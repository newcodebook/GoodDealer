#![cfg_attr(
    all(not(debug_assertions), not(feature = "sqlcipher-bundle-spike")),
    windows_subsystem = "windows"
)]

mod command_handlers;

fn main() {
    #[cfg(feature = "sqlcipher-bundle-spike")]
    if run_sqlcipher_bundle_spike_if_requested() {
        return;
    }

    tauri::Builder::default()
        .manage(gooddealer_secure_host_core::RuntimeGate::default())
        .invoke_handler(tauri::generate_handler![command_handlers::runtime_status])
        .run(tauri::generate_context!())
        .expect("failed to run the GoodDealer desktop host");
}

#[cfg(feature = "sqlcipher-bundle-spike")]
fn run_sqlcipher_bundle_spike_if_requested() -> bool {
    use std::path::Path;

    let mut arguments = std::env::args_os().skip(1);
    let Some(command) = arguments.next() else {
        return false;
    };
    if command != "--sqlcipher-bundle-spike-report" {
        return false;
    }
    let output_path = arguments
        .next()
        .expect("--sqlcipher-bundle-spike-report requires an output path");
    assert!(
        arguments.next().is_none(),
        "SQLCipher bundle spike accepts exactly one output path"
    );
    gooddealer_local_storage::write_sqlcipher_bundle_spike_report(Path::new(&output_path))
        .expect("SQLCipher bundle spike probe failed");
    true
}
