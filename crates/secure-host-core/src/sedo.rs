//! Native transport for the official Sedo seller portfolio.
use reqwest::{Client, Request, StatusCode, header};
use std::{collections::BTreeSet, fmt, time::Duration};
use zeroize::Zeroizing;

#[path = "sedo/credentials.rs"]
mod credentials;
pub use credentials::{
    SedoCapture, SedoCredentialPlan, load_sedo_credential_guarded, publish_sedo_credential_guarded,
    purge_sedo_credential_guarded,
};
#[path = "sedo/portfolio_wire.rs"]
mod portfolio_wire;

const INVENTORY_URL: &str = "https://api.sedo.com/api/v1/DomainListExtended";
const PAGE_SIZE: usize = 100;
const MAX_LISTINGS: usize = 10_000;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SedoError {
    AuthorityStale,
    InputRejected,
    CaptureCancelled,
    CustodyUnavailable,
    CustodyMismatch,
    CustodyOutcomeUnknown,
    AuthenticationRequired,
    Forbidden,
    RateLimited,
    Unavailable,
    ProviderFault,
    ProtocolRejected,
}

impl fmt::Display for SedoError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "sedo_authority_stale",
            Self::InputRejected => "sedo_input_rejected",
            Self::CaptureCancelled => "sedo_capture_cancelled",
            Self::CustodyUnavailable => "sedo_custody_unavailable",
            Self::CustodyMismatch => "sedo_custody_mismatch",
            Self::CustodyOutcomeUnknown => "sedo_custody_outcome_unknown",
            Self::AuthenticationRequired => "sedo_authentication_required",
            Self::Forbidden => "sedo_forbidden",
            Self::RateLimited => "sedo_rate_limited",
            Self::Unavailable => "sedo_unavailable",
            Self::ProviderFault => "sedo_provider_fault",
            Self::ProtocolRejected => "sedo_protocol_rejected",
        })
    }
}

impl std::error::Error for SedoError {}

pub type SedoGuard<'a> = dyn FnMut() -> Result<(), SedoError> + Send + 'a;

pub struct SedoCredential {
    partner_id: Zeroizing<String>,
    sign_key: Zeroizing<String>,
    username: Zeroizing<String>,
    password: Zeroizing<String>,
}

impl fmt::Debug for SedoCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("SedoCredential([redacted])")
    }
}

impl SedoCredential {
    /// Validates the four inputs obtained by Native capture.
    ///
    /// # Errors
    /// Rejects invalid partner IDs, empty values, and values outside the official field bounds.
    fn from_native_fields(
        partner_id: Zeroizing<String>,
        sign_key: Zeroizing<String>,
        username: Zeroizing<String>,
        password: Zeroizing<String>,
    ) -> Result<Self, SedoError> {
        if partner_id.len() > 10
            || partner_id.starts_with('0')
            || !partner_id.bytes().all(|byte| byte.is_ascii_digit())
            || partner_id.parse::<i32>().is_err()
            || !valid_credential_field(&sign_key, 256)
            || !valid_credential_field(&username, 25)
            || !valid_credential_field(&password, 16)
        {
            return Err(SedoError::InputRejected);
        }
        Ok(Self {
            partner_id,
            sign_key,
            username,
            password,
        })
    }
}

fn valid_credential_field(value: &str, maximum_chars: usize) -> bool {
    !value.trim().is_empty()
        && value.chars().take(maximum_chars + 1).count() <= maximum_chars
        && !value.chars().any(char::is_control)
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SedoCurrency {
    Eur,
    Usd,
    Gbp,
}

#[derive(Debug, PartialEq, Eq)]
pub struct SedoListing {
    pub domain: String,
    pub for_sale: bool,
    pub fixed_price: bool,
    pub price_cents: Option<u64>,
    pub minimum_price_cents: Option<u64>,
    pub currency: SedoCurrency,
}

pub struct SedoPortfolioClient {
    client: Client,
}

impl SedoPortfolioClient {
    /// Creates the fixed-origin HTTPS client. The official XML POST keeps credentials in the body.
    ///
    /// # Errors
    /// Returns a redacted error if TLS transport cannot initialize.
    pub fn production() -> Result<Self, SedoError> {
        Client::builder()
            .https_only(true)
            .http1_only()
            .no_proxy()
            .connection_verbose(false)
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map(|client| Self { client })
            .map_err(|_| SedoError::Unavailable)
    }

    /// Reads the complete bounded seller portfolio. A fault or inconsistent page yields no inventory.
    ///
    /// # Errors
    /// Refuses stale authority, transport failures, unrecognized responses, and duplicate domains.
    pub async fn inventory(
        &self,
        credential: &SedoCredential,
        guard: &mut SedoGuard<'_>,
    ) -> Result<Vec<SedoListing>, SedoError> {
        let mut listings = Vec::new();
        let mut seen = BTreeSet::new();
        // Count requests as well as rows, including the authenticated empty page that completes it.
        for _ in 0..=(MAX_LISTINGS / PAGE_SIZE + 1) {
            guard()?;
            let response = self
                .client
                .execute(self.inventory_request(credential, listings.len())?)
                .await;
            guard()?;
            let bytes =
                read_inventory_response(response.map_err(|_| SedoError::Unavailable)?, guard)
                    .await?;
            let page = portfolio_wire::parse_inventory_page(&bytes, PAGE_SIZE).map_err(
                |error| match error {
                    portfolio_wire::InventoryError::CredentialsRequired => {
                        SedoError::AuthenticationRequired
                    }
                    portfolio_wire::InventoryError::Forbidden => SedoError::Forbidden,
                    portfolio_wire::InventoryError::Unavailable => SedoError::Unavailable,
                    portfolio_wire::InventoryError::ProviderFault => SedoError::ProviderFault,
                    portfolio_wire::InventoryError::Malformed => SedoError::ProtocolRejected,
                },
            )?;
            guard()?;
            if page.is_empty() {
                return Ok(listings);
            }
            if listings.len() + page.len() > MAX_LISTINGS {
                return Err(SedoError::ProtocolRejected);
            }
            for row in page {
                if !seen.insert(row.domain.clone()) {
                    return Err(SedoError::ProtocolRejected);
                }
                listings.push(row);
            }
        }
        Err(SedoError::ProtocolRejected)
    }

    fn inventory_request(
        &self,
        credential: &SedoCredential,
        start: usize,
    ) -> Result<Request, SedoError> {
        if start > MAX_LISTINGS {
            return Err(SedoError::InputRejected);
        }
        let mut fields = url::form_urlencoded::Serializer::new(String::new());
        fields
            .append_pair("partnerid", &credential.partner_id)
            .append_pair("signkey", &credential.sign_key)
            .append_pair("username", &credential.username)
            .append_pair("password", &credential.password)
            .append_pair("output_method", "xml")
            .append_pair("startfrom", &start.to_string())
            .append_pair("results", &PAGE_SIZE.to_string())
            .append_pair("orderby", "0");
        self.client
            .post(INVENTORY_URL)
            .header(header::ACCEPT, "application/xml, text/xml")
            .header(header::CONTENT_TYPE, "application/x-www-form-urlencoded")
            .header(header::CACHE_CONTROL, "no-store")
            .body(fields.finish())
            .build()
            .map_err(|_| SedoError::InputRejected)
    }
}

async fn read_inventory_response(
    mut response: reqwest::Response,
    guard: &mut SedoGuard<'_>,
) -> Result<Zeroizing<Vec<u8>>, SedoError> {
    let malformed = SedoError::ProtocolRejected;
    match response.status() {
        StatusCode::OK => {}
        StatusCode::UNAUTHORIZED => return Err(SedoError::AuthenticationRequired),
        StatusCode::FORBIDDEN => return Err(SedoError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => return Err(SedoError::RateLimited),
        status if status.is_server_error() => return Err(SedoError::Unavailable),
        _ => return Err(malformed),
    }
    let mut types = response.headers().get_all(header::CONTENT_TYPE).iter();
    let content_type = types
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(malformed)?;
    let mut content_type = content_type.split(';').map(str::trim);
    let media = content_type.next().ok_or(malformed)?;
    if !(media.eq_ignore_ascii_case("application/xml") || media.eq_ignore_ascii_case("text/xml"))
        || content_type
            .next()
            .is_some_and(|value| !value.eq_ignore_ascii_case("charset=utf-8"))
        || content_type.next().is_some()
        || types.next().is_some()
        || response
            .content_length()
            .is_some_and(|length| length > portfolio_wire::MAX_PAGE_BYTES as u64)
    {
        return Err(malformed);
    }
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = response.chunk().await.map_err(|_| SedoError::Unavailable)? {
        guard()?;
        if chunk.len() > portfolio_wire::MAX_PAGE_BYTES - body.len() {
            return Err(malformed);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_the_documented_post_with_no_filters_or_credentials_in_its_url() {
        let credential = SedoCredential::from_native_fields(
            Zeroizing::new("1234".into()),
            Zeroizing::new("fixture-key".into()),
            Zeroizing::new("fixture-user".into()),
            Zeroizing::new("p&=?".into()),
        )
        .unwrap();
        let request = SedoPortfolioClient::production()
            .unwrap()
            .inventory_request(&credential, 100)
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(request.url().as_str(), INVENTORY_URL);
        let bytes = request.body().unwrap().as_bytes().unwrap();
        let fields = url::form_urlencoded::parse(bytes)
            .into_owned()
            .collect::<std::collections::BTreeMap<_, _>>();
        assert_eq!(fields.len(), 8);
        assert_eq!(fields["password"], "p&=?");
        assert_eq!(fields["startfrom"], "100");
        assert_eq!(fields["results"], "100");
        assert_eq!(fields["output_method"], "xml");
        assert_eq!(fields["orderby"], "0");
    }
}
