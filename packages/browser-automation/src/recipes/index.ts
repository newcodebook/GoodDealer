/**
 * Recipe contract status.
 *
 * Unblocked by W4 (P0-29): the Rust-side RecipeStep AST is now defined in
 * `crates/automation-host/src/recipe_ast.rs`.  The TypeScript recipe layer
 * mirrors the allowed step types without re-implementing the closed enum —
 * the Rust AST is the authoritative parse boundary.
 */
export const recipeContractStatus = "ast-defined" as const;

/**
 * Allowed recipe step types — mirrors the 10 variants in the Rust
 * `RecipeStep` enum.  The TypeScript side uses these for recipe authoring
 * and display; the Rust side is the enforcement boundary.
 */
export const ALLOWED_STEP_TYPES = [
  "navigate",
  "wait_for_selector",
  "click",
  "fill_field",
  "select_option",
  "extract_text",
  "extract_attribute",
  "screenshot",
  "wait_for_navigation",
  "assert_visible",
] as const;

export type AllowedStepType = (typeof ALLOWED_STEP_TYPES)[number];

/**
 * Rejected step types — these are intentionally excluded from the Rust AST
 * and will fail deserialization.  Listed here for documentation and test
 * coverage on the TypeScript side.
 */
export const REJECTED_STEP_TYPES = [
  "fill_password",
  "fill_credit_card",
  "fill_ssn",
  "execute_script",
  "set_cookie",
  "read_cookie",
  "modify_header",
  "intercept_request",
  "file_upload_credential",
  "read_local_storage",
  "write_local_storage",
  "access_keychain",
  "inject_credential",
] as const;

export type RejectedStepType = (typeof REJECTED_STEP_TYPES)[number];

/**
 * The only allowed field category for `fill_field` steps.
 * Credential, payment, and identity field categories are rejected at the
 * Rust parse boundary.
 */
export const ALLOWED_FIELD_CATEGORY = "business_field" as const;
