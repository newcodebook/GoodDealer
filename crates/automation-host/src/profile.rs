//! Browser session profiles (P0-28).
//!
//! A [`BrowserSessionProfile`] bundles the session scope, isolation key, and
//! policies that govern a single automation WebView instance.  Active and
//! sunset profiles carry different scopes and default policies.
//!
//! The **profile isolation key** is derived from:
//!   `profile_scope + provider_connection_id + session_mode`
//! Two profiles with different isolation keys MUST NOT share browser state
//! (cookies, storage, cache).

use crate::download_policy::DownloadPolicy;
use crate::navigation_policy::NavigationPolicy;
use crate::session::SessionMode;
use crate::upload_policy::UploadPolicy;

// ---------------------------------------------------------------------------
// Profile scope
// ---------------------------------------------------------------------------

/// The scope variant for an active automation profile.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ActiveProfileScope {
    /// Provider identifier (e.g., `"spaceship"`).
    pub provider: String,
    /// Provider connection identifier.
    pub provider_connection_id: String,
    /// Allowed navigation domains.
    pub allowed_domains: Vec<String>,
}

/// The scope variant for a sunset/drain automation profile.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SunsetProfileScope {
    /// Provider identifier.
    pub provider: String,
    /// Provider connection identifier.
    pub provider_connection_id: String,
    /// Drain stream identifier.
    pub drain_stream_id: String,
    /// Allowed data-export URLs.
    pub allowed_export_urls: Vec<String>,
}

/// Typed profile scope discriminated by session mode.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case", tag = "scope_type")]
pub enum ProfileScope {
    Active(ActiveProfileScope),
    Sunset(SunsetProfileScope),
}

// ---------------------------------------------------------------------------
// Browser session profile
// ---------------------------------------------------------------------------

/// A complete browser session profile bundling scope, isolation key, and
/// all applicable policies (INV-PRF-01..08).
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct BrowserSessionProfile {
    /// The profile scope (active or sunset).
    scope: ProfileScope,
    /// Session mode matching the scope variant.
    session_mode: SessionMode,
    /// Navigation policy for this profile.
    navigation_policy: NavigationPolicy,
    /// Download policy for this profile.
    download_policy: DownloadPolicy,
    /// Upload policy for this profile.
    upload_policy: UploadPolicy,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProfileError {
    InvalidJson(String),
    ScopeModeMismatch,
    EmptyProvider,
    EmptyProviderConnectionId,
}

impl std::fmt::Display for ProfileError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid profile JSON: {msg}"),
            Self::ScopeModeMismatch => {
                write!(f, "profile scope type does not match session_mode")
            }
            Self::EmptyProvider => write!(f, "provider must not be empty"),
            Self::EmptyProviderConnectionId => {
                write!(f, "provider_connection_id must not be empty")
            }
        }
    }
}

impl std::error::Error for ProfileError {}

impl BrowserSessionProfile {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, ProfileError> {
        let profile: Self =
            serde_json::from_str(json).map_err(|e| ProfileError::InvalidJson(e.to_string()))?;
        profile.validate()?;
        Ok(profile)
    }

    fn validate(&self) -> Result<(), ProfileError> {
        match (&self.scope, self.session_mode) {
            (ProfileScope::Active(s), SessionMode::Active) => {
                if s.provider.is_empty() {
                    return Err(ProfileError::EmptyProvider);
                }
                if s.provider_connection_id.is_empty() {
                    return Err(ProfileError::EmptyProviderConnectionId);
                }
            }
            (ProfileScope::Sunset(s), SessionMode::Sunset) => {
                if s.provider.is_empty() {
                    return Err(ProfileError::EmptyProvider);
                }
                if s.provider_connection_id.is_empty() {
                    return Err(ProfileError::EmptyProviderConnectionId);
                }
            }
            _ => return Err(ProfileError::ScopeModeMismatch),
        }
        Ok(())
    }

    /// Compute the profile isolation key.
    ///
    /// Two profiles with different isolation keys MUST NOT share browser state.
    #[must_use]
    pub fn isolation_key(&self) -> String {
        let (scope_label, provider_connection_id) = match &self.scope {
            ProfileScope::Active(s) => ("active", s.provider_connection_id.as_str()),
            ProfileScope::Sunset(s) => ("sunset", s.provider_connection_id.as_str()),
        };
        let mode = match self.session_mode {
            SessionMode::Active => "active",
            SessionMode::Sunset => "sunset",
        };
        format!("{scope_label}:{provider_connection_id}:{mode}")
    }

    #[must_use]
    pub fn scope(&self) -> &ProfileScope {
        &self.scope
    }

    #[must_use]
    pub fn session_mode(&self) -> SessionMode {
        self.session_mode
    }

    #[must_use]
    pub fn navigation_policy(&self) -> &NavigationPolicy {
        &self.navigation_policy
    }

    #[must_use]
    pub fn download_policy(&self) -> &DownloadPolicy {
        &self.download_policy
    }

    #[must_use]
    pub fn upload_policy(&self) -> &UploadPolicy {
        &self.upload_policy
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn active_profile_json() -> String {
        serde_json::json!({
            "scope": {
                "scope_type": "active",
                "provider": "spaceship",
                "provider_connection_id": "pconn-001",
                "allowed_domains": ["spaceship.com"]
            },
            "session_mode": "active",
            "navigation_policy": {
                "policy_type": "active",
                "allowed_domains": ["spaceship.com"],
                "allow_subpaths": true,
                "require_https": true
            },
            "download_policy": { "policy_type": "deny" },
            "upload_policy": { "policy_type": "deny" }
        })
        .to_string()
    }

    fn sunset_profile_json() -> String {
        serde_json::json!({
            "scope": {
                "scope_type": "sunset",
                "provider": "spaceship",
                "provider_connection_id": "pconn-001",
                "drain_stream_id": "drain-001",
                "allowed_export_urls": ["https://spaceship.com/export"]
            },
            "session_mode": "sunset",
            "navigation_policy": {
                "policy_type": "sunset",
                "allowed_export_urls": ["https://spaceship.com/export"],
                "require_https": true
            },
            "download_policy": {
                "policy_type": "export_only",
                "allowed_mime_types": ["text/csv"],
                "max_size_bytes": 104_857_600,
                "export_directory": "/exports/spaceship"
            },
            "upload_policy": { "policy_type": "deny" }
        })
        .to_string()
    }

    #[test]
    fn active_profile_parses_and_isolates() {
        let profile = BrowserSessionProfile::from_json(&active_profile_json()).unwrap();
        assert_eq!(profile.session_mode(), SessionMode::Active);
        assert_eq!(profile.isolation_key(), "active:pconn-001:active");
    }

    #[test]
    fn sunset_profile_parses_and_isolates() {
        let profile = BrowserSessionProfile::from_json(&sunset_profile_json()).unwrap();
        assert_eq!(profile.session_mode(), SessionMode::Sunset);
        assert_eq!(profile.isolation_key(), "sunset:pconn-001:sunset");
    }

    #[test]
    fn different_connections_produce_different_keys() {
        let json1 = active_profile_json();
        let json2 = json1.replace("pconn-001", "pconn-002");
        let p1 = BrowserSessionProfile::from_json(&json1).unwrap();
        let p2 = BrowserSessionProfile::from_json(&json2).unwrap();
        assert_ne!(p1.isolation_key(), p2.isolation_key());
    }

    #[test]
    fn active_and_sunset_produce_different_keys_same_connection() {
        let p1 = BrowserSessionProfile::from_json(&active_profile_json()).unwrap();
        let p2 = BrowserSessionProfile::from_json(&sunset_profile_json()).unwrap();
        assert_ne!(p1.isolation_key(), p2.isolation_key());
    }

    #[test]
    fn rejects_scope_mode_mismatch() {
        // Active scope with sunset mode.
        let mut val: serde_json::Value =
            serde_json::from_str(&active_profile_json()).unwrap();
        val["session_mode"] = serde_json::json!("sunset");
        let result = BrowserSessionProfile::from_json(&val.to_string());
        assert!(matches!(result, Err(ProfileError::ScopeModeMismatch)));
    }

    #[test]
    fn rejects_empty_provider() {
        let mut val: serde_json::Value =
            serde_json::from_str(&active_profile_json()).unwrap();
        val["scope"]["provider"] = serde_json::json!("");
        let result = BrowserSessionProfile::from_json(&val.to_string());
        assert!(matches!(result, Err(ProfileError::EmptyProvider)));
    }

    #[test]
    fn rejects_unknown_fields_in_profile() {
        let mut val: serde_json::Value =
            serde_json::from_str(&active_profile_json()).unwrap();
        val["rogue_field"] = serde_json::json!("bad");
        let result = BrowserSessionProfile::from_json(&val.to_string());
        assert!(result.is_err());
    }
}
