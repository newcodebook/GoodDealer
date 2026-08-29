#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg_attr(
    not(test),
    allow(
        dead_code,
        reason = "remove when the native Cloud transport and signing-key distribution compose the grant verifier"
    )
)]
mod authorization;
mod command_handlers;
mod host_storage;

use tauri::Manager;

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_root = app.path().app_data_dir()?;
            let storage = host_storage::HostStorageBootstrap::initialize(
                &app_data_root,
                &host_storage::NativeDatabaseKeyStore,
            )?;
            app.manage(command_handlers::LocalBusinessRuntime::new(storage));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            command_handlers::local_business_status,
            command_handlers::local_portfolio_read,
            command_handlers::local_domain_asset_upsert,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the GoodDealer desktop host");
}
