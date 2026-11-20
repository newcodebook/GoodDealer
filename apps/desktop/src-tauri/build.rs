#[expect(
    clippy::too_many_lines,
    reason = "the production IPC manifest enumerates each reviewed command at its declaration"
)]
fn main() {
    println!("cargo:rustc-check-cfg=cfg(afternic_controlled_debug_linux)");
    // PROFILE collapses every custom dev-derived profile to "debug". OUT_DIR retains
    // Cargo's actual artifact profile: <profile>/build/<package-hash>/out, including
    // cross-target builds. Both must identify the standard debug profile.
    let out_dir = std::env::var_os("OUT_DIR").expect("Cargo must provide OUT_DIR");
    let artifact_profile = std::path::Path::new(&out_dir)
        .ancestors()
        .nth(3)
        .and_then(std::path::Path::file_name);
    if artifact_profile == Some(std::ffi::OsStr::new("debug"))
        && std::env::var("PROFILE").as_deref() == Ok("debug")
        && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
    {
        println!("cargo:rustc-cfg=afternic_controlled_debug_linux");
    }
    // This manifest is the complete production IPC permission source.
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "afternic_connection_connect",
            "afternic_connection_revoke",
            "afternic_connection_status",
            "afternic_delist_approve",
            "afternic_delist_preview",
            "afternic_delist_status",
            "afternic_listing_plan_approve",
            "afternic_listing_plan_preview",
            "afternic_listing_plan_status",
            "afternic_listing_write_approve",
            "afternic_listing_write_preview",
            "afternic_listing_write_status",
            "afternic_inventory_refresh",
            "cloudflare_connection_activate",
            "cloudflare_connection_create",
            "cloudflare_connection_revoke",
            "cloudflare_connection_purge",
            "cloudflare_retirement_candidates",
            "cloudflare_zone_observe",
            "cloudflare_connection_status",
            "cloudflare_observation_read",
            "cloudflare_registrar_inventory_refresh",
            "spaceship_registrar_status",
            "spaceship_registrar_submit",
            "sellerhub_bin_price_approve",
            "sellerhub_bin_price_preview",
            "sellerhub_bin_price_status",
            "atom_standard_delist_approve",
            "atom_standard_delist_preview",
            "atom_standard_delist_status",
            "sellerhub_status",
            "sellerhub_submit",
            "aliyun_registrar_status",
            "aliyun_registrar_submit",
            "godaddy_registrar_status",
            "godaddy_registrar_submit",
            "cloudflare_registrar_account_status",
            "cloudflare_registrar_account_submit",
            "atom_marketplace_status",
            "atom_marketplace_submit",
            "sedo_marketplace_status",
            "sedo_marketplace_submit",
            "local_business_status",
            "local_device_lease_read",
            "device_directory_read",
            "device_self_report",
            "local_asset_library_read",
            "local_domain_detail_read",
            "local_dns_health_read",
            "local_settings_read",
            "local_sales_read",
            "local_renewals_read",
            "local_batch_operations_read",
            "local_history_read",
            "local_manual_tasks_read",
            "local_domain_asset_edit",
            "local_domain_asset_create",
            "local_domain_asset_delete",
            "local_domain_asset_provider_bind",
            "local_storage_repair",
            "local_conflict_center_read",
            "local_conflict_resolve",
            "local_sync_status",
            "device_switch_request",
            "device_switch_advance",
            "device_switch_status",
            "device_switch_cancel",
            "target_bootstrap_status",
            "target_bootstrap_cancel",
            "target_installation_start",
            "target_installation_status",
            "forced_takeover_reauthenticate",
            "forced_takeover_preview",
            "forced_takeover_confirm",
            "forced_takeover_status",
            "forced_takeover_cancel",
            "local_backup_restore_status",
            "local_backup_export",
            "local_backup_artifact_select",
            "local_backup_restore_begin",
            "local_portable_backup",
            "desktop_authentication_status",
            "desktop_authentication_begin",
            "desktop_authentication_refresh",
        ]),
    ))
    .expect("failed to run tauri-build");
}
