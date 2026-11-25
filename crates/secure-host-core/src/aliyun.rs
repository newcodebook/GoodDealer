//! Alibaba Cloud Domain 2018-01-29 `QueryDomainList`. Only projected registration facts leave this
//! service. `AccessKey` material, request signatures and raw provider payloads are Native-only.

use futures_util::StreamExt;
use reqwest::{Client, Request, StatusCode, header};
use std::{fmt, time::Duration};
use time::OffsetDateTime;
use zeroize::Zeroizing;

mod credentials;
mod registrar_wire;
mod signing;

pub use credentials::{
    AliyunCapture, AliyunCredentialPlan, load_aliyun_credential_guarded,
    publish_aliyun_credential_guarded, purge_aliyun_credential_guarded,
};

const DOMAIN_HOST: &str = "domain.aliyuncs.com";
const PAGE_SIZE: usize = 50;
const MAX_REGISTRATIONS: usize = 10_000;
const MAX_BODY: usize = 512 * 1024;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum AliyunError {
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
    ProtocolRejected,
}

impl fmt::Display for AliyunError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(match self {
            Self::AuthorityStale => "aliyun_authority_stale",
            Self::InputRejected => "aliyun_input_rejected",
            Self::CaptureCancelled => "aliyun_capture_cancelled",
            Self::CustodyUnavailable => "aliyun_custody_unavailable",
            Self::CustodyMismatch => "aliyun_custody_mismatch",
            Self::CustodyOutcomeUnknown => "aliyun_custody_outcome_unknown",
            Self::AuthenticationRequired => "aliyun_authentication_required",
            Self::Forbidden => "aliyun_forbidden",
            Self::RateLimited => "aliyun_rate_limited",
            Self::Unavailable => "aliyun_unavailable",
            Self::ProtocolRejected => "aliyun_protocol_rejected",
        })
    }
}

impl std::error::Error for AliyunError {}

pub type AliyunGuard<'a> = dyn FnMut() -> Result<(), AliyunError> + Send + 'a;

pub struct AliyunCredential {
    key: Zeroizing<String>,
    secret: Zeroizing<String>,
}

impl fmt::Debug for AliyunCredential {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("AliyunCredential([REDACTED])")
    }
}

pub struct AliyunRegistration {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: String,
    pub auto_renew: Option<bool>,
    pub active: bool,
}

pub struct AliyunRegistrarClient {
    client: Client,
}

impl AliyunRegistrarClient {
    /// Constructs a direct HTTPS client restricted to the Domain API request below.
    ///
    /// # Errors
    /// Returns `Unavailable` if Native TLS initialization fails.
    pub fn production() -> Result<Self, AliyunError> {
        Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(30))
            .connect_timeout(Duration::from_secs(10))
            .user_agent("GoodDealer/0.0.0 (Alibaba Cloud Registrar client)")
            .build()
            .map(|client| Self { client })
            .map_err(|_| AliyunError::Unavailable)
    }

    /// Reads the complete account list using the admitted RAM credential. The Provider supplies
    /// no snapshot ID; page metadata and domain uniqueness can detect inconsistent scans.
    ///
    /// # Errors
    /// Rejects stale authority, permission failures, limits and invalid or incomplete responses.
    pub async fn scan(
        &self,
        credential: &AliyunCredential,
        guard: &mut AliyunGuard<'_>,
    ) -> Result<Vec<AliyunRegistration>, AliyunError> {
        let mut inventory = registrar_wire::InventoryScan::default();
        loop {
            guard()?;
            let mut nonce = [0_u8; 16];
            getrandom::fill(&mut nonce).map_err(|_| AliyunError::Unavailable)?;
            let request = self.request(
                credential,
                inventory.next_page(),
                OffsetDateTime::now_utc(),
                &signing::lower_hex(&nonce),
            )?;
            guard()?;
            let response = self.client.execute(request).await;
            guard()?;
            let body = read_page(response.map_err(|_| AliyunError::Unavailable)?, guard).await?;
            let complete = inventory.accept(&body)?;
            guard()?;
            if complete {
                return Ok(inventory.into_registrations());
            }
        }
    }

    fn request(
        &self,
        credential: &AliyunCredential,
        page: usize,
        now: OffsetDateTime,
        nonce: &str,
    ) -> Result<Request, AliyunError> {
        let date = format!(
            "{}T{:02}:{:02}:{:02}Z",
            now.date(),
            now.hour(),
            now.minute(),
            now.second()
        );
        let query = format!("PageNum={page}&PageSize={PAGE_SIZE}");
        let signed = signing::SignedRequest::query_domain_list(&query, &date, nonce);
        self.client
            .post(format!("https://{DOMAIN_HOST}/?{query}"))
            .headers(signed.headers(credential)?)
            .header(header::ACCEPT, "application/json")
            .build()
            .map_err(|_| AliyunError::Unavailable)
    }
}

async fn read_page(
    response: reqwest::Response,
    guard: &mut AliyunGuard<'_>,
) -> Result<Zeroizing<Vec<u8>>, AliyunError> {
    let invalid = AliyunError::ProtocolRejected;
    let status = response.status();
    match status {
        StatusCode::OK => {}
        StatusCode::UNAUTHORIZED => return Err(AliyunError::AuthenticationRequired),
        StatusCode::FORBIDDEN => return Err(AliyunError::Forbidden),
        StatusCode::TOO_MANY_REQUESTS => return Err(AliyunError::RateLimited),
        status if status.is_server_error() => return Err(AliyunError::Unavailable),
        _ => return Err(invalid),
    }
    let mut content_types = response.headers().get_all(header::CONTENT_TYPE).iter();
    let content_type = content_types
        .next()
        .and_then(|value| value.to_str().ok())
        .ok_or(invalid)?;
    let mut parts = content_type.split(';').map(str::trim);
    if !parts
        .next()
        .is_some_and(|v| v.eq_ignore_ascii_case("application/json"))
        || parts
            .next()
            .is_some_and(|v| !v.eq_ignore_ascii_case("charset=utf-8"))
        || parts.next().is_some()
        || content_types.next().is_some()
        || response
            .content_length()
            .is_some_and(|size| size > MAX_BODY as u64)
    {
        return Err(invalid);
    }
    let mut stream = response.bytes_stream();
    let mut body = Zeroizing::new(Vec::new());
    while let Some(chunk) = stream.next().await {
        guard()?;
        let chunk = chunk.map_err(|_| AliyunError::Unavailable)?;
        if chunk.len() > MAX_BODY - body.len() {
            return Err(invalid);
        }
        body.extend_from_slice(&chunk);
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use time::format_description::well_known::Rfc3339;

    #[test]
    fn query_domain_list_builds_only_the_fixed_read_request() {
        let client = AliyunRegistrarClient::production().unwrap();
        let credential = AliyunCredential {
            key: Zeroizing::new("FakeAccessKeyOnlyForTest".to_owned()),
            secret: Zeroizing::new("FakeSecretOnlyForTest".to_owned()),
        };
        let request = client
            .request(
                &credential,
                2,
                OffsetDateTime::parse("2026-11-20T01:00:00Z", &Rfc3339).unwrap(),
                "3156853299f313e23d1673dc12e1703d",
            )
            .unwrap();
        assert_eq!(request.method(), reqwest::Method::POST);
        assert_eq!(
            request.url().as_str(),
            "https://domain.aliyuncs.com/?PageNum=2&PageSize=50"
        );
        assert!(request.body().is_none());
        assert_eq!(request.headers()["x-acs-action"], "QueryDomainList");
        assert_eq!(request.headers()["x-acs-version"], "2018-01-29");
        assert!(request.headers()[header::AUTHORIZATION].is_sensitive());
        assert!(!format!("{request:?} {credential:?}").contains("OnlyForTest"));
    }
}
