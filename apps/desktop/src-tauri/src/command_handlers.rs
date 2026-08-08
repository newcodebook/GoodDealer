use gooddealer_secure_host_core::{RuntimeGate, RuntimeStatusSnapshot};
use tauri::State;

/// The only P0-05 app command. It is read-only and receives Host-owned state from Tauri rather
/// than accepting runtime authority from the `WebView`. Tauri's managed-state command extractor
/// intentionally passes the lightweight `State` handle by value.
#[tauri::command]
#[allow(clippy::needless_pass_by_value)]
pub(crate) fn runtime_status(runtime_gate: State<'_, RuntimeGate>) -> RuntimeStatusSnapshot {
    runtime_status_snapshot(&runtime_gate)
}

fn runtime_status_snapshot(runtime_gate: &RuntimeGate) -> RuntimeStatusSnapshot {
    runtime_gate.snapshot()
}

#[cfg(test)]
mod tests {
    use gooddealer_secure_host_core::RuntimeMode;

    use super::{RuntimeGate, runtime_status_snapshot};

    #[test]
    fn exposes_only_the_host_owned_locked_snapshot() {
        let snapshot = runtime_status_snapshot(&RuntimeGate::default());
        assert_eq!(snapshot.mode(), RuntimeMode::Locked);
        assert_eq!(snapshot.activation_purpose(), None);
    }
}
