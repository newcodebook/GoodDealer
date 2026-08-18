//! Callback handler contract for browser automation (P0-29).
//!
//! Defines the typed callback messages that the automation WebView may send
//! back to the host during recipe execution.  The callback surface is closed:
//! only the variants in [`AutomationCallback`] are accepted.

use crate::recipe_ast::RecipeStep;

/// Result of executing a single recipe step.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct StepResult {
    /// Zero-based index of the step in the recipe.
    pub step_index: u32,
    /// The step that produced this result.
    pub step: RecipeStep,
    /// Whether the step succeeded.
    pub success: bool,
    /// Extracted values (for `ExtractText` / `ExtractAttribute`), if any.
    pub extracted: Option<std::collections::BTreeMap<String, String>>,
    /// Error message, if the step failed.
    pub error: Option<String>,
    /// Duration of the step in milliseconds.
    pub duration_ms: u64,
}

/// Automation callback messages from the WebView to the host.
///
/// The enum is closed: only these callback types are accepted by the host.
/// Any other message from the WebView is dropped.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "callback_type", rename_all = "snake_case", deny_unknown_fields)]
pub enum AutomationCallback {
    /// A recipe step completed (success or failure).
    StepCompleted {
        session_id: String,
        result: StepResult,
    },
    /// The entire recipe finished.
    RecipeCompleted {
        session_id: String,
        recipe_id: String,
        success: bool,
        total_steps: u32,
        failed_steps: u32,
        total_duration_ms: u64,
    },
    /// A navigation event occurred.
    NavigationEvent {
        session_id: String,
        url: String,
        /// Whether the navigation was blocked by policy.
        blocked: bool,
    },
    /// The WebView encountered an unrecoverable error.
    FatalError {
        session_id: String,
        message: String,
    },
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CallbackError {
    InvalidJson(String),
    EmptySessionId,
}

impl std::fmt::Display for CallbackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid callback JSON: {msg}"),
            Self::EmptySessionId => write!(f, "session_id must not be empty"),
        }
    }
}

impl std::error::Error for CallbackError {}

/// Parse and validate a callback from JSON.
pub fn parse_callback(json: &str) -> Result<AutomationCallback, CallbackError> {
    let cb: AutomationCallback =
        serde_json::from_str(json).map_err(|e| CallbackError::InvalidJson(e.to_string()))?;
    let session_id = match &cb {
        AutomationCallback::StepCompleted { session_id, .. }
        | AutomationCallback::RecipeCompleted { session_id, .. }
        | AutomationCallback::NavigationEvent { session_id, .. }
        | AutomationCallback::FatalError { session_id, .. } => session_id,
    };
    if session_id.is_empty() {
        return Err(CallbackError::EmptySessionId);
    }
    Ok(cb)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn step_completed_callback_parses() {
        let json = serde_json::json!({
            "callback_type": "step_completed",
            "session_id": "sess-001",
            "result": {
                "step_index": 0,
                "step": {"step_type": "navigate", "url": "https://spaceship.com"},
                "success": true,
                "extracted": null,
                "error": null,
                "duration_ms": 1200
            }
        })
        .to_string();
        let cb = parse_callback(&json).unwrap();
        assert!(matches!(cb, AutomationCallback::StepCompleted { .. }));
    }

    #[test]
    fn recipe_completed_callback_parses() {
        let json = serde_json::json!({
            "callback_type": "recipe_completed",
            "session_id": "sess-001",
            "recipe_id": "r-001",
            "success": true,
            "total_steps": 3,
            "failed_steps": 0,
            "total_duration_ms": 5000
        })
        .to_string();
        let cb = parse_callback(&json).unwrap();
        assert!(matches!(cb, AutomationCallback::RecipeCompleted { .. }));
    }

    #[test]
    fn navigation_event_callback_parses() {
        let json = serde_json::json!({
            "callback_type": "navigation_event",
            "session_id": "sess-001",
            "url": "https://spaceship.com/dashboard",
            "blocked": false
        })
        .to_string();
        let cb = parse_callback(&json).unwrap();
        assert!(matches!(cb, AutomationCallback::NavigationEvent { .. }));
    }

    #[test]
    fn fatal_error_callback_parses() {
        let json = serde_json::json!({
            "callback_type": "fatal_error",
            "session_id": "sess-001",
            "message": "WebView crashed"
        })
        .to_string();
        let cb = parse_callback(&json).unwrap();
        assert!(matches!(cb, AutomationCallback::FatalError { .. }));
    }

    #[test]
    fn rejects_unknown_callback_type() {
        let json = r#"{"callback_type":"steal_cookies","session_id":"sess-001"}"#;
        assert!(parse_callback(json).is_err());
    }

    #[test]
    fn rejects_empty_session_id() {
        let json = serde_json::json!({
            "callback_type": "fatal_error",
            "session_id": "",
            "message": "oops"
        })
        .to_string();
        assert!(matches!(
            parse_callback(&json),
            Err(CallbackError::EmptySessionId)
        ));
    }

    #[test]
    fn rejects_unknown_fields() {
        let json = serde_json::json!({
            "callback_type": "fatal_error",
            "session_id": "sess-001",
            "message": "oops",
            "rogue": true
        })
        .to_string();
        assert!(parse_callback(&json).is_err());
    }
}
