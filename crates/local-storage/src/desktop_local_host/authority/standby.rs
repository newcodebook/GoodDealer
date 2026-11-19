//! Strict role exchange parsing. A Standby grant never acquires Lease or commercial fields.

use super::{
    AuthorizedWorkspaceWire, CredentialPurpose, DesktopAuthorizationGrant, EXPECTED_ISSUER,
    MAX_SAFE_INTEGER, MAX_SIGNED_WIRE_BYTES, TrustedWorkspaceBinding, VerifiedWorkspaceAuthority,
    WorkspaceAuthorityError, WorkspaceAuthorityVerifier, canonical_array, canonical_number,
    canonical_object, canonical_string, frame, parse_canonical_utc, valid_identifier,
};
use serde::Deserialize;

#[derive(Deserialize)]
#[serde(tag = "role", rename_all = "snake_case", deny_unknown_fields)]
enum RoleWire {
    Active {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        grant: Box<DesktopAuthorizationGrant>,
    },
    Standby {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        grant: Box<StandbyGrant>,
    },
}

pub(in crate::desktop_local_host) enum VerifiedWorkspaceRole {
    Active(VerifiedWorkspaceAuthority),
    Standby(VerifiedStandbyAuthority),
}

impl VerifiedWorkspaceRole {
    pub(in crate::desktop_local_host) fn verify(
        wire: &[u8],
        binding: &TrustedWorkspaceBinding<'_>,
        now: i64,
        verifier: &WorkspaceAuthorityVerifier,
    ) -> Result<Self, WorkspaceAuthorityError> {
        if wire.is_empty() || wire.len() > MAX_SIGNED_WIRE_BYTES {
            return Err(WorkspaceAuthorityError::Malformed);
        }
        let value: RoleWire =
            serde_json::from_slice(wire).map_err(|_| WorkspaceAuthorityError::Malformed)?;
        match value {
            RoleWire::Active {
                schema_version: 5,
                grant,
            } => VerifiedWorkspaceAuthority::verify_grant(*grant, binding, now, verifier)
                .map(Self::Active),
            RoleWire::Standby {
                schema_version: 5,
                grant,
            } => grant.verify(binding, now, verifier).map(Self::Standby),
            _ => Err(WorkspaceAuthorityError::Malformed),
        }
    }
}

pub(in crate::desktop_local_host) struct VerifiedStandbyAuthority {
    pub(in crate::desktop_local_host) account_id: String,
    pub(in crate::desktop_local_host) workspace_id: String,
    pub(in crate::desktop_local_host) device_id: String,
    pub(in crate::desktop_local_host) account_security_epoch: u64,
    pub(in crate::desktop_local_host) lease_epoch_floor: u64,
    pub(in crate::desktop_local_host) issued_at: i64,
    pub(in crate::desktop_local_host) expires_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct StandbyGrant {
    schema_version: u8,
    typ: String,
    iss: String,
    aud: String,
    kid: String,
    issued_at: String,
    expires_at: String,
    account_id: String,
    device_id: String,
    account_security_epoch: u64,
    workspace: AuthorizedWorkspaceWire,
    lease_epoch_floor: u64,
    scopes: [String; 1],
    signature: String,
}

impl StandbyGrant {
    fn verify(
        self,
        binding: &TrustedWorkspaceBinding<'_>,
        now: i64,
        verifier: &WorkspaceAuthorityVerifier,
    ) -> Result<VerifiedStandbyAuthority, WorkspaceAuthorityError> {
        let issued = parse_canonical_utc(&self.issued_at)?;
        let expires = parse_canonical_utc(&self.expires_at)?;
        if self.schema_version != 1
            || self.typ != "gd.desktop-standby-grant.v1"
            || self.iss != EXPECTED_ISSUER
            || self.aud != "gooddealer-desktop/standby"
            || !valid_identifier(&self.kid)
            || !valid_identifier(&self.account_id)
            || !valid_identifier(&self.device_id)
            || !valid_identifier(&self.workspace.workspace_id)
            || self.workspace.kind != "personal_default"
            || self.account_security_epoch == 0
            || self.account_security_epoch > MAX_SAFE_INTEGER
            || self.lease_epoch_floor > MAX_SAFE_INTEGER
            || self.scopes != ["workspace:read"]
            || expires <= issued
            || expires - issued > 900
        {
            return Err(WorkspaceAuthorityError::Malformed);
        }
        let transcript = self.signature_transcript();
        if !verifier.verify(
            CredentialPurpose::StandbyGrantV1,
            &self.kid,
            &transcript,
            &self.signature,
        ) {
            return Err(WorkspaceAuthorityError::SignatureRejected);
        }
        if binding.account_id.is_some_and(|id| id != self.account_id)
            || binding.device_id != self.device_id
            || self.account_security_epoch < binding.minimum_account_security_epoch
            || self.lease_epoch_floor < binding.minimum_lease_epoch
        {
            return Err(WorkspaceAuthorityError::ScopeRejected);
        }
        if now < issued || now >= expires {
            return Err(WorkspaceAuthorityError::Expired);
        }
        Ok(VerifiedStandbyAuthority {
            account_id: self.account_id,
            workspace_id: self.workspace.workspace_id,
            device_id: self.device_id,
            account_security_epoch: self.account_security_epoch,
            lease_epoch_floor: self.lease_epoch_floor,
            issued_at: issued,
            expires_at: expires,
        })
    }
    fn signature_transcript(&self) -> Vec<u8> {
        let envelope = canonical_object([
            (
                "schemaVersion",
                canonical_number(u64::from(self.schema_version)),
            ),
            ("typ", canonical_string(&self.typ)),
            ("iss", canonical_string(&self.iss)),
            ("aud", canonical_string(&self.aud)),
            ("kid", canonical_string(&self.kid)),
            ("issuedAt", canonical_string(&self.issued_at)),
            ("expiresAt", canonical_string(&self.expires_at)),
            ("accountId", canonical_string(&self.account_id)),
            ("deviceId", canonical_string(&self.device_id)),
            (
                "accountSecurityEpoch",
                canonical_number(self.account_security_epoch),
            ),
            ("leaseEpochFloor", canonical_number(self.lease_epoch_floor)),
            (
                "scopes",
                canonical_array([canonical_string(&self.scopes[0])]),
            ),
            (
                "workspace",
                canonical_object([
                    (
                        "workspaceId",
                        canonical_string(&self.workspace.workspace_id),
                    ),
                    ("kind", canonical_string(&self.workspace.kind)),
                ]),
            ),
        ]);
        [
            frame(b'd', b"GOODDEALER-DESKTOP-STANDBY-GRANT-V1"),
            frame(b'v', &envelope),
        ]
        .concat()
    }
}

#[cfg(test)]
pub(in crate::desktop_local_host) fn signed_standby_for_host_test(
    floor: u64,
    security_epoch: u64,
) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
    use super::VerificationKey;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::json;
    let grant = Ed25519KeyPair::from_seed_unchecked(&[0x51; 32]).unwrap();
    let lease = Ed25519KeyPair::from_seed_unchecked(&[0x52; 32]).unwrap();
    let standby = Ed25519KeyPair::from_seed_unchecked(&[0x71; 32]).unwrap();
    let verifier = WorkspaceAuthorityVerifier::from_keys([
        VerificationKey::new(
            CredentialPurpose::GrantV3,
            "grant-key-host-test",
            grant.public_key().as_ref(),
        )
        .unwrap(),
        VerificationKey::new(
            CredentialPurpose::ActiveDeviceLeaseV1,
            "lease-key-host-test",
            lease.public_key().as_ref(),
        )
        .unwrap(),
        VerificationKey::new(
            CredentialPurpose::StandbyGrantV1,
            "standby-key-host-test",
            standby.public_key().as_ref(),
        )
        .unwrap(),
    ])
    .unwrap();
    let now = crate::desktop_local_host::current_unix_seconds().unwrap();
    let mut value = json!({"schemaVersion":1,"typ":"gd.desktop-standby-grant.v1", "iss":EXPECTED_ISSUER,
        "aud":"gooddealer-desktop/standby", "kid":"standby-key-host-test",
        "issuedAt":crate::desktop_local_host::format_timestamp(now - 60),
        "expiresAt":crate::desktop_local_host::format_timestamp(now + 600),
        "accountId":"account-local", "deviceId":"device-local", "accountSecurityEpoch":security_epoch,
        "workspace":{"workspaceId":"workspace-local","kind":"personal_default"},
        "leaseEpochFloor":floor,"scopes":["workspace:read"],"signature":"placeholder"});
    let parsed: StandbyGrant = serde_json::from_value(value.clone()).unwrap();
    value["signature"] =
        json!(URL_SAFE_NO_PAD.encode(standby.sign(&parsed.signature_transcript()).as_ref()));
    (
        verifier,
        serde_json::to_vec(&json!({"schemaVersion":5,"role":"standby","grant":value})).unwrap(),
    )
}

#[cfg(test)]
mod tests {
    use super::super::VerificationKey;
    use super::*;
    use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
    use ring::signature::{Ed25519KeyPair, KeyPair};
    use serde_json::{Value, json};
    use sha2::{Digest, Sha256};

    fn binding() -> TrustedWorkspaceBinding<'static> {
        TrustedWorkspaceBinding {
            account_id: Some("account-local"),
            device_id: "device-standby",
            minimum_account_security_epoch: 4,
            minimum_lease_epoch: 7,
        }
    }
    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../../../packages/protocol/test-vectors/standby-grant/valid/standby-grant.json"
        ))
        .unwrap()
    }
    fn signed(value: Value, purpose: CredentialPurpose) -> (WorkspaceAuthorityVerifier, Vec<u8>) {
        let key = Ed25519KeyPair::from_seed_unchecked(&[0x71; 32]).unwrap();
        let verifier = WorkspaceAuthorityVerifier::from_keys([VerificationKey::new(
            purpose,
            "standby-grant-key-1",
            key.public_key().as_ref(),
        )
        .unwrap()])
        .unwrap();
        let mut grant = value;
        let parsed: StandbyGrant = serde_json::from_value(grant.clone()).unwrap();
        grant["signature"] =
            json!(URL_SAFE_NO_PAD.encode(key.sign(&parsed.signature_transcript()).as_ref()));
        (
            verifier,
            serde_json::to_vec(&json!({"schemaVersion":5,"role":"standby","grant":grant})).unwrap(),
        )
    }
    fn now() -> i64 {
        parse_canonical_utc("2026-11-18T08:05:00Z").unwrap()
    }

    #[test]
    fn standby_transcript_matches_protocol_golden_vector() {
        let grant: StandbyGrant = serde_json::from_value(fixture()).unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(Sha256::digest(grant.signature_transcript())),
            "flcU9oAsGcmEfUhVif4nF5vEvYa-61L1CS2DjsohAkM"
        );
    }
    #[test]
    fn accepts_only_separate_standby_purpose_and_matching_native_binding() {
        let (verifier, wire) = signed(fixture(), CredentialPurpose::StandbyGrantV1);
        assert!(matches!(
            VerifiedWorkspaceRole::verify(&wire, &binding(), now(), &verifier),
            Ok(VerifiedWorkspaceRole::Standby(_))
        ));
        let mut wrong = binding();
        wrong.account_id = Some("another-account");
        assert!(VerifiedWorkspaceRole::verify(&wire, &wrong, now(), &verifier).is_err());
        wrong = binding();
        wrong.device_id = "another-device";
        assert!(VerifiedWorkspaceRole::verify(&wire, &wrong, now(), &verifier).is_err());
        wrong = binding();
        wrong.minimum_account_security_epoch = 5;
        assert!(VerifiedWorkspaceRole::verify(&wire, &wrong, now(), &verifier).is_err());
        wrong = binding();
        wrong.minimum_lease_epoch = 8;
        assert!(VerifiedWorkspaceRole::verify(&wire, &wrong, now(), &verifier).is_err());
        for purpose in [
            CredentialPurpose::GrantV3,
            CredentialPurpose::ActiveDeviceLeaseV1,
        ] {
            let (verifier, wire) = signed(fixture(), purpose);
            assert!(VerifiedWorkspaceRole::verify(&wire, &binding(), now(), &verifier).is_err());
        }
    }
    #[test]
    fn rejects_expiry_mixed_roles_unknown_fields_and_duplicate_keys() {
        let (verifier, wire) = signed(fixture(), CredentialPurpose::StandbyGrantV1);
        for time in [now() - 301, now() + 600] {
            assert!(VerifiedWorkspaceRole::verify(&wire, &binding(), time, &verifier).is_err());
        }
        let valid: Value = serde_json::from_slice(&wire).unwrap();
        for (field, value) in [
            ("role", json!("active")),
            ("schemaVersion", json!(3)),
            ("extra", json!(true)),
        ] {
            let mut bad = valid.clone();
            bad[field] = value;
            assert!(
                VerifiedWorkspaceRole::verify(
                    &serde_json::to_vec(&bad).unwrap(),
                    &binding(),
                    now(),
                    &verifier
                )
                .is_err()
            );
        }
        for field in ["commercialAuthority", "activeDeviceLease", "extra"] {
            let mut bad = valid.clone();
            bad["grant"][field] = json!({});
            assert!(
                VerifiedWorkspaceRole::verify(
                    &serde_json::to_vec(&bad).unwrap(),
                    &binding(),
                    now(),
                    &verifier
                )
                .is_err()
            );
        }
        let duplicate = String::from_utf8(wire).unwrap().replace(
            "\"leaseEpochFloor\":7",
            "\"leaseEpochFloor\":7,\"leaseEpochFloor\":7",
        );
        assert!(
            VerifiedWorkspaceRole::verify(duplicate.as_bytes(), &binding(), now(), &verifier)
                .is_err()
        );
        assert!(
            VerifiedWorkspaceRole::verify(
                &serde_json::to_vec(&valid["grant"]).unwrap(),
                &binding(),
                now(),
                &verifier
            )
            .is_err()
        );
    }
}
