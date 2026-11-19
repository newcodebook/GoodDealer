//! Afternic's fixed official customer API. Evidence: API 3.0.0, `OpenAPI` 3.2.0,
//! SHA-256 0f384f5f33abd5bdbaff47a9cc8290ae2d20db27c92b5ca64b9386797da0d48b.
//! Provider URLs, authentication, and response bodies never become a public forwarding API.

use crate::{afternic_credentials::AfternicCredential, afternic_wire};
use futures_util::StreamExt;
use reqwest::{Client, Method, header};
use serde::Serialize;
use std::{
    collections::BTreeSet,
    fmt,
    future::Future,
    pin::Pin,
    sync::Mutex,
    time::{Duration, Instant},
};
use zeroize::Zeroizing;

#[cfg(test)]
#[path = "afternic_provider_tests.rs"]
mod tests;

pub(super) const ORIGIN: &str = "https://api.afternic.com";
pub(super) const DOMAIN_PATH: &str = "/v3/aftermarket/customers/my/domains";
pub(super) const PAGE_SIZE: usize = 50;
pub(super) const MAX_DOMAINS: usize = 10_000;
pub(super) const MAX_PRICE: u64 = 49_999_999_000_000;
const MAX_BODY: usize = 1_048_576;
// A shared admission schedule also covers separate client instances and read requests. 410ms
// spacing stays below 150/minute without treating X-Request-Id as an idempotency promise.
static NEXT_REQUEST: Mutex<Option<Instant>> = Mutex::new(None);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AfternicError {
    AuthorityStale,
    InputRejected,
    AuthenticationRequired,
    Forbidden,
    RateLimited { retry_after_seconds: u32 },
    Rejected,
    Retryable,
    OutcomeUnknown,
    ProtocolRejected,
    CustodyUnavailable,
    CustodyMismatch,
    CaptureCancelled,
}
impl fmt::Display for AfternicError {
    fn fmt(&self, out: &mut fmt::Formatter<'_>) -> fmt::Result {
        out.write_str(match self {
            Self::AuthorityStale => "afternic_authority_stale",
            Self::InputRejected => "afternic_input_rejected",
            Self::AuthenticationRequired => "afternic_authentication_required",
            Self::Forbidden => "afternic_forbidden",
            Self::RateLimited { .. } => "afternic_rate_limited",
            Self::Rejected => "afternic_rejected",
            Self::Retryable => "afternic_retryable",
            Self::OutcomeUnknown => "afternic_outcome_unknown",
            Self::ProtocolRejected => "afternic_protocol_rejected",
            Self::CustodyUnavailable => "afternic_custody_unavailable",
            Self::CustodyMismatch => "afternic_custody_mismatch",
            Self::CaptureCancelled => "afternic_capture_cancelled",
        })
    }
}
impl std::error::Error for AfternicError {}
pub type AfternicGuard<'a> = dyn FnMut() -> Result<(), AfternicError> + Send + 'a;

#[derive(Clone, Copy, Debug, PartialEq, Eq, serde::Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub enum AfternicListingStatus {
    Pending,
    FailedCompliance,
    Active,
    Hidden,
    OnHold,
    Sold,
    Inactive,
    OwnershipReview,
    OwnershipUnverified,
    VerifiedOwnerConflict,
    InventoryComplianceIssue,
    TldUnsupported,
    UnregisteredDomain,
    Unknown,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AfternicListing {
    pub domain: String,
    pub status: AfternicListingStatus,
    pub buynow_price: Option<u64>,
    pub floor_price: Option<u64>,
    pub minbid_price: Option<u64>,
    pub hidden: Option<bool>,
    pub created_at: String,
    pub updated_at: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AfternicPortfolio {
    pub listings: Vec<AfternicListing>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AfternicDomainObservation {
    pub domain: String,
    pub listing: Option<AfternicListing>,
}

/// Approved prices are integer micro-USD, whole dollars only. None means omitted, never zero.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AfternicListingFields {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub buynow_price: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub floor_price: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub minbid_price: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub hidden: Option<bool>,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AfternicListingIntent {
    Create {
        domain: String,
        fields: AfternicListingFields,
    },
    Update {
        domain: String,
        fields: AfternicListingFields,
    },
    Remove {
        domain: String,
    },
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AfternicWriteOutcome {
    AcceptedPendingVerification,
}

pub struct AfternicProviderClient {
    transport: Box<dyn Transport>,
}
impl AfternicProviderClient {
    /// Constructs the fixed HTTPS transport, without redirects, proxy inheritance or retries.
    /// # Errors
    /// Returns a closed error when native TLS/client initialization is unavailable.
    pub fn production() -> Result<Self, AfternicError> {
        let client = http_client_builder()
            .build()
            .map_err(|_| AfternicError::Retryable)?;
        Ok(Self {
            transport: Box::new(HttpTransport { client }),
        })
    }

    /// Returns only a complete bounded portfolio. Partial scans, changing totals, repeated
    /// domains or inconsistent pagination are refused, so callers cannot treat them as absence.
    /// # Errors
    /// Returns a closed authority, transport, protocol or account access classification.
    pub async fn scan(
        &mut self,
        credential: &AfternicCredential,
        guard: &mut AfternicGuard<'_>,
    ) -> Result<AfternicPortfolio, AfternicError> {
        let mut listings = Vec::new();
        let mut names = BTreeSet::new();
        let mut total = None;
        loop {
            let offset = listings.len();
            let response = self
                .request(
                    credential,
                    Request::read(format!(
                        "{DOMAIN_PATH}?offset={offset}&limit={PAGE_SIZE}&order=NAME_ASC"
                    )),
                    guard,
                )
                .await?;
            require_status(&response, &[200], false)?;
            let page = afternic_wire::parse_page(&response.body, offset)?;
            if total.is_some_and(|expected| expected != page.total) {
                return Err(AfternicError::ProtocolRejected);
            }
            total = Some(page.total);
            for listing in page.listings {
                if names
                    .last()
                    .is_some_and(|previous| previous >= &listing.domain)
                    || !names.insert(listing.domain.clone())
                {
                    return Err(AfternicError::ProtocolRejected);
                }
                listings.push(listing);
            }
            if listings.len() == page.total {
                guard()?;
                return Ok(AfternicPortfolio { listings });
            }
            if listings.len() >= MAX_DOMAINS || listings.len() == offset {
                return Err(AfternicError::ProtocolRejected);
            }
        }
    }

    /// Reconciles an exact bounded domain set. A single invalid/failed response refuses the
    /// entire observation; authenticated `RESOURCE_NOT_FOUND` alone means absent.
    /// # Errors
    /// Refuses invalid domains, duplicates, stale authority and untrusted Provider responses.
    pub async fn observe(
        &mut self,
        credential: &AfternicCredential,
        domains: &[String],
        guard: &mut AfternicGuard<'_>,
    ) -> Result<Vec<AfternicDomainObservation>, AfternicError> {
        if domains.is_empty()
            || domains.len() > 500
            || domains.iter().any(|domain| !valid_domain(domain))
            || domains.iter().collect::<BTreeSet<_>>().len() != domains.len()
        {
            return Err(AfternicError::InputRejected);
        }
        let mut observations = Vec::with_capacity(domains.len());
        for domain in domains {
            let response = self
                .request(
                    credential,
                    Request::read(format!("{DOMAIN_PATH}/{domain}")),
                    guard,
                )
                .await?;
            let listing =
                if response.status == 404 && afternic_wire::is_domain_missing(&response.body)? {
                    None
                } else {
                    require_status(&response, &[200], false)?;
                    let listing = afternic_wire::parse_listing(&response.body)?;
                    if listing.domain != *domain {
                        return Err(AfternicError::ProtocolRejected);
                    }
                    Some(listing)
                };
            observations.push(AfternicDomainObservation {
                domain: domain.clone(),
                listing,
            });
        }
        guard()?;
        Ok(observations)
    }

    /// Sends exactly one previously approved item, never automatically retrying a mutation.
    /// A successful response is only acceptance: the durable owner must perform a separate GET.
    /// # Errors
    /// Any ambiguous post-send failure is `OutcomeUnknown` and requires reconciliation.
    pub async fn execute(
        &mut self,
        credential: &AfternicCredential,
        intent: &AfternicListingIntent,
        guard: &mut AfternicGuard<'_>,
    ) -> Result<AfternicWriteOutcome, AfternicError> {
        let (request, domain, statuses) = prepare_intent(intent)?;
        let response = self.request(credential, request, guard).await?;
        require_status(&response, statuses, true)?;
        if response.status == 204 {
            if !response.body.is_empty() {
                return Err(AfternicError::OutcomeUnknown);
            }
        } else {
            let listing = afternic_wire::parse_listing(&response.body)
                .map_err(|_| AfternicError::OutcomeUnknown)?;
            if listing.domain != domain {
                return Err(AfternicError::OutcomeUnknown);
            }
        }
        guard().map_err(|_| AfternicError::OutcomeUnknown)?;
        Ok(AfternicWriteOutcome::AcceptedPendingVerification)
    }

    async fn request(
        &mut self,
        credential: &AfternicCredential,
        request: Request,
        guard: &mut AfternicGuard<'_>,
    ) -> Result<Response, AfternicError> {
        guard()?;
        let mutation = request.method != Method::GET;
        let result = self.transport.send(request, credential, guard).await;
        if guard().is_err() {
            return Err(
                if mutation && !matches!(result, Err(AfternicError::AuthorityStale)) {
                    AfternicError::OutcomeUnknown
                } else {
                    AfternicError::AuthorityStale
                },
            );
        }
        result
    }
}

fn prepare_intent(
    intent: &AfternicListingIntent,
) -> Result<(Request, &str, &'static [u16]), AfternicError> {
    let (domain, fields) = match intent {
        AfternicListingIntent::Create { domain, fields }
        | AfternicListingIntent::Update { domain, fields } => (domain, Some(fields)),
        AfternicListingIntent::Remove { domain } => (domain, None),
    };
    if !valid_domain(domain) {
        return Err(AfternicError::InputRejected);
    }
    if let Some(fields) = fields
        && (fields
            .buynow_price
            .is_some_and(|value| !valid_price(value, false))
            || fields
                .floor_price
                .is_some_and(|value| !valid_price(value, false))
            || fields
                .minbid_price
                .is_some_and(|value| !valid_price(value, true))
            || fields == &AfternicListingFields::default())
    {
        return Err(AfternicError::InputRejected);
    }
    let (method, path, body, statuses): (_, _, _, &'static [u16]) = match intent {
        AfternicListingIntent::Create { fields, .. } => {
            let mut body =
                serde_json::to_value(fields).map_err(|_| AfternicError::InputRejected)?;
            body.as_object_mut()
                .ok_or(AfternicError::InputRejected)?
                .insert("name".to_owned(), domain.clone().into());
            (Method::POST, DOMAIN_PATH.to_owned(), Some(body), &[201])
        }
        AfternicListingIntent::Update { fields, .. } => (
            Method::PATCH,
            format!("{DOMAIN_PATH}/{domain}?resource=true"),
            Some(serde_json::to_value(fields).map_err(|_| AfternicError::InputRejected)?),
            &[200, 204],
        ),
        AfternicListingIntent::Remove { .. } => (
            Method::DELETE,
            format!("{DOMAIN_PATH}/{domain}"),
            None,
            &[204],
        ),
    };
    let body = body
        .map(|body| serde_json::to_vec(&body))
        .transpose()
        .map_err(|_| AfternicError::InputRejected)?;
    Ok((Request { method, path, body }, domain, statuses))
}

pub(super) fn valid_domain(value: &str) -> bool {
    value.len() <= 253
        && value.split('.').count() >= 2
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-')
        })
        && value
            .rsplit('.')
            .next()
            .is_some_and(|label| label.len() >= 2)
}
pub(super) const fn valid_price(value: u64, minimum_bid: bool) -> bool {
    value <= MAX_PRICE && value.is_multiple_of(1_000_000) && (!minimum_bid || value >= 20_000_000)
}

struct Request {
    method: Method,
    path: String,
    body: Option<Vec<u8>>,
}
impl Request {
    fn read(path: String) -> Self {
        Self {
            method: Method::GET,
            path,
            body: None,
        }
    }
}
struct Response {
    status: u16,
    retry_after: Option<u32>,
    body: Vec<u8>,
}
type ResponseFuture<'a> =
    Pin<Box<dyn Future<Output = Result<Response, AfternicError>> + Send + 'a>>;
trait Transport: Send {
    fn send<'a>(
        &'a mut self,
        request: Request,
        credential: &'a AfternicCredential,
        guard: &'a mut AfternicGuard<'_>,
    ) -> ResponseFuture<'a>;
}
struct HttpTransport {
    client: Client,
}
impl Transport for HttpTransport {
    fn send<'a>(
        &'a mut self,
        request: Request,
        credential: &'a AfternicCredential,
        guard: &'a mut AfternicGuard<'_>,
    ) -> ResponseFuture<'a> {
        Box::pin(async move {
            wait_request_slot(guard).await?;
            let mutation = request.method != Method::GET;
            let uncertain = || {
                if mutation {
                    AfternicError::OutcomeUnknown
                } else {
                    AfternicError::Retryable
                }
            };
            let authorization = credential.authorization();
            let mut header = header::HeaderValue::from_str(&authorization)
                .map_err(|_| AfternicError::InputRejected)?;
            header.set_sensitive(true);
            let mut builder = self
                .client
                .request(request.method, format!("{ORIGIN}{}", request.path))
                .header(header::AUTHORIZATION, header)
                .header(header::ACCEPT, "application/json");
            if let Some(body) = request.body {
                builder = builder
                    .header(header::CONTENT_TYPE, "application/json")
                    .body(body);
            }
            let built = builder.build().map_err(|_| AfternicError::InputRejected)?;
            guard()?;
            let response = self.client.execute(built).await.map_err(|_| uncertain())?;
            guard().map_err(|_| uncertain())?;
            let status = response.status().as_u16();
            let retry_after = if status == 429 {
                retry_after_header(response.headers())?
            } else {
                None
            };
            if !(200..300).contains(&status) && status != 429 && (status != 404 || mutation) {
                // Closed HTTP failures need no Provider text; dropping the response also prevents
                // large HTML/diagnostic bodies from turning an ordinary denial into parse failure.
                return Ok(Response {
                    status,
                    retry_after,
                    body: Vec::new(),
                });
            }
            if response
                .content_length()
                .is_some_and(|n| n > MAX_BODY as u64)
            {
                return Err(if mutation {
                    AfternicError::OutcomeUnknown
                } else {
                    AfternicError::ProtocolRejected
                });
            }
            if status != 204
                && status != 429
                && response
                    .headers()
                    .get(header::CONTENT_TYPE)
                    .and_then(|v| v.to_str().ok())
                    .is_none_or(|v| {
                        !v.split(';')
                            .next()
                            .is_some_and(|v| v.trim().eq_ignore_ascii_case("application/json"))
                    })
            {
                return Err(if mutation {
                    AfternicError::OutcomeUnknown
                } else {
                    AfternicError::ProtocolRejected
                });
            }
            let mut stream = response.bytes_stream();
            let mut body = Zeroizing::new(Vec::new());
            loop {
                guard().map_err(|_| uncertain())?;
                let chunk = stream.next().await;
                guard().map_err(|_| uncertain())?;
                let Some(chunk) = chunk else {
                    break;
                };
                let chunk = chunk.map_err(|_| uncertain())?;
                if body.len().saturating_add(chunk.len()) > MAX_BODY {
                    return Err(if mutation {
                        AfternicError::OutcomeUnknown
                    } else {
                        AfternicError::ProtocolRejected
                    });
                }
                body.extend_from_slice(&chunk);
            }
            Ok(Response {
                status,
                retry_after,
                body: std::mem::take(&mut *body),
            })
        })
    }
}
fn require_status(
    response: &Response,
    allowed: &[u16],
    mutation: bool,
) -> Result<(), AfternicError> {
    if allowed.contains(&response.status) {
        return Ok(());
    }
    Err(match response.status {
        401 => AfternicError::AuthenticationRequired,
        403 => AfternicError::Forbidden,
        429 => AfternicError::RateLimited {
            retry_after_seconds: afternic_wire::retry_after(&response.body)?
                .into_iter()
                .chain(response.retry_after)
                .max()
                .unwrap_or(60),
        },
        400 | 404 | 409 | 422 => AfternicError::Rejected,
        _ if mutation => AfternicError::OutcomeUnknown,
        500..=599 => AfternicError::Retryable,
        _ => AfternicError::ProtocolRejected,
    })
}

// The currently evidenced retry hint is delta-seconds. Unsupported date syntax, duplicate
// headers and unrepresentable values stop the operation instead of scheduling an early retry.
fn retry_after_header(headers: &header::HeaderMap) -> Result<Option<u32>, AfternicError> {
    let mut values = headers.get_all(header::RETRY_AFTER).iter();
    let Some(value) = values.next() else {
        return Ok(None);
    };
    if values.next().is_some() {
        return Err(AfternicError::ProtocolRejected);
    }
    let value = value
        .to_str()
        .map_err(|_| AfternicError::ProtocolRejected)?;
    if value.is_empty() || value.len() > 10 || !value.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(AfternicError::ProtocolRejected);
    }
    let seconds: u32 = value.parse().map_err(|_| AfternicError::ProtocolRejected)?;
    Ok(Some(seconds.max(1)))
}

fn http_client_builder() -> reqwest::ClientBuilder {
    Client::builder()
        .https_only(true)
        .redirect(reqwest::redirect::Policy::none())
        .retry(reqwest::retry::never())
        .no_proxy()
        .timeout(Duration::from_secs(30))
        .connect_timeout(Duration::from_secs(10))
        .user_agent("GoodDealer/0.0.0 (Afternic portfolio client)")
}

async fn wait_request_slot(guard: &mut AfternicGuard<'_>) -> Result<(), AfternicError> {
    let slot = {
        let mut next = NEXT_REQUEST.lock().map_err(|_| AfternicError::Retryable)?;
        let slot = next.unwrap_or_else(Instant::now).max(Instant::now());
        *next = slot.checked_add(Duration::from_millis(410));
        slot
    };
    while let Some(remaining) = slot.checked_duration_since(Instant::now()) {
        guard()?;
        tokio::time::sleep(remaining.min(Duration::from_millis(100))).await;
        guard()?;
    }
    Ok(())
}
