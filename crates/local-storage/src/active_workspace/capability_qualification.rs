//! The Host's ADR-0027 qualification register: the Provider capabilities that have passed their
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
//! `platform:role:capability`. Technical sub-capabilities do not add commercial Grant rights.

/// One qualified capability and the path of the evidence that qualified it.
#[allow(
    dead_code,
    reason = "entries arrive only with a reviewed qualification; the register test reads evidence"
)]
struct Qualification {
    capability: &'static str,
    evidence: &'static str,
    target_os: Option<&'static str>,
}

/// Capabilities that passed ADR-0027 qualification. Empty: none has yet.
const QUALIFIED_CAPABILITIES: &[Qualification] = &[];

/// Cloudflare Zone/DNS read-only observation, including the credential activation it needs.
pub(crate) const CLOUDFLARE_DNS_OBSERVE: &str = "cloudflare:dns:observe";

pub(crate) const CLOUDFLARE_REGISTRAR_OBSERVE: &str = "cloudflare:registrar:observe";
pub(crate) const ALIYUN_REGISTRAR_OBSERVE: &str = "aliyun:registrar:observe";
pub(crate) const GODADDY_REGISTRAR_OBSERVE: &str = "godaddy:registrar:observe";
pub(crate) const PORKBUN_REGISTRAR_OBSERVE: &str = "porkbun:registrar:observe";
pub(crate) const ATOM_MARKETPLACE_OBSERVE: &str = "atom:marketplace:observe";
pub(crate) const ATOM_MARKETPLACE_WRITE: &str = "atom:marketplace:write";
pub(crate) const SEDO_MARKETPLACE_OBSERVE: &str = "sedo:marketplace:observe";
pub(crate) const SPACESHIP_MARKETPLACE_OBSERVE: &str = "spaceship:marketplace:observe";
pub(crate) const SPACESHIP_MARKETPLACE_CREATE: &str = "spaceship:marketplace:create-listing";
pub(crate) const SPACESHIP_MARKETPLACE_WRITE: &str = "spaceship:marketplace:write";
pub(crate) const SPACESHIP_REGISTRAR_OBSERVE: &str = "spaceship:registrar:observe";

/// Separately reviewed technical admission; the commercial Grant still uses observe/write.
pub(crate) const AFTERNIC_OWNERSHIP_REVIEW: &str = "afternic:marketplace:ownership-review";

fn applies(capability: &str, target_os: Option<&str>) -> bool {
    match target_os {
        Some(target) => target == std::env::consts::OS,
        None => capability != AFTERNIC_OWNERSHIP_REVIEW,
    }
}

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
    QUALIFIED_CAPABILITIES
        .iter()
        .filter(|entry| applies(entry.capability, entry.target_os))
        .map(|entry| entry.capability)
}

#[cfg(test)]
fn qualified() -> impl Iterator<Item = &'static str> {
    let overrides = test_qualification::current();
    QUALIFIED_CAPABILITIES
        .iter()
        .filter(|entry| applies(entry.capability, entry.target_os))
        .map(|entry| entry.capability)
        .chain(
            overrides
                .into_iter()
                .filter(|(capability, os)| applies(capability, *os))
                .map(|(capability, _)| capability),
        )
}

/// Test-only qualification, scoped to the current thread and released when the guard drops, so
/// Host success paths stay tested while the production register is still empty.
#[cfg(test)]
pub(crate) mod test_qualification {
    use std::cell::RefCell;

    thread_local! {
        static QUALIFIED: RefCell<Vec<(&'static str, Option<&'static str>)>> = const { RefCell::new(Vec::new()) };
    }

    pub(crate) struct Guard((&'static str, Option<&'static str>));

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
        qualify_for_target(capability, None)
    }

    pub(crate) fn qualify_for_target(
        capability: &'static str,
        target_os: Option<&'static str>,
    ) -> Guard {
        QUALIFIED.with(|qualified| qualified.borrow_mut().push((capability, target_os)));
        Guard((capability, target_os))
    }

    pub(super) fn current() -> Vec<(&'static str, Option<&'static str>)> {
        QUALIFIED.with(|qualified| qualified.borrow().clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ownership_review_requires_evidence_for_the_exact_target() {
        let _commercial = test_qualification::qualify("afternic:marketplace:write");
        let _unscoped = test_qualification::qualify(AFTERNIC_OWNERSHIP_REVIEW);
        assert!(!capability_qualified(AFTERNIC_OWNERSHIP_REVIEW));
        let wrong = if std::env::consts::OS == "windows" {
            "macos"
        } else {
            "windows"
        };
        let _wrong = test_qualification::qualify_for_target(AFTERNIC_OWNERSHIP_REVIEW, Some(wrong));
        assert!(!capability_qualified(AFTERNIC_OWNERSHIP_REVIEW));
        {
            let _exact = test_qualification::qualify_for_target(
                AFTERNIC_OWNERSHIP_REVIEW,
                Some(std::env::consts::OS),
            );
            assert!(capability_qualified(AFTERNIC_OWNERSHIP_REVIEW));
        }
        assert!(!capability_qualified(AFTERNIC_OWNERSHIP_REVIEW));
    }

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
            if entry.capability == AFTERNIC_OWNERSHIP_REVIEW {
                assert!(matches!(
                    entry.target_os,
                    Some("windows" | "macos" | "linux")
                ));
            }
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
