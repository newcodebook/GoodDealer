//! Closed execution-evidence signing. Host owns authorization and the truth of claims.

use super::{
    DesktopDeviceIdentity, DesktopDeviceIdentityError, read_canonical_frame, read_exact_frame,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use ring::signature::{ED25519, Ed25519KeyPair, UnparsedPublicKey};
use serde::de::{MapAccess, Visitor};
use serde::{Deserialize, Deserializer};
use serde_json::{Map, Value, json};
use sha2::{Digest as _, Sha256};

const APPROVAL: &str = "GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-V1";
const APPROVAL_ENVELOPE: &str = "GOODDEALER-AFTERNIC-DELIST-ITEM-APPROVAL-ENVELOPE-V1";
const WRITE_APPROVAL: &str = "GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-V1";
const WRITE_APPROVAL_ENVELOPE: &str = "GOODDEALER-AFTERNIC-LISTING-WRITE-ITEM-APPROVAL-ENVELOPE-V1";
const SELLERHUB_BIN_APPROVAL: &str = "GOODDEALER-SELLERHUB-BIN-PRICE-ITEM-APPROVAL-V1";
const SELLERHUB_BIN_APPROVAL_ENVELOPE: &str =
    "GOODDEALER-SELLERHUB-BIN-PRICE-ITEM-APPROVAL-ENVELOPE-V1";
const SELLERHUB_BIN_DISPATCH_KEY: &str = "GOODDEALER-SELLERHUB-BIN-PRICE-LOCAL-DISPATCH-KEY-V1";
const SELLERHUB_CREATE_APPROVAL: &str = "GOODDEALER-SELLERHUB-CREATE-LISTING-ITEM-APPROVAL-V1";
const SELLERHUB_CREATE_APPROVAL_TYPE: &str = "gd.sellerhub-create-listing-item-approval.v1";
const SELLERHUB_CREATE_APPROVAL_ENVELOPE: &str =
    "GOODDEALER-SELLERHUB-CREATE-LISTING-ITEM-APPROVAL-ENVELOPE-V1";
const SELLERHUB_CREATE_DISPATCH_KEY: &str =
    "GOODDEALER-SELLERHUB-CREATE-LISTING-LOCAL-DISPATCH-KEY-V1";
const ATOM_STANDARD_DELIST_APPROVAL: &str = "GOODDEALER-ATOM-STANDARD-DELIST-ITEM-APPROVAL-V1";
const ATOM_STANDARD_DELIST_APPROVAL_TYPE: &str = "gd.atom-standard-delist-item-approval.v1";
const ATOM_STANDARD_DELIST_APPROVAL_ENVELOPE: &str =
    "GOODDEALER-ATOM-STANDARD-DELIST-ITEM-APPROVAL-ENVELOPE-V1";
const ATOM_STANDARD_DELIST_DISPATCH_KEY: &str =
    "GOODDEALER-ATOM-STANDARD-DELIST-LOCAL-DISPATCH-KEY-V1";
const ATOM_STANDARD_LISTING_APPROVAL: &str = "GOODDEALER-ATOM-STANDARD-LISTING-ITEM-APPROVAL-V1";
const ATOM_STANDARD_LISTING_APPROVAL_TYPE: &str = "gd.atom-standard-listing-item-approval.v1";
const ATOM_STANDARD_LISTING_APPROVAL_ENVELOPE: &str =
    "GOODDEALER-ATOM-STANDARD-LISTING-ITEM-APPROVAL-ENVELOPE-V1";
const ATOM_STANDARD_LISTING_DISPATCH_KEY: &str =
    "GOODDEALER-ATOM-STANDARD-LISTING-LOCAL-DISPATCH-KEY-V1";
const PLAN_APPROVAL: &str = "GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-V2";
const OWNERSHIP_APPROVAL: &str = "GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-V1";
const PLAN_APPROVAL_ENVELOPE: &str = "GOODDEALER-AFTERNIC-LISTING-PLAN-ITEM-APPROVAL-ENVELOPE-V2";
const OWNERSHIP_APPROVAL_ENVELOPE: &str =
    "GOODDEALER-AFTERNIC-OWNERSHIP-REVIEW-ITEM-APPROVAL-ENVELOPE-V1";
const AUDIT: &str = "GOODDEALER-DEVICE-AUDIT-EVENT-V1";
const AUDIT_HASH: &str = "GOODDEALER-DEVICE-AUDIT-EVENT-HASH-V1";
const FACT: &str = "GOODDEALER-EXECUTION-FACT-V1";
const MAX_TRANSCRIPT: usize = 32_768;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

type Object = Map<String, Value>;

impl DesktopDeviceIdentity {
    /// Signs only a closed, device-bound Afternic removal item approval transcript.
    /// # Errors
    /// Rejects another purpose, unknown/invalid claims, or a different device/key.
    pub fn sign_afternic_delist_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object =
            decode(transcript, APPROVAL).ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !literal(&object, "action", "remove") || !approval(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs only a closed, device-bound Afternic create/update item approval transcript.
    /// # Errors
    /// Rejects removal or another purpose, unknown claims, or a different device/key.
    pub fn sign_afternic_listing_write_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, WRITE_APPROVAL)
            .ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !listing_action(&object) || !approval(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs one device-bound `SellerHub` BIN price change approval.
    ///
    /// # Errors
    /// Rejects another purpose, unknown claims or mismatched device/key identity.
    pub fn sign_sellerhub_bin_price_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, SELLERHUB_BIN_APPROVAL)
            .ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !sellerhub_bin_price_approval(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs a device-bound fixed-price `SellerHub` creation approval.
    ///
    /// # Errors
    /// Rejects a different purpose, invalid claims, or a different device or key.
    pub fn sign_sellerhub_create_listing_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, SELLERHUB_CREATE_APPROVAL)
            .ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !sellerhub_create_listing_approval(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs a device-bound approval for one Atom Standard listing creation.
    ///
    /// # Errors
    /// Rejects a different purpose, invalid claims, or a different device or key.
    pub fn sign_atom_standard_listing_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, ATOM_STANDARD_LISTING_APPROVAL)
            .ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !atom_standard_listing_approval(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs a device-bound approval for one Atom Standard listing removal.
    ///
    /// # Errors
    /// Rejects a different purpose, invalid claims, or a different device or key.
    pub fn sign_atom_standard_delist_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, ATOM_STANDARD_DELIST_APPROVAL)
            .ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !atom_standard_delist_approval(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs a v2 create/update item in a bounded Afternic Listing plan.
    /// # Errors
    /// Rejects another purpose, parent references, invalid claims or another device/key.
    pub fn sign_afternic_listing_plan_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object =
            decode(transcript, PLAN_APPROVAL).ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !plan_item_approval(&object, false) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs only a separately approved Afternic ownership-review item.
    /// # Errors
    /// Rejects Listing writes, another purpose, inconsistent parent claims or another device/key.
    pub fn sign_afternic_ownership_review_approval_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, OWNERSHIP_APPROVAL)
            .ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !plan_item_approval(&object, true) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs only the closed workspace Afternic audit events, after recomputing their hash.
    /// # Errors
    /// Rejects another purpose, hash/chain mismatch, invalid payload, or different device/key.
    pub fn sign_device_audit_event_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object =
            decode(transcript, AUDIT).ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !audit(&object) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    /// Signs only a supported durable local dispatch claim with its exact signed item approval.
    /// # Errors
    /// Rejects altered evidence, another purpose, invalid fields or mismatched device/key/item.
    pub fn sign_execution_fact_transcript(
        &self,
        transcript: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let object = decode(transcript, FACT).ok_or(DesktopDeviceIdentityError::SigningRejected)?;
        if !fact(&object, &self.public_key) || !self.owns(&object) {
            return Err(DesktopDeviceIdentityError::SigningRejected);
        }
        self.sign_validated(transcript)
    }

    fn owns(&self, object: &Object) -> bool {
        text(object, "sourceDeviceId") == Some(self.device_id.as_str())
            && text(object, "signingKeyId") == Some(self.key_id.as_str())
    }

    // Private only: every caller above has decoded and validated its own fixed purpose.
    fn sign_validated(&self, transcript: &[u8]) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        let pair = Ed25519KeyPair::from_seed_unchecked(&*self.seed)
            .map_err(|_| DesktopDeviceIdentityError::SigningRejected)?;
        pair.sign(transcript)
            .as_ref()
            .try_into()
            .map_err(|_| DesktopDeviceIdentityError::SigningRejected)
    }
}

fn decode(bytes: &[u8], domain: &str) -> Option<Object> {
    if bytes.is_empty() || bytes.len() > MAX_TRANSCRIPT {
        return None;
    }
    let (tag, actual, rest) = read_canonical_frame(bytes)?;
    if tag != b'd' || actual != domain.as_bytes() {
        return None;
    }
    let value = decode_value(read_exact_frame(rest, b'v')?, 0)?;
    value.as_object().cloned()
}

fn decode_value(bytes: &[u8], depth: u8) -> Option<Value> {
    if depth > 4 {
        return None;
    }
    let (tag, payload, rest) = read_canonical_frame(bytes)?;
    if !rest.is_empty() {
        return None;
    }
    match tag {
        b'z' if payload.is_empty() => Some(Value::Null),
        b's' => Some(Value::String(std::str::from_utf8(payload).ok()?.to_owned())),
        b'n' => {
            let number: u64 = std::str::from_utf8(payload).ok()?.parse().ok()?;
            (number <= MAX_SAFE_INTEGER && number.to_string().as_bytes() == payload)
                .then(|| Value::from(number))
        }
        b'o' => {
            let mut result = Object::new();
            let mut remaining = payload;
            let mut previous: Option<&[u8]> = None;
            while !remaining.is_empty() {
                if result.len() >= 40 {
                    return None;
                }
                let (tag, entry, rest) = read_canonical_frame(remaining)?;
                let (key_tag, key, value) = read_canonical_frame(entry)?;
                if tag != b'e'
                    || key_tag != b'k'
                    || key.is_empty()
                    || key.len() > 64
                    || !key.is_ascii()
                    || previous.is_some_and(|old| old >= key)
                {
                    return None;
                }
                previous = Some(key);
                let value = decode_value(read_exact_frame(value, b'v')?, depth + 1)?;
                result.insert(std::str::from_utf8(key).ok()?.to_owned(), value);
                remaining = rest;
            }
            Some(Value::Object(result))
        }
        // The closed evidence schemas contain no arrays, booleans, floats or negative numbers.
        _ => None,
    }
}

fn frame(tag: char, payload: &[u8]) -> Vec<u8> {
    let mut result = format!("{tag}{}:", payload.len()).into_bytes();
    result.extend_from_slice(payload);
    result
}
fn canonical(value: &Value) -> Vec<u8> {
    match value {
        Value::Null => b"z0:".to_vec(),
        Value::String(value) => frame('s', value.as_bytes()),
        Value::Number(value) => frame('n', value.to_string().as_bytes()),
        Value::Object(value) => {
            let mut entries = value.iter().collect::<Vec<_>>();
            entries.sort_by_key(|(key, _)| *key);
            let mut bytes = Vec::new();
            for (key, value) in entries {
                let mut entry = frame('k', key.as_bytes());
                entry.extend(frame('v', &canonical(value)));
                bytes.extend(frame('e', &entry));
            }
            frame('o', &bytes)
        }
        _ => Vec::new(), // unreachable after closed validation; never used on caller wire directly
    }
}
fn transcript(domain: &str, object: &Object) -> Vec<u8> {
    let mut result = frame('d', domain.as_bytes());
    result.extend(frame('v', &canonical(&Value::Object(object.clone()))));
    result
}
fn hash(domain: &str, object: &Object) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(transcript(domain, object)))
}
fn text<'a>(object: &'a Object, key: &str) -> Option<&'a str> {
    object.get(key)?.as_str()
}
fn literal(object: &Object, key: &str, expected: &str) -> bool {
    text(object, key) == Some(expected)
}
fn number(object: &Object, key: &str) -> Option<u64> {
    object.get(key)?.as_u64()
}
fn integer(object: &Object, key: &str, minimum: u64) -> bool {
    number(object, key).is_some_and(|value| (minimum..=MAX_SAFE_INTEGER).contains(&value))
}
fn keys(object: &Object, expected: &str) -> bool {
    let expected = expected.split_ascii_whitespace().collect::<Vec<_>>();
    object.len() == expected.len() && expected.iter().all(|key| object.contains_key(*key))
}
fn all(object: &Object, names: &str, valid: fn(&str) -> bool) -> bool {
    names
        .split_ascii_whitespace()
        .all(|key| text(object, key).is_some_and(valid))
}
fn base64<const N: usize>(value: &str) -> Option<[u8; N]> {
    if value.len() > 4 * N {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(value).ok()?;
    (URL_SAFE_NO_PAD.encode(&bytes) == value).then_some(())?;
    bytes.try_into().ok()
}
fn digest(value: &str) -> bool {
    base64::<32>(value).is_some()
}
fn identifier(value: &str) -> bool {
    super::valid_identifier(value)
}
fn uuid(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 36
        && bytes[14] == b'4'
        && matches!(bytes[19], b'8' | b'9' | b'a' | b'b')
        && bytes.iter().enumerate().all(|(index, byte)| {
            if matches!(index, 8 | 13 | 18 | 23) {
                *byte == b'-'
            } else {
                byte.is_ascii_digit() || (b'a'..=b'f').contains(byte)
            }
        })
}
fn timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if b.len() != 20
        || b[19] != b'Z'
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || !b[..19]
            .iter()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7 | 10 | 13 | 16) || c.is_ascii_digit())
    {
        return false;
    }
    let n = |start: usize, end: usize| value[start..end].parse::<u32>().unwrap_or(u32::MAX);
    let year = n(0, 4);
    let month = n(5, 7);
    let day = n(8, 10);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    (1..=days).contains(&day) && n(11, 13) < 24 && n(14, 16) < 60 && n(17, 19) < 60
}
fn common(object: &Object) -> bool {
    common_version(object, 1)
}
fn common_version(object: &Object, version: u64) -> bool {
    number(object, "schemaVersion") == Some(version)
        && number(object, "signatureTranscriptVersion") == Some(1)
        && all(
            object,
            "sourceDeviceId workspaceId signingKeyId",
            identifier,
        )
        && all(object, "trustedTimeAnchorId", digest)
        && ["activeLeaseEpoch", "credentialEpoch", "signingKeyVersion"]
            .iter()
            .all(|key| integer(object, key, 1))
        && integer(object, "monotonicDeltaMs", 0)
}
fn listing_action(object: &Object) -> bool {
    matches!(text(object, "action"), Some("create" | "update"))
}
fn approval_domain(object: &Object) -> &'static str {
    if literal(object, "typ", "gd.sellerhub-bin-price-item-approval.v1") {
        SELLERHUB_BIN_APPROVAL
    } else if literal(object, "typ", SELLERHUB_CREATE_APPROVAL_TYPE) {
        SELLERHUB_CREATE_APPROVAL
    } else if literal(object, "typ", ATOM_STANDARD_DELIST_APPROVAL_TYPE) {
        ATOM_STANDARD_DELIST_APPROVAL
    } else if literal(object, "typ", ATOM_STANDARD_LISTING_APPROVAL_TYPE) {
        ATOM_STANDARD_LISTING_APPROVAL
    } else if literal(object, "typ", "gd.afternic-listing-plan-item-approval.v2") {
        PLAN_APPROVAL
    } else if literal(
        object,
        "typ",
        "gd.afternic-ownership-review-item-approval.v1",
    ) {
        OWNERSHIP_APPROVAL
    } else if listing_action(object) {
        WRITE_APPROVAL
    } else {
        APPROVAL
    }
}
fn envelope_domain(object: &Object) -> &'static str {
    if literal(object, "typ", "gd.sellerhub-bin-price-item-approval.v1") {
        SELLERHUB_BIN_APPROVAL_ENVELOPE
    } else if literal(object, "typ", SELLERHUB_CREATE_APPROVAL_TYPE) {
        SELLERHUB_CREATE_APPROVAL_ENVELOPE
    } else if literal(object, "typ", ATOM_STANDARD_DELIST_APPROVAL_TYPE) {
        ATOM_STANDARD_DELIST_APPROVAL_ENVELOPE
    } else if literal(object, "typ", ATOM_STANDARD_LISTING_APPROVAL_TYPE) {
        ATOM_STANDARD_LISTING_APPROVAL_ENVELOPE
    } else if literal(object, "typ", "gd.afternic-listing-plan-item-approval.v2") {
        PLAN_APPROVAL_ENVELOPE
    } else if literal(
        object,
        "typ",
        "gd.afternic-ownership-review-item-approval.v1",
    ) {
        OWNERSHIP_APPROVAL_ENVELOPE
    } else if listing_action(object) {
        WRITE_APPROVAL_ENVELOPE
    } else {
        APPROVAL_ENVELOPE
    }
}
fn approval(object: &Object) -> bool {
    approval_claims(object)
        && literal(
            object,
            "typ",
            if listing_action(object) {
                "gd.afternic-listing-write-item-approval.v1"
            } else {
                "gd.afternic-delist-item-approval.v1"
            },
        )
        && literal(object, "capability", "afternic:marketplace:write")
        && matches!(text(object, "action"), Some("remove" | "create" | "update"))
}
fn sellerhub_bin_price_approval(object: &Object) -> bool {
    approval_claims(object)
        && literal(object, "typ", "gd.sellerhub-bin-price-item-approval.v1")
        && literal(object, "action", "set_bin_price")
        && literal(object, "capability", "spaceship:marketplace:write")
}

fn sellerhub_create_listing_approval(object: &Object) -> bool {
    approval_claims(object)
        && literal(object, "typ", SELLERHUB_CREATE_APPROVAL_TYPE)
        && literal(object, "action", "create_listing")
        && literal(object, "capability", "spaceship:marketplace:write")
}

fn atom_standard_delist_approval(object: &Object) -> bool {
    approval_claims(object)
        && literal(object, "typ", ATOM_STANDARD_DELIST_APPROVAL_TYPE)
        && literal(object, "action", "remove_standard")
        && literal(object, "capability", "atom:marketplace:write")
}

fn atom_standard_listing_approval(object: &Object) -> bool {
    approval_claims(object)
        && literal(object, "typ", ATOM_STANDARD_LISTING_APPROVAL_TYPE)
        && literal(object, "action", "add_standard")
        && literal(object, "capability", "atom:marketplace:write")
}

fn approval_claims(object: &Object) -> bool {
    keys(
        object,
        "schemaVersion typ aud approvedOperationId operationId operationItemId planId planHash targetCount targetSetDigest capability action requestDigest accountId workspaceId sourceDeviceId activeLeaseEpoch credentialEpoch signingKeyId signingKeyVersion authorizationHash trustedTimeAnchorId monotonicDeltaMs approvedAt signatureTranscriptVersion",
    ) && common(object)
        && literal(object, "aud", "gooddealer-cloud/execution-evidence")
        && all(
            object,
            "approvedOperationId operationId operationItemId planId",
            uuid,
        )
        && all(
            object,
            "planHash targetSetDigest requestDigest authorizationHash",
            digest,
        )
        && all(object, "accountId", identifier)
        && all(object, "approvedAt", timestamp)
        && number(object, "targetCount").is_some_and(|n| (1..=500).contains(&n))
}
fn plan_item_approval(object: &Object, ownership: bool) -> bool {
    let purpose = if ownership {
        "gd.afternic-ownership-review-item-approval.v1"
    } else {
        "gd.afternic-listing-plan-item-approval.v2"
    };
    keys(
        object,
        "schemaVersion typ aud approvedOperationId operationId operationItemId planId planHash targetCount targetSetDigest capability action requestDigest parentItemId parentRequestDigest accountId workspaceId sourceDeviceId activeLeaseEpoch credentialEpoch signingKeyId signingKeyVersion authorizationHash trustedTimeAnchorId monotonicDeltaMs approvedAt signatureTranscriptVersion",
    ) && common_version(object, if ownership { 1 } else { 2 })
        && literal(object, "typ", purpose)
        && literal(object, "aud", "gooddealer-cloud/execution-evidence")
        && literal(object, "capability", "afternic:marketplace:write")
        && if ownership {
            literal(object, "action", "reactivate_ownership_review")
        } else {
            listing_action(object)
        }
        && all(
            object,
            "approvedOperationId operationId operationItemId planId",
            uuid,
        )
        && all(
            object,
            "planHash targetSetDigest requestDigest authorizationHash",
            digest,
        )
        && all(object, "accountId", identifier)
        && all(object, "approvedAt", timestamp)
        && number(object, "targetCount").is_some_and(|n| (1..=1000).contains(&n))
        && match (
            object.get("parentItemId"),
            object.get("parentRequestDigest"),
        ) {
            (Some(Value::Null), Some(Value::Null)) => true,
            (Some(Value::String(parent)), Some(Value::String(request))) if ownership => {
                uuid(parent)
                    && digest(request)
                    && Some(parent.as_str()) != text(object, "operationItemId")
            }
            _ => false,
        }
}

fn payload_common(object: &Object) -> bool {
    number(object, "schemaVersion") == Some(1)
        && literal(object, "provider", "afternic")
        && matches!(text(object, "action"), Some("remove" | "create" | "update"))
}
fn audit_payload(object: &Object, event: &Object) -> bool {
    if !payload_common(object) {
        return false;
    }
    match text(object, "stage") {
        Some("approved") => {
            keys(
                object,
                "schemaVersion provider action stage approvedOperationId operationId planId planHash targetCount targetSetDigest",
            ) && all(object, "approvedOperationId operationId planId", uuid)
                && all(object, "planHash targetSetDigest", digest)
                && number(object, "targetCount").is_some_and(|n| (1..=500).contains(&n))
                && literal(event, "actorKind", "user")
                && literal(
                    event,
                    "targetType",
                    if listing_action(object) {
                        "afternic_listing_write_approval"
                    } else {
                        "afternic_delist_approval"
                    },
                )
                && object.get("approvedOperationId") == event.get("targetRef")
                && approved_audit(event)
        }
        Some("dispatch_claimed") => {
            keys(
                object,
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId attemptNo planHash requestDigest approvalEnvelopeDigest",
            ) && number(object, "attemptNo") == Some(1)
                && claim_payload_fields(object)
                && device_attempt_audit(event, object)
                && approved_audit(event)
        }
        Some("preflight_refused") => {
            keys(
                object,
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId planHash requestDigest approvalEnvelopeDigest reason",
            ) && claim_payload_fields(object)
                && match text(object, "reason") {
                    Some("precondition_changed" | "connection_changed") => true,
                    Some("already_absent") => !listing_action(object),
                    Some("already_present" | "listing_absent" | "provider_state_blocked") => {
                        listing_action(object)
                    }
                    _ => false,
                }
                && device_attempt_audit(event, object)
                && literal(event, "eventType", "runtime_security_lifecycle")
                && literal(event, "authorizationSource", "runtime_security_context")
        }
        Some("reconciled") => {
            keys(
                object,
                "schemaVersion provider action stage operationId operationItemId attemptId originalExecutionFactId originalExecutionFactDigest outcome reason",
            ) && all(
                object,
                "operationId operationItemId attemptId originalExecutionFactId",
                uuid,
            ) && all(object, "originalExecutionFactDigest", digest)
                && device_attempt_audit(event, object)
                && literal(event, "eventType", "runtime_security_lifecycle")
                && literal(event, "authorizationSource", "runtime_security_context")
                && reconciliation_outcome(object)
        }
        _ => false,
    }
}
fn ownership_action(object: &Object) -> bool {
    literal(object, "action", "reactivate_ownership_review")
}
fn plan_item_payload(object: &Object) -> bool {
    literal(object, "provider", "afternic")
        && ((number(object, "schemaVersion") == Some(2) && listing_action(object))
            || (number(object, "schemaVersion") == Some(1) && ownership_action(object)))
}
fn plan_attempt_audit(event: &Object, payload: &Object) -> bool {
    literal(event, "actorKind", "device_service")
        && literal(
            event,
            "targetType",
            if ownership_action(payload) {
                "afternic_ownership_review_attempt"
            } else {
                "afternic_listing_plan_v2_attempt"
            },
        )
        && payload.get("attemptId") == event.get("targetRef")
}
fn sellerhub_bin_price_payload(object: &Object) -> bool {
    number(object, "schemaVersion") == Some(1)
        && literal(object, "provider", "spaceship")
        && literal(object, "action", "set_bin_price")
}

fn sellerhub_bin_price_audit(object: &Object, event: &Object) -> bool {
    if !sellerhub_bin_price_payload(object) {
        return false;
    }
    if literal(object, "stage", "approved") {
        return single_attempt_approval_audit(object, event, "sellerhub_bin_price_approval");
    }
    single_attempt_audit(
        object,
        event,
        "sellerhub_bin_price_attempt",
        ReconciliationPurpose::SellerHubPrice,
    )
}

#[derive(Clone, Copy)]
enum ReconciliationPurpose {
    SellerHubPrice,
    SellerHubCreation,
    AtomRemoval,
    AtomListing,
}

fn reconciliation_outcome_is_valid(object: &Object, purpose: ReconciliationPurpose) -> bool {
    let outcome = text(object, "outcome");
    let reason = text(object, "reason");
    let null_reason = object.get("reason") == Some(&Value::Null);
    match purpose {
        ReconciliationPurpose::SellerHubPrice => {
            (outcome == Some("matched") && null_reason)
                || outcome.zip(reason) == Some(("different", "postcondition_pending"))
                || outcome.zip(reason) == Some(("read_failed", "read_failed"))
        }
        ReconciliationPurpose::AtomRemoval => matches!(
            outcome.zip(reason),
            Some(("different", "postcondition_pending") | ("read_failed", "read_failed"))
        ),
        ReconciliationPurpose::AtomListing => {
            (outcome == Some("listed") && null_reason)
                || matches!(
                    outcome.zip(reason),
                    Some(
                        ("verification_pending", "ownership_verifying")
                            | ("terms_unconfirmed", "postcondition_pending")
                            | ("state_blocked", "not_on_sale")
                            | ("read_failed", "read_failed")
                    )
                )
        }
        ReconciliationPurpose::SellerHubCreation => {
            (outcome == Some("published") && null_reason)
                || matches!(
                    outcome.zip(reason),
                    Some(
                        ("ownership_pending", "ownership_verifying")
                            | ("terms_unconfirmed", "postcondition_pending")
                            | ("state_blocked", "not_on_sale")
                            | ("read_failed", "read_failed")
                    )
                )
        }
    }
}

fn single_attempt_audit(
    object: &Object,
    event: &Object,
    target: &str,
    purpose: ReconciliationPurpose,
) -> bool {
    if !literal(event, "actorKind", "device_service")
        || !literal(event, "targetType", target)
        || object.get("attemptId") != event.get("targetRef")
    {
        return false;
    }
    let runtime = literal(event, "eventType", "runtime_security_lifecycle")
        && literal(event, "authorizationSource", "runtime_security_context");
    match text(object, "stage") {
        Some("dispatch_claimed") => {
            keys(
                object,
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId attemptNo planHash requestDigest approvalEnvelopeDigest",
            ) && claim_payload_fields(object)
                && number(object, "attemptNo") == Some(1)
                && approved_audit(event)
        }
        Some("preflight_refused") => {
            keys(
                object,
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId planHash requestDigest approvalEnvelopeDigest reason",
            ) && claim_payload_fields(object)
                && matches!(
                    text(object, "reason"),
                    Some("precondition_changed" | "connection_changed" | "provider_state_blocked")
                )
                && runtime
        }
        Some("reconciled") => {
            keys(
                object,
                "schemaVersion provider action stage operationId operationItemId attemptId originalExecutionFactId originalExecutionFactDigest originalSourceDeviceId originalActiveLeaseEpoch outcome reason",
            ) && all(
                object,
                "operationId operationItemId attemptId originalExecutionFactId",
                uuid,
            ) && all(object, "originalExecutionFactDigest", digest)
                && all(object, "originalSourceDeviceId", identifier)
                && integer(object, "originalActiveLeaseEpoch", 1)
                && reconciliation_outcome_is_valid(object, purpose)
                && runtime
        }
        _ => false,
    }
}

fn sellerhub_create_listing_payload(object: &Object) -> bool {
    number(object, "schemaVersion") == Some(1)
        && literal(object, "provider", "spaceship")
        && literal(object, "action", "create_listing")
}

fn sellerhub_create_listing_audit(object: &Object, event: &Object) -> bool {
    if !sellerhub_create_listing_payload(object) {
        return false;
    }
    if literal(object, "stage", "approved") {
        return single_attempt_approval_audit(object, event, "sellerhub_create_listing_approval");
    }
    single_attempt_audit(
        object,
        event,
        "sellerhub_create_listing_attempt",
        ReconciliationPurpose::SellerHubCreation,
    )
}

fn atom_standard_delist_audit(object: &Object, event: &Object) -> bool {
    if !atom_standard_delist_payload(object) {
        return false;
    }
    if literal(object, "stage", "approved") {
        return single_attempt_approval_audit(object, event, "atom_standard_delist_approval");
    }
    // Seller API evidence currently supplies positive listings, without a definite absence shape.
    single_attempt_audit(
        object,
        event,
        "atom_standard_delist_attempt",
        ReconciliationPurpose::AtomRemoval,
    )
}

fn atom_standard_listing_audit(object: &Object, event: &Object) -> bool {
    if !atom_standard_listing_payload(object) {
        return false;
    }
    if literal(object, "stage", "approved") {
        return single_attempt_approval_audit(object, event, "atom_standard_listing_approval");
    }
    single_attempt_audit(
        object,
        event,
        "atom_standard_listing_attempt",
        ReconciliationPurpose::AtomListing,
    )
}

fn atom_standard_listing_payload(object: &Object) -> bool {
    number(object, "schemaVersion") == Some(1)
        && literal(object, "provider", "atom")
        && literal(object, "action", "add_standard")
}

fn atom_standard_listing_fact(payload: &Object, event: &Object) -> bool {
    atom_standard_listing_payload(payload)
        && single_attempt_fact(payload, event, "atom_standard_listing_dispatch_claimed")
}

fn atom_standard_delist_payload(object: &Object) -> bool {
    number(object, "schemaVersion") == Some(1)
        && literal(object, "provider", "atom")
        && literal(object, "action", "remove_standard")
}

fn single_attempt_approval_audit(object: &Object, event: &Object, target: &str) -> bool {
    keys(
        object,
        "schemaVersion provider action stage approvedOperationId operationId planId planHash targetCount targetSetDigest",
    ) && all(object, "approvedOperationId operationId planId", uuid)
        && all(object, "planHash targetSetDigest", digest)
        && number(object, "targetCount").is_some_and(|n| (1..=500).contains(&n))
        && literal(event, "actorKind", "user")
        && literal(event, "targetType", target)
        && object.get("approvedOperationId") == event.get("targetRef")
        && approved_audit(event)
}

fn sellerhub_bin_price_fact(payload: &Object, event: &Object) -> bool {
    sellerhub_bin_price_payload(payload)
        && single_attempt_fact(payload, event, "sellerhub_bin_price_dispatch_claimed")
}

fn sellerhub_create_listing_fact(payload: &Object, event: &Object) -> bool {
    sellerhub_create_listing_payload(payload)
        && single_attempt_fact(payload, event, "sellerhub_create_listing_dispatch_claimed")
}

fn atom_standard_delist_fact(payload: &Object, event: &Object) -> bool {
    atom_standard_delist_payload(payload)
        && single_attempt_fact(payload, event, "atom_standard_delist_dispatch_claimed")
}

fn single_attempt_fact(payload: &Object, event: &Object, event_type: &str) -> bool {
    keys(
        payload,
        "schemaVersion provider action stage dispatchSemantics deduplicationScope requestDigest approvalEnvelopeDigest",
    ) && literal(event, "eventType", event_type)
        && literal(payload, "stage", "dispatch_claimed")
        && literal(payload, "dispatchSemantics", "local_claim_only")
        && literal(payload, "deduplicationScope", "local_only")
        && all(payload, "requestDigest approvalEnvelopeDigest", digest)
}

fn plan_audit_payload(object: &Object, event: &Object) -> bool {
    if number(object, "schemaVersion") == Some(2) && literal(object, "action", "listing_plan_v2") {
        return keys(
            object,
            "schemaVersion provider action stage approvedOperationId operationId planId planHash targetCount targetSetDigest",
        ) && literal(object, "provider", "afternic")
            && literal(object, "stage", "approved")
            && all(object, "approvedOperationId operationId planId", uuid)
            && all(object, "planHash targetSetDigest", digest)
            && number(object, "targetCount").is_some_and(|n| (1..=1000).contains(&n))
            && literal(event, "actorKind", "user")
            && literal(event, "targetType", "afternic_listing_plan_v2_approval")
            && object.get("approvedOperationId") == event.get("targetRef")
            && approved_audit(event);
    }
    if !plan_item_payload(object) || !plan_attempt_audit(event, object) {
        return false;
    }
    let ownership = ownership_action(object);
    match text(object, "stage") {
        Some("dispatch_claimed") => {
            keys(
                object,
                if ownership {
                    "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId attemptNo planHash requestDigest approvalEnvelopeDigest resourceBindingDigest preflightObservationDigest"
                } else {
                    "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId attemptNo planHash requestDigest approvalEnvelopeDigest"
                },
            ) && number(object, "attemptNo") == Some(1)
                && claim_payload_fields(object)
                && (!ownership
                    || all(
                        object,
                        "resourceBindingDigest preflightObservationDigest",
                        digest,
                    ))
                && approved_audit(event)
        }
        Some("preflight_satisfied") => {
            ownership
                && keys(
                    object,
                    "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId planHash requestDigest approvalEnvelopeDigest",
                )
                && claim_payload_fields(object)
                && literal(event, "eventType", "runtime_security_lifecycle")
                && literal(event, "authorizationSource", "runtime_security_context")
        }
        Some("preflight_refused") => {
            keys(
                object,
                "schemaVersion provider action stage approvedOperationId operationId operationItemId attemptId planHash requestDigest approvalEnvelopeDigest reason",
            ) && claim_payload_fields(object)
                && match text(object, "reason") {
                    Some(
                        "precondition_changed"
                        | "connection_changed"
                        | "listing_absent"
                        | "provider_state_blocked",
                    ) => true,
                    Some("already_present") => !ownership,
                    Some("cooldown" | "prior_outcome_unknown") => ownership,
                    _ => false,
                }
                && literal(event, "eventType", "runtime_security_lifecycle")
                && literal(event, "authorizationSource", "runtime_security_context")
        }
        Some("reconciled") => {
            keys(
                object,
                "schemaVersion provider action stage operationId operationItemId attemptId originalExecutionFactId originalExecutionFactDigest outcome reason",
            ) && all(
                object,
                "operationId operationItemId attemptId originalExecutionFactId",
                uuid,
            ) && all(object, "originalExecutionFactDigest", digest)
                && literal(event, "eventType", "runtime_security_lifecycle")
                && literal(event, "authorizationSource", "runtime_security_context")
                && if ownership {
                    ownership_outcome(object)
                } else {
                    reconciliation_outcome(object)
                }
        }
        _ => false,
    }
}
fn ownership_outcome(object: &Object) -> bool {
    match (text(object, "outcome"), object.get("reason")) {
        (Some("confirmed"), Some(Value::Null)) => true,
        (Some("still_review"), Some(Value::String(reason))) => reason == "postcondition_pending",
        (Some("read_failed"), Some(Value::String(reason))) => reason == "read_failed",
        (Some("conflict"), Some(Value::String(reason))) => matches!(
            reason.as_str(),
            "precondition_changed" | "connection_changed" | "provider_state_blocked"
        ),
        _ => false,
    }
}
fn plan_fact_payload(payload: &Object, event: &Object) -> bool {
    let ownership = ownership_action(payload);
    plan_item_payload(payload)
        && keys(
            payload,
            if ownership {
                "schemaVersion provider action stage dispatchSemantics deduplicationScope requestDigest approvalEnvelopeDigest resourceBindingDigest preflightObservationDigest"
            } else {
                "schemaVersion provider action stage dispatchSemantics deduplicationScope requestDigest approvalEnvelopeDigest"
            },
        )
        && literal(
            event,
            "eventType",
            if ownership {
                "afternic_ownership_review_dispatch_claimed"
            } else {
                "afternic_listing_plan_v2_dispatch_claimed"
            },
        )
        && literal(payload, "stage", "dispatch_claimed")
        && literal(payload, "dispatchSemantics", "local_claim_only")
        && literal(payload, "deduplicationScope", "local_only")
        && all(payload, "requestDigest approvalEnvelopeDigest", digest)
        && (!ownership
            || all(
                payload,
                "resourceBindingDigest preflightObservationDigest",
                digest,
            ))
}

fn reconciliation_outcome(object: &Object) -> bool {
    match (
        listing_action(object),
        text(object, "outcome"),
        object.get("reason"),
    ) {
        (true, Some("matched"), Some(Value::Null)) | (false, Some("absent"), Some(Value::Null)) => {
            true
        }
        (true, Some("absent" | "different"), Some(Value::String(reason))) => {
            reason == "postcondition_pending"
        }
        (false, Some("present"), Some(Value::String(reason))) => reason == "still_present",
        (_, Some("read_failed"), Some(Value::String(reason))) => reason == "read_failed",
        (_, Some("conflict"), Some(Value::String(reason))) => {
            matches!(
                reason.as_str(),
                "precondition_changed" | "connection_changed"
            ) || (listing_action(object) && reason == "provider_state_blocked")
        }
        _ => false,
    }
}
fn approved_audit(event: &Object) -> bool {
    literal(event, "eventType", "approved_operation_execution")
        && literal(event, "authorizationSource", "approved_operation")
}
fn device_attempt_audit(event: &Object, payload: &Object) -> bool {
    literal(event, "actorKind", "device_service")
        && literal(
            event,
            "targetType",
            if listing_action(payload) {
                "afternic_listing_write_attempt"
            } else {
                "afternic_delist_attempt"
            },
        )
        && payload.get("attemptId") == event.get("targetRef")
}
fn claim_payload_fields(object: &Object) -> bool {
    all(
        object,
        "approvedOperationId operationId operationItemId attemptId",
        uuid,
    ) && all(
        object,
        "planHash requestDigest approvalEnvelopeDigest",
        digest,
    )
}
fn audit(object: &Object) -> bool {
    if !keys(
        object,
        "schemaVersion auditEventId auditEventKind eventType accountId actorKind authorizationSource targetType targetRef sourceDeviceId credentialEpoch chainId auditSequence previousHash eventHash occurredAt signingKeyId signingKeyVersion signingKeyPurpose trustedTimeAnchorId monotonicDeltaMs authorizationContextHash signatureTranscriptVersion payloadRedacted scopeKind workspaceId activeLeaseEpoch",
    ) || !common(object)
        || !literal(object, "auditEventKind", "device")
        || !literal(object, "scopeKind", "workspace")
        || !literal(object, "signingKeyPurpose", "device_identity_audit")
        || !all(object, "auditEventId targetRef", uuid)
        || !all(object, "accountId", identifier)
        || !all(
            object,
            "chainId previousHash eventHash authorizationContextHash",
            digest,
        )
        || !all(object, "occurredAt", timestamp)
        || !integer(object, "auditSequence", 1)
        || !object
            .get("payloadRedacted")
            .and_then(Value::as_object)
            .is_some_and(|p| {
                audit_payload(p, object)
                    || plan_audit_payload(p, object)
                    || sellerhub_bin_price_audit(p, object)
                    || sellerhub_create_listing_audit(p, object)
                    || atom_standard_delist_audit(p, object)
                    || atom_standard_listing_audit(p, object)
            })
    {
        return false;
    }
    let mut unhashed = object.clone();
    unhashed.remove("eventHash");
    if text(object, "eventHash") != Some(hash(AUDIT_HASH, &unhashed).as_str()) {
        return false;
    }
    let chain = json!({"scope":"workspace","workspaceId":object["workspaceId"],"sourceDeviceId":object["sourceDeviceId"],"activeLeaseEpoch":object["activeLeaseEpoch"]});
    text(object, "chainId")
        == Some(
            hash(
                "GOODDEALER-DEVICE-AUDIT-CHAIN-V1",
                chain.as_object().unwrap(),
            )
            .as_str(),
        )
        && (number(object, "auditSequence") != Some(1)
            || text(object, "previousHash")
                == Some(
                    URL_SAFE_NO_PAD
                        .encode(Sha256::digest(b"GOODDEALER-DEVICE-AUDIT-CHAIN-GENESIS-V1"))
                        .as_str(),
                ))
}

struct UniqueObject(Object);
impl<'de> Deserialize<'de> for UniqueObject {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        struct ObjectVisitor;
        impl<'de> Visitor<'de> for ObjectVisitor {
            type Value = UniqueObject;
            fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
                f.write_str("one closed approval object")
            }
            fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
                let mut object = Object::new();
                while let Some((key, value)) = map.next_entry::<String, Value>()? {
                    if object.len() >= 40 || object.insert(key, value).is_some() {
                        return Err(serde::de::Error::custom("duplicate or excess field"));
                    }
                }
                Ok(UniqueObject(object))
            }
        }
        deserializer.deserialize_map(ObjectVisitor)
    }
}
fn fact_payload(payload: &Object, object: &Object) -> bool {
    !(!keys(
        payload,
        "schemaVersion provider action stage dispatchSemantics deduplicationScope requestDigest approvalEnvelopeDigest",
    ) || !payload_common(payload)
        || !literal(
            object,
            "eventType",
            if listing_action(payload) {
                "afternic_listing_write_dispatch_claimed"
            } else {
                "afternic_delist_dispatch_claimed"
            },
        )
        || !literal(payload, "stage", "dispatch_claimed")
        || !literal(payload, "dispatchSemantics", "local_claim_only")
        || !literal(payload, "deduplicationScope", "local_only")
        || !all(payload, "requestDigest approvalEnvelopeDigest", digest))
}

fn fact(object: &Object, key: &[u8; 32]) -> bool {
    if !keys(
        object,
        "schemaVersion executionFactId operationId operationItemId workflowNodeId attemptId attemptNo approvedOperationId planHash idempotencyKeyHash sourceDeviceId workspaceId activeLeaseEpoch executionFactSequence eventType evidenceLevel occurredAt signingKeyId signingKeyVersion credentialEpoch trustedTimeAnchorId monotonicDeltaMs requestStartBoundary authorizationHash executionAuthorizationEvidence signatureTranscriptVersion payloadRedacted auditEventRef auditEventHash",
    ) || !common(object)
        || !all(
            object,
            "executionFactId operationId operationItemId workflowNodeId attemptId approvedOperationId auditEventRef",
            uuid,
        )
        || number(object, "attemptNo") != Some(1)
        || !integer(object, "executionFactSequence", 1)
        || !all(
            object,
            "planHash idempotencyKeyHash authorizationHash auditEventHash",
            digest,
        )
        || !all(object, "occurredAt requestStartBoundary", timestamp)
        || object.get("occurredAt") != object.get("requestStartBoundary")
        || !literal(object, "evidenceLevel", "durable_local_claim")
    {
        return false;
    }
    let Some(payload) = object.get("payloadRedacted").and_then(Value::as_object) else {
        return false;
    };
    if !fact_payload(payload, object)
        && !plan_fact_payload(payload, object)
        && !sellerhub_bin_price_fact(payload, object)
        && !sellerhub_create_listing_fact(payload, object)
        && !atom_standard_delist_fact(payload, object)
        && !atom_standard_listing_fact(payload, object)
    {
        return false;
    }
    let Some(evidence) = object
        .get("executionAuthorizationEvidence")
        .and_then(Value::as_object)
    else {
        return false;
    };
    if !keys(
        evidence,
        "approvedOperationDigest approvedOperationEnvelope signingKeyId signingKeyVersion credentialEpoch signatureTranscriptVersion",
    ) || number(evidence, "signatureTranscriptVersion") != Some(1)
        || !all(evidence, "approvedOperationDigest", digest)
        || ["signingKeyId", "signingKeyVersion", "credentialEpoch"]
            .iter()
            .any(|k| evidence.get(*k) != object.get(*k))
    {
        return false;
    }
    let Some((mut approved, signature)) = verified_approval(evidence, key) else {
        return false;
    };
    for field in [
        "sourceDeviceId",
        "workspaceId",
        "activeLeaseEpoch",
        "credentialEpoch",
        "signingKeyId",
        "signingKeyVersion",
        "approvedOperationId",
        "operationId",
        "operationItemId",
        "planHash",
    ] {
        if approved.get(field) != object.get(field) {
            return false;
        }
    }
    if approved.get("requestDigest") != payload.get("requestDigest")
        || approved.get("action") != payload.get("action")
        || approved.get("schemaVersion") != payload.get("schemaVersion")
    {
        return false;
    }
    let dispatch_key = json!({"schemaVersion":1,"operationId":object["operationId"],
        "operationItemId":object["operationItemId"],"attemptNo":1,"localOperationKey":approved["planId"]});
    let dispatch_domain = dispatch_key_domain(payload);
    if text(object, "idempotencyKeyHash")
        != Some(hash(dispatch_domain, dispatch_key.as_object().unwrap()).as_str())
        || text(&approved, "approvedAt") > text(object, "requestStartBoundary")
    {
        return false;
    }
    approved.insert(
        "deviceSignature".into(),
        Value::String(URL_SAFE_NO_PAD.encode(signature)),
    );
    let digest = hash(envelope_domain(&approved), &approved);
    text(evidence, "approvedOperationDigest") == Some(digest.as_str())
        && text(payload, "approvalEnvelopeDigest") == Some(digest.as_str())
}

/// The local dispatch-key domain of a claimed purpose; each purpose hashes its key separately.
fn dispatch_key_domain(payload: &Object) -> &'static str {
    if sellerhub_bin_price_payload(payload) {
        SELLERHUB_BIN_DISPATCH_KEY
    } else if sellerhub_create_listing_payload(payload) {
        SELLERHUB_CREATE_DISPATCH_KEY
    } else if atom_standard_delist_payload(payload) {
        ATOM_STANDARD_DELIST_DISPATCH_KEY
    } else if atom_standard_listing_payload(payload) {
        ATOM_STANDARD_LISTING_DISPATCH_KEY
    } else {
        "GOODDEALER-AFTERNIC-LOCAL-DISPATCH-KEY-V1"
    }
}

fn verified_approval(evidence: &Object, key: &[u8; 32]) -> Option<(Object, [u8; 64])> {
    let encoded = text(evidence, "approvedOperationEnvelope")?;
    if encoded.is_empty() || encoded.len() > 8192 {
        return None;
    }
    let bytes = URL_SAFE_NO_PAD.decode(encoded).ok()?;
    if bytes.len() > 6144 || URL_SAFE_NO_PAD.encode(&bytes) != encoded {
        return None;
    }
    let UniqueObject(mut approved) = serde_json::from_slice::<UniqueObject>(&bytes).ok()?;
    let signature = approved
        .remove("deviceSignature")
        .and_then(|v| v.as_str().and_then(base64::<64>))?;
    if !(approval(&approved)
        || sellerhub_bin_price_approval(&approved)
        || sellerhub_create_listing_approval(&approved)
        || atom_standard_delist_approval(&approved)
        || atom_standard_listing_approval(&approved)
        || plan_item_approval(&approved, false)
        || plan_item_approval(&approved, true))
        || UnparsedPublicKey::new(&ED25519, key)
            .verify(
                &transcript(approval_domain(&approved), &approved),
                &signature,
            )
            .is_err()
    {
        return None;
    }
    Some((approved, signature))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/afternic-execution-evidence/valid.json"
        ))
        .unwrap()
    }
    fn identity() -> DesktopDeviceIdentity {
        DesktopDeviceIdentity::from_test_material("device-01", "fixture-device-key", [85; 32])
    }
    fn claims(name: &str) -> Object {
        let mut object = fixture()[name].as_object().unwrap().clone();
        object.remove("deviceSignature");
        object
    }
    fn rehash(object: &mut Object) {
        object.remove("eventHash");
        object.insert("eventHash".into(), Value::String(hash(AUDIT_HASH, object)));
    }

    #[test]
    fn atom_standard_removal_signs_its_claim_but_rejects_manufactured_success() {
        let device = identity();
        let item: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/atom-standard-delist/approval.json"
        ))
        .unwrap();
        let mut claims = item["approval"].as_object().unwrap().clone();
        let signature = claims.remove("deviceSignature").unwrap();
        let item_bytes = transcript(ATOM_STANDARD_DELIST_APPROVAL, &claims);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_atom_standard_delist_approval_transcript(&item_bytes)
                    .unwrap()
            ),
            signature
        );
        assert!(
            device
                .sign_sellerhub_bin_price_approval_transcript(&item_bytes)
                .is_err()
        );
        assert!(
            device
                .sign_afternic_delist_approval_transcript(&item_bytes)
                .is_err()
        );
        for (field, value) in [
            ("action", json!("remove")),
            ("capability", json!("spaceship:marketplace:write")),
            ("sourceDeviceId", json!("another-device")),
            ("listingType", json!("premium")),
        ] {
            let mut altered = claims.clone();
            altered.insert(field.to_owned(), value);
            assert!(
                device
                    .sign_atom_standard_delist_approval_transcript(&transcript(
                        ATOM_STANDARD_DELIST_APPROVAL,
                        &altered
                    ),)
                    .is_err()
            );
        }
        let wire: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/atom-standard-delist/dispatch.json"
        ))
        .unwrap();
        let mut fact = wire["fact"].as_object().unwrap().clone();
        let signature = fact.remove("deviceSignature").unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &fact))
                    .unwrap()
            ),
            signature
        );
        for key in [
            "approveAudit",
            "claimAudit",
            "preflightAudit",
            "reconciledAudit",
        ] {
            let mut audit = wire[key].as_object().unwrap().clone();
            let signature = audit.remove("deviceSignature").unwrap();
            assert_eq!(
                URL_SAFE_NO_PAD.encode(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &audit))
                        .unwrap()
                ),
                signature
            );
        }
        let mut audit = wire["reconciledAudit"].as_object().unwrap().clone();
        audit.remove("deviceSignature");
        let payload = audit.get_mut("payloadRedacted").unwrap();
        payload["outcome"] = json!("matched");
        payload["reason"] = Value::Null;
        rehash(&mut audit);
        assert!(
            device
                .sign_device_audit_event_transcript(&transcript(AUDIT, &audit))
                .is_err()
        );
    }

    #[test]
    fn atom_standard_listing_signs_its_claim_but_rejects_other_purposes_and_borrowed_outcomes() {
        let device = identity();
        let item: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/atom-standard-listing/approval.json"
        ))
        .unwrap();
        let mut claims = item["approval"].as_object().unwrap().clone();
        let signature = claims.remove("deviceSignature").unwrap();
        let item_bytes = transcript(ATOM_STANDARD_LISTING_APPROVAL, &claims);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_atom_standard_listing_approval_transcript(&item_bytes)
                    .unwrap()
            ),
            signature
        );
        assert!(
            device
                .sign_atom_standard_delist_approval_transcript(&item_bytes)
                .is_err()
        );
        assert!(
            device
                .sign_sellerhub_create_listing_approval_transcript(&item_bytes)
                .is_err()
        );
        for (field, value) in [
            ("action", json!("remove_standard")),
            ("action", json!("add_premium")),
            ("typ", json!(ATOM_STANDARD_DELIST_APPROVAL_TYPE)),
            ("capability", json!("spaceship:marketplace:write")),
            ("sourceDeviceId", json!("another-device")),
            ("priceMicroUsd", json!(1_000_000)),
        ] {
            let mut altered = claims.clone();
            altered.insert(field.to_owned(), value);
            assert!(
                device
                    .sign_atom_standard_listing_approval_transcript(&transcript(
                        ATOM_STANDARD_LISTING_APPROVAL,
                        &altered
                    ))
                    .is_err(),
                "{field}"
            );
        }
        let wire: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/atom-standard-listing/dispatch.json"
        ))
        .unwrap();
        let mut fact = wire["fact"].as_object().unwrap().clone();
        let signature = fact.remove("deviceSignature").unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &fact))
                    .unwrap()
            ),
            signature
        );
        for key in [
            "approveAudit",
            "claimAudit",
            "preflightAudit",
            "reconciledAudit",
        ] {
            let mut audit = wire[key].as_object().unwrap().clone();
            let signature = audit.remove("deviceSignature").unwrap();
            assert_eq!(
                URL_SAFE_NO_PAD.encode(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &audit))
                        .unwrap()
                ),
                signature,
                "{key}"
            );
        }
        // A listing reconciliation cannot borrow the delist or SellerHub success outcomes.
        for (outcome, reason) in [
            ("matched", Value::Null),
            ("published", Value::Null),
            ("different", json!("postcondition_pending")),
            ("ownership_pending", json!("ownership_verifying")),
        ] {
            let mut audit = wire["reconciledAudit"].as_object().unwrap().clone();
            audit.remove("deviceSignature");
            let payload = audit.get_mut("payloadRedacted").unwrap();
            payload["outcome"] = json!(outcome);
            payload["reason"] = reason;
            rehash(&mut audit);
            assert!(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &audit))
                    .is_err(),
                "{outcome}"
            );
        }
    }

    #[test]
    fn sellerhub_dispatch_evidence_matches_closed_shared_vectors() {
        let device = identity();
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/sellerhub-bin-price/dispatch.json"
        ))
        .unwrap();
        for name in [
            "approveAudit",
            "claimAudit",
            "preflightAudit",
            "reconciledAudit",
        ] {
            let mut event = vector[name].as_object().unwrap().clone();
            let signature = event.remove("deviceSignature").unwrap();
            assert_eq!(
                URL_SAFE_NO_PAD.encode(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &event))
                        .unwrap()
                ),
                signature,
            );
            event.get_mut("payloadRedacted").unwrap()["provider"] = json!("afternic");
            rehash(&mut event);
            assert!(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &event))
                    .is_err()
            );
        }
        let mut fact = vector["fact"].as_object().unwrap().clone();
        let signed = fact.remove("deviceSignature").unwrap();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &fact))
                    .unwrap()
            ),
            signed,
        );
        for (key, bad) in [
            (
                "eventType",
                json!("afternic_listing_write_dispatch_claimed"),
            ),
            (
                "idempotencyKeyHash",
                json!(URL_SAFE_NO_PAD.encode([4u8; 32])),
            ),
        ] {
            let mut changed = fact.clone();
            changed.insert(key.into(), bad);
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &changed))
                    .is_err()
            );
        }
    }

    #[test]
    fn sellerhub_approval_is_own_device_and_purpose_only() {
        let device = identity();
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/sellerhub-bin-price/approval.json"
        ))
        .unwrap();
        let mut claims = vector["approval"].as_object().unwrap().clone();
        claims.remove("deviceSignature");
        let transcript_bytes = transcript(SELLERHUB_BIN_APPROVAL, &claims);
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_sellerhub_bin_price_approval_transcript(&transcript_bytes)
                    .unwrap()
            ),
            vector["approval"]["deviceSignature"]
        );
        assert!(
            device
                .sign_afternic_listing_write_approval_transcript(&transcript_bytes)
                .is_err()
        );
        assert!(
            device
                .sign_sellerhub_bin_price_approval_transcript(&transcript(WRITE_APPROVAL, &claims))
                .is_err()
        );
        for (field, replacement) in [
            ("sourceDeviceId", json!("foreign-device")),
            ("capability", json!("afternic:marketplace:write")),
            ("action", json!("create")),
            ("targetCount", json!(0)),
            ("password", json!("refused")),
        ] {
            let mut changed = claims.clone();
            changed.insert(field.to_owned(), replacement);
            assert!(
                device
                    .sign_sellerhub_bin_price_approval_transcript(&transcript(
                        SELLERHUB_BIN_APPROVAL,
                        &changed
                    ))
                    .is_err()
            );
        }
    }
    #[test]
    fn sellerhub_creation_has_a_distinct_approval_and_truthful_reconciliation() {
        let device = identity();
        let vector: Value = serde_json::from_str(include_str!(
            "../../../../packages/protocol/test-vectors/sellerhub-bin-price/approval.json"
        ))
        .unwrap();
        let mut claims = vector["approval"].as_object().unwrap().clone();
        claims.remove("deviceSignature");
        let original = transcript(SELLERHUB_BIN_APPROVAL, &claims);
        claims.insert("typ".into(), json!(SELLERHUB_CREATE_APPROVAL_TYPE));
        claims.insert("action".into(), json!("create_listing"));
        let creation = transcript(SELLERHUB_CREATE_APPROVAL, &claims);
        assert!(
            device
                .sign_sellerhub_create_listing_approval_transcript(&creation)
                .is_ok()
        );
        assert!(
            device
                .sign_sellerhub_create_listing_approval_transcript(&original)
                .is_err()
        );
        assert!(
            device
                .sign_sellerhub_bin_price_approval_transcript(&creation)
                .is_err()
        );
        claims.insert("workspaceId".into(), json!("another-workspace"));
        claims.insert("sourceDeviceId".into(), json!("another-device"));
        assert!(
            device
                .sign_sellerhub_create_listing_approval_transcript(&transcript(
                    SELLERHUB_CREATE_APPROVAL,
                    &claims
                ))
                .is_err()
        );

        let outcome = |result, reason| {
            json!({"outcome": result, "reason":reason})
                .as_object()
                .unwrap()
                .clone()
        };
        let pending = outcome("ownership_pending", json!("ownership_verifying"));
        assert!(reconciliation_outcome_is_valid(
            &pending,
            ReconciliationPurpose::SellerHubCreation
        ));
        assert!(!reconciliation_outcome_is_valid(
            &pending,
            ReconciliationPurpose::SellerHubPrice
        ));
        assert!(!reconciliation_outcome_is_valid(
            &outcome("published", json!("ownership_verifying")),
            ReconciliationPurpose::SellerHubCreation,
        ));
        assert!(reconciliation_outcome_is_valid(
            &outcome("published", Value::Null),
            ReconciliationPurpose::SellerHubCreation,
        ));
    }
    #[test]
    fn signatures_match_shared_protocol_golden_vectors() {
        let device = identity();
        let vector = fixture();
        assert_eq!(device.public_key_base64url(), vector["devicePublicKey"]);
        for (name, domain) in [
            ("approval", APPROVAL),
            ("approvalAudit", AUDIT),
            ("claimAudit", AUDIT),
            ("preflightAudit", AUDIT),
            ("reconciledAudit", AUDIT),
            ("fact", FACT),
        ] {
            let bytes = transcript(domain, &claims(name));
            let signature = match domain {
                APPROVAL => device.sign_afternic_delist_approval_transcript(&bytes),
                AUDIT => device.sign_device_audit_event_transcript(&bytes),
                _ => device.sign_execution_fact_transcript(&bytes),
            }
            .unwrap();
            assert_eq!(
                URL_SAFE_NO_PAD.encode(signature),
                vector[name]["deviceSignature"],
                "{name}"
            );
            if name == "approval" {
                let hex = vector["bytes"]["approvalTranscript"].as_str().unwrap();
                let expected = (0..hex.len())
                    .step_by(2)
                    .map(|offset| u8::from_str_radix(&hex[offset..offset + 2], 16).unwrap())
                    .collect::<Vec<_>>();
                assert_eq!(bytes, expected);
            }
        }
    }
    #[test]
    fn purpose_and_installed_device_key_are_not_interchangeable() {
        let device = identity();
        let approval = transcript(APPROVAL, &claims("approval"));
        assert!(
            device
                .sign_device_audit_event_transcript(&approval)
                .is_err()
        );
        assert!(device.sign_execution_fact_transcript(&approval).is_err());
        assert!(device.sign_drain_proof_transcript(&approval).is_err());
        for (field, value) in [
            ("sourceDeviceId", "another-device"),
            ("signingKeyId", "another-key"),
            ("capability", "cloudflare:dns:write"),
            ("action", "create"),
        ] {
            let mut object = claims("approval");
            object.insert(field.into(), json!(value));
            assert!(
                device
                    .sign_afternic_delist_approval_transcript(&transcript(APPROVAL, &object))
                    .is_err()
            );
        }
    }
    #[test]
    fn closed_fields_and_canonical_encoding_fail_closed() {
        let device = identity();
        let original = claims("approval");
        let mut extra = original.clone();
        extra.insert("secret".into(), json!("must-not-sign"));
        assert!(
            device
                .sign_afternic_delist_approval_transcript(&transcript(APPROVAL, &extra))
                .is_err()
        );
        for (field, value) in [
            ("targetCount", json!(501)),
            ("activeLeaseEpoch", json!(0)),
            ("monotonicDeltaMs", json!(MAX_SAFE_INTEGER + 1)),
            ("approvedAt", json!("2026-02-30T00:00:00Z")),
            ("planId", json!("00000000-0000-1000-8000-000000000001")),
        ] {
            let mut object = original.clone();
            object.insert(field.into(), value);
            assert!(
                device
                    .sign_afternic_delist_approval_transcript(&transcript(APPROVAL, &object))
                    .is_err()
            );
        }
        let valid = transcript(APPROVAL, &original);
        let mut trailing = valid.clone();
        trailing.push(0);
        assert!(
            device
                .sign_afternic_delist_approval_transcript(&trailing)
                .is_err()
        );
        assert!(
            device
                .sign_afternic_delist_approval_transcript(&valid[..valid.len() - 1])
                .is_err()
        );
        assert!(
            device
                .sign_afternic_delist_approval_transcript(&vec![b'x'; MAX_TRANSCRIPT + 1])
                .is_err()
        );
        assert!(decode_value(b"n2:01", 0).is_none());
        assert!(decode_value(b"n2:-1", 0).is_none());
        assert!(decode_value(b"s1:x", 5).is_none());
        let entry = frame('e', &[frame('k', b"a"), frame('v', b"z0:")].concat());
        assert!(decode_value(&frame('o', &[entry.clone(), entry].concat()), 0).is_none());
    }
    #[test]
    fn audit_hash_chain_scope_and_actor_are_bound() {
        let device = identity();
        for (field, value) in [
            ("eventHash", json!(URL_SAFE_NO_PAD.encode([0; 32]))),
            ("previousHash", json!(URL_SAFE_NO_PAD.encode([0; 32]))),
            ("chainId", json!(URL_SAFE_NO_PAD.encode([0; 32]))),
            ("actorKind", json!("device_service")),
            ("scopeKind", json!("device")),
            ("workspaceId", json!("other-workspace")),
        ] {
            let mut object = claims("approvalAudit");
            object.insert(field.into(), value);
            if field != "eventHash" {
                rehash(&mut object);
            }
            assert!(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &object))
                    .is_err(),
                "{field}"
            );
        }
    }
    #[test]
    fn facts_bind_signed_approval_and_cannot_claim_remote_success() {
        let device = identity();
        for (field, value) in [
            ("workspaceId", json!("other-workspace")),
            ("activeLeaseEpoch", json!(8)),
            ("credentialEpoch", json!(8)),
            (
                "operationItemId",
                json!("00000000-0000-4000-8000-000000000099"),
            ),
            ("evidenceLevel", json!("provider_confirmed")),
            ("occurredAt", json!("2026-08-01T10:00:04Z")),
        ] {
            let mut object = claims("fact");
            object.insert(field.into(), value);
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &object))
                    .is_err(),
                "{field}"
            );
        }
        for field in ["requestDigest", "approvalEnvelopeDigest"] {
            let mut object = claims("fact");
            object["payloadRedacted"][field] = json!(URL_SAFE_NO_PAD.encode([0; 32]));
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &object))
                    .is_err()
            );
        }
        let mut object = claims("fact");
        let mut approval = fixture()["approval"].clone();
        approval["deviceSignature"] = json!(URL_SAFE_NO_PAD.encode([0; 64]));
        object["executionAuthorizationEvidence"]["approvedOperationEnvelope"] =
            json!(URL_SAFE_NO_PAD.encode(serde_json::to_vec(&approval).unwrap()));
        assert!(
            device
                .sign_execution_fact_transcript(&transcript(FACT, &object))
                .is_err()
        );
    }
    #[test]
    fn dispatch_key_and_approval_time_are_bound() {
        let mut object = claims("fact");
        object.insert(
            "idempotencyKeyHash".into(),
            json!(URL_SAFE_NO_PAD.encode([0; 32])),
        );
        assert!(
            identity()
                .sign_execution_fact_transcript(&transcript(FACT, &object))
                .is_err()
        );
        let mut early = claims("fact");
        early.insert("occurredAt".into(), json!("2026-08-01T10:00:01Z"));
        early.insert("requestStartBoundary".into(), json!("2026-08-01T10:00:01Z"));
        assert!(
            identity()
                .sign_execution_fact_transcript(&transcript(FACT, &early))
                .is_err()
        );
    }
    #[test]
    fn preflight_and_reconciliation_cannot_claim_user_authorization() {
        for name in ["preflightAudit", "reconciledAudit"] {
            let mut object = claims(name);
            object.insert("eventType".into(), json!("approved_operation_execution"));
            object.insert("authorizationSource".into(), json!("approved_operation"));
            rehash(&mut object);
            assert!(
                identity()
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &object))
                    .is_err()
            );
        }
        let mut object = claims("reconciledAudit");
        object["payloadRedacted"]["outcome"] = json!("present");
        object["payloadRedacted"]["reason"] = Value::Null;
        rehash(&mut object);
        assert!(
            identity()
                .sign_device_audit_event_transcript(&transcript(AUDIT, &object))
                .is_err()
        );
    }
    #[test]
    fn embedded_approval_duplicate_keys_are_rejected() {
        let mut object = claims("fact");
        let encoded = object["executionAuthorizationEvidence"]["approvedOperationEnvelope"]
            .as_str()
            .unwrap();
        let bytes = URL_SAFE_NO_PAD.decode(encoded).unwrap();
        let mut json = String::from_utf8(bytes).unwrap();
        json.insert_str(1, "\"schemaVersion\":1,");
        object["executionAuthorizationEvidence"]["approvedOperationEnvelope"] =
            json!(URL_SAFE_NO_PAD.encode(json));
        assert!(
            identity()
                .sign_execution_fact_transcript(&transcript(FACT, &object))
                .is_err()
        );
    }
    #[test]
    fn refreshed_dispatch_context_preserves_original_signed_approval() {
        let mut object = claims("fact");
        object.insert(
            "authorizationHash".into(),
            json!(URL_SAFE_NO_PAD.encode([9; 32])),
        );
        object.insert(
            "trustedTimeAnchorId".into(),
            json!(URL_SAFE_NO_PAD.encode([8; 32])),
        );
        assert!(
            identity()
                .sign_execution_fact_transcript(&transcript(FACT, &object))
                .is_ok()
        );
    }
    fn listing_fixture(action: &str) -> Value {
        let bytes = match action {
            "create" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-write-evidence/create.json"
            ),
            "update" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-write-evidence/update.json"
            ),
            _ => panic!("closed fixture action"),
        };
        serde_json::from_str(bytes).unwrap()
    }
    fn unsigned(vector: &Value, name: &str) -> Object {
        let mut value = vector[name].as_object().unwrap().clone();
        value.remove("deviceSignature");
        value
    }
    #[test]
    fn create_update_signatures_match_shared_protocol_vectors() {
        let device = identity();
        for action in ["create", "update"] {
            let vector = listing_fixture(action);
            for (name, domain) in [
                ("approval", WRITE_APPROVAL),
                ("approvalAudit", AUDIT),
                ("claimAudit", AUDIT),
                ("preflightAudit", AUDIT),
                ("reconciledAudit", AUDIT),
                ("fact", FACT),
            ] {
                let bytes = transcript(domain, &unsigned(&vector, name));
                let signature = match domain {
                    WRITE_APPROVAL => {
                        device.sign_afternic_listing_write_approval_transcript(&bytes)
                    }
                    AUDIT => device.sign_device_audit_event_transcript(&bytes),
                    _ => device.sign_execution_fact_transcript(&bytes),
                }
                .unwrap();
                assert_eq!(
                    URL_SAFE_NO_PAD.encode(signature),
                    vector[name]["deviceSignature"],
                    "{action}/{name}"
                );
            }
        }
    }
    #[test]
    fn listing_approval_cannot_be_signed_or_replayed_as_another_purpose() {
        let device = identity();
        for action in ["create", "update"] {
            let vector = listing_fixture(action);
            let approved = unsigned(&vector, "approval");
            let bytes = transcript(WRITE_APPROVAL, &approved);
            assert!(
                device
                    .sign_afternic_delist_approval_transcript(&bytes)
                    .is_err()
            );
            assert!(
                device
                    .sign_afternic_listing_write_approval_transcript(&transcript(
                        APPROVAL, &approved
                    ))
                    .is_err()
            );
            for (field, value) in [
                ("action", "remove"),
                ("typ", "gd.afternic-delist-item-approval.v1"),
                ("sourceDeviceId", "another-device"),
                ("signingKeyId", "another-key"),
            ] {
                let mut altered = approved.clone();
                altered.insert(field.into(), json!(value));
                assert!(
                    device
                        .sign_afternic_listing_write_approval_transcript(&transcript(
                            WRITE_APPROVAL,
                            &altered
                        ))
                        .is_err()
                );
            }
            let mut fact = unsigned(&vector, "fact");
            fact["payloadRedacted"]["action"] = json!(if action == "create" {
                "update"
            } else {
                "create"
            });
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &fact))
                    .is_err()
            );
            let mut fact = unsigned(&vector, "fact");
            fact["eventType"] = json!("afternic_delist_dispatch_claimed");
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &fact))
                    .is_err()
            );
            let mut audit = unsigned(&vector, "reconciledAudit");
            audit["payloadRedacted"]["outcome"] = json!("absent");
            audit["payloadRedacted"]["reason"] = Value::Null;
            rehash(&mut audit);
            assert!(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &audit))
                    .is_err()
            );
        }
        assert!(
            device
                .sign_afternic_listing_write_approval_transcript(&transcript(
                    WRITE_APPROVAL,
                    &claims("approval")
                ))
                .is_err()
        );
    }
    fn plan_fixture(name: &str) -> Value {
        let bytes = match name {
            "create" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-plan-evidence/create.json"
            ),
            "update" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-plan-evidence/update.json"
            ),
            "ownership-linked-create" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-plan-evidence/ownership-linked-create.json"
            ),
            "ownership-linked-update" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-plan-evidence/ownership-linked-update.json"
            ),
            "ownership-standalone" => include_str!(
                "../../../../packages/protocol/test-vectors/afternic-listing-plan-evidence/ownership-standalone.json"
            ),
            _ => panic!("closed fixture name"),
        };
        serde_json::from_str(bytes).unwrap()
    }
    fn sign_plan(
        device: &DesktopDeviceIdentity,
        ownership: bool,
        bytes: &[u8],
    ) -> Result<[u8; 64], DesktopDeviceIdentityError> {
        if ownership {
            device.sign_afternic_ownership_review_approval_transcript(bytes)
        } else {
            device.sign_afternic_listing_plan_approval_transcript(bytes)
        }
    }
    #[test]
    fn listing_plan_and_ownership_approvals_match_protocol_golden_vectors() {
        let device = identity();
        for name in [
            "create",
            "update",
            "ownership-linked-create",
            "ownership-linked-update",
            "ownership-standalone",
        ] {
            let vector = plan_fixture(name);
            let ownership = name.starts_with("ownership");
            let object = unsigned(&vector, "approval");
            let domain = if ownership {
                OWNERSHIP_APPROVAL
            } else {
                PLAN_APPROVAL
            };
            let bytes = transcript(domain, &object);
            assert_eq!(device.public_key_base64url(), vector["devicePublicKey"]);
            assert_eq!(
                URL_SAFE_NO_PAD.encode(sign_plan(&device, ownership, &bytes).unwrap()),
                vector["approval"]["deviceSignature"],
                "{name}"
            );
            let hex = vector["bytes"]["approvalTranscript"].as_str().unwrap();
            let expected = (0..hex.len())
                .step_by(2)
                .map(|offset| u8::from_str_radix(&hex[offset..offset + 2], 16).unwrap())
                .collect::<Vec<_>>();
            assert_eq!(bytes, expected, "{name}");
            assert!(sign_plan(&device, !ownership, &bytes).is_err());
            assert!(
                device
                    .sign_afternic_listing_write_approval_transcript(&bytes)
                    .is_err()
            );
            assert!(
                device
                    .sign_afternic_delist_approval_transcript(&bytes)
                    .is_err()
            );
            assert!(device.sign_execution_fact_transcript(&bytes).is_err());
            assert!(device.sign_device_audit_event_transcript(&bytes).is_err());
        }
    }
    #[test]
    fn new_approvals_reject_wrong_purpose_parent_shape_and_device_authority() {
        let device = identity();
        for ownership in [false, true] {
            let original = unsigned(
                &plan_fixture(if ownership {
                    "ownership-standalone"
                } else {
                    "create"
                }),
                "approval",
            );
            let domain = if ownership {
                OWNERSHIP_APPROVAL
            } else {
                PLAN_APPROVAL
            };
            for (field, value) in [
                ("schemaVersion", json!(if ownership { 2 } else { 1 })),
                ("typ", json!("gd.afternic-listing-write-item-approval.v1")),
                (
                    "action",
                    json!(if ownership {
                        "create"
                    } else {
                        "reactivate_ownership_review"
                    }),
                ),
                ("sourceDeviceId", json!("other-device")),
                ("signingKeyId", json!("other-key")),
                ("targetCount", json!(1001)),
                ("targetCount", json!(0)),
                ("activeLeaseEpoch", json!(0)),
                ("approvedAt", json!("2026-02-30T00:00:00Z")),
                (
                    "parentItemId",
                    json!("00000000-0000-4000-8000-000000000099"),
                ),
                (
                    "parentRequestDigest",
                    json!(URL_SAFE_NO_PAD.encode([9; 32])),
                ),
                ("secret", json!("not-a-claim")),
            ] {
                let mut object = original.clone();
                object.insert(field.into(), value);
                assert!(
                    sign_plan(&device, ownership, &transcript(domain, &object)).is_err(),
                    "{ownership}/{field}"
                );
            }
            let mut linked = original.clone();
            linked.insert(
                "parentItemId".into(),
                json!("00000000-0000-4000-8000-000000000099"),
            );
            linked.insert(
                "parentRequestDigest".into(),
                json!(URL_SAFE_NO_PAD.encode([9; 32])),
            );
            assert_eq!(
                sign_plan(&device, ownership, &transcript(domain, &linked)).is_ok(),
                ownership
            );
            linked.insert("parentItemId".into(), original["operationItemId"].clone());
            assert!(sign_plan(&device, ownership, &transcript(domain, &linked)).is_err());
            for missing in ["parentItemId", "parentRequestDigest"] {
                let mut object = original.clone();
                object.remove(missing);
                assert!(sign_plan(&device, ownership, &transcript(domain, &object)).is_err());
            }
            for wrong_domain in [APPROVAL, WRITE_APPROVAL, FACT, AUDIT] {
                assert!(
                    sign_plan(&device, ownership, &transcript(wrong_domain, &original)).is_err()
                );
            }
            let old = unsigned(&listing_fixture("create"), "approval");
            assert!(sign_plan(&device, ownership, &transcript(domain, &old)).is_err());
        }
    }
    #[test]
    fn listing_plan_and_ownership_audits_and_facts_match_protocol_golden_vectors() {
        let device = identity();
        for name in [
            "create",
            "update",
            "ownership-linked-create",
            "ownership-linked-update",
            "ownership-standalone",
        ] {
            let vector = plan_fixture(name);
            for field in [
                "approvalAudit",
                "claimAudit",
                "preflightAudit",
                "reconciledAudit",
                "fact",
            ] {
                let domain = if field == "fact" { FACT } else { AUDIT };
                let bytes = transcript(domain, &unsigned(&vector, field));
                let signature = if field == "fact" {
                    device.sign_execution_fact_transcript(&bytes)
                } else {
                    device.sign_device_audit_event_transcript(&bytes)
                }
                .unwrap_or_else(|_| panic!("{name}/{field}"));
                assert_eq!(
                    URL_SAFE_NO_PAD.encode(signature),
                    vector[field]["deviceSignature"],
                    "{name}/{field}"
                );
            }
        }
    }
    #[test]
    fn new_audits_keep_exact_item_version_purpose_and_observation_shape() {
        let device = identity();
        for name in ["create", "ownership-linked-create", "ownership-standalone"] {
            let vector = plan_fixture(name);
            for field in ["claimAudit", "preflightAudit", "reconciledAudit"] {
                let original = unsigned(&vector, field);
                let mut changed = original.clone();
                changed["targetType"] = json!("afternic_listing_write_attempt");
                rehash(&mut changed);
                assert!(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                        .is_err()
                );
                let mut changed = original.clone();
                changed["payloadRedacted"]["schemaVersion"] =
                    json!(if name == "create" { 1 } else { 2 });
                rehash(&mut changed);
                assert!(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                        .is_err()
                );
                let mut changed = original.clone();
                changed["payloadRedacted"]["parentItemId"] = Value::Null;
                rehash(&mut changed);
                assert!(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                        .is_err()
                );
            }
            if name.starts_with("ownership") {
                for digest_field in ["resourceBindingDigest", "preflightObservationDigest"] {
                    let mut changed = unsigned(&vector, "claimAudit");
                    changed["payloadRedacted"]
                        .as_object_mut()
                        .unwrap()
                        .remove(digest_field);
                    rehash(&mut changed);
                    assert!(
                        device
                            .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                            .is_err()
                    );
                }
                let mut changed = unsigned(&vector, "reconciledAudit");
                changed["payloadRedacted"]["outcome"] = json!("matched");
                changed["payloadRedacted"]["reason"] = Value::Null;
                rehash(&mut changed);
                assert!(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                        .is_err()
                );
                let mut changed = unsigned(&vector, "preflightAudit");
                changed["payloadRedacted"]["reason"] = json!("already_present");
                rehash(&mut changed);
                assert!(
                    device
                        .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                        .is_err()
                );
            }
        }
    }
    #[test]
    fn new_facts_bind_approval_version_and_separate_observation_digests() {
        let device = identity();
        for name in ["create", "ownership-linked-create", "ownership-standalone"] {
            let vector = plan_fixture(name);
            let original = unsigned(&vector, "fact");
            let mut changed = original.clone();
            changed["eventType"] = json!("afternic_listing_write_dispatch_claimed");
            if name == "create" {
                changed["payloadRedacted"]["schemaVersion"] = json!(1);
            }
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &changed))
                    .is_err()
            );
            let mut changed = original.clone();
            changed["executionAuthorizationEvidence"]["approvedOperationEnvelope"] = json!(
                URL_SAFE_NO_PAD
                    .encode(serde_json::to_vec(&listing_fixture("create")["approval"]).unwrap())
            );
            assert!(
                device
                    .sign_execution_fact_transcript(&transcript(FACT, &changed))
                    .is_err()
            );
            for digest_field in ["resourceBindingDigest", "preflightObservationDigest"] {
                let mut changed = original.clone();
                if name.starts_with("ownership") {
                    changed["payloadRedacted"]
                        .as_object_mut()
                        .unwrap()
                        .remove(digest_field);
                } else {
                    changed["payloadRedacted"][digest_field] =
                        json!(URL_SAFE_NO_PAD.encode([9; 32]));
                }
                assert!(
                    device
                        .sign_execution_fact_transcript(&transcript(FACT, &changed))
                        .is_err()
                );
            }
        }
    }
    #[test]
    fn satisfied_preflight_is_an_observation_without_a_claim_or_refusal_reason() {
        let vector: Value = serde_json::from_str(include_str!("../../../../packages/protocol/test-vectors/afternic-listing-plan-evidence/ownership-preflight-satisfied.json")).unwrap();
        let original = unsigned(&vector, "satisfiedAudit");
        let device = identity();
        assert_eq!(
            URL_SAFE_NO_PAD.encode(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &original))
                    .unwrap()
            ),
            vector["satisfiedAudit"]["deviceSignature"]
        );
        for (field, value) in [
            ("reason", json!("already_present")),
            ("reason", Value::Null),
            (
                "resourceBindingDigest",
                json!(URL_SAFE_NO_PAD.encode([9; 32])),
            ),
            ("action", json!("create")),
            ("stage", json!("dispatch_claimed")),
        ] {
            let mut changed = original.clone();
            changed["payloadRedacted"][field] = value;
            rehash(&mut changed);
            assert!(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                    .is_err(),
                "{field}"
            );
        }
        for (field, value) in [
            ("actorKind", "user"),
            ("authorizationSource", "approved_operation"),
            ("eventType", "approved_operation_execution"),
            ("targetType", "afternic_listing_plan_v2_attempt"),
        ] {
            let mut changed = original.clone();
            changed[field] = json!(value);
            rehash(&mut changed);
            assert!(
                device
                    .sign_device_audit_event_transcript(&transcript(AUDIT, &changed))
                    .is_err(),
                "{field}"
            );
        }
    }
}
