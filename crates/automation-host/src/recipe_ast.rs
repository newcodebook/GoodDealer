//! Recipe AST for browser automation (P0-29).
//!
//! The [`RecipeStep`] enum is **closed**: `serde(deny_unknown_fields)` on every
//! variant rejects any JSON that does not match a known step type.
//!
//! ## Allowed steps (10)
//!
//! `Navigate`, `WaitForSelector`, `Click`, `FillField`, `SelectOption`,
//! `ExtractText`, `ExtractAttribute`, `Screenshot`, `WaitForNavigation`,
//! `AssertVisible`.
//!
//! ## Rejected node types (13)
//!
//! The following are intentionally excluded and will fail deserialization:
//! `FillPassword`, `FillCreditCard`, `FillSsn`, `ExecuteScript`, `SetCookie`,
//! `ReadCookie`, `ModifyHeader`, `InterceptRequest`, `FileUploadCredential`,
//! `ReadLocalStorage`, `WriteLocalStorage`, `AccessKeychain`, `InjectCredential`.
//!
//! ## `FillField` constraint (INV-AH-04)
//!
//! `FillField` only accepts `field_category = FieldCategory::BusinessField`.
//! The [`FieldCategory`] enum has exactly one variant, so serde enforces this
//! at the parse boundary.

// ---------------------------------------------------------------------------
// Field category
// ---------------------------------------------------------------------------

/// The category of a form field that `FillField` may target.
///
/// Only `BusinessField` is allowed — credential, payment, and identity fields
/// are excluded at the type level.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldCategory {
    /// A non-sensitive business-data field (e.g., domain name, contact email).
    BusinessField,
}

// ---------------------------------------------------------------------------
// Recipe step (closed enum — 10 allowed variants)
// ---------------------------------------------------------------------------

/// A single step in a browser automation recipe.
///
/// The enum is closed via `serde(tag = "step_type", deny_unknown_fields)` on
/// each variant's struct, ensuring that only the 10 allowed step types parse
/// successfully.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(tag = "step_type", rename_all = "snake_case")]
pub enum RecipeStep {
    /// Navigate the WebView to a URL.
    Navigate(NavigateStep),
    /// Wait for a CSS selector to appear in the DOM.
    WaitForSelector(WaitForSelectorStep),
    /// Click an element matched by a CSS selector.
    Click(ClickStep),
    /// Fill a form field.  Only `field_category = business_field` is accepted.
    FillField(FillFieldStep),
    /// Select an option from a `<select>` element.
    SelectOption(SelectOptionStep),
    /// Extract visible text from an element.
    ExtractText(ExtractTextStep),
    /// Extract an attribute value from an element.
    ExtractAttribute(ExtractAttributeStep),
    /// Take a screenshot of the current viewport.
    Screenshot(ScreenshotStep),
    /// Wait for a navigation event to complete.
    WaitForNavigation(WaitForNavigationStep),
    /// Assert that an element is visible in the viewport.
    AssertVisible(AssertVisibleStep),
}

// ---------------------------------------------------------------------------
// Step structs
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct NavigateStep {
    pub url: String,
    /// Optional timeout in milliseconds.
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct WaitForSelectorStep {
    pub selector: String,
    /// Timeout in milliseconds (default: 30 000).
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ClickStep {
    pub selector: String,
    /// Optional delay before click in milliseconds.
    pub delay_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct FillFieldStep {
    pub selector: String,
    pub value: String,
    /// Must be `business_field`.
    pub field_category: FieldCategory,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct SelectOptionStep {
    pub selector: String,
    pub value: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractTextStep {
    pub selector: String,
    /// Key under which the extracted text is stored in the step result.
    pub output_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ExtractAttributeStep {
    pub selector: String,
    pub attribute: String,
    /// Key under which the extracted value is stored in the step result.
    pub output_key: String,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct ScreenshotStep {
    /// Optional label for the screenshot artifact.
    pub label: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct WaitForNavigationStep {
    /// Timeout in milliseconds (default: 30 000).
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct AssertVisibleStep {
    pub selector: String,
}

// ---------------------------------------------------------------------------
// Recipe (ordered sequence of steps)
// ---------------------------------------------------------------------------

/// A recipe is an ordered sequence of automation steps with metadata.
#[derive(Debug, Clone, PartialEq, Eq, serde::Deserialize, serde::Serialize)]
#[serde(deny_unknown_fields)]
pub struct Recipe {
    pub recipe_id: String,
    pub provider: String,
    pub description: String,
    pub steps: Vec<RecipeStep>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum RecipeError {
    InvalidJson(String),
    EmptyRecipeId,
    EmptyProvider,
    EmptySteps,
}

impl std::fmt::Display for RecipeError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::InvalidJson(msg) => write!(f, "invalid recipe JSON: {msg}"),
            Self::EmptyRecipeId => write!(f, "recipe_id must not be empty"),
            Self::EmptyProvider => write!(f, "provider must not be empty"),
            Self::EmptySteps => write!(f, "recipe must have at least one step"),
        }
    }
}

impl std::error::Error for RecipeError {}

impl Recipe {
    /// Parse and validate from JSON.
    pub fn from_json(json: &str) -> Result<Self, RecipeError> {
        let recipe: Self =
            serde_json::from_str(json).map_err(|e| RecipeError::InvalidJson(e.to_string()))?;
        recipe.validate()?;
        Ok(recipe)
    }

    fn validate(&self) -> Result<(), RecipeError> {
        if self.recipe_id.is_empty() {
            return Err(RecipeError::EmptyRecipeId);
        }
        if self.provider.is_empty() {
            return Err(RecipeError::EmptyProvider);
        }
        if self.steps.is_empty() {
            return Err(RecipeError::EmptySteps);
        }
        Ok(())
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    // ── Allowed steps ────────────────────────────────────────────────

    #[test]
    fn navigate_step_parses() {
        let json = r#"{"step_type":"navigate","url":"https://spaceship.com","timeout_ms":5000}"#;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::Navigate(_)));
    }

    #[test]
    fn wait_for_selector_step_parses() {
        let json = r##"{"step_type":"wait_for_selector","selector":"#login-form","timeout_ms":10000}"##;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::WaitForSelector(_)));
    }

    #[test]
    fn click_step_parses() {
        let json = r#"{"step_type":"click","selector":"button.submit","delay_ms":100}"#;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::Click(_)));
    }

    #[test]
    fn fill_field_business_field_parses() {
        let json = r##"{"step_type":"fill_field","selector":"#domain","value":"example.com","field_category":"business_field"}"##;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::FillField(_)));
    }

    #[test]
    fn select_option_step_parses() {
        let json = r##"{"step_type":"select_option","selector":"#tld","value":".com"}"##;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::SelectOption(_)));
    }

    #[test]
    fn extract_text_step_parses() {
        let json = r#"{"step_type":"extract_text","selector":".price","output_key":"price"}"#;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::ExtractText(_)));
    }

    #[test]
    fn extract_attribute_step_parses() {
        let json = r#"{"step_type":"extract_attribute","selector":"a.link","attribute":"href","output_key":"url"}"#;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::ExtractAttribute(_)));
    }

    #[test]
    fn screenshot_step_parses() {
        let json = r#"{"step_type":"screenshot","label":"after-login"}"#;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::Screenshot(_)));
    }

    #[test]
    fn wait_for_navigation_step_parses() {
        let json = r#"{"step_type":"wait_for_navigation","timeout_ms":15000}"#;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::WaitForNavigation(_)));
    }

    #[test]
    fn assert_visible_step_parses() {
        let json = r##"{"step_type":"assert_visible","selector":"#dashboard"}"##;
        let step: RecipeStep = serde_json::from_str(json).unwrap();
        assert!(matches!(step, RecipeStep::AssertVisible(_)));
    }

    // ── Rejected node types (13 negative vectors) ────────────────────

    #[test]
    fn rejects_fill_password() {
        let json = r##"{"step_type":"fill_password","selector":"#pw","value":"secret"}"##;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_fill_credit_card() {
        let json = r##"{"step_type":"fill_credit_card","selector":"#cc","value":"4111111111111111"}"##;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_fill_ssn() {
        let json = r##"{"step_type":"fill_ssn","selector":"#ssn","value":"123-45-6789"}"##;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_execute_script() {
        let json = r#"{"step_type":"execute_script","code":"alert(1)"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_set_cookie() {
        let json = r#"{"step_type":"set_cookie","name":"sid","value":"abc"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_read_cookie() {
        let json = r#"{"step_type":"read_cookie","name":"sid"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_modify_header() {
        let json = r#"{"step_type":"modify_header","name":"Authorization","value":"Bearer x"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_intercept_request() {
        let json = r#"{"step_type":"intercept_request","pattern":"*"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_file_upload_credential() {
        let json = r#"{"step_type":"file_upload_credential","path":"/etc/passwd"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_read_local_storage() {
        let json = r#"{"step_type":"read_local_storage","key":"token"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_write_local_storage() {
        let json = r#"{"step_type":"write_local_storage","key":"token","value":"abc"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_access_keychain() {
        let json = r#"{"step_type":"access_keychain","entry":"api-key"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn rejects_inject_credential() {
        let json = r#"{"step_type":"inject_credential","target":"header","value":"Bearer x"}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    // ── FillField constraint ─────────────────────────────────────────

    #[test]
    fn fill_field_rejects_non_business_category() {
        let json = r##"{"step_type":"fill_field","selector":"#x","value":"v","field_category":"password"}"##;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn fill_field_rejects_credential_category() {
        let json = r##"{"step_type":"fill_field","selector":"#x","value":"v","field_category":"credential"}"##;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    // ── Unknown fields ───────────────────────────────────────────────

    #[test]
    fn navigate_rejects_unknown_fields() {
        let json = r#"{"step_type":"navigate","url":"https://x.com","rogue":true}"#;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    #[test]
    fn fill_field_rejects_unknown_fields() {
        let json = r##"{"step_type":"fill_field","selector":"#x","value":"v","field_category":"business_field","extra":1}"##;
        assert!(serde_json::from_str::<RecipeStep>(json).is_err());
    }

    // ── Recipe validation ────────────────────────────────────────────

    #[test]
    fn recipe_parses_valid() {
        let json = serde_json::json!({
            "recipe_id": "r-spaceship-list-domains",
            "provider": "spaceship",
            "description": "List all domains",
            "steps": [
                {"step_type": "navigate", "url": "https://spaceship.com/domains"},
                {"step_type": "wait_for_selector", "selector": ".domain-list"},
                {"step_type": "extract_text", "selector": ".domain-list", "output_key": "domains"}
            ]
        })
        .to_string();
        let recipe = Recipe::from_json(&json).unwrap();
        assert_eq!(recipe.recipe_id, "r-spaceship-list-domains");
        assert_eq!(recipe.steps.len(), 3);
    }

    #[test]
    fn recipe_rejects_empty_steps() {
        let json = serde_json::json!({
            "recipe_id": "r-empty",
            "provider": "spaceship",
            "description": "Empty recipe",
            "steps": []
        })
        .to_string();
        assert!(matches!(
            Recipe::from_json(&json),
            Err(RecipeError::EmptySteps)
        ));
    }

    #[test]
    fn recipe_rejects_unknown_step_type() {
        let json = serde_json::json!({
            "recipe_id": "r-bad",
            "provider": "spaceship",
            "description": "Bad",
            "steps": [{"step_type": "execute_script", "code": "alert(1)"}]
        })
        .to_string();
        assert!(Recipe::from_json(&json).is_err());
    }
}
