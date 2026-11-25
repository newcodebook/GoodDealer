//! Independently verifies the exact signed authorization/time pair before Native persistence.
use super::*;

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Response {
    schema_version: u8,
    grant: DesktopAuthorizationGrant,
    context: Context,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Context {
    schema_version: u8,
    typ: String,
    iss: String,
    aud: String,
    kid: String,
    nonce: String,
    account_id: String,
    workspace_id: String,
    device_id: String,
    account_security_epoch: u64,
    active_lease_epoch: u64,
    credential_epoch: u64,
    signing_key_id: String,
    signing_key_version: u64,
    authorization_grant_digest: String,
    server_observed_at: String,
    expires_at: String,
    signature: String,
}
pub(in crate::desktop_local_host) struct VerifiedExecutionContext {
    pub(in crate::desktop_local_host) authority: VerifiedWorkspaceAuthority,
    pub(in crate::desktop_local_host) observed_at: i64,
    pub(in crate::desktop_local_host) expires_at: i64,
    pub(in crate::desktop_local_host) credential_epoch: u64,
    pub(in crate::desktop_local_host) key_id: String,
    pub(in crate::desktop_local_host) key_version: u64,
    pub(in crate::desktop_local_host) anchor_digest: String,
    pub(in crate::desktop_local_host) authorization_hash: String,
}
fn canonical(value: &serde_json::Value) -> Result<Vec<u8>, WorkspaceAuthorityError> {
    use serde_json::Value;
    Ok(match value {
        Value::String(value) => canonical_string(value),
        Value::Number(value) => {
            canonical_number(value.as_u64().ok_or(WorkspaceAuthorityError::Malformed)?)
        }
        Value::Array(values) => canonical_array(
            values
                .iter()
                .map(canonical)
                .collect::<Result<Vec<_>, _>>()?,
        ),
        Value::Object(values) => {
            let mut entries = Vec::new();
            let mut sorted = values.iter().collect::<Vec<_>>();
            sorted.sort_unstable_by_key(|(key, _)| *key);
            for (key, value) in sorted {
                entries.extend(frame(
                    b'e',
                    &[frame(b'k', key.as_bytes()), frame(b'v', &canonical(value)?)].concat(),
                ));
            }
            frame(b'o', &entries)
        }
        _ => return Err(WorkspaceAuthorityError::Malformed),
    })
}
fn transcript(domain: &str, value: &serde_json::Value) -> Result<Vec<u8>, WorkspaceAuthorityError> {
    Ok([
        frame(b'd', domain.as_bytes()),
        frame(b'v', &canonical(value)?),
    ]
    .concat())
}
fn exact_base64(value: &str, len: usize) -> bool {
    URL_SAFE_NO_PAD
        .decode(value)
        .is_ok_and(|bytes| bytes.len() == len && URL_SAFE_NO_PAD.encode(bytes) == value)
}
impl VerifiedExecutionContext {
    #[expect(
        clippy::too_many_lines,
        reason = "the independent signed pair validation keeps its identity, digest and time checks together"
    )]
    pub(in crate::desktop_local_host) fn verify(
        bytes: &[u8],
        nonce: &str,
        key_id: &str,
        binding: &TrustedWorkspaceBinding<'_>,
        verifier: &WorkspaceAuthorityVerifier,
    ) -> Result<Self, WorkspaceAuthorityError> {
        if bytes.is_empty() || bytes.len() > 32_768 {
            return Err(WorkspaceAuthorityError::Malformed);
        }
        let response: Response =
            serde_json::from_slice(bytes).map_err(|_| WorkspaceAuthorityError::Malformed)?;
        let context = &response.context;
        if response.schema_version != 1
            || context.schema_version != 1
            || context.typ != "gd.desktop-execution-context.v1"
            || context.iss != EXPECTED_ISSUER
            || context.aud != "gooddealer-desktop/execution-evidence"
            || context.nonce != nonce
            || context.signing_key_id != key_id
            || !exact_base64(nonce, 32)
            || !exact_base64(&context.signature, 64)
            || !exact_base64(&context.authorization_grant_digest, 32)
            || [
                &context.kid,
                &context.account_id,
                &context.workspace_id,
                &context.device_id,
                &context.signing_key_id,
            ]
            .iter()
            .any(|v| !valid_identifier(v))
            || [
                context.account_security_epoch,
                context.active_lease_epoch,
                context.credential_epoch,
                context.signing_key_version,
            ]
            .iter()
            .any(|v| *v == 0 || *v > MAX_SAFE_INTEGER)
        {
            return Err(WorkspaceAuthorityError::Malformed);
        }
        let mut context_value =
            serde_json::to_value(context).map_err(|_| WorkspaceAuthorityError::Malformed)?;
        let anchor = transcript(
            "GOODDEALER-DESKTOP-EXECUTION-CONTEXT-ENVELOPE-V1",
            &context_value,
        )?;
        context_value
            .as_object_mut()
            .ok_or(WorkspaceAuthorityError::Malformed)?
            .remove("signature");
        if !verifier.verify(
            CredentialPurpose::ExecutionContextV1,
            &context.kid,
            &transcript("GOODDEALER-DESKTOP-EXECUTION-CONTEXT-V1", &context_value)?,
            &context.signature,
        ) {
            return Err(WorkspaceAuthorityError::SignatureRejected);
        }
        let grant = &response.grant;
        let digest = URL_SAFE_NO_PAD.encode(Sha256::digest(transcript(
            "GOODDEALER-DESKTOP-EXECUTION-AUTHORIZATION-V1",
            &serde_json::to_value(grant).map_err(|_| WorkspaceAuthorityError::Malformed)?,
        )?));
        let observed_at = parse_canonical_utc(&context.server_observed_at)?;
        let expires_at = parse_canonical_utc(&context.expires_at)?;
        let deadline = parse_canonical_utc(&grant.expires_at)?
            .min(parse_canonical_utc(
                &grant.active_device_lease.payload.offline_execute_until,
            )?)
            .min(parse_canonical_utc(
                &grant.commercial_authority.commercial_expires_at,
            )?);
        if digest != context.authorization_grant_digest
            || expires_at != deadline
            || observed_at < parse_canonical_utc(&grant.issued_at)?
            || observed_at < parse_canonical_utc(&grant.active_device_lease.issued_at)?
            || observed_at >= expires_at
            || expires_at - observed_at > MAX_OFFLINE_WINDOW_SECONDS
            || context.account_id != grant.active_device_lease.account_id
            || context.workspace_id != grant.workspace.workspace_id
            || context.device_id != grant.active_device_lease.device_id
            || context.account_security_epoch != grant.active_device_lease.account_security_epoch
            || context.active_lease_epoch != grant.active_device_lease.payload.lease_epoch
        {
            return Err(WorkspaceAuthorityError::ScopeRejected);
        }
        let credential_epoch = context.credential_epoch;
        let key_id = context.signing_key_id.clone();
        let key_version = context.signing_key_version;
        // Historical signature admission uses the signed sample; elapsed-time admission is separate.
        let authority = VerifiedWorkspaceAuthority::verify_grant(
            response.grant,
            binding,
            observed_at,
            verifier,
        )?;
        Ok(Self {
            authority,
            observed_at,
            expires_at,
            credential_epoch,
            key_id,
            key_version,
            anchor_digest: URL_SAFE_NO_PAD.encode(Sha256::digest(anchor)),
            authorization_hash: digest,
        })
    }
}

#[cfg(test)]
pub(in crate::desktop_local_host) fn test_verifier(
    mut verifier: WorkspaceAuthorityVerifier,
) -> WorkspaceAuthorityVerifier {
    use ring::signature::KeyPair as _;
    let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&[0x53; 32]).unwrap();
    verifier.keys.insert(
        (CredentialPurpose::ExecutionContextV1, "context-test".into()),
        pair.public_key().as_ref().try_into().unwrap(),
    );
    verifier
}
#[cfg(test)]
pub(in crate::desktop_local_host) fn test_response(grant: &[u8], nonce: &str) -> Vec<u8> {
    let grant: serde_json::Value = serde_json::from_slice(grant).unwrap();
    let context = serde_json::json!({"schemaVersion":1,"typ":"gd.desktop-execution-context.v1","iss":EXPECTED_ISSUER,"aud":"gooddealer-desktop/execution-evidence","kid":"context-test","nonce":nonce,"accountId":grant["activeDeviceLease"]["accountId"],"workspaceId":grant["workspace"]["workspaceId"],"deviceId":grant["activeDeviceLease"]["deviceId"],"accountSecurityEpoch":grant["activeDeviceLease"]["accountSecurityEpoch"],"activeLeaseEpoch":grant["activeDeviceLease"]["payload"]["leaseEpoch"],"credentialEpoch":3,"signingKeyId":"device-test-key","signingKeyVersion":4,"authorizationGrantDigest":URL_SAFE_NO_PAD.encode(Sha256::digest(transcript("GOODDEALER-DESKTOP-EXECUTION-AUTHORIZATION-V1",&grant).unwrap())),"serverObservedAt":crate::desktop_local_host::format_timestamp(crate::desktop_local_host::current_unix_seconds().unwrap()),"expiresAt":grant["expiresAt"]});
    let mut context = context;
    let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&[0x53; 32]).unwrap();
    context["signature"] = serde_json::json!(
        URL_SAFE_NO_PAD.encode(
            pair.sign(&transcript("GOODDEALER-DESKTOP-EXECUTION-CONTEXT-V1", &context).unwrap())
                .as_ref()
        )
    );
    serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"grant":grant,"context":context}))
        .unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;
    fn binding() -> TrustedWorkspaceBinding<'static> {
        TrustedWorkspaceBinding {
            account_id: Some("account-local"),
            device_id: "device-local",
            minimum_account_security_epoch: 2,
            minimum_lease_epoch: 2,
        }
    }
    fn sign_context(value: &mut serde_json::Value) {
        value["context"]
            .as_object_mut()
            .unwrap()
            .remove("signature");
        let pair = ring::signature::Ed25519KeyPair::from_seed_unchecked(&[0x53; 32]).unwrap();
        value["context"]["signature"] = serde_json::json!(
            URL_SAFE_NO_PAD.encode(
                pair.sign(
                    &transcript("GOODDEALER-DESKTOP-EXECUTION-CONTEXT-V1", &value["context"])
                        .unwrap()
                )
                .as_ref()
            )
        );
    }
    #[test]
    fn rejects_wrong_purpose_nonce_nested_grant_and_signed_scope_or_deadline_substitution() {
        let (verifier, grant) = super::super::tests::long_lived_signed_grant(
            2,
            &"22".repeat(32),
            "2099-12-31T23:59:59Z",
        );
        let verifier = test_verifier(verifier);
        let nonce = URL_SAFE_NO_PAD.encode([7; 32]);
        let response = test_response(&grant, &nonce);
        let valid: serde_json::Value = serde_json::from_slice(&response).unwrap();
        assert!(
            VerifiedExecutionContext::verify(
                &response,
                &nonce,
                "device-test-key",
                &binding(),
                &verifier
            )
            .is_ok()
        );
        for (field, value) in [
            ("kid", serde_json::json!("grant-key-host-test")),
            ("nonce", serde_json::json!(URL_SAFE_NO_PAD.encode([8; 32]))),
            ("accountId", serde_json::json!("foreign-account")),
            ("deviceId", serde_json::json!("foreign-device")),
            ("workspaceId", serde_json::json!("foreign-workspace")),
            ("accountSecurityEpoch", serde_json::json!(3)),
            ("activeLeaseEpoch", serde_json::json!(3)),
            ("signingKeyId", serde_json::json!("foreign-key")),
            ("credentialEpoch", serde_json::json!(0)),
            ("expiresAt", serde_json::json!("2099-12-31T23:59:59Z")),
            (
                "authorizationGrantDigest",
                serde_json::json!(URL_SAFE_NO_PAD.encode([0; 32])),
            ),
        ] {
            let mut changed = valid.clone();
            changed["context"][field] = value;
            sign_context(&mut changed);
            assert!(
                VerifiedExecutionContext::verify(
                    &serde_json::to_vec(&changed).unwrap(),
                    &nonce,
                    "device-test-key",
                    &binding(),
                    &verifier
                )
                .is_err(),
                "{field}"
            );
        }
        let mut changed = valid.clone();
        changed["grant"]["signature"] = serde_json::json!(URL_SAFE_NO_PAD.encode([0; 64]));
        assert!(
            VerifiedExecutionContext::verify(
                &serde_json::to_vec(&changed).unwrap(),
                &nonce,
                "device-test-key",
                &binding(),
                &verifier
            )
            .is_err()
        );
        let mut changed = valid.clone();
        changed["context"]["unexpected"] = serde_json::json!(1);
        assert!(
            VerifiedExecutionContext::verify(
                &serde_json::to_vec(&changed).unwrap(),
                &nonce,
                "device-test-key",
                &binding(),
                &verifier
            )
            .is_err()
        );
        let duplicate = String::from_utf8(response).unwrap().replacen(
            "\"schemaVersion\":1",
            "\"schemaVersion\":1,\"schemaVersion\":1",
            1,
        );
        assert!(
            VerifiedExecutionContext::verify(
                duplicate.as_bytes(),
                &nonce,
                "device-test-key",
                &binding(),
                &verifier
            )
            .is_err()
        );
    }
}
