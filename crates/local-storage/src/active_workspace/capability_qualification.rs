//! The Host's ADR-0024 qualification register: the Provider capabilities that have passed their
//! qualification review and may execute.
//!
//! It is empty because no capability is qualified yet. Every path that would reach a Provider for
//! a capability, and every read that reports whether one can run, consults this register, so a
//! Renderer or IPC caller cannot reach an unqualified capability and no surface infers
//! availability from credential state. Withdrawing access (revoking a credential) and recovering
//! an interrupted credential write never consult it: they only reduce what the Host holds.
//!
//! Qualifying a capability is a reviewed change to this list, never a runtime toggle, and each
//! entry names the repository evidence that qualified it. Identifiers are
//! `platform:role:capability`, the form the commercial Grant uses.

/// One qualified capability and the path of the evidence that qualified it.
#[allow(
    dead_code,
    reason = "entries arrive only with a reviewed qualification; the register test reads evidence"
)]
struct Qualification {
    capability: &'static str,
    evidence: &'static str,
}

/// Capabilities that passed ADR-0024 qualification. Empty: none has yet.
const QUALIFIED_CAPABILITIES: &[Qualification] = &[];

/// Cloudflare Zone/DNS read-only observation, including the credential activation it needs.
pub(crate) const CLOUDFLARE_DNS_OBSERVE: &str = "cloudflare:dns:observe";

/// Whether one capability may execute.
pub(crate) fn capability_qualified(capability: &str) -> bool {
    qualified().any(|qualified| qualified == capability)
}

/// Whether any capability of a platform's role may execute; used by reads that report per role.
pub(crate) fn role_qualified(platform: &str, role: &str) -> bool {
    qualified().any(|capability| {
        let mut parts = capability.splitn(3, ':');
        parts.next() == Some(platform) && parts.next() == Some(role)
    })
}

#[cfg(not(test))]
fn qualified() -> impl Iterator<Item = &'static str> {
    QUALIFIED_CAPABILITIES.iter().map(|entry| entry.capability)
}

#[cfg(test)]
fn qualified() -> impl Iterator<Item = &'static str> {
    let overrides = test_qualification::current();
    QUALIFIED_CAPABILITIES
        .iter()
        .map(|entry| entry.capability)
        .chain(overrides)
}

/// Test-only qualification, scoped to the current thread and released when the guard drops, so
/// Host success paths stay tested while the production register is still empty.
#[cfg(test)]
pub(crate) mod test_qualification {
    use std::cell::RefCell;

    thread_local! {
        static QUALIFIED: RefCell<Vec<&'static str>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) struct Guard(&'static str);

    impl Drop for Guard {
        fn drop(&mut self) {
            QUALIFIED.with(|qualified| {
                let mut qualified = qualified.borrow_mut();
                if let Some(index) = qualified.iter().position(|entry| *entry == self.0) {
                    qualified.remove(index);
                }
            });
        }
    }

    pub(crate) fn qualify(capability: &'static str) -> Guard {
        QUALIFIED.with(|qualified| qualified.borrow_mut().push(capability));
        Guard(capability)
    }

    pub(super) fn current() -> Vec<&'static str> {
        QUALIFIED.with(|qualified| qualified.borrow().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nothing_is_qualified_before_its_review() {
        assert!(QUALIFIED_CAPABILITIES.is_empty());
        assert!(!capability_qualified(CLOUDFLARE_DNS_OBSERVE));
        for platform in super::super::launch_platforms::LAUNCH_PLATFORMS {
            for role in ["registrar", "dns", "marketplace", "acquisition"] {
                assert!(!role_qualified(platform, role), "{platform}:{role}");
            }
        }
        assert!(!capability_qualified(""));
        assert!(!role_qualified("cloudflare", ""));
    }

    #[test]
    fn every_qualification_names_existing_evidence() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        for entry in QUALIFIED_CAPABILITIES {
            assert_eq!(
                entry.capability.split(':').count(),
                3,
                "{}",
                entry.capability
            );
            assert!(
                evidence_is_under_docs(entry.evidence),
                "{}",
                entry.capability
            );
            assert!(
                root.join(entry.evidence).is_file(),
                "{} has no evidence",
                entry.capability
            );
        }
        for escaping in [
            "docs/../Cargo.toml",
            "../docs/x.md",
            "/docs/x.md",
            "docs/",
            "docs\\x.md",
        ] {
            assert!(!evidence_is_under_docs(escaping), "{escaping}");
        }
        assert!(evidence_is_under_docs("docs/qualification/cloudflare.md"));
    }

    /// Evidence is a plain relative path inside `docs/`: no parent, root or empty segment can
    /// point it at a file the qualification review never looked at.
    fn evidence_is_under_docs(path: &str) -> bool {
        let mut segments = path.split('/');
        segments.next() == Some("docs")
            && path.len() > "docs/".len()
            && !path.contains('\\')
            && segments.all(|segment| !segment.is_empty() && segment != "." && segment != "..")
    }

    #[test]
    fn test_qualification_is_scoped_to_its_guard() {
        {
            let _guard = test_qualification::qualify(CLOUDFLARE_DNS_OBSERVE);
            assert!(capability_qualified(CLOUDFLARE_DNS_OBSERVE));
            assert!(role_qualified("cloudflare", "dns"));
            assert!(!role_qualified("cloudflare", "registrar"));
        }
        assert!(!capability_qualified(CLOUDFLARE_DNS_OBSERVE));
    }
}
