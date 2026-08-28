//! Closed Cloudflare HTTPS transport. Callers cannot supply any request authority.

use std::time::Duration;

use futures_util::StreamExt;
use reqwest::{Client, StatusCode, header};
use zeroize::Zeroizing;

use crate::{
    cloudflare_operation::{CloudflareObservationError, CloudflareObservationErrorCode},
    cloudflare_provider::CloudflareEndpoint,
};

pub(super) const MAX_RESPONSE_BYTES: usize = 1024 * 1024;
const ORIGIN: &str = "https://api.cloudflare.com:443";

pub(super) struct CloudflareHttpResponse {
    pub(super) status: u16,
    pub(super) retry_after: Option<String>,
    pub(super) body: Vec<u8>,
}

pub(super) struct CloudflareTransport {
    client: Option<Client>,
    #[cfg(test)]
    retry_policy: CloudflareRetryPolicy,
    #[cfg(test)]
    script: std::collections::VecDeque<ScriptedResponse>,
    #[cfg(test)]
    attempts: Vec<CloudflareEndpoint>,
}

#[cfg(test)]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum CloudflareRetryPolicy {
    Never,
}

impl CloudflareTransport {
    pub(super) fn production() -> Self {
        let client = Client::builder()
            .https_only(true)
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .connect_timeout(Duration::from_secs(5))
            .timeout(Duration::from_secs(15))
            .build()
            .ok();
        Self {
            client,
            #[cfg(test)]
            retry_policy: CloudflareRetryPolicy::Never,
            #[cfg(test)]
            script: std::collections::VecDeque::new(),
            #[cfg(test)]
            attempts: Vec::new(),
        }
    }

    pub(super) async fn send(
        &mut self,
        request: CloudflareEndpoint,
        zone_id: &str,
        token: &str,
    ) -> Result<CloudflareHttpResponse, CloudflareObservationError> {
        #[cfg(test)]
        if let Some(scripted) = self.script.pop_front() {
            self.attempts.push(request);
            return scripted.into_result();
        }

        let client = self.client.as_ref().ok_or_else(temporary_error)?;
        let authorization = Zeroizing::new(format!("Bearer {token}"));
        let mut authorization_header =
            header::HeaderValue::from_str(&authorization).map_err(|_| temporary_error())?;
        authorization_header.set_sensitive(true);
        let response = client
            .get(format!("{ORIGIN}{}", request.path_and_query(zone_id)))
            .header(header::AUTHORIZATION, authorization_header)
            .header(header::ACCEPT, "application/json")
            .send()
            .await
            .map_err(|_| temporary_error())?;
        let status = response.status();
        let retry_after = response
            .headers()
            .get(header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok())
            .map(str::to_owned);
        if status.is_success() && !is_json_content_type(response.headers()) {
            return Err(CloudflareObservationError::new(
                CloudflareObservationErrorCode::InvalidResponse,
                None,
            ));
        }

        let mut body = Vec::new();
        let mut stream = response.bytes_stream();
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|_| temporary_error())?;
            if body.len().saturating_add(chunk.len()) > MAX_RESPONSE_BYTES {
                return Err(CloudflareObservationError::new(
                    CloudflareObservationErrorCode::ResponseTooLarge,
                    None,
                ));
            }
            body.extend_from_slice(&chunk);
        }

        Ok(CloudflareHttpResponse {
            status: status.as_u16(),
            retry_after,
            body,
        })
    }

    #[cfg(test)]
    pub(super) fn scripted(script: Vec<ScriptedResponse>) -> Self {
        Self {
            client: None,
            retry_policy: CloudflareRetryPolicy::Never,
            script: script.into(),
            attempts: Vec::new(),
        }
    }

    #[cfg(test)]
    pub(super) fn attempts(&self) -> &[CloudflareEndpoint] {
        &self.attempts
    }
}

fn is_json_content_type(headers: &header::HeaderMap) -> bool {
    headers
        .get(header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.split(';').next())
        .is_some_and(|value| value.trim().eq_ignore_ascii_case("application/json"))
}

pub(super) fn map_status(
    response: CloudflareHttpResponse,
) -> Result<Vec<u8>, CloudflareObservationError> {
    match StatusCode::from_u16(response.status) {
        Ok(StatusCode::OK) => Ok(response.body),
        Ok(StatusCode::UNAUTHORIZED) => Err(CloudflareObservationError::new(
            CloudflareObservationErrorCode::Authentication,
            None,
        )),
        Ok(StatusCode::FORBIDDEN) => Err(CloudflareObservationError::new(
            CloudflareObservationErrorCode::Permission,
            None,
        )),
        Ok(StatusCode::TOO_MANY_REQUESTS) => {
            let retry_after = response.retry_after.as_deref().and_then(parse_retry_after);
            Err(CloudflareObservationError::new(
                CloudflareObservationErrorCode::RateLimited,
                retry_after,
            ))
        }
        Ok(status) if status.is_success() => Err(CloudflareObservationError::new(
            CloudflareObservationErrorCode::InvalidResponse,
            None,
        )),
        _ => Err(temporary_error()),
    }
}

fn parse_retry_after(value: &str) -> Option<u32> {
    (!value.is_empty() && value.bytes().all(|byte| byte.is_ascii_digit()))
        .then(|| value.parse::<u32>().ok())
        .flatten()
        .filter(|delay| *delay <= 86_400)
}

fn temporary_error() -> CloudflareObservationError {
    CloudflareObservationError::new(CloudflareObservationErrorCode::TemporarilyUnavailable, None)
}

#[cfg(test)]
pub(super) struct ScriptedResponse {
    result: Result<CloudflareHttpResponse, CloudflareObservationError>,
}

#[cfg(test)]
impl ScriptedResponse {
    pub(super) fn json(status: u16, body: impl Into<Vec<u8>>) -> Self {
        Self {
            result: Ok(CloudflareHttpResponse {
                status,
                retry_after: None,
                body: body.into(),
            }),
        }
    }

    pub(super) fn rate_limited(retry_after: &str) -> Self {
        Self {
            result: Ok(CloudflareHttpResponse {
                status: 429,
                retry_after: Some(retry_after.to_owned()),
                body: Vec::new(),
            }),
        }
    }

    pub(super) fn failure(error: CloudflareObservationError) -> Self {
        Self { result: Err(error) }
    }

    fn into_result(self) -> Result<CloudflareHttpResponse, CloudflareObservationError> {
        if let Ok(response) = &self.result
            && response.body.len() > MAX_RESPONSE_BYTES
        {
            return Err(CloudflareObservationError::new(
                CloudflareObservationErrorCode::ResponseTooLarge,
                None,
            ));
        }
        self.result
    }
}

#[cfg(test)]
mod policy_tests {
    use super::*;
    use crate::{
        cloudflare_operation::CloudflareRecordType, cloudflare_provider::CloudflareEndpoint,
    };

    #[test]
    fn request_formatter_has_one_origin_and_get_only_allowlist() {
        let zone = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            format!(
                "{ORIGIN}{}",
                CloudflareEndpoint::ZoneDetails.path_and_query(zone)
            ),
            format!("{ORIGIN}/client/v4/zones/{zone}")
        );
        assert_eq!(
            format!(
                "{ORIGIN}{}",
                CloudflareEndpoint::ListDnsRecords {
                    record_type: CloudflareRecordType::TXT,
                    page: 7
                }
                .path_and_query(zone)
            ),
            format!(
                "{ORIGIN}/client/v4/zones/{zone}/dns_records?type=TXT&page=7&per_page=100&order=name&direction=asc"
            )
        );
    }

    #[test]
    fn production_transport_constructs_with_explicit_retry_never_policy() {
        let transport = CloudflareTransport::production();
        assert!(transport.client.is_some());
        assert_eq!(transport.retry_policy, CloudflareRetryPolicy::Never);
        assert_eq!(
            include_str!("cloudflare_transport.rs")
                .matches(concat!(".retry(", "reqwest::retry::never())"))
                .count(),
            1,
            "removing or duplicating the production retry-never configuration must fail"
        );
    }

    #[test]
    fn scripted_transport_enforces_response_limit_at_exact_boundary() {
        let at_limit = ScriptedResponse::json(200, vec![0; MAX_RESPONSE_BYTES]);
        assert_eq!(
            at_limit
                .into_result()
                .expect("limit is accepted")
                .body
                .len(),
            MAX_RESPONSE_BYTES
        );
        let over_limit = ScriptedResponse::json(200, vec![0; MAX_RESPONSE_BYTES + 1]);
        let Err(error) = over_limit.into_result() else {
            panic!("limit plus one must fail");
        };
        assert_eq!(
            error.code(),
            CloudflareObservationErrorCode::ResponseTooLarge
        );
    }
}
