use std::any::TypeId;

use gooddealer_secure_host_core::RuntimeMode;

#[must_use]
pub fn webview_runtime_marker() -> TypeId {
    TypeId::of::<wry::WebView>()
}

#[must_use]
pub const fn automation_is_allowed(mode: RuntimeMode) -> bool {
    matches!(mode, RuntimeMode::Active)
}
