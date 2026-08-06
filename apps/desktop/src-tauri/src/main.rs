#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod command_handlers;

fn main() {
    tauri::Builder::default()
        .manage(gooddealer_secure_host_core::RuntimeGate::default())
        .invoke_handler(tauri::generate_handler![command_handlers::runtime_status])
        .run(tauri::generate_context!())
        .expect("failed to run the GoodDealer desktop host");
}
