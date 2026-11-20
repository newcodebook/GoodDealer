fn main() {
    println!("cargo:rerun-if-env-changed=CARGO_FEATURE_AFTERNIC_CONTROLLED_ACCEPTANCE");
    if std::env::var_os("CARGO_FEATURE_AFTERNIC_CONTROLLED_ACCEPTANCE").is_some() {
        // Cargo reports PROFILE=debug for profiles inheriting dev. Its artifact directory
        // retains the actual profile name, so those custom profiles must also be refused.
        let output = std::env::var_os("OUT_DIR").map(std::path::PathBuf::from);
        let debug_artifacts = output
            .as_deref()
            .and_then(|path| path.ancestors().nth(3))
            .and_then(std::path::Path::file_name)
            .is_some_and(|name| name == "debug");
        assert!(
            std::env::var("PROFILE").as_deref() == Ok("debug")
                && std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("linux")
                && debug_artifacts,
            "afternic-controlled-acceptance requires the Linux debug build profile"
        );
    }
}
