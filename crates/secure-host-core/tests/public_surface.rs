use gooddealer_secure_host_core::{
    CloudflareCredentialPublicKind, CloudflareCustodyComparison, CloudflareProviderClient,
    CloudflareProviderError, CloudflareProviderObservation, CloudflareProviderRecord,
    CloudflareProviderZone, CloudflareProviderZoneStatus, CloudflareRecordType,
    VerifiedLocalWorkspaceBindingParams,
};

fn name_cloudflare_proof_surface(
    _cloudflare_kind: Option<CloudflareCredentialPublicKind>,
    _custody_comparison: Option<CloudflareCustodyComparison>,
    _cloudflare_record_type: Option<CloudflareRecordType>,
) {
}

fn name_cloudflare_provider_surface(
    _client: Option<&CloudflareProviderClient>,
    _observation: Option<&CloudflareProviderObservation>,
    _zone: Option<&CloudflareProviderZone>,
    _record: Option<&CloudflareProviderRecord>,
    _error: Option<CloudflareProviderError>,
    _zone_status: Option<CloudflareProviderZoneStatus>,
) {
}

fn name_workspace_binding_params(_params: Option<&VerifiedLocalWorkspaceBindingParams<'_>>) {}

#[test]
fn external_consumer_can_compile_the_nonsecret_public_surface() {
    name_cloudflare_proof_surface(None, None, None);
    name_cloudflare_provider_surface(None, None, None, None, None, None);
    name_workspace_binding_params(None);
}

#[test]
fn gdbk_parser_key_registry_and_plaintext_port_are_not_public_exports() {
    let public_surface = include_str!("../src/lib.rs")
        .lines()
        .filter(|line| !line.trim_start().starts_with("//!"))
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "pub use backup_container",
        "DesktopBackupHost",
        "DesktopBackupExportSession",
        "DesktopBackupRestoreSession",
        "DesktopBackupExportStatus",
        "DesktopBackupRestoreStatus",
        "DesktopVerifiedBackupArtifact",
        "DesktopBackupError",
        "DesktopBackupBinding",
        "DesktopBackupCiphertext",
        "DesktopBackupContainer",
        "DesktopBackupExportInput",
        "ActiveBackupOperation",
        "BackupArtifactAdmission",
        "BackupExportOperation",
        "BackupOperationError",
        "SealedBackupFrame",
        "BackupContainerHost",
        "BackupKekRegistry",
        "BackupManifest",
        "ExportRequest",
        "SealedBackupArtifact",
        "VerifiedArtifact",
        "BindingDigests",
        "inspect_guarded",
        "load_installation",
    ] {
        assert!(
            !public_surface.contains(forbidden),
            "Host-private backup container symbol leaked: {forbidden}"
        );
    }
}

#[test]
fn database_key_custody_is_not_a_secure_host_core_capability() {
    let public_surface = include_str!("../src/lib.rs")
        .lines()
        .filter(|line| !line.trim_start().starts_with("//!"))
        .collect::<Vec<_>>()
        .join("\n");
    let source_files = std::fs::read_dir(concat!(env!("CARGO_MANIFEST_DIR"), "/src"))
        .expect("secure-host source directory")
        .map(|entry| {
            entry
                .expect("secure-host source entry")
                .file_name()
                .to_string_lossy()
                .into_owned()
        })
        .collect::<Vec<_>>();
    assert!(
        !source_files
            .iter()
            .any(|name| name == "local_database_key.rs")
    );
    for forbidden in [
        "mod local_database_key",
        "LocalDatabaseKeyError",
        "LocalDatabaseKeyMaterial",
        "LocalDatabaseSlot",
        "LocalDatabaseSlotKeyRef",
        "SlotKeyCapability",
        "generate_local_database_key",
        "generate_slot_key",
        "load_local_database_key",
        "load_slot_key",
        "retire_slot_key",
        "slot_key_capability",
    ] {
        assert!(
            !public_surface.contains(forbidden),
            "database-key capability leaked from secure-host-core: {forbidden}"
        );
    }
}
