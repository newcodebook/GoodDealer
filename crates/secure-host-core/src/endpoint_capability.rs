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
pub enum CredentialTarget {
    Header,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CredentialValueEncoding {
    Raw,
    Bearer,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SecretKind {
    ApiToken,
    AccountToken,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CredentialInjection {
    pub slot_id: &'static str,
    pub secret_kind: SecretKind,
    pub target: CredentialTarget,
    pub wire_name: &'static str,
    pub value_encoding: CredentialValueEncoding,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PublicValueType {
    String,
    Integer,
    Boolean,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PublicFieldSchema {
    pub field_id: &'static str,
    pub wire_name: &'static str,
    pub value_type: PublicValueType,
    pub required: bool,
    pub max_length: Option<u32>,
    pub allowed_values: &'static [&'static str],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BodyEncoding {
    None,
    Json,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BodySchema {
    pub encoding: BodyEncoding,
    pub fields: &'static [PublicFieldSchema],
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum PublicValue {
    String(String),
    Integer(i64),
    Boolean(bool),
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
    pub credential_profile_id: &'static str,
    pub credential_profile_version: u32,
    pub credential_injections: &'static [CredentialInjection],
    pub idempotency_header: Option<&'static str>,
    pub query_parameters: &'static [PublicFieldSchema],
    pub max_query_bytes: u32,
    pub body_schema: BodySchema,
    pub max_body_bytes: u32,
    pub redirect_policy: RedirectPolicy,
    pub retry_safety: RetrySafety,
    pub response_extractor: ResponseExtractor,
    pub public_response_schema: BodySchema,
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
    pub query_parameters: &'a BTreeMap<String, PublicValue>,
    pub body: Option<&'a BTreeMap<String, PublicValue>>,
    pub idempotency_key: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CredentialSlotBinding<'a> {
    pub slot_id: &'a str,
    pub secret_kind: SecretKind,
    pub credential_ref: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct CredentialBinding<'a> {
    pub device_id: &'a str,
    pub provider_connection_id: &'a str,
    pub provider: &'a str,
    pub namespace: CredentialNamespace,
    pub credential_profile_id: &'a str,
    pub credential_profile_version: u32,
    pub slots: &'a [CredentialSlotBinding<'a>],
}

#[derive(Debug, PartialEq, Eq)]
pub struct ValidatedCredentialSlot<'a> {
    pub injection: &'a CredentialInjection,
    pub credential_ref: &'a str,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ValidatedEndpointRequest<'a> {
    pub capability: &'a EndpointCapability,
    pub credential_slots: Vec<ValidatedCredentialSlot<'a>>,
    pub url: String,
    pub body: Option<Vec<u8>>,
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
    CredentialProfileMismatch,
    CredentialSlotMismatch,
    InvalidIdempotencyKey,
    PathParameterMismatch,
    EmptyPathParameter,
    InvalidPathParameter,
    QueryParameterMismatch,
    BodyMismatch,
    PublicValueTypeMismatch,
    PublicValueTooLong,
    PublicValueNotAllowed,
    PublicIntegerOutOfRange,
    QueryTooLarge,
    BodyTooLarge,
    ResponseMismatch,
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

pub(crate) fn validate_endpoint_request_against_registry<'a>(
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

    let credential_slots =
        validate_credential_binding(capability, current_device_id, request, binding)?;
    if request.idempotency_key.is_empty()
        || request.idempotency_key.len() > 160
        || !request
            .idempotency_key
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
    {
        return Err(EndpointValidationError::InvalidIdempotencyKey);
    }
    let path = validate_path_parameters(capability, request)?;

    let query = validate_public_fields(
        capability.query_parameters,
        request.query_parameters,
        EndpointValidationError::QueryParameterMismatch,
    )?;
    let mut url = format!("{}{}", capability.origin.trim_end_matches('/'), path);
    if !query.is_empty() {
        let mut encoded_query = String::new();
        for (index, (wire_name, value)) in query.iter().enumerate() {
            if index != 0 {
                encoded_query.push('&');
            }
            encoded_query.push_str(wire_name);
            encoded_query.push('=');
            encoded_query.push_str(&percent_encode_query_component(value));
        }
        if encoded_query.len() > capability.max_query_bytes as usize {
            return Err(EndpointValidationError::QueryTooLarge);
        }
        url.push('?');
        url.push_str(&encoded_query);
    }

    let body = encode_request_body(
        capability.body_schema,
        capability.max_body_bytes,
        request.body,
    )?;

    Ok(ValidatedEndpointRequest {
        capability,
        credential_slots,
        url,
        body,
        idempotency_key: request.idempotency_key.to_owned(),
    })
}

fn validate_credential_binding<'a>(
    capability: &'a EndpointCapability,
    current_device_id: &str,
    request: &EndpointRequest<'_>,
    binding: &'a CredentialBinding<'a>,
) -> Result<Vec<ValidatedCredentialSlot<'a>>, EndpointValidationError> {
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
    if binding.credential_profile_id != capability.credential_profile_id
        || binding.credential_profile_version != capability.credential_profile_version
    {
        return Err(EndpointValidationError::CredentialProfileMismatch);
    }
    if binding.slots.len() != capability.credential_injections.len() {
        return Err(EndpointValidationError::CredentialSlotMismatch);
    }

    capability
        .credential_injections
        .iter()
        .map(|injection| {
            let mut matching = binding
                .slots
                .iter()
                .filter(|slot| slot.slot_id == injection.slot_id);
            let slot = matching
                .next()
                .ok_or(EndpointValidationError::CredentialSlotMismatch)?;
            if matching.next().is_some()
                || slot.credential_ref.is_empty()
                || slot.secret_kind != injection.secret_kind
            {
                return Err(EndpointValidationError::CredentialSlotMismatch);
            }
            Ok(ValidatedCredentialSlot {
                injection,
                credential_ref: slot.credential_ref,
            })
        })
        .collect()
}

fn validate_path_parameters(
    capability: &EndpointCapability,
    request: &EndpointRequest<'_>,
) -> Result<String, EndpointValidationError> {
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
        if value.len() > 512 {
            return Err(EndpointValidationError::InvalidPathParameter);
        }
        if !value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'~'))
        {
            return Err(EndpointValidationError::InvalidPathParameter);
        }
        path = path.replace(&format!("{{{name}}}"), value);
    }
    Ok(path)
}

fn encode_request_body(
    schema: BodySchema,
    max_body_bytes: u32,
    body: Option<&BTreeMap<String, PublicValue>>,
) -> Result<Option<Vec<u8>>, EndpointValidationError> {
    match schema.encoding {
        BodyEncoding::None => {
            if body.is_some() {
                return Err(EndpointValidationError::BodyMismatch);
            }
            Ok(None)
        }
        BodyEncoding::Json => {
            let values = body.ok_or(EndpointValidationError::BodyMismatch)?;
            validate_public_fields(schema.fields, values, EndpointValidationError::BodyMismatch)?;
            let mut object = serde_json::Map::new();
            for field in schema.fields {
                if let Some(value) = values.get(field.field_id) {
                    object.insert(field.wire_name.to_owned(), public_value_to_json(value));
                }
            }
            let encoded = serde_json::to_vec(&serde_json::Value::Object(object))
                .map_err(|_| EndpointValidationError::BodyMismatch)?;
            if encoded.len() > max_body_bytes as usize {
                return Err(EndpointValidationError::BodyTooLarge);
            }
            Ok(Some(encoded))
        }
    }
}

fn validate_public_fields(
    schema: &[PublicFieldSchema],
    values: &BTreeMap<String, PublicValue>,
    mismatch: EndpointValidationError,
) -> Result<Vec<(&'static str, String)>, EndpointValidationError> {
    if values.keys().any(|field_id| {
        !schema
            .iter()
            .any(|field| field.field_id == field_id.as_str())
    }) {
        return Err(mismatch);
    }

    let mut encoded = Vec::with_capacity(values.len());
    for field in schema {
        let Some(value) = values.get(field.field_id) else {
            if field.required {
                return Err(mismatch);
            }
            continue;
        };
        validate_public_value(field, value)?;
        let wire_value = match value {
            PublicValue::String(value) => value.clone(),
            PublicValue::Integer(value) => value.to_string(),
            PublicValue::Boolean(value) => value.to_string(),
        };
        encoded.push((field.wire_name, wire_value));
    }
    Ok(encoded)
}

fn validate_public_value(
    field: &PublicFieldSchema,
    value: &PublicValue,
) -> Result<(), EndpointValidationError> {
    match (field.value_type, value) {
        (PublicValueType::String, PublicValue::String(value)) => {
            if field
                .max_length
                .is_some_and(|limit| value.len() > limit as usize)
            {
                return Err(EndpointValidationError::PublicValueTooLong);
            }
            if !field.allowed_values.is_empty() && !field.allowed_values.contains(&value.as_str()) {
                return Err(EndpointValidationError::PublicValueNotAllowed);
            }
            Ok(())
        }
        (PublicValueType::Integer, PublicValue::Integer(value)) => {
            if (-9_007_199_254_740_991..=9_007_199_254_740_991).contains(value) {
                Ok(())
            } else {
                Err(EndpointValidationError::PublicIntegerOutOfRange)
            }
        }
        (PublicValueType::Boolean, PublicValue::Boolean(_)) => Ok(()),
        _ => Err(EndpointValidationError::PublicValueTypeMismatch),
    }
}

fn public_value_to_json(value: &PublicValue) -> serde_json::Value {
    match value {
        PublicValue::String(value) => serde_json::Value::String(value.clone()),
        PublicValue::Integer(value) => serde_json::Value::Number((*value).into()),
        PublicValue::Boolean(value) => serde_json::Value::Bool(*value),
    }
}

#[cfg(test)]
pub(crate) fn project_public_json_response(
    schema: BodySchema,
    body: &[u8],
) -> Result<Vec<u8>, EndpointValidationError> {
    if schema.encoding != BodyEncoding::Json {
        return Err(EndpointValidationError::ResponseMismatch);
    }
    let parsed: serde_json::Value =
        serde_json::from_slice(body).map_err(|_| EndpointValidationError::ResponseMismatch)?;
    let object = parsed
        .as_object()
        .ok_or(EndpointValidationError::ResponseMismatch)?;
    if object.keys().any(|wire_name| {
        !schema
            .fields
            .iter()
            .any(|field| field.wire_name == wire_name)
    }) {
        return Err(EndpointValidationError::ResponseMismatch);
    }

    let mut public_values = BTreeMap::new();
    for field in schema.fields {
        let Some(value) = object.get(field.wire_name) else {
            continue;
        };
        let value = match value {
            serde_json::Value::String(value) => PublicValue::String(value.clone()),
            serde_json::Value::Number(value) => PublicValue::Integer(
                value
                    .as_i64()
                    .ok_or(EndpointValidationError::ResponseMismatch)?,
            ),
            serde_json::Value::Bool(value) => PublicValue::Boolean(*value),
            _ => return Err(EndpointValidationError::ResponseMismatch),
        };
        public_values.insert(field.field_id.to_owned(), value);
    }
    validate_public_fields(
        schema.fields,
        &public_values,
        EndpointValidationError::ResponseMismatch,
    )?;

    let mut projected = serde_json::Map::new();
    for field in schema.fields {
        if let Some(value) = public_values.get(field.field_id) {
            projected.insert(field.field_id.to_owned(), public_value_to_json(value));
        }
    }
    serde_json::to_vec(&serde_json::Value::Object(projected))
        .map_err(|_| EndpointValidationError::ResponseMismatch)
}

fn percent_encode_query_component(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'.' | b'_' | b'~') {
            encoded.push(char::from(byte));
        } else {
            use std::fmt::Write as _;
            let _ = write!(encoded, "%{byte:02X}");
        }
    }
    encoded
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
        || (a == 192 && b == 88 && c == 99)
        || (a == 198 && (b == 18 || b == 19))
        || a >= 240)
}

fn is_public_ipv6(address: Ipv6Addr) -> bool {
    let segments = address.segments();
    if let Some(mapped) = address.to_ipv4_mapped() {
        return is_public_ipv4(mapped);
    }

    // Phase 0 permits only ordinary global-unicast space and conservatively rejects IANA
    // protocol, documentation and transition prefixes even when an OS route exists.
    (segments[0] & 0xe000) == 0x2000
        && !(segments[0] == 0x2001 && segments[1] <= 0x01ff)
        && !(segments[0] == 0x2001 && segments[1] == 0x0db8)
        && segments[0] != 0x2002
        && !(segments[0] == 0x3fff && (segments[1] & 0xf000) == 0)
}

#[cfg(test)]
mod tests {
    use std::collections::BTreeMap;
    use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};

    use super::{
        BodyEncoding, BodySchema, CredentialBinding, CredentialInjection, CredentialNamespace,
        CredentialSlotBinding, CredentialTarget, CredentialValueEncoding, EndpointCapability,
        EndpointRequest, EndpointValidationError, HttpMethod, PublicFieldSchema, PublicValue,
        PublicValueType, RedirectPolicy, ResponseExtractor, RetrySafety, SecretKind,
        reject_redirect, validate_endpoint_request, validate_endpoint_request_against_registry,
        validate_public_value, validate_resolved_addresses,
    };
    use crate::RuntimeMode;

    const INJECTIONS: &[CredentialInjection] = &[CredentialInjection {
        slot_id: "api-token",
        secret_kind: SecretKind::ApiToken,
        target: CredentialTarget::Header,
        wire_name: "authorization",
        value_encoding: CredentialValueEncoding::Bearer,
    }];
    const MULTI_SLOT_INJECTIONS: &[CredentialInjection] = &[
        INJECTIONS[0],
        CredentialInjection {
            slot_id: "secondary-token",
            secret_kind: SecretKind::ApiToken,
            target: CredentialTarget::Header,
            wire_name: "x-fixture-secondary",
            value_encoding: CredentialValueEncoding::Raw,
        },
    ];
    const QUERY: &[PublicFieldSchema] = &[PublicFieldSchema {
        field_id: "dryRun",
        wire_name: "dry_run",
        value_type: PublicValueType::Boolean,
        required: true,
        max_length: None,
        allowed_values: &[],
    }];
    const BODY_FIELDS: &[PublicFieldSchema] = &[
        PublicFieldSchema {
            field_id: "recordType",
            wire_name: "type",
            value_type: PublicValueType::String,
            required: true,
            max_length: Some(8),
            allowed_values: &["TXT"],
        },
        PublicFieldSchema {
            field_id: "name",
            wire_name: "name",
            value_type: PublicValueType::String,
            required: true,
            max_length: Some(253),
            allowed_values: &[],
        },
        PublicFieldSchema {
            field_id: "value",
            wire_name: "value",
            value_type: PublicValueType::String,
            required: true,
            max_length: Some(1024),
            allowed_values: &[],
        },
    ];
    const RESPONSE_FIELDS: &[PublicFieldSchema] = &[PublicFieldSchema {
        field_id: "ok",
        wire_name: "ok",
        value_type: PublicValueType::Boolean,
        required: true,
        max_length: None,
        allowed_values: &[],
    }];
    const CAPABILITY: EndpointCapability = EndpointCapability {
        endpoint_id: "fixture.records.create",
        provider: "fixture",
        method: HttpMethod::Post,
        origin: "https://api.fixture.invalid",
        path_template: "/v1/zones/{zoneId}/records",
        path_parameters: &["zoneId"],
        credential_namespace: CredentialNamespace::ProviderApi,
        credential_profile_id: "fixture-api-v1",
        credential_profile_version: 1,
        credential_injections: INJECTIONS,
        idempotency_header: Some("idempotency-key"),
        query_parameters: QUERY,
        max_query_bytes: 128,
        body_schema: BodySchema {
            encoding: BodyEncoding::Json,
            fields: BODY_FIELDS,
        },
        max_body_bytes: 2_048,
        redirect_policy: RedirectPolicy::Deny,
        retry_safety: RetrySafety::ProviderIdempotencyKey,
        response_extractor: ResponseExtractor::PublicJson,
        public_response_schema: BodySchema {
            encoding: BodyEncoding::Json,
            fields: RESPONSE_FIELDS,
        },
        redact_headers: &["authorization"],
        redact_json_pointers: &["/token"],
        timeout_ms: 10_000,
        max_response_bytes: 1_048_576,
    };

    struct RequestData {
        path: BTreeMap<String, String>,
        query: BTreeMap<String, PublicValue>,
        body: BTreeMap<String, PublicValue>,
    }

    impl RequestData {
        fn fixture() -> Self {
            Self {
                path: BTreeMap::from([("zoneId".to_owned(), "zone_a-01~x".to_owned())]),
                query: BTreeMap::from([("dryRun".to_owned(), PublicValue::Boolean(true))]),
                body: BTreeMap::from([
                    (
                        "recordType".to_owned(),
                        PublicValue::String("TXT".to_owned()),
                    ),
                    ("name".to_owned(), PublicValue::String("_verify".to_owned())),
                    (
                        "value".to_owned(),
                        PublicValue::String("proof value".to_owned()),
                    ),
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

    const SLOT_BINDINGS: &[CredentialSlotBinding<'static>] = &[CredentialSlotBinding {
        slot_id: "api-token",
        secret_kind: SecretKind::ApiToken,
        credential_ref: "opaque-ref-a",
    }];

    fn binding() -> CredentialBinding<'static> {
        CredentialBinding {
            device_id: "device-a",
            provider_connection_id: "connection-a",
            provider: "fixture",
            namespace: CredentialNamespace::ProviderApi,
            credential_profile_id: "fixture-api-v1",
            credential_profile_version: 1,
            slots: SLOT_BINDINGS,
        }
    }

    #[test]
    fn constructs_strict_path_query_body_and_slot_binding() {
        let data = RequestData::fixture();
        let binding = binding();
        let validated = validate_endpoint_request_against_registry(
            RuntimeMode::Active,
            "device-a",
            &[CAPABILITY],
            &data.request(),
            &binding,
        )
        .expect("fixture request should pass");

        assert_eq!(
            validated.url,
            "https://api.fixture.invalid/v1/zones/zone_a-01~x/records?dry_run=true"
        );
        assert_eq!(validated.credential_slots[0].credential_ref, "opaque-ref-a");
        assert_eq!(validated.idempotency_key, "request-01");
        let body: serde_json::Value =
            serde_json::from_slice(validated.body.as_deref().expect("JSON body")).expect("JSON");
        assert_eq!(body["type"], "TXT");
        assert_eq!(body["name"], "_verify");
        assert_eq!(body["value"], "proof value");
    }

    #[test]
    fn rejects_preencoded_or_traversal_path_values() {
        for value in ["../a", "%2F", "a/b", "a\\b"] {
            let mut data = RequestData::fixture();
            data.path.insert("zoneId".to_owned(), value.to_owned());
            assert_eq!(
                validate_endpoint_request_against_registry(
                    RuntimeMode::Active,
                    "device-a",
                    &[CAPABILITY],
                    &data.request(),
                    &binding(),
                ),
                Err(EndpointValidationError::InvalidPathParameter)
            );
        }
    }

    #[test]
    fn rejects_standby_before_network() {
        let data = RequestData::fixture();
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Standby,
                "device-a",
                &[CAPABILITY],
                &data.request(),
                &binding(),
            ),
            Err(EndpointValidationError::RuntimeDenied)
        );
    }

    #[test]
    fn rejects_cross_connection_binding() {
        let data = RequestData::fixture();
        let binding = CredentialBinding {
            provider_connection_id: "connection-b",
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &data.request(),
                &binding,
            ),
            Err(EndpointValidationError::ConnectionMismatch)
        );
    }

    #[test]
    fn rejects_cloud_token_namespace_for_platform_endpoint() {
        let data = RequestData::fixture();
        let binding = CredentialBinding {
            namespace: CredentialNamespace::GoodDealerAccount,
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &data.request(),
                &binding,
            ),
            Err(EndpointValidationError::CredentialNamespaceMismatch)
        );
    }

    #[test]
    fn rejects_profile_or_slot_mismatch() {
        let data = RequestData::fixture();
        let wrong_profile = CredentialBinding {
            credential_profile_version: 2,
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &data.request(),
                &wrong_profile,
            ),
            Err(EndpointValidationError::CredentialProfileMismatch)
        );

        let no_slots = CredentialBinding {
            slots: &[],
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &data.request(),
                &no_slots,
            ),
            Err(EndpointValidationError::CredentialSlotMismatch)
        );

        let wrong_kind_slots = [CredentialSlotBinding {
            slot_id: "api-token",
            secret_kind: SecretKind::AccountToken,
            credential_ref: "opaque-account-ref",
        }];
        let wrong_kind = CredentialBinding {
            slots: &wrong_kind_slots,
            ..binding()
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &data.request(),
                &wrong_kind,
            ),
            Err(EndpointValidationError::CredentialSlotMismatch)
        );
    }

    #[test]
    fn validates_complete_multi_slot_binding_in_manifest_order() {
        let data = RequestData::fixture();
        let capability = EndpointCapability {
            credential_injections: MULTI_SLOT_INJECTIONS,
            ..CAPABILITY
        };
        let slots = [
            CredentialSlotBinding {
                slot_id: "secondary-token",
                secret_kind: SecretKind::ApiToken,
                credential_ref: "opaque-ref-b",
            },
            CredentialSlotBinding {
                slot_id: "api-token",
                secret_kind: SecretKind::ApiToken,
                credential_ref: "opaque-ref-a",
            },
        ];
        let binding = CredentialBinding {
            slots: &slots,
            ..binding()
        };
        let registry = [capability];
        let validated = validate_endpoint_request_against_registry(
            RuntimeMode::Active,
            "device-a",
            &registry,
            &data.request(),
            &binding,
        )
        .expect("complete multi-slot binding should pass");

        assert_eq!(validated.credential_slots.len(), 2);
        assert_eq!(validated.credential_slots[0].credential_ref, "opaque-ref-a");
        assert_eq!(validated.credential_slots[1].credential_ref, "opaque-ref-b");
    }

    #[test]
    fn rejects_unknown_query_and_invalid_body_value() {
        let mut unknown_query = RequestData::fixture();
        unknown_query
            .query
            .insert("rawQuery".to_owned(), PublicValue::String("x=1".to_owned()));
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &unknown_query.request(),
                &binding(),
            ),
            Err(EndpointValidationError::QueryParameterMismatch)
        );

        let mut invalid_body = RequestData::fixture();
        invalid_body
            .body
            .insert("recordType".to_owned(), PublicValue::String("A".to_owned()));
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[CAPABILITY],
                &invalid_body.request(),
                &binding(),
            ),
            Err(EndpointValidationError::PublicValueNotAllowed)
        );
    }

    #[test]
    fn enforces_encoded_request_limits_and_safe_integers() {
        let data = RequestData::fixture();
        let query_limited = EndpointCapability {
            max_query_bytes: 1,
            ..CAPABILITY
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[query_limited],
                &data.request(),
                &binding(),
            ),
            Err(EndpointValidationError::QueryTooLarge)
        );

        let body_limited = EndpointCapability {
            max_body_bytes: 1,
            ..CAPABILITY
        };
        assert_eq!(
            validate_endpoint_request_against_registry(
                RuntimeMode::Active,
                "device-a",
                &[body_limited],
                &data.request(),
                &binding(),
            ),
            Err(EndpointValidationError::BodyTooLarge)
        );

        let integer_field = PublicFieldSchema {
            field_id: "count",
            wire_name: "count",
            value_type: PublicValueType::Integer,
            required: true,
            max_length: None,
            allowed_values: &[],
        };
        assert_eq!(
            validate_public_value(&integer_field, &PublicValue::Integer(9_007_199_254_740_992)),
            Err(EndpointValidationError::PublicIntegerOutOfRange)
        );
    }

    #[test]
    fn production_entrypoint_uses_the_generated_deny_all_registry() {
        let data = RequestData::fixture();
        assert_eq!(
            validate_endpoint_request(RuntimeMode::Active, "device-a", &data.request(), &binding(),),
            Err(EndpointValidationError::UnknownEndpoint)
        );
    }

    #[test]
    fn rejects_invalid_idempotency_key_before_network() {
        let data = RequestData::fixture();
        let request = EndpointRequest {
            idempotency_key: "bad/key",
            ..data.request()
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
        for reserved in [
            IpAddr::V4(Ipv4Addr::new(192, 0, 0, 8)),
            IpAddr::V4(Ipv4Addr::new(192, 88, 99, 1)),
            IpAddr::V6("64:ff9b::1".parse().expect("NAT64 address")),
            IpAddr::V6("2001:db8::1".parse().expect("documentation address")),
            IpAddr::V6("2002:0101:0101::1".parse().expect("6to4 address")),
        ] {
            assert_eq!(
                validate_resolved_addresses(&[reserved]),
                Err(EndpointValidationError::NonPublicAddress)
            );
        }
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
