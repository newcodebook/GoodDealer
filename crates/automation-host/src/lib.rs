use std::any::TypeId;

use gooddealer_secure_host_core::RuntimeMode;

// P0-28: Policy modules
pub mod download_policy;
pub mod navigation_policy;
pub mod upload_policy;

// P0-27: Session context
pub mod session;

// P0-28: Profile
pub mod profile;

// P0-29: Recipe AST, injection, callback, webview, evidence
pub mod callback_handler;
pub mod evidence;
pub mod injection;
pub mod recipe_ast;
pub mod webview_manager;

// P0-30: Ticket consumer
pub mod ticket_consumer;

#[must_use]
pub fn webview_runtime_marker() -> TypeId {
    TypeId::of::<wry::WebView>()
}

#[must_use]
pub const fn automation_is_allowed(mode: RuntimeMode) -> bool {
    matches!(mode, RuntimeMode::Active)
}
