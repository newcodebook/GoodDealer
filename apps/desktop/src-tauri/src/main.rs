#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod command_handlers;

fn main() {
    tauri::Builder::default()
        .manage(command_handlers::LocalBusinessRuntime::default())
        .invoke_handler(tauri::generate_handler![
            command_handlers::local_business_status,
            command_handlers::local_portfolio_read,
            command_handlers::local_domain_asset_upsert,
        ])
        .run(tauri::generate_context!())
        .expect("failed to run the GoodDealer desktop host");
}
