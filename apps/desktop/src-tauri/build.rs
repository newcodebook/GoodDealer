fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "local_business_status",
            "local_portfolio_read",
            "local_domain_asset_upsert",
        ]),
    ))
    .expect("failed to run tauri-build");
}
