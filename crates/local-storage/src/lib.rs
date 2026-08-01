use gooddealer_secure_host_core::RuntimeMode;

#[must_use]
pub const fn storage_is_mountable(mode: RuntimeMode) -> bool {
    matches!(
        mode,
        RuntimeMode::Activating | RuntimeMode::Active | RuntimeMode::Draining
    )
}

#[cfg(test)]
mod tests {
    use gooddealer_secure_host_core::RuntimeMode;

    use super::storage_is_mountable;

    #[test]
    fn locked_and_standby_cannot_mount_active_storage() {
        assert!(!storage_is_mountable(RuntimeMode::Locked));
        assert!(!storage_is_mountable(RuntimeMode::Standby));
    }
}
