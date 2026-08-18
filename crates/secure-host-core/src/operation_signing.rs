//! Operation signing for automation execution tickets (P0-30).
//!
//! Provides the signing and verification primitives used to bind an
//! [`AutomationExecutionTicket`] to its issuing context.  The signature
//! covers a deterministic digest of the ticket's identity fields, preventing
//! replay or mutation after issuance.
//!
//! This module defines the contract types only.  Real cryptographic
//! implementations are deferred to the platform-specific host.

/// The signing algorithm used for ticket signatures.
///
/// Currently only `HmacSha256` is defined; the enum is closed to prevent
/// algorithm confusion attacks.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum SigningAlgorithm {
    HmacSha256,
}

/// A signed ticket digest produced by the host.
///
/// The `digest_input` is the deterministic canonical representation of the
/// ticket's identity fields.  The `signature` is the HMAC-SHA-256 over that
/// input using the device-scoped signing key.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct TicketSignature {
    /// The signing algorithm used.
    pub algorithm: SigningAlgorithm,
    /// Hex-encoded digest of the ticket identity fields.
    pub digest_hex: String,
    /// Hex-encoded HMAC signature.
    pub signature_hex: String,
    /// Device identifier that produced the signature.
    pub signer_device_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TicketSignatureError {
    InvalidJson(String),
    EmptyDigest,
    EmptySignature,
    EmptySignerDeviceId,
    DigestNotHex,
    SignatureNotHex,
}

impl std::fmt::Display for TicketSignatureError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid ticket signature JSON: {msg}"),
            Self::EmptyDigest => write!(f, "digest_hex must not be empty"),
            Self::EmptySignature => write!(f, "signature_hex must not be empty"),
            Self::EmptySignerDeviceId => write!(f, "signer_device_id must not be empty"),
            Self::DigestNotHex => write!(f, "digest_hex is not valid hex"),
            Self::SignatureNotHex => write!(f, "signature_hex is not valid hex"),
        }
    }
}

impl std::error::Error for TicketSignatureError {}

impl TicketSignature {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, TicketSignatureError> {
        let sig: Self = serde_json::from_str(json)
            .map_err(|e| TicketSignatureError::InvalidJson(e.to_string()))?;
        sig.validate()?;
        Ok(sig)
    }

    fn validate(&self) -> Result<(), TicketSignatureError> {
        if self.digest_hex.is_empty() {
            return Err(TicketSignatureError::EmptyDigest);
        }
        if self.signature_hex.is_empty() {
            return Err(TicketSignatureError::EmptySignature);
        }
        if self.signer_device_id.is_empty() {
            return Err(TicketSignatureError::EmptySignerDeviceId);
        }
        if !is_hex(&self.digest_hex) {
            return Err(TicketSignatureError::DigestNotHex);
        }
        if !is_hex(&self.signature_hex) {
            return Err(TicketSignatureError::SignatureNotHex);
        }
        Ok(())
    }
}

/// Encode the canonical digest input for a ticket.
///
/// The input is a deterministic concatenation of the ticket's identity fields
/// in a fixed order, separated by newlines.
#[must_use]
pub fn encode_ticket_digest_input(
    ticket_id: &str,
    session_id: &str,
    recipe_id: &str,
    device_id: &str,
    nonce: &str,
    issued_at_seconds: u64,
    expires_at_seconds: u64,
    sequence_number: u64,
) -> String {
    format!(
        "ticket:{ticket_id}\nsession:{session_id}\nrecipe:{recipe_id}\ndevice:{device_id}\nnonce:{nonce}\nissued:{issued_at_seconds}\nexpires:{expires_at_seconds}\nseq:{sequence_number}"
    )
}

fn is_hex(s: &str) -> bool {
    !s.is_empty() && s.len() % 2 == 0 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

#[cfg(test)]
pub(crate) fn test_signature(device_id: &str) -> TicketSignature {
    TicketSignature {
        algorithm: SigningAlgorithm::HmacSha256,
        digest_hex: "aa".repeat(32),
        signature_hex: "bb".repeat(32),
        signer_device_id: device_id.to_owned(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn signature_parses_valid() {
        let json = serde_json::json!({
            "algorithm": "hmac_sha256",
            "digest_hex": "aa".repeat(32),
            "signature_hex": "bb".repeat(32),
            "signer_device_id": "dev-001"
        })
        .to_string();
        let sig = TicketSignature::from_json(&json).unwrap();
        assert_eq!(sig.algorithm, SigningAlgorithm::HmacSha256);
        assert_eq!(sig.signer_device_id, "dev-001");
    }

    #[test]
    fn rejects_empty_digest() {
        let json = serde_json::json!({
            "algorithm": "hmac_sha256",
            "digest_hex": "",
            "signature_hex": "bb".repeat(32),
            "signer_device_id": "dev-001"
        })
        .to_string();
        assert!(matches!(
            TicketSignature::from_json(&json),
            Err(TicketSignatureError::EmptyDigest)
        ));
    }

    #[test]
    fn rejects_non_hex_digest() {
        let json = serde_json::json!({
            "algorithm": "hmac_sha256",
            "digest_hex": "not-hex!",
            "signature_hex": "bb".repeat(32),
            "signer_device_id": "dev-001"
        })
        .to_string();
        assert!(matches!(
            TicketSignature::from_json(&json),
            Err(TicketSignatureError::DigestNotHex)
        ));
    }

    #[test]
    fn rejects_unknown_algorithm() {
        let json = serde_json::json!({
            "algorithm": "rsa_pss",
            "digest_hex": "aa".repeat(32),
            "signature_hex": "bb".repeat(32),
            "signer_device_id": "dev-001"
        })
        .to_string();
        assert!(TicketSignature::from_json(&json).is_err());
    }

    #[test]
    fn rejects_unknown_fields() {
        let json = serde_json::json!({
            "algorithm": "hmac_sha256",
            "digest_hex": "aa".repeat(32),
            "signature_hex": "bb".repeat(32),
            "signer_device_id": "dev-001",
            "rogue": true
        })
        .to_string();
        assert!(TicketSignature::from_json(&json).is_err());
    }

    #[test]
    fn digest_input_is_deterministic() {
        let a = encode_ticket_digest_input("t1", "s1", "r1", "d1", "n1", 100, 200, 1);
        let b = encode_ticket_digest_input("t1", "s1", "r1", "d1", "n1", 100, 200, 1);
        assert_eq!(a, b);
    }

    #[test]
    fn digest_input_changes_with_any_field() {
        let base = encode_ticket_digest_input("t1", "s1", "r1", "d1", "n1", 100, 200, 1);
        assert_ne!(
            base,
            encode_ticket_digest_input("t2", "s1", "r1", "d1", "n1", 100, 200, 1)
        );
        assert_ne!(
            base,
            encode_ticket_digest_input("t1", "s1", "r1", "d1", "n2", 100, 200, 1)
        );
        assert_ne!(
            base,
            encode_ticket_digest_input("t1", "s1", "r1", "d1", "n1", 100, 200, 2)
        );
    }
}
