//! WebView manager contract for browser automation (P0-29).
//!
//! Defines the lifecycle and configuration types for managed automation
//! WebView instances.  This module provides type definitions only — actual
//! WebView2/WKWebView native code is NOT implemented here.

use crate::download_policy::DownloadPolicy;
use crate::navigation_policy::NavigationPolicy;
use crate::session::SessionMode;
use crate::upload_policy::UploadPolicy;

/// Configuration for creating a managed automation WebView.
///
/// This is a data-only type.  The actual WebView creation is performed by
/// the platform-specific host code (Tauri/wry), not by this crate.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct WebViewConfig {
    /// WebView label (matches the Tauri capability target, e.g., `"remote-browser"`).
    pub label: String,
    /// Session identifier that owns this WebView.
    pub session_id: String,
    /// Profile isolation key (determines browser-state partition).
    pub profile_isolation_key: String,
    /// Session mode.
    pub session_mode: SessionMode,
    /// Navigation policy for this WebView.
    pub navigation_policy: NavigationPolicy,
    /// Download policy for this WebView.
    pub download_policy: DownloadPolicy,
    /// Upload policy for this WebView.
    pub upload_policy: UploadPolicy,
    /// Whether DevTools access is allowed (always false in production).
    pub devtools_enabled: bool,
    /// Whether JavaScript is enabled in the WebView.
    pub javascript_enabled: bool,
}

/// Lifecycle state of a managed WebView.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum WebViewState {
    /// WebView has been configured but not yet created.
    Pending,
    /// WebView is created and ready for navigation.
    Ready,
    /// A recipe is currently executing in the WebView.
    Executing,
    /// The WebView has been destroyed.
    Destroyed,
}

/// Snapshot of a managed WebView's current state.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct WebViewSnapshot {
    /// WebView label.
    pub label: String,
    /// Session identifier.
    pub session_id: String,
    /// Current lifecycle state.
    pub state: WebViewState,
    /// Current URL loaded in the WebView (if any).
    pub current_url: Option<String>,
    /// Profile isolation key.
    pub profile_isolation_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum WebViewConfigError {
    InvalidJson(String),
    EmptyLabel,
    EmptySessionId,
    EmptyProfileIsolationKey,
    LabelMustBeRemoteBrowser,
}

impl std::fmt::Display for WebViewConfigError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid webview config JSON: {msg}"),
            Self::EmptyLabel => write!(f, "label must not be empty"),
            Self::EmptySessionId => write!(f, "session_id must not be empty"),
            Self::EmptyProfileIsolationKey => {
                write!(f, "profile_isolation_key must not be empty")
            }
            Self::LabelMustBeRemoteBrowser => {
                write!(f, "automation WebView label must be \"remote-browser\"")
            }
        }
    }
}

impl std::error::Error for WebViewConfigError {}

impl WebViewConfig {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, WebViewConfigError> {
        let config: Self = serde_json::from_str(json)
            .map_err(|e| WebViewConfigError::InvalidJson(e.to_string()))?;
        config.validate()?;
        Ok(config)
    }

    fn validate(&self) -> Result<(), WebViewConfigError> {
        if self.label.is_empty() {
            return Err(WebViewConfigError::EmptyLabel);
        }
        if self.label != "remote-browser" {
            return Err(WebViewConfigError::LabelMustBeRemoteBrowser);
        }
        if self.session_id.is_empty() {
            return Err(WebViewConfigError::EmptySessionId);
        }
        if self.profile_isolation_key.is_empty() {
            return Err(WebViewConfigError::EmptyProfileIsolationKey);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn valid_config_json() -> String {
        serde_json::json!({
            "label": "remote-browser",
            "session_id": "sess-001",
            "profile_isolation_key": "active:pconn-001:active",
            "session_mode": "active",
            "navigation_policy": {
                "policy_type": "active",
                "allowed_domains": ["spaceship.com"],
                "allow_subpaths": true,
                "require_https": true
            },
            "download_policy": {"policy_type": "deny"},
            "upload_policy": {"policy_type": "deny"},
            "devtools_enabled": false,
            "javascript_enabled": true
        })
        .to_string()
    }

    #[test]
    fn valid_config_parses() {
        let config = WebViewConfig::from_json(&valid_config_json()).unwrap();
        assert_eq!(config.label, "remote-browser");
        assert_eq!(config.session_id, "sess-001");
        assert!(!config.devtools_enabled);
        assert!(config.javascript_enabled);
    }

    #[test]
    fn rejects_non_remote_browser_label() {
        let json = valid_config_json().replace("remote-browser", "local-app");
        assert!(matches!(
            WebViewConfig::from_json(&json),
            Err(WebViewConfigError::LabelMustBeRemoteBrowser)
        ));
    }

    #[test]
    fn rejects_empty_session_id() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_config_json()).unwrap();
        val["session_id"] = serde_json::json!("");
        assert!(matches!(
            WebViewConfig::from_json(&val.to_string()),
            Err(WebViewConfigError::EmptySessionId)
        ));
    }

    #[test]
    fn rejects_unknown_fields() {
        let mut val: serde_json::Value =
            serde_json::from_str(&valid_config_json()).unwrap();
        val["rogue"] = serde_json::json!(true);
        assert!(WebViewConfig::from_json(&val.to_string()).is_err());
    }

    #[test]
    fn snapshot_roundtrips() {
        let snapshot = WebViewSnapshot {
            label: "remote-browser".to_owned(),
            session_id: "sess-001".to_owned(),
            state: WebViewState::Ready,
            current_url: Some("https://spaceship.com".to_owned()),
            profile_isolation_key: "active:pconn-001:active".to_owned(),
        };
        let json = serde_json::to_string(&snapshot).unwrap();
        let parsed: WebViewSnapshot = serde_json::from_str(&json).unwrap();
        assert_eq!(snapshot, parsed);
    }
}
