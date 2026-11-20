//! Closed account-level Cloudflare Registrar reads within the existing Provider service.

use super::{
    API_PREFIX, CloudflareCredentialObservationPlan, CloudflareProviderClient,
    CloudflareProviderError, CloudflareProviderGuard, canonicalize_timestamp, is_control_or_format,
    is_lower_hex_id, load_observation_credential, normalize_fqdn, parse_bounded_json,
};
use ring::hmac;
use serde::Deserialize;
use std::{collections::BTreeSet, fmt, fmt::Write as _};

const PAGE_SIZE: usize = 25;
const MAX_REGISTRATIONS: usize = 10_000;
const MAX_CURSOR_BYTES: usize = 256;

/// The account-scoped facts returned only after all pages were accepted.
pub struct CloudflareRegistrationInventory {
    pub account_digest: String,
    pub registrations: Vec<CloudflareRegistration>,
}

impl fmt::Debug for CloudflareRegistrationInventory {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareRegistrationInventory([REDACTED])")
    }
}

/// Local Registrar facts. Pending registrations are represented separately from confirmed ones.
pub struct CloudflareRegistration {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: Option<String>,
    pub auto_renew: bool,
    pub locked: bool,
    pub standing: CloudflareRegistrationStanding,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum CloudflareRegistrationStanding {
    Active,
    Pending,
    Inactive,
}

impl fmt::Debug for CloudflareRegistration {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareRegistration([REDACTED])")
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ZoneAccount {
    id: String,
    #[serde(rename = "name")]
    _name: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistrationPage {
    success: bool,
    errors: Vec<serde::de::IgnoredAny>,
    messages: Vec<serde::de::IgnoredAny>,
    result: Vec<RegistrationWire>,
    result_info: CursorPage,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CursorPage {
    count: usize,
    per_page: usize,
    cursor: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum RegistrationStatus {
    Active,
    RegistrationPending,
    TransferPending,
    Expired,
    Suspended,
    RedemptionPeriod,
    PendingDelete,
}

#[derive(Deserialize)]
#[serde(rename_all = "snake_case")]
enum PrivacyMode {
    Off,
    Redaction,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RegistrationWire {
    domain_name: String,
    created_at: String,
    // Required field, nullable only for the two pending states.
    #[serde(deserialize_with = "Deserialize::deserialize")]
    expires_at: Option<String>,
    auto_renew: bool,
    locked: bool,
    #[serde(rename = "privacy_mode")]
    _privacy_mode: PrivacyMode,
    status: RegistrationStatus,
}

fn project_registration(
    registration: RegistrationWire,
) -> Result<CloudflareRegistration, CloudflareProviderError> {
    let invalid = CloudflareProviderError::InvalidResponse;
    let standing = match registration.status {
        RegistrationStatus::Active => CloudflareRegistrationStanding::Active,
        RegistrationStatus::RegistrationPending | RegistrationStatus::TransferPending => {
            CloudflareRegistrationStanding::Pending
        }
        RegistrationStatus::Expired
        | RegistrationStatus::Suspended
        | RegistrationStatus::RedemptionPeriod
        | RegistrationStatus::PendingDelete => CloudflareRegistrationStanding::Inactive,
    };
    let domain = normalize_fqdn(&registration.domain_name).ok_or(invalid)?;
    let registered_at = canonicalize_timestamp(&registration.created_at).ok_or(invalid)?;
    let expires_at = match registration.expires_at {
        Some(value) => Some(canonicalize_timestamp(&value).ok_or(invalid)?),
        None if standing == CloudflareRegistrationStanding::Pending => None,
        None => return Err(invalid),
    };
    if expires_at
        .as_ref()
        .is_some_and(|expiry| expiry < &registered_at)
    {
        return Err(invalid);
    }
    Ok(CloudflareRegistration {
        domain,
        registered_on: registered_at[..10].to_owned(),
        expires_on: expires_at.map(|expiry| expiry[..10].to_owned()),
        auto_renew: registration.auto_renew,
        locked: registration.locked,
        standing,
    })
}

impl CloudflareProviderClient {
    /// Reads the complete Registrar inventory of the account owning the exact stored Zone.
    /// The calling Host must grant a separate Registrar read admission and bind its account digest.
    ///
    /// # Errors
    ///
    /// Rejects stale admission, credential or account mismatch, repeated cursors, malformed
    /// responses and incomplete or excessive inventories. No Provider account ID is returned.
    pub async fn scan_registrations_guarded(
        &mut self,
        plan: &(impl CloudflareCredentialObservationPlan + ?Sized),
        expected_account_digest: Option<&str>,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<CloudflareRegistrationInventory, CloudflareProviderError> {
        let credential = load_observation_credential(plan, guard)?;
        let token = credential
            .token()
            .ok_or(CloudflareProviderError::InvalidInput)?;
        self.scan_registrations(
            credential.zone_id(),
            token,
            plan.connection_digest(),
            expected_account_digest,
            guard,
        )
        .await
    }

    pub(super) async fn scan_registrations(
        &mut self,
        zone_id: &str,
        token: &str,
        connection_digest: &str,
        expected_account_digest: Option<&str>,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<CloudflareRegistrationInventory, CloudflareProviderError> {
        let invalid = CloudflareProviderError::InvalidResponse;
        guard()?;
        if !is_lower_hex_id(zone_id) || token.is_empty() || token.len() > 4096 {
            return Err(CloudflareProviderError::InvalidInput);
        }
        let zone = self
            .request_raw_zone::<ZoneAccount>(zone_id, token, guard)
            .await?;
        let account = zone.account.ok_or(invalid)?;
        if !is_lower_hex_id(&account.id) {
            return Err(invalid);
        }
        // The receipt stores a slot-specific commitment, not a reusable account identifier.
        let key = hmac::Key::new(hmac::HMAC_SHA256, token.as_bytes());
        let mut digest = hmac::Context::with_key(&key);
        digest.update(b"GoodDealer/Cloudflare/RegistrarAccount/v1\0");
        digest.update(connection_digest.as_bytes());
        digest.update(account.id.as_bytes());
        let account_digest =
            digest
                .sign()
                .as_ref()
                .iter()
                .fold(String::with_capacity(64), |mut hex, byte| {
                    write!(hex, "{byte:02x}").expect("format into a string");
                    hex
                });
        if expected_account_digest.is_some_and(|expected| expected != account_digest) {
            return Err(invalid);
        }
        let mut registrations = self
            .read_registration_pages(&account.id, token, guard)
            .await?;
        registrations.sort_unstable_by(|a, b| a.domain.cmp(&b.domain));
        guard()?;
        Ok(CloudflareRegistrationInventory {
            account_digest,
            registrations,
        })
    }

    async fn read_registration_pages(
        &mut self,
        account_id: &str,
        token: &str,
        guard: &mut CloudflareProviderGuard<'_>,
    ) -> Result<Vec<CloudflareRegistration>, CloudflareProviderError> {
        let invalid = CloudflareProviderError::InvalidResponse;
        let path = format!("{API_PREFIX}/accounts/{account_id}/registrar/registrations");
        let mut cursor = String::new();
        let mut cursors = BTreeSet::new();
        let mut domains = BTreeSet::new();
        let mut registrations = Vec::new();

        for _ in 0..=MAX_REGISTRATIONS.div_ceil(PAGE_SIZE) {
            let mut query = format!("per_page={PAGE_SIZE}&sort_by=name&direction=asc");
            if !cursor.is_empty() {
                query = url::form_urlencoded::Serializer::new(query)
                    .append_pair("cursor", &cursor)
                    .finish();
            }
            let body = self
                .request_at_provider(&path, &query, token, guard)
                .await?;
            let page: RegistrationPage = parse_bounded_json(&body)?;
            let count = page.result.len();
            if !page.success
                || !page.errors.is_empty()
                || !page.messages.is_empty()
                || page.result_info.per_page != PAGE_SIZE
                || count > PAGE_SIZE
                || count != page.result_info.count
            {
                return Err(invalid);
            }
            if registrations.len() + count > MAX_REGISTRATIONS {
                return Err(CloudflareProviderError::ResponseLimit);
            }
            for wire in page.result {
                let registration = project_registration(wire)?;
                if !domains.insert(registration.domain.clone()) {
                    return Err(invalid);
                }
                registrations.push(registration);
            }
            cursor = page.result_info.cursor;
            if cursor.is_empty() {
                return Ok(registrations);
            }
            if count == 0
                || cursor.len() > MAX_CURSOR_BYTES
                || cursor.chars().any(is_control_or_format)
                || !cursors.insert(cursor.clone())
            {
                return Err(invalid);
            }
        }
        Err(CloudflareProviderError::ResponseLimit)
    }
}
