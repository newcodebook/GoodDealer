#![forbid(unsafe_code)]
#![recursion_limit = "256"]
//! Non-backup native capabilities for the Desktop adapter.
//!
//! `SQLCipher` database-key custody is owned wholly by `gooddealer-local-storage`; no database key,
//! slot, or key-lifecycle primitive is exposed from this crate.
//!
//! ```compile_fail
//! use gooddealer_secure_host_core::LocalDatabaseKeyMaterial;
//! ```
//! ```compile_fail
//! use gooddealer_secure_host_core::{LocalDatabaseSlot, LocalDatabaseSlotKeyRef};
//! ```
//! ```compile_fail
//! use gooddealer_secure_host_core::{generate_local_database_key, load_slot_key, retire_slot_key};
//! ```

mod cloudflare_capture;
mod cloudflare_keychain;
mod cloudflare_provider;
mod desktop_authorization_verifier;
mod desktop_device_identity;
mod desktop_oauth;
mod local_workspace_binding;

pub use cloudflare_capture::{CloudflareCandidate, CloudflareCapture, CloudflareCaptureError};
pub use cloudflare_keychain::{
    CloudflareCredentialProvisionPlan, CloudflareCredentialPublicKind,
    CloudflareCredentialRecoveryPlan, CloudflareCustodyComparison, CloudflareKeychainError,
    CloudflareKeychainGuard, CloudflarePrewriteFailure, CloudflarePrewriteInspection,
    inspect_cloudflare_recovery_guarded, publish_cloudflare_candidate_guarded,
};
pub use cloudflare_provider::{
    CloudflareCredentialObservationPlan, CloudflareProviderClient, CloudflareProviderError,
    CloudflareProviderGuard, CloudflareProviderObservation, CloudflareProviderRecord,
    CloudflareProviderZone, CloudflareProviderZoneStatus, CloudflareRecordType,
};
pub use desktop_authorization_verifier::{
    AuthorizationVerificationKeyError, DesktopAuthorizationCredentialPurpose,
    DesktopAuthorizationVerificationKey, DesktopAuthorizationVerifier,
    parse_desktop_authorization_verifier_registry,
};
pub use desktop_device_identity::{
    DESKTOP_DEVICE_PROOF_DOMAIN, DesktopDeviceIdentity, DesktopDeviceIdentityError,
    DesktopDeviceProofTranscript, load_or_create_desktop_device_identity,
};
pub use desktop_oauth::{
    DesktopAccessToken, DesktopAuthorizationCodeExchange, DesktopOAuthAttempt,
    DesktopOAuthContinuation, DesktopOAuthError, DesktopRefreshRequestId, DesktopRefreshToken,
    clear_desktop_refresh_request_id, clear_desktop_refresh_token, load_desktop_refresh_request_id,
    load_desktop_refresh_token, store_desktop_refresh_request_id, store_desktop_refresh_token,
};
pub use local_workspace_binding::{
    LocalWorkspaceBindingError, VerifiedLocalWorkspaceBinding, VerifiedLocalWorkspaceBindingParams,
    clear_verified_local_workspace_binding, load_verified_local_workspace_binding,
    store_verified_local_workspace_binding,
};
