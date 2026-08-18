//! Navigation policy for browser automation sessions (P0-28).
//!
//! Defines which URLs the automation WebView is allowed to navigate to.
//! Active sessions navigate freely within the provider scope.
//! Sunset sessions are restricted to read-only data-export pages.

/// Navigation policy governing which URLs the WebView may load.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields, rename_all = "snake_case", tag = "policy_type")]
pub enum NavigationPolicy {
    /// Active-session policy: navigation allowed within the provider scope.
    Active {
        /// Allowed origin domains (e.g., `["spaceship.com", "www.spaceship.com"]`).
        allowed_domains: Vec<String>,
        /// Whether sub-paths of allowed domains are permitted.
        allow_subpaths: bool,
        /// Whether HTTPS is required (always true in production).
        require_https: bool,
    },
    /// Sunset-session policy: only data-export URLs are reachable.
    Sunset {
        /// Allowed export-only URLs.
        allowed_export_urls: Vec<String>,
        /// Whether HTTPS is required (always true in production).
        require_https: bool,
    },
}

/// Validation errors for [`NavigationPolicy`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum NavigationPolicyError {
    InvalidJson(String),
    EmptyAllowedDomains,
    EmptyAllowedExportUrls,
    InsecureNotAllowed,
}

impl std::fmt::Display for NavigationPolicyError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid navigation policy JSON: {msg}"),
            Self::EmptyAllowedDomains => write!(f, "allowed_domains must not be empty"),
            Self::EmptyAllowedExportUrls => write!(f, "allowed_export_urls must not be empty"),
            Self::InsecureNotAllowed => write!(f, "require_https must be true"),
        }
    }
}

impl std::error::Error for NavigationPolicyError {}

impl NavigationPolicy {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, NavigationPolicyError> {
        let policy: Self = serde_json::from_str(json)
            .map_err(|e| NavigationPolicyError::InvalidJson(e.to_string()))?;
        policy.validate()?;
        Ok(policy)
    }

    fn validate(&self) -> Result<(), NavigationPolicyError> {
        match self {
            Self::Active {
                allowed_domains,
                require_https,
                ..
            } => {
                if allowed_domains.is_empty() {
                    return Err(NavigationPolicyError::EmptyAllowedDomains);
                }
                if !require_https {
                    return Err(NavigationPolicyError::InsecureNotAllowed);
                }
            }
            Self::Sunset {
                allowed_export_urls,
                require_https,
                ..
            } => {
                if allowed_export_urls.is_empty() {
                    return Err(NavigationPolicyError::EmptyAllowedExportUrls);
                }
                if !require_https {
                    return Err(NavigationPolicyError::InsecureNotAllowed);
                }
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn active_policy_parses_valid() {
        let json = serde_json::json!({
            "policy_type": "active",
            "allowed_domains": ["spaceship.com", "www.spaceship.com"],
            "allow_subpaths": true,
            "require_https": true
        })
        .to_string();
        let policy = NavigationPolicy::from_json(&json).unwrap();
        assert!(matches!(policy, NavigationPolicy::Active { .. }));
    }

    #[test]
    fn sunset_policy_parses_valid() {
        let json = serde_json::json!({
            "policy_type": "sunset",
            "allowed_export_urls": ["https://spaceship.com/export/domains"],
            "require_https": true
        })
        .to_string();
        let policy = NavigationPolicy::from_json(&json).unwrap();
        assert!(matches!(policy, NavigationPolicy::Sunset { .. }));
    }

    #[test]
    fn rejects_empty_domains() {
        let json = serde_json::json!({
            "policy_type": "active",
            "allowed_domains": [],
            "allow_subpaths": true,
            "require_https": true
        })
        .to_string();
        assert!(matches!(
            NavigationPolicy::from_json(&json),
            Err(NavigationPolicyError::EmptyAllowedDomains)
        ));
    }

    #[test]
    fn rejects_insecure_active() {
        let json = serde_json::json!({
            "policy_type": "active",
            "allowed_domains": ["spaceship.com"],
            "allow_subpaths": true,
            "require_https": false
        })
        .to_string();
        assert!(matches!(
            NavigationPolicy::from_json(&json),
            Err(NavigationPolicyError::InsecureNotAllowed)
        ));
    }

    #[test]
    fn rejects_insecure_sunset() {
        let json = serde_json::json!({
            "policy_type": "sunset",
            "allowed_export_urls": ["http://spaceship.com/export"],
            "require_https": false
        })
        .to_string();
        assert!(matches!(
            NavigationPolicy::from_json(&json),
            Err(NavigationPolicyError::InsecureNotAllowed)
        ));
    }

    #[test]
    fn rejects_unknown_fields() {
        let json = serde_json::json!({
            "policy_type": "active",
            "allowed_domains": ["spaceship.com"],
            "allow_subpaths": true,
            "require_https": true,
            "rogue": true
        })
        .to_string();
        assert!(NavigationPolicy::from_json(&json).is_err());
    }
}
