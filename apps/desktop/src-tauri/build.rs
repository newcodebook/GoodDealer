fn main() {
    // This manifest is the complete production IPC permission source.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "cloudflare_connection_activate",
            "cloudflare_zone_observe",
            "cloudflare_connection_status",
            "cloudflare_observation_read",
            "local_business_status",
            "local_asset_library_read",
            "local_domain_detail_read",
            "local_domain_asset_edit",
            "local_domain_asset_delete",
            "local_conflict_center_read",
            "local_conflict_resolve",
            "local_sync_status",
            "local_backup_restore_status",
            "local_backup_export",
            "local_backup_artifact_select",
            "local_backup_restore_begin",
            "desktop_authentication_status",
            "desktop_authentication_begin",
            "desktop_authentication_refresh",
        ]),
    ))
    .expect("failed to run tauri-build");
}
