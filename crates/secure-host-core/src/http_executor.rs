use std::net::IpAddr;

use crate::RuntimeMode;
use crate::endpoint_capability::{
    CredentialBinding, CredentialInjection, CredentialNamespace, CredentialSlotBinding,
    CredentialTarget, CredentialValueEncoding, EndpointCapability, EndpointRequest,
    EndpointValidationError, HttpMethod, ResponseExtractor, SecretKind, ValidatedEndpointRequest,
    project_public_json_response, validate_endpoint_request_against_registry,
    validate_resolved_addresses,
};
use crate::secret::SecretMaterial;

const MAX_CREDENTIAL_HEADER_VALUE_BYTES: usize = 8 * 1024;
const MAX_INJECTED_HEADERS_BYTES: usize = 16 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedCredentialSlotBinding {
    pub slot_id: String,
    pub secret_kind: SecretKind,
    pub credential_ref: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OwnedCredentialBinding {
    pub device_id: String,
    pub provider_connection_id: String,
    pub provider: String,
    pub namespace: CredentialNamespace,
    pub credential_profile_id: String,
    pub credential_profile_version: u32,
    pub slots: Vec<OwnedCredentialSlotBinding>,
}

pub trait CredentialProvider {
    type Error;

    /// Loads non-secret binding metadata for the current device and provider connection.
    ///
    /// # Errors
    ///
    /// Returns the Host-owned credential lookup error without accepting a caller-supplied ref.
    fn load_binding(
        &mut self,
        current_device_id: &str,
        provider_connection_id: &str,
    ) -> Result<OwnedCredentialBinding, Self::Error>;

    /// Loads one secret from the Host-owned store after the full request and DNS policy pass.
    ///
    /// # Errors
    ///
    /// Returns the Host-owned secret lookup error without falling back to a weaker store.
    fn load_secret(
        &mut self,
        scope: &CredentialSecretScope<'_>,
    ) -> Result<SecretMaterial, Self::Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CredentialSecretScope<'a> {
    pub device_id: &'a str,
    pub provider_connection_id: &'a str,
    pub provider: &'a str,
    pub namespace: CredentialNamespace,
    pub credential_profile_id: &'a str,
    pub credential_profile_version: u32,
    pub slot_id: &'static str,
    pub secret_kind: SecretKind,
    pub credential_ref: &'a str,
}

pub trait DnsResolver {
    type Error;

    /// Resolves the Manifest hostname for one execution attempt.
    ///
    /// # Errors
    ///
    /// Returns the resolver error. The returned address set is subsequently validated and pinned.
    fn resolve(&mut self, hostname: &str) -> Result<Vec<IpAddr>, Self::Error>;
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProxyPolicy {
    DenySystem,
}

pub struct SecretHeader {
    pub name: &'static str,
    pub value: SecretMaterial,
}

impl std::fmt::Debug for SecretHeader {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("SecretHeader")
            .field("name", &self.name)
            .field("value", &"[REDACTED]")
            .finish()
    }
}

pub struct TransportRequest<'a> {
    pub method: HttpMethod,
    pub url: &'a str,
    pub tls_server_name: &'a str,
    pub pinned_addresses: &'a [IpAddr],
    pub credential_headers: &'a [SecretHeader],
    pub body: Option<&'a [u8]>,
    pub idempotency_header: Option<PublicHeader<'a>>,
    pub timeout_ms: u32,
    pub max_response_bytes: u32,
    pub proxy_policy: ProxyPolicy,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicHeader<'a> {
    pub name: &'static str,
    pub value: &'a str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TransportResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub trait HttpTransport {
    type Error;

    /// Sends through a transport that must connect only to `pinned_addresses`, use
    /// `tls_server_name` for certificate/SNI validation, disable automatic redirects and system
    /// proxy inheritance, and enforce the response limit while streaming and after decompression.
    ///
    /// # Errors
    ///
    /// Returns a transport-specific failure without performing an implicit DNS re-resolution.
    fn send(&mut self, request: &TransportRequest<'_>) -> Result<TransportResponse, Self::Error>;
}

#[derive(Debug, PartialEq, Eq)]
pub enum ExecuteEndpointError<CredentialError, ResolverError, TransportError> {
    Validation(EndpointValidationError),
    Credential(CredentialError),
    Resolver(ResolverError),
    Transport(TransportError),
    RedirectDenied,
    ResponseTooLarge,
    InvalidPublicResponse,
    HostOwnedExtractorRequired,
    InvalidCredentialHeaderValue,
    CredentialHeadersTooLarge,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PublicEndpointResponse {
    pub status: u16,
    pub body: Vec<u8>,
}

pub type EndpointExecutionResult<C, D, T> = Result<
    PublicEndpointResponse,
    ExecuteEndpointError<
        <C as CredentialProvider>::Error,
        <D as DnsResolver>::Error,
        <T as HttpTransport>::Error,
    >,
>;

type CredentialHeaderResult<C, D, T> = Result<
    Vec<SecretHeader>,
    ExecuteEndpointError<
        <C as CredentialProvider>::Error,
        <D as DnsResolver>::Error,
        <T as HttpTransport>::Error,
    >,
>;

/// Executes against the immutable production Endpoint Registry.
///
/// The production Registry is currently empty, so this entry point fails before credential, DNS,
/// or transport access. Test-only Fixture Registries are reachable only through internal tests.
///
/// # Errors
///
/// Fails closed for any validation, credential, resolver, transport, redirect, response-limit, or
/// extractor error.
pub fn execute_endpoint_request<C, D, T>(
    runtime_mode: RuntimeMode,
    current_device_id: &str,
    request: &EndpointRequest<'_>,
    credentials: &mut C,
    resolver: &mut D,
    transport: &mut T,
) -> EndpointExecutionResult<C, D, T>
where
    C: CredentialProvider,
    D: DnsResolver,
    T: HttpTransport,
{
    execute_endpoint_request_against_registry(
        runtime_mode,
        current_device_id,
        crate::generated::endpoint_registry::ENDPOINT_CAPABILITIES,
        request,
        credentials,
        resolver,
        transport,
    )
}

fn execute_endpoint_request_against_registry<C, D, T>(
    runtime_mode: RuntimeMode,
    current_device_id: &str,
    registry: &[EndpointCapability],
    request: &EndpointRequest<'_>,
    credentials: &mut C,
    resolver: &mut D,
    transport: &mut T,
) -> EndpointExecutionResult<C, D, T>
where
    C: CredentialProvider,
    D: DnsResolver,
    T: HttpTransport,
{
    let capability = registry
        .iter()
        .find(|candidate| candidate.endpoint_id == request.endpoint_id)
        .ok_or(ExecuteEndpointError::Validation(
            EndpointValidationError::UnknownEndpoint,
        ))?;

    if runtime_mode != RuntimeMode::Active {
        return Err(ExecuteEndpointError::Validation(
            EndpointValidationError::RuntimeDenied,
        ));
    }

    let binding = credentials
        .load_binding(current_device_id, request.provider_connection_id)
        .map_err(ExecuteEndpointError::Credential)?;
    let slot_bindings = binding
        .slots
        .iter()
        .map(|slot| CredentialSlotBinding {
            slot_id: &slot.slot_id,
            secret_kind: slot.secret_kind,
            credential_ref: &slot.credential_ref,
        })
        .collect::<Vec<_>>();
    let borrowed_binding = CredentialBinding {
        device_id: &binding.device_id,
        provider_connection_id: &binding.provider_connection_id,
        provider: &binding.provider,
        namespace: binding.namespace,
        credential_profile_id: &binding.credential_profile_id,
        credential_profile_version: binding.credential_profile_version,
        slots: &slot_bindings,
    };
    let validated = validate_endpoint_request_against_registry(
        runtime_mode,
        current_device_id,
        registry,
        request,
        &borrowed_binding,
    )
    .map_err(ExecuteEndpointError::Validation)?;

    let hostname = manifest_hostname(capability).map_err(ExecuteEndpointError::Validation)?;
    let addresses = resolver
        .resolve(hostname)
        .map_err(ExecuteEndpointError::Resolver)?;
    validate_resolved_addresses(&addresses).map_err(ExecuteEndpointError::Validation)?;

    let credential_headers = load_credential_headers::<C, D, T>(credentials, &binding, &validated)?;

    let transport_request = TransportRequest {
        method: capability.method,
        url: &validated.url,
        tls_server_name: hostname,
        pinned_addresses: &addresses,
        credential_headers: &credential_headers,
        body: validated.body.as_deref(),
        idempotency_header: capability.idempotency_header.map(|name| PublicHeader {
            name,
            value: &validated.idempotency_key,
        }),
        timeout_ms: capability.timeout_ms,
        max_response_bytes: capability.max_response_bytes,
        proxy_policy: ProxyPolicy::DenySystem,
    };
    let response = transport
        .send(&transport_request)
        .map_err(ExecuteEndpointError::Transport)?;

    if (300..400).contains(&response.status) {
        return Err(ExecuteEndpointError::RedirectDenied);
    }
    if response.body.len() > capability.max_response_bytes as usize {
        return Err(ExecuteEndpointError::ResponseTooLarge);
    }
    match capability.response_extractor {
        ResponseExtractor::PublicJson => {
            let body =
                project_public_json_response(capability.public_response_schema, &response.body)
                    .map_err(|_| ExecuteEndpointError::InvalidPublicResponse)?;
            Ok(PublicEndpointResponse {
                status: response.status,
                body,
            })
        }
        ResponseExtractor::HostOwned => Err(ExecuteEndpointError::HostOwnedExtractorRequired),
    }
}

fn load_credential_headers<C, D, T>(
    credentials: &mut C,
    binding: &OwnedCredentialBinding,
    validated: &ValidatedEndpointRequest<'_>,
) -> CredentialHeaderResult<C, D, T>
where
    C: CredentialProvider,
    D: DnsResolver,
    T: HttpTransport,
{
    let mut injected_header_bytes = 0;
    if let Some(name) = validated.capability.idempotency_header {
        reserve_injected_header_bytes(
            &mut injected_header_bytes,
            name,
            validated.idempotency_key.len(),
        )
        .map_err(map_credential_header_error)?;
    }

    let mut credential_headers = Vec::with_capacity(validated.credential_slots.len());
    for slot in &validated.credential_slots {
        let scope = CredentialSecretScope {
            device_id: &binding.device_id,
            provider_connection_id: &binding.provider_connection_id,
            provider: &binding.provider,
            namespace: binding.namespace,
            credential_profile_id: &binding.credential_profile_id,
            credential_profile_version: binding.credential_profile_version,
            slot_id: slot.injection.slot_id,
            secret_kind: slot.injection.secret_kind,
            credential_ref: slot.credential_ref,
        };
        let secret = credentials
            .load_secret(&scope)
            .map_err(ExecuteEndpointError::Credential)?;
        let header = inject_header(slot.injection, secret).map_err(map_credential_header_error)?;
        reserve_injected_header_bytes(
            &mut injected_header_bytes,
            header.name,
            header.value.expose_secret().len(),
        )
        .map_err(map_credential_header_error)?;
        credential_headers.push(header);
    }
    Ok(credential_headers)
}

fn manifest_hostname(capability: &EndpointCapability) -> Result<&str, EndpointValidationError> {
    capability
        .origin
        .strip_prefix("https://")
        .ok_or(EndpointValidationError::UnknownEndpoint)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CredentialHeaderError {
    InvalidValue,
    TooLarge,
}

fn inject_header(
    injection: &CredentialInjection,
    secret: SecretMaterial,
) -> Result<SecretHeader, CredentialHeaderError> {
    let secret_bytes = secret.expose_secret();
    if secret_bytes.is_empty() || !secret_bytes.iter().all(|byte| matches!(byte, 0x21..=0x7e)) {
        return Err(CredentialHeaderError::InvalidValue);
    }
    let prefix_bytes = match injection.value_encoding {
        CredentialValueEncoding::Raw => 0,
        CredentialValueEncoding::Bearer => b"Bearer ".len(),
    };
    if secret_bytes
        .len()
        .checked_add(prefix_bytes)
        .is_none_or(|length| length > MAX_CREDENTIAL_HEADER_VALUE_BYTES)
    {
        return Err(CredentialHeaderError::TooLarge);
    }

    let value = match injection.value_encoding {
        CredentialValueEncoding::Raw => secret,
        CredentialValueEncoding::Bearer => {
            let mut encoded = b"Bearer ".to_vec();
            encoded.extend_from_slice(secret.expose_secret());
            SecretMaterial::new(encoded)
        }
    };
    debug_assert_eq!(injection.target, CredentialTarget::Header);
    Ok(SecretHeader {
        name: injection.wire_name,
        value,
    })
}

fn reserve_injected_header_bytes(
    total: &mut usize,
    name: &str,
    value_length: usize,
) -> Result<(), CredentialHeaderError> {
    let header_length = name
        .len()
        .checked_add(value_length)
        .and_then(|length| length.checked_add(4))
        .ok_or(CredentialHeaderError::TooLarge)?;
    *total = total
        .checked_add(header_length)
        .filter(|length| *length <= MAX_INJECTED_HEADERS_BYTES)
        .ok_or(CredentialHeaderError::TooLarge)?;
    Ok(())
}

const fn map_credential_header_error<CredentialError, ResolverError, TransportError>(
    error: CredentialHeaderError,
) -> ExecuteEndpointError<CredentialError, ResolverError, TransportError> {
    match error {
        CredentialHeaderError::InvalidValue => ExecuteEndpointError::InvalidCredentialHeaderValue,
        CredentialHeaderError::TooLarge => ExecuteEndpointError::CredentialHeadersTooLarge,
    }
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::net::{IpAddr, Ipv4Addr};

    use super::{
        CredentialHeaderError, CredentialProvider, CredentialSecretScope, DnsResolver,
        ExecuteEndpointError, HttpTransport, MAX_CREDENTIAL_HEADER_VALUE_BYTES,
        OwnedCredentialBinding, OwnedCredentialSlotBinding, ProxyPolicy, TransportRequest,
        TransportResponse, execute_endpoint_request, execute_endpoint_request_against_registry,
        reserve_injected_header_bytes,
    };
    use crate::RuntimeMode;
    use crate::endpoint_capability::{
        CredentialNamespace, EndpointRequest, EndpointValidationError, PublicValue, SecretKind,
    };
    use crate::generated::fixture_endpoint_registry::{
        ENDPOINT_CAPABILITIES, ENDPOINT_MANIFEST_SHA256,
    };
    use crate::secret::SecretMaterial;

    const CANARY: &str = "fixture-secret-canary";

    struct RequestData {
        path: BTreeMap<String, String>,
        query: BTreeMap<String, PublicValue>,
        body: BTreeMap<String, PublicValue>,
    }

    impl RequestData {
        fn fixture() -> Self {
            Self {
                path: BTreeMap::from([("zoneId".to_owned(), "zone-01".to_owned())]),
                query: BTreeMap::from([("dryRun".to_owned(), PublicValue::Boolean(true))]),
                body: BTreeMap::from([
                    (
                        "recordType".to_owned(),
                        PublicValue::String("TXT".to_owned()),
                    ),
                    ("name".to_owned(), PublicValue::String("_verify".to_owned())),
                    ("value".to_owned(), PublicValue::String("proof".to_owned())),
                ]),
            }
        }

        fn request(&self) -> EndpointRequest<'_> {
            EndpointRequest {
                provider_connection_id: "connection-a",
                endpoint_id: "fixture.records.create",
                path_parameters: &self.path,
                query_parameters: &self.query,
                body: Some(&self.body),
                idempotency_key: "request-01",
            }
        }
    }

    #[derive(Default)]
    struct FakeCredentials {
        binding_loads: usize,
        secret_loads: usize,
        secret_bytes: Option<Vec<u8>>,
    }

    impl CredentialProvider for FakeCredentials {
        type Error = ();

        fn load_binding(
            &mut self,
            current_device_id: &str,
            provider_connection_id: &str,
        ) -> Result<OwnedCredentialBinding, Self::Error> {
            self.binding_loads += 1;
            Ok(OwnedCredentialBinding {
                device_id: current_device_id.to_owned(),
                provider_connection_id: provider_connection_id.to_owned(),
                provider: "fixture".to_owned(),
                namespace: CredentialNamespace::ProviderApi,
                credential_profile_id: "fixture-api-v1".to_owned(),
                credential_profile_version: 1,
                slots: vec![OwnedCredentialSlotBinding {
                    slot_id: "api-token".to_owned(),
                    secret_kind: SecretKind::ApiToken,
                    credential_ref: "fixture-ref".to_owned(),
                }],
            })
        }

        fn load_secret(
            &mut self,
            scope: &CredentialSecretScope<'_>,
        ) -> Result<SecretMaterial, Self::Error> {
            self.secret_loads += 1;
            assert_eq!(scope.device_id, "device-a");
            assert_eq!(scope.provider_connection_id, "connection-a");
            assert_eq!(scope.provider, "fixture");
            assert_eq!(scope.namespace, CredentialNamespace::ProviderApi);
            assert_eq!(scope.credential_profile_id, "fixture-api-v1");
            assert_eq!(scope.credential_profile_version, 1);
            assert_eq!(scope.slot_id, "api-token");
            assert_eq!(scope.secret_kind, SecretKind::ApiToken);
            assert_eq!(scope.credential_ref, "fixture-ref");
            Ok(SecretMaterial::new(
                self.secret_bytes
                    .take()
                    .unwrap_or_else(|| CANARY.as_bytes().to_vec()),
            ))
        }
    }

    struct FakeResolver {
        addresses: Vec<IpAddr>,
        calls: usize,
    }

    impl DnsResolver for FakeResolver {
        type Error = ();

        fn resolve(&mut self, hostname: &str) -> Result<Vec<IpAddr>, Self::Error> {
            self.calls += 1;
            assert_eq!(hostname, "api.fixture.invalid");
            Ok(self.addresses.clone())
        }
    }

    #[derive(Default)]
    struct FakeTransport {
        calls: usize,
        response: Option<TransportResponse>,
        captured_url: Option<String>,
        captured_addresses: Vec<IpAddr>,
    }

    impl HttpTransport for FakeTransport {
        type Error = ();

        fn send(
            &mut self,
            request: &TransportRequest<'_>,
        ) -> Result<TransportResponse, Self::Error> {
            self.calls += 1;
            assert_eq!(request.method, crate::endpoint_capability::HttpMethod::Post);
            assert_eq!(request.tls_server_name, "api.fixture.invalid");
            assert_eq!(request.proxy_policy, ProxyPolicy::DenySystem);
            assert_eq!(request.credential_headers.len(), 1);
            assert_eq!(request.credential_headers[0].name, "authorization");
            assert_eq!(
                request.credential_headers[0].value.expose_secret(),
                format!("Bearer {CANARY}").as_bytes()
            );
            assert!(request.body.is_some());
            assert_eq!(request.timeout_ms, 10_000);
            assert_eq!(request.max_response_bytes, 1_048_576);
            assert_eq!(
                request.idempotency_header,
                Some(super::PublicHeader {
                    name: "idempotency-key",
                    value: "request-01",
                })
            );
            self.captured_url = Some(request.url.to_owned());
            self.captured_addresses = request.pinned_addresses.to_vec();
            Ok(self.response.clone().unwrap_or(TransportResponse {
                status: 200,
                body: br#"{"ok":true}"#.to_vec(),
            }))
        }
    }

    fn public_resolver() -> FakeResolver {
        FakeResolver {
            addresses: vec![IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))],
            calls: 0,
        }
    }

    #[test]
    fn fake_provider_pins_dns_and_injects_only_the_declared_slot() {
        assert_eq!(ENDPOINT_MANIFEST_SHA256.len(), 64);
        let data = RequestData::fixture();
        let mut credentials = FakeCredentials::default();
        let mut resolver = public_resolver();
        let mut transport = FakeTransport::default();
        let response = execute_endpoint_request_against_registry(
            RuntimeMode::Active,
            "device-a",
            ENDPOINT_CAPABILITIES,
            &data.request(),
            &mut credentials,
            &mut resolver,
            &mut transport,
        )
        .expect("fixture request should pass");

        assert_eq!(response.status, 200);
        assert_eq!(credentials.binding_loads, 1);
        assert_eq!(credentials.secret_loads, 1);
        assert_eq!(resolver.calls, 1);
        assert_eq!(transport.calls, 1);
        assert_eq!(
            transport.captured_url.as_deref(),
            Some("https://api.fixture.invalid/v1/zones/zone-01/records?dry_run=true")
        );
        assert_eq!(
            transport.captured_addresses,
            vec![IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1))]
        );
    }

    #[test]
    fn mixed_dns_result_fails_before_secret_or_transport() {
        let data = RequestData::fixture();
        let mut credentials = FakeCredentials::default();
        let mut resolver = FakeResolver {
            addresses: vec![
                IpAddr::V4(Ipv4Addr::new(1, 1, 1, 1)),
                IpAddr::V4(Ipv4Addr::LOCALHOST),
            ],
            calls: 0,
        };
        let mut transport = FakeTransport::default();
        let result = execute_endpoint_request_against_registry(
            RuntimeMode::Active,
            "device-a",
            ENDPOINT_CAPABILITIES,
            &data.request(),
            &mut credentials,
            &mut resolver,
            &mut transport,
        );
        assert_eq!(
            result,
            Err(ExecuteEndpointError::Validation(
                EndpointValidationError::NonPublicAddress
            ))
        );
        assert_eq!(credentials.secret_loads, 0);
        assert_eq!(transport.calls, 0);
    }

    #[test]
    fn non_active_runtime_fails_before_any_host_resource_access() {
        let data = RequestData::fixture();
        let mut credentials = FakeCredentials::default();
        let mut resolver = public_resolver();
        let mut transport = FakeTransport::default();
        let result = execute_endpoint_request_against_registry(
            RuntimeMode::Standby,
            "device-a",
            ENDPOINT_CAPABILITIES,
            &data.request(),
            &mut credentials,
            &mut resolver,
            &mut transport,
        );

        assert_eq!(
            result,
            Err(ExecuteEndpointError::Validation(
                EndpointValidationError::RuntimeDenied
            ))
        );
        assert_eq!(credentials.binding_loads, 0);
        assert_eq!(credentials.secret_loads, 0);
        assert_eq!(resolver.calls, 0);
        assert_eq!(transport.calls, 0);
    }

    #[test]
    fn unsafe_or_oversized_credential_header_fails_before_transport() {
        let data = RequestData::fixture();
        for (secret_bytes, expected) in [
            (
                b"fixture-secret\r\nx-injected: true".to_vec(),
                ExecuteEndpointError::InvalidCredentialHeaderValue,
            ),
            (
                vec![b'x'; MAX_CREDENTIAL_HEADER_VALUE_BYTES],
                ExecuteEndpointError::CredentialHeadersTooLarge,
            ),
        ] {
            let mut credentials = FakeCredentials {
                secret_bytes: Some(secret_bytes),
                ..FakeCredentials::default()
            };
            let mut resolver = public_resolver();
            let mut transport = FakeTransport::default();
            let result = execute_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                ENDPOINT_CAPABILITIES,
                &data.request(),
                &mut credentials,
                &mut resolver,
                &mut transport,
            );

            assert_eq!(result, Err(expected));
            assert_eq!(credentials.binding_loads, 1);
            assert_eq!(credentials.secret_loads, 1);
            assert_eq!(resolver.calls, 1);
            assert_eq!(transport.calls, 0);
        }
    }

    #[test]
    fn injected_header_budget_is_cumulative() {
        let mut total = 0;
        reserve_injected_header_bytes(&mut total, "x-first", 8_181)
            .expect("first bounded header should fit");
        assert_eq!(
            reserve_injected_header_bytes(&mut total, "x-second", 8_181),
            Err(CredentialHeaderError::TooLarge)
        );
    }

    #[test]
    fn invalid_public_parameters_fail_before_dns_secret_or_transport() {
        let mut data = RequestData::fixture();
        data.query.insert(
            "unexpected".to_owned(),
            PublicValue::String("value".to_owned()),
        );
        let mut credentials = FakeCredentials::default();
        let mut resolver = public_resolver();
        let mut transport = FakeTransport::default();
        let result = execute_endpoint_request_against_registry(
            RuntimeMode::Active,
            "device-a",
            ENDPOINT_CAPABILITIES,
            &data.request(),
            &mut credentials,
            &mut resolver,
            &mut transport,
        );

        assert_eq!(
            result,
            Err(ExecuteEndpointError::Validation(
                EndpointValidationError::QueryParameterMismatch
            ))
        );
        assert_eq!(credentials.binding_loads, 1);
        assert_eq!(credentials.secret_loads, 0);
        assert_eq!(resolver.calls, 0);
        assert_eq!(transport.calls, 0);
    }

    #[test]
    fn redirect_oversize_and_malformed_json_fail_closed() {
        let data = RequestData::fixture();
        for (response, expected) in [
            (
                TransportResponse {
                    status: 302,
                    body: Vec::new(),
                },
                ExecuteEndpointError::RedirectDenied,
            ),
            (
                TransportResponse {
                    status: 200,
                    body: vec![b'x'; 1_048_577],
                },
                ExecuteEndpointError::ResponseTooLarge,
            ),
            (
                TransportResponse {
                    status: 200,
                    body: b"not-json".to_vec(),
                },
                ExecuteEndpointError::InvalidPublicResponse,
            ),
            (
                TransportResponse {
                    status: 200,
                    body: br#"{"ok":true,"token":"fixture-secret-canary"}"#.to_vec(),
                },
                ExecuteEndpointError::InvalidPublicResponse,
            ),
        ] {
            let mut credentials = FakeCredentials::default();
            let mut resolver = public_resolver();
            let mut transport = FakeTransport {
                response: Some(response),
                ..FakeTransport::default()
            };
            let result = execute_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                ENDPOINT_CAPABILITIES,
                &data.request(),
                &mut credentials,
                &mut resolver,
                &mut transport,
            );
            assert_eq!(result, Err(expected));
        }
    }

    #[test]
    fn production_entrypoint_stays_deny_all_without_touching_host_resources() {
        let data = RequestData::fixture();
        let mut credentials = FakeCredentials::default();
        let mut resolver = public_resolver();
        let mut transport = FakeTransport::default();
        let result = execute_endpoint_request(
            RuntimeMode::Active,
            "device-a",
            &data.request(),
            &mut credentials,
            &mut resolver,
            &mut transport,
        );
        assert_eq!(
            result,
            Err(ExecuteEndpointError::Validation(
                EndpointValidationError::UnknownEndpoint
            ))
        );
        assert_eq!(credentials.binding_loads, 0);
        assert_eq!(resolver.calls, 0);
        assert_eq!(transport.calls, 0);
    }
}
