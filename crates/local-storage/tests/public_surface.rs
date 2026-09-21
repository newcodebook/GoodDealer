use gooddealer_local_storage::{
    AssetLibraryReadSnapshot, AssetLibraryRow, AssetLibraryWindow, DesktopApplicationRoot,
    DesktopApplicationRootError, DesktopAssetLibraryReadRequest, DesktopBackupError,
    DesktopBackupExportStatus, DesktopBackupRestoreStatus, DesktopConflict,
    DesktopConflictCenterView, DesktopConflictFreshness, DesktopConflictResolveRequest,
    DesktopDomainAssetDeleteRequest, DesktopDomainAssetEditRequest, DesktopDomainAssetWrite,
    DesktopDomainDetailReadRequest, DesktopHostAuthorizationStatus, DesktopLocalBusinessState,
    DesktopLocalBusinessStatus, DesktopLocalHost, DesktopLocalHostError,
    DesktopVerifiedBackupArtifact, DomainAssetMutationReceipt, DomainDetailAsset,
    DomainDetailReadSnapshot, Money, PortfolioReadFreshness,
};

fn name<T>() {}

#[test]
fn dependent_crate_can_name_only_the_reviewed_local_host_contract() {
    name::<DesktopApplicationRoot>();
    name::<DesktopApplicationRootError>();
    name::<DesktopLocalHost>();
    name::<DesktopLocalHostError>();
    name::<DesktopHostAuthorizationStatus>();
    name::<DesktopLocalBusinessState>();
    name::<DesktopLocalBusinessStatus>();
    name::<DesktopBackupError>();
    name::<DesktopBackupExportStatus>();
    name::<DesktopBackupRestoreStatus>();
    name::<DesktopVerifiedBackupArtifact>();
    name::<DesktopAssetLibraryReadRequest>();
    name::<DesktopDomainDetailReadRequest>();
    name::<DesktopDomainAssetEditRequest>();
    name::<DesktopDomainAssetDeleteRequest>();
    name::<DesktopDomainAssetWrite>();
    name::<DesktopConflictResolveRequest>();
    name::<AssetLibraryReadSnapshot>();
    name::<AssetLibraryRow>();
    name::<AssetLibraryWindow>();
    name::<DomainDetailReadSnapshot>();
    name::<DomainDetailAsset>();
    name::<PortfolioReadFreshness>();
    name::<Money>();
    name::<DomainAssetMutationReceipt>();
    name::<DesktopConflictCenterView>();
    name::<DesktopConflictFreshness>();
    name::<DesktopConflict>();
}

#[test]
fn rebootstrap_backends_fakes_capabilities_and_evidence_are_not_root_exports() {
    let public_surface = include_str!("../src/lib.rs")
        .lines()
        .filter(|line| !line.trim_start().starts_with("//!"))
        .collect::<Vec<_>>()
        .join("\n");
    for forbidden in [
        "pub mod desktop_custody",
        "pub mod rebootstrap_runtime",
        "pub use desktop_custody",
        "pub use rebootstrap_runtime",
    ] {
        assert!(
            !public_surface.contains(forbidden),
            "private rebootstrap implementation leaked through the crate root: {forbidden}"
        );
    }
}
