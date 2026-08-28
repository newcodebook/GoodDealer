#![recursion_limit = "256"]

// Removal condition: delete these dead-code allowances when a signed native
// engine gate permits the Desktop composition root to consume the private seam.
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod browser_runtime;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod download_policy;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod engine;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod navigation_policy;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod permission_policy;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod popup_policy;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod profile;
#[allow(
    dead_code,
    reason = "portable foundation is intentionally production-uncomposed"
)]
mod session;

pub mod recipe_ast;
pub mod ticket_consumer;

/// Production browser automation is deliberately unavailable until the native
/// WebView2/WKWebView gate has signed platform evidence.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BrowserEngineAvailability {
    Unavailable,
}

#[must_use]
pub fn browser_engine_availability() -> BrowserEngineAvailability {
    engine::production_availability()
}
