use std::collections::BTreeMap;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

use crate::RuntimeMode;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialNamespace {
    ProviderApi,
    GoodDealerAccount,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RedirectPolicy {
    Deny,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialInjection {
    BearerHeader,
    ApiKeyHeaders,
    QueryToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RetrySafety {
    Safe,
    ProviderIdempotencyKey,
    ConfirmBeforeRetry,
    Never,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ResponseExtractor {
    PublicJson,
    HostOwned,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct EndpointCapability {
    pub endpoint_id: &'static str,
    pub provider: &'static str,
    pub method: HttpMethod,
    pub origin: &'static str,
    pub path_template: &'static str,
    pub path_parameters: &'static [&'static str],
    pub credential_namespace: CredentialNamespace,
    pub credential_injection: CredentialInjection,
    pub redirect_policy: RedirectPolicy,
    pub retry_safety: RetrySafety,
    pub response_extractor: ResponseExtractor,
    pub redact_headers: &'static [&'static str],
    pub redact_json_pointers: &'static [&'static str],
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
}

#[derive(Debug, PartialEq, Eq)]
pub struct EndpointRequest<'a> {
    pub provider_connection_id: &'a str,
    pub endpoint_id: &'a str,
    pub path_parameters: &'a BTreeMap<String, String>,
    pub idempotency_key: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CredentialBinding<'a> {
    pub device_id: &'a str,
    pub provider_connection_id: &'a str,
    pub provider: &'a str,
    pub credential_ref: &'a str,
    pub namespace: CredentialNamespace,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ValidatedEndpointRequest<'a> {
    pub capability: &'a EndpointCapability,
    pub credential_ref: &'a str,
    pub url: String,
    pub idempotency_key: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EndpointValidationError {
    RuntimeDenied,
    UnknownEndpoint,
    DeviceMismatch,
    ConnectionMismatch,
    ProviderMismatch,
    CredentialNamespaceMismatch,
    InvalidIdempotencyKey,
    PathParameterMismatch,
    EmptyPathParameter,
    InvalidPathParameter,
    NoResolvedAddress,
    NonPublicAddress,
    RedirectDenied,
}

/// Returns the build-time hash of the schema and every connector Endpoint Manifest.
#[must_use]
pub const fn endpoint_manifest_sha256() -> &'static str {
    crate::generated::endpoint_registry::ENDPOINT_MANIFEST_SHA256
}

/// Validates the complete endpoint and credential binding before any network request is made.
///
/// # Errors
///
/// Returns [`EndpointValidationError`] when the runtime mode, embedded capability, local
/// credential binding or public path parameters do not match exactly.
pub fn validate_endpoint_request<'a>(
    runtime_mode: RuntimeMode,
    current_device_id: &str,
    request: &EndpointRequest<'_>,
    binding: &'a CredentialBinding<'a>,
) -> Result<ValidatedEndpointRequest<'a>, EndpointValidationError> {
    validate_endpoint_request_against_registry(
        runtime_mode,
        current_device_id,
        crate::generated::endpoint_registry::ENDPOINT_CAPABILITIES,
        request,
        binding,
    )
}

fn validate_endpoint_request_against_registry<'a>(
    runtime_mode: RuntimeMode,
    current_device_id: &str,
    registry: &'a [EndpointCapability],
    request: &EndpointRequest<'_>,
    binding: &'a CredentialBinding<'a>,
) -> Result<ValidatedEndpointRequest<'a>, EndpointValidationError> {
    if runtime_mode != RuntimeMode::Active {
        return Err(EndpointValidationError::RuntimeDenied);
    }

    let capability = registry
        .iter()
        .find(|candidate| candidate.endpoint_id == request.endpoint_id)
        .ok_or(EndpointValidationError::UnknownEndpoint)?;

    if binding.device_id != current_device_id {
        return Err(EndpointValidationError::DeviceMismatch);
    }
    if binding.provider_connection_id != request.provider_connection_id {
        return Err(EndpointValidationError::ConnectionMismatch);
    }
    if binding.provider != capability.provider {
        return Err(EndpointValidationError::ProviderMismatch);
    }
    if binding.namespace != capability.credential_namespace {
        return Err(EndpointValidationError::CredentialNamespaceMismatch);
    }
    if request.idempotency_key.is_empty()
        || request.idempotency_key.len() > 160
        || !request
            .idempotency_key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(EndpointValidationError::InvalidIdempotencyKey);
    }
    if request.path_parameters.len() != capability.path_parameters.len()
        || !capability
            .path_parameters
            .iter()
            .all(|name| request.path_parameters.contains_key(*name))
    {
        return Err(EndpointValidationError::PathParameterMismatch);
    }

    let mut path = capability.path_template.to_owned();
    for name in capability.path_parameters {
        let value = request
            .path_parameters
            .get(*name)
            .ok_or(EndpointValidationError::PathParameterMismatch)?;
        if value.is_empty() {
            return Err(EndpointValidationError::EmptyPathParameter);
        }
        if !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'~'))
        {
            return Err(EndpointValidationError::InvalidPathParameter);
        }
        path = path.replace(&format!("{{{name}}}"), value);
    }

    Ok(ValidatedEndpointRequest {
        capability,
        credential_ref: binding.credential_ref,
        url: format!("{}{}", capability.origin.trim_end_matches('/'), path),
        idempotency_key: request.idempotency_key.to_owned(),
    })
}

/// Rejects an empty DNS result or any address outside the public unicast ranges accepted by the
/// Phase 0 network policy.
///
/// # Errors
///
/// Returns [`EndpointValidationError::NoResolvedAddress`] for an empty result, or
/// [`EndpointValidationError::NonPublicAddress`] when at least one address is not public.
pub fn validate_resolved_addresses(addresses: &[IpAddr]) -> Result<(), EndpointValidationError> {
    if addresses.is_empty() {
        return Err(EndpointValidationError::NoResolvedAddress);
    }
    if addresses.iter().copied().all(is_public_address) {
        Ok(())
    } else {
        Err(EndpointValidationError::NonPublicAddress)
    }
}

/// Phase 0 denies every redirect for credential-bearing requests.
///
/// # Errors
///
/// Always returns [`EndpointValidationError::RedirectDenied`]. The HTTP client must also have
/// automatic redirects disabled so this check cannot be bypassed.
pub const fn reject_redirect() -> Result<(), EndpointValidationError> {
    Err(EndpointValidationError::RedirectDenied)
}

fn is_public_address(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(address) => is_public_ipv4(address),
        IpAddr::V6(address) => is_public_ipv6(address),
    }
}

fn is_public_ipv4(address: Ipv4Addr) -> bool {
    let [a, b, c, _] = address.octets();
    !(address.is_private()
        || address.is_loopback()
        || address.is_link_local()
        || address.is_broadcast()
        || address.is_documentation()
        || address.is_unspecified()
        || address.is_multicast()
        || a == 0
        || (a == 100 && (64..=127).contains(&b))
        || (a == 192 && b == 0 && c == 0)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    let first = segments[0];
    !(address.is_unspecified()
        || address.is_loopback()
        || address.is_multicast()
        || (first & 0xfe00) == 0xfc00
        || (first & 0xffc0) == 0xfe80
        || (segments[0] == 0x2001 && segments[1] == 0x0db8)
        || address
            .to_ipv4_mapped()
            .is_some_and(|mapped| !is_public_ipv4(mapped)))
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use super::{
        CredentialBinding, CredentialInjection, CredentialNamespace, EndpointCapability,
        EndpointRequest, EndpointValidationError, HttpMethod, RedirectPolicy, ResponseExtractor,
        RetrySafety, reject_redirect, validate_endpoint_request,
        validate_endpoint_request_against_registry, validate_resolved_addresses,
    };
    use crate::RuntimeMode;

    const CAPABILITY: EndpointCapability = EndpointCapability {
        endpoint_id: "fixture.records.read",
        provider: "fixture",
        method: HttpMethod::Get,
        origin: "https://api.fixture.invalid",
        path_template: "/v1/zones/{zoneId}/records",
        path_parameters: &["zoneId"],
        credential_namespace: CredentialNamespace::ProviderApi,
        credential_injection: CredentialInjection::BearerHeader,
        redirect_policy: RedirectPolicy::Deny,
        retry_safety: RetrySafety::Safe,
        response_extractor: ResponseExtractor::PublicJson,
        redact_headers: &["authorization"],
        redact_json_pointers: &["/token"],
        timeout_ms: 10_000,
        max_response_bytes: 1_048_576,
    };

    fn request(parameters: &BTreeMap<String, String>) -> EndpointRequest<'_> {
        EndpointRequest {
            provider_connection_id: "connection-a",
            endpoint_id: "fixture.records.read",
            path_parameters: parameters,
            idempotency_key: "request-01",
        }
    }

    fn binding() -> CredentialBinding<'static> {
        CredentialBinding {
            device_id: "device-a",
            provider_connection_id: "connection-a",
            provider: "fixture",
            credential_ref: "opaque-ref-a",
            namespace: CredentialNamespace::ProviderApi,
        }
    }

    #[test]
    fn constructs_url_from_strict_opaque_path_values() {
        let parameters = BTreeMap::from([("zoneId".to_owned(), "zone_a-01~x".to_owned())]);
        let binding = binding();
        let validated = validate_endpoint_request_against_registry(
            RuntimeMode::Active,
            "device-a",
            &[CAPABILITY],
            &request(&parameters),
            &binding,
        )
        .expect("fixture request should pass");

        assert_eq!(
            validated.url,
            "https://api.fixture.invalid/v1/zones/zone_a-01~x/records"
        );
        assert_eq!(validated.credential_ref, "opaque-ref-a");
        assert_eq!(validated.idempotency_key, "request-01");
    }

    #[test]
    fn rejects_preencoded_or_traversal_path_values() {
        for value in ["../a", "%2F", "a/b", "a\\b"] {
            let parameters = BTreeMap::from([("zoneId".to_owned(), value.to_owned())]);
            assert_eq!(
                validate_endpoint_request_against_registry(
                    RuntimeMode::Active,
                    "device-a",
                    &[CAPABILITY],
                    &request(&parameters),
                    &binding(),
                ),
                Err(EndpointValidationError::InvalidPathParameter)
            );
        }
    }

    #[test]
    fn rejects_standby_before_network() {
        let parameters = BTreeMap::from([("zoneId".to_owned(), "zone-a".to_owned())]);
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Standby,
                "device-a",
                &[CAPABILITY],
                &request(&parameters),
                &binding(),
            ),
            Err(EndpointValidationError::RuntimeDenied)
        );
    }

    #[test]
    fn rejects_cross_connection_binding() {
        let parameters = BTreeMap::from([("zoneId".to_owned(), "zone-a".to_owned())]);
        let binding = CredentialBinding {
            provider_connection_id: "connection-b",
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &request(&parameters),
                &binding,
            ),
            Err(EndpointValidationError::ConnectionMismatch)
        );
    }

    #[test]
    fn rejects_cloud_token_namespace_for_platform_endpoint() {
        let parameters = BTreeMap::from([("zoneId".to_owned(), "zone-a".to_owned())]);
        let binding = CredentialBinding {
            namespace: CredentialNamespace::GoodDealerAccount,
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &request(&parameters),
                &binding,
            ),
            Err(EndpointValidationError::CredentialNamespaceMismatch)
        );
    }

    #[test]
    fn production_entrypoint_uses_the_generated_deny_all_registry() {
        let parameters = BTreeMap::from([("zoneId".to_owned(), "zone-a".to_owned())]);
        assert_eq!(
            validate_endpoint_request(
                RuntimeMode::Active,
                "device-a",
                &request(&parameters),
                &binding(),
            ),
            Err(EndpointValidationError::UnknownEndpoint)
        );
    }

    #[test]
    fn rejects_invalid_idempotency_key_before_network() {
        let parameters = BTreeMap::from([("zoneId".to_owned(), "zone-a".to_owned())]);
        let request = EndpointRequest {
            idempotency_key: "bad/key",
            ..request(&parameters)
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &request,
                &binding(),
            ),
            Err(EndpointValidationError::InvalidIdempotencyKey)
        );
    }

    #[test]
    fn rejects_private_or_mixed_dns_results() {
        let addresses = [
            IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
            IpAddr::V4(Ipv4Addr::LOCALHOST),
        ];
        assert_eq!(
            validate_resolved_addresses(&addresses),
            Err(EndpointValidationError::NonPublicAddress)
        );
        assert_eq!(
            validate_resolved_addresses(&[IpAddr::V6(Ipv6Addr::LOCALHOST)]),
            Err(EndpointValidationError::NonPublicAddress)
        );
    }

    #[test]
    fn accepts_public_dns_results_and_denies_redirects() {
        assert_eq!(
            validate_resolved_addresses(&[IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))]),
            Ok(())
        );
        assert_eq!(
            reject_redirect(),
            Err(EndpointValidationError::RedirectDenied)
        );
    }
}
