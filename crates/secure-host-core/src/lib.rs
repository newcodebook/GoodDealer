#![deny(unsafe_code)]
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

#[cfg(windows)]
mod windows_credential_capture;
#[cfg(windows)]
mod windows_custody;
#[cfg(all(test, not(windows)))]
#[path = "windows_custody/format.rs"]
mod windows_custody_format_tests;
#[cfg(windows)]
mod windows_private_files;
#[cfg(all(test, not(windows)))]
#[path = "windows_private_files/protected_acl.rs"]
mod windows_protected_acl_tests;

mod afternic_credentials;
mod afternic_provider;
mod afternic_wire;
mod aliyun;
mod atom;
mod cloudflare_capture;
mod cloudflare_keychain;
mod cloudflare_provider;
mod desktop_authorization_verifier;
mod desktop_device_directory;
mod desktop_device_identity;
mod desktop_oauth;
mod godaddy;
#[cfg(target_os = "linux")]
mod linux_credential_capture;
mod local_workspace_binding;
#[cfg(target_os = "macos")]
mod macos_pair_capture;
mod provider_credential_slot;
#[cfg(target_os = "linux")]
mod secret_service_custody;
mod spaceship;

pub use aliyun::{
    AliyunCapture, AliyunCredential, AliyunCredentialPlan, AliyunError, AliyunGuard,
    AliyunRegistrarClient, AliyunRegistration, load_aliyun_credential_guarded,
    publish_aliyun_credential_guarded, purge_aliyun_credential_guarded,
};

pub use atom::{
    AtomCapture, AtomCredential, AtomCredentialPlan, AtomError, AtomGuard, AtomListing,
    AtomListingState, AtomPortfolioClient, AtomSellerInventory, load_atom_credential_guarded,
    publish_atom_credential_guarded, purge_atom_credential_guarded,
};

pub use godaddy::{
    GoDaddyCapture, GoDaddyCredential, GoDaddyCredentialPlan, GoDaddyError, GoDaddyGuard,
    GoDaddyRegistrarClient, GoDaddyRegistration, GoDaddyRegistrationStanding,
    load_godaddy_credential_guarded, publish_godaddy_credential_guarded,
    purge_godaddy_credential_guarded,
};

pub use spaceship::{
    SpaceshipCapture, SpaceshipCredential, SpaceshipCredentialPlan, SpaceshipError, SpaceshipGuard,
    SpaceshipRegistrarClient, SpaceshipRegistration, SpaceshipRegistrationStanding,
    load_spaceship_credential_guarded, publish_spaceship_credential_guarded,
    purge_spaceship_credential_guarded,
};

pub use afternic_credentials::{
    AfternicCapture, AfternicCredential, AfternicCredentialPlan, load_afternic_credential_guarded,
    publish_afternic_credential_guarded, purge_afternic_credential_guarded,
};
pub use afternic_provider::{
    AfternicDomainObservation, AfternicError, AfternicGuard, AfternicListing,
    AfternicListingFields, AfternicListingIntent, AfternicListingStatus, AfternicPortfolio,
    AfternicProviderClient, AfternicWriteOutcome,
};
pub use cloudflare_capture::{CloudflareCandidate, CloudflareCapture, CloudflareCaptureError};
pub use cloudflare_keychain::{
    CloudflareCredentialProvisionPlan, CloudflareCredentialPublicKind,
    CloudflareCredentialRecoveryPlan, CloudflareCredentialRetirementPlan,
    CloudflareCustodyComparison, CloudflareKeychainError, CloudflareKeychainGuard,
    CloudflarePrewriteFailure, CloudflarePrewriteInspection, CloudflarePurgeOutcome,
    inspect_cloudflare_recovery_guarded, publish_cloudflare_candidate_guarded,
    publish_cloudflare_tombstone_guarded, purge_retired_cloudflare_slot,
};
pub use cloudflare_provider::{
    CloudflareCredentialObservationPlan, CloudflareProviderClient, CloudflareProviderError,
    CloudflareProviderGuard, CloudflareProviderObservation, CloudflareProviderRecord,
    CloudflareProviderZone, CloudflareProviderZoneStatus, CloudflareRecordType,
    CloudflareRegistrarCredential, CloudflareRegistrarCredentialError,
    CloudflareRegistrarCredentialGuard, CloudflareRegistrarCredentialPlan, CloudflareRegistration,
    CloudflareRegistrationInventory, CloudflareRegistrationStanding,
    load_cloudflare_registrar_credential, publish_cloudflare_registrar_credential,
    purge_cloudflare_registrar_credential,
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

pub use desktop_device_directory::{
    DesktopDeviceDirectory, DeviceDirectoryRejected, parse_desktop_device_directory,
    prepare_desktop_device_self_report,
};

mod native_power;
pub use native_power::{
    NativePowerCommitGuard, NativePowerGate, NativePowerMonitor, NativePowerSnapshot,
    NativePowerUnavailable,
};

mod native_continuous_clock;
pub use native_continuous_clock::{
    NativeContinuousClockError, NativeContinuousClockKind, NativeContinuousClockSample,
    capture_native_continuous_clock,
};
