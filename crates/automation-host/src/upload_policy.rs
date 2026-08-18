//! Upload policy for browser automation sessions (P0-28).
//!
//! Controls whether and how the automation WebView may upload files.

/// Upload policy governing file uploads during automation.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case", tag = "policy_type")]
pub enum UploadPolicy {
    /// Uploads are completely denied (default).
    Deny {},
    /// Uploads are allowed only for specific business-field file inputs.
    BusinessFieldOnly {
        /// Allowed MIME types for upload.
        allowed_mime_types: Vec<String>,
        /// Maximum upload size in bytes.
        max_size_bytes: u64,
        /// Source directory that uploads must originate from.
        source_directory: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum UploadPolicyError {
    InvalidJson(String),
    EmptyAllowedMimeTypes,
    EmptySourceDirectory,
    ZeroMaxSize,
    UnexpectedFields,
}

impl std::fmt::Display for UploadPolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid upload policy JSON: {msg}"),
            Self::EmptyAllowedMimeTypes => write!(f, "allowed_mime_types must not be empty"),
            Self::EmptySourceDirectory => write!(f, "source_directory must not be empty"),
            Self::ZeroMaxSize => write!(f, "max_size_bytes must be greater than zero"),
            Self::UnexpectedFields => write!(f, "unexpected fields in upload policy"),
        }
    }
}

impl std::error::Error for UploadPolicyError {}

impl UploadPolicy {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, UploadPolicyError> {
        // First check for unknown fields by counting the raw keys.
        let raw: serde_json::Value = serde_json::from_str(json)
            .map_err(|e| UploadPolicyError::InvalidJson(e.to_string()))?;
        let obj = raw
            .as_object()
            .ok_or_else(|| UploadPolicyError::InvalidJson("expected object".to_owned()))?;
        let expected_keys: usize = match obj.get("policy_type").and_then(|v| v.as_str()) {
            Some("deny") => 1,              // just policy_type
            Some("business_field_only") => 4, // policy_type + 3 fields
            _ => {
                return Err(UploadPolicyError::InvalidJson(
                    "unknown policy_type".to_owned(),
                ))
            }
        };
        if obj.len() != expected_keys {
            return Err(UploadPolicyError::UnexpectedFields);
        }

        let policy: Self = serde_json::from_value(raw)
            .map_err(|e| UploadPolicyError::InvalidJson(e.to_string()))?;
        policy.validate()?;
        Ok(policy)
    }

    fn validate(&self) -> Result<(), UploadPolicyError> {
        if let Self::BusinessFieldOnly {
            allowed_mime_types,
            max_size_bytes,
            source_directory,
        } = self
        {
            if allowed_mime_types.is_empty() {
                return Err(UploadPolicyError::EmptyAllowedMimeTypes);
            }
            if source_directory.is_empty() {
                return Err(UploadPolicyError::EmptySourceDirectory);
            }
            if *max_size_bytes == 0 {
                return Err(UploadPolicyError::ZeroMaxSize);
            }
        }
        Ok(())
    }

    #[must_use]
    pub fn is_deny(&self) -> bool {
        matches!(self, Self::Deny {})
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deny_policy_parses() {
        let json = r#"{"policy_type":"deny"}"#;
        let policy = UploadPolicy::from_json(json).unwrap();
        assert!(policy.is_deny());
    }

    #[test]
    fn business_field_only_parses_valid() {
        let json = serde_json::json!({
            "policy_type": "business_field_only",
            "allowed_mime_types": ["image/png", "application/pdf"],
            "max_size_bytes": 10_485_760,
            "source_directory": "/uploads/staging"
        })
        .to_string();
        let policy = UploadPolicy::from_json(&json).unwrap();
        assert!(!policy.is_deny());
    }

    #[test]
    fn rejects_empty_mime_types() {
        let json = serde_json::json!({
            "policy_type": "business_field_only",
            "allowed_mime_types": [],
            "max_size_bytes": 1024,
            "source_directory": "/uploads"
        })
        .to_string();
        assert!(matches!(
            UploadPolicy::from_json(&json),
            Err(UploadPolicyError::EmptyAllowedMimeTypes)
        ));
    }

    #[test]
    fn rejects_zero_max_size() {
        let json = serde_json::json!({
            "policy_type": "business_field_only",
            "allowed_mime_types": ["text/csv"],
            "max_size_bytes": 0,
            "source_directory": "/uploads"
        })
        .to_string();
        assert!(matches!(
            UploadPolicy::from_json(&json),
            Err(UploadPolicyError::ZeroMaxSize)
        ));
    }

    #[test]
    fn rejects_unknown_fields_on_deny() {
        let json = r#"{"policy_type":"deny","rogue":true}"#;
        assert!(UploadPolicy::from_json(json).is_err());
    }

    #[test]
    fn rejects_unknown_fields_on_business() {
        let json = serde_json::json!({
            "policy_type": "business_field_only",
            "allowed_mime_types": ["text/csv"],
            "max_size_bytes": 1024,
            "source_directory": "/uploads",
            "rogue": true
        })
        .to_string();
        assert!(UploadPolicy::from_json(&json).is_err());
    }
}
