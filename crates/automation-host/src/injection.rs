//! Injection context for browser automation (P0-29).
//!
//! The [`InjectionContext`] carries the scoped data that the automation host
//! injects into a WebView before recipe execution begins.  It never contains
//! raw secrets — only scoped, redacted references that the host resolves at
//! injection time through the secure-host-core secret surface.

use crate::session::SessionMode;

/// Scoped injection context passed to the WebView sandbox.
///
/// This type is serialized into the WebView's isolated world.  It contains
/// only non-secret metadata; the automation host resolves secret material
/// internally and injects it through the platform credential API, never
/// through this context.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct InjectionContext {
    /// Session identifier.
    session_id: String,
    /// Provider connection identifier.
    provider_connection_id: String,
    /// Session mode (active or sunset).
    session_mode: SessionMode,
    /// Profile isolation key (opaque string computed by the profile module).
    profile_isolation_key: String,
    /// Navigation scope (domain restriction).
    navigation_scope: String,
    /// Whether the session permits write operations.
    permits_write: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum InjectionContextError {
    InvalidJson(String),
    EmptySessionId,
    EmptyProviderConnectionId,
    EmptyProfileIsolationKey,
    EmptyNavigationScope,
    SunsetMustBeReadOnly,
}

impl std::fmt::Display for InjectionContextError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid injection context JSON: {msg}"),
            Self::EmptySessionId => write!(f, "session_id must not be empty"),
            Self::EmptyProviderConnectionId => {
                write!(f, "provider_connection_id must not be empty")
            }
            Self::EmptyProfileIsolationKey => {
                write!(f, "profile_isolation_key must not be empty")
            }
            Self::EmptyNavigationScope => write!(f, "navigation_scope must not be empty"),
            Self::SunsetMustBeReadOnly => {
                write!(f, "sunset sessions must have permits_write = false")
            }
        }
    }
}

impl std::error::Error for InjectionContextError {}

impl InjectionContext {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, InjectionContextError> {
        let ctx: Self = serde_json::from_str(json)
            .map_err(|e| InjectionContextError::InvalidJson(e.to_string()))?;
        ctx.validate()?;
        Ok(ctx)
    }

    fn validate(&self) -> Result<(), InjectionContextError> {
        if self.session_id.is_empty() {
            return Err(InjectionContextError::EmptySessionId);
        }
        if self.provider_connection_id.is_empty() {
            return Err(InjectionContextError::EmptyProviderConnectionId);
        }
        if self.profile_isolation_key.is_empty() {
            return Err(InjectionContextError::EmptyProfileIsolationKey);
        }
        if self.navigation_scope.is_empty() {
            return Err(InjectionContextError::EmptyNavigationScope);
        }
        if self.session_mode == SessionMode::Sunset && self.permits_write {
            return Err(InjectionContextError::SunsetMustBeReadOnly);
        }
        Ok(())
    }

    #[must_use]
    pub fn session_id(&self) -> &str {
        &self.session_id
    }

    #[must_use]
    pub fn provider_connection_id(&self) -> &str {
        &self.provider_connection_id
    }

    #[must_use]
    pub fn session_mode(&self) -> SessionMode {
        self.session_mode
    }

    #[must_use]
    pub fn profile_isolation_key(&self) -> &str {
        &self.profile_isolation_key
    }

    #[must_use]
    pub fn permits_write(&self) -> bool {
        self.permits_write
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_injection_json() -> String {
        serde_json::json!({
            "session_id": "sess-001",
            "provider_connection_id": "pconn-001",
            "session_mode": "active",
            "profile_isolation_key": "active:pconn-001:active",
            "navigation_scope": "spaceship.com",
            "permits_write": true
        })
        .to_string()
    }

    #[test]
    fn parses_valid_injection_context() {
        let ctx = InjectionContext::from_json(&valid_injection_json()).unwrap();
        assert_eq!(ctx.session_id(), "sess-001");
        assert!(ctx.permits_write());
    }

    #[test]
    fn sunset_rejects_write_permission() {
        let json = serde_json::json!({
            "session_id": "sess-001",
            "provider_connection_id": "pconn-001",
            "session_mode": "sunset",
            "profile_isolation_key": "sunset:pconn-001:sunset",
            "navigation_scope": "spaceship.com",
            "permits_write": true
        })
        .to_string();
        assert!(matches!(
            InjectionContext::from_json(&json),
            Err(InjectionContextError::SunsetMustBeReadOnly)
        ));
    }

    #[test]
    fn sunset_accepts_readonly() {
        let json = serde_json::json!({
            "session_id": "sess-001",
            "provider_connection_id": "pconn-001",
            "session_mode": "sunset",
            "profile_isolation_key": "sunset:pconn-001:sunset",
            "navigation_scope": "spaceship.com",
            "permits_write": false
        })
        .to_string();
        let ctx = InjectionContext::from_json(&json).unwrap();
        assert!(!ctx.permits_write());
    }

    #[test]
    fn rejects_unknown_fields() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_injection_json()).unwrap();
        val["rogue"] = serde_json::json!(true);
        assert!(InjectionContext::from_json(&val.to_string()).is_err());
    }
}
