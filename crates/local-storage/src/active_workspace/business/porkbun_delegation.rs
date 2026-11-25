//! `Porkbun` registry delegation reads (`getNs`), owned by the workspace business writer.
//!
//! A read lands as one append-only row: the asset, the connection that read it and the registry's
//! nameserver set. It changes no Zone binding; DNS health compares it with the Zone's own
//! nameservers. The evidence stays local.
use super::{
    BusinessDatabase, BusinessDatabaseError, afternic::random_id, porkbun_dns::admit_connection,
};
use crate::active_workspace::business::PorkbunConnectionSeed;
use rusqlite::{TransactionBehavior, params};
use serde::Serialize;
use std::collections::BTreeSet;

type Result<T> = std::result::Result<T, BusinessDatabaseError>;

/// The local bound on one registry nameserver set, shared with the Native parser.
const MAX_NAMESERVERS: usize = 16;

/// Public result of one committed read. The nameservers themselves are read back through DNS
/// health, which compares them with the Zone.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPorkbunDelegationReceipt {
    pub nameserver_count: u32,
    pub observed_at: String,
}

pub(crate) struct PorkbunDelegationCommit<'a> {
    pub seed: &'a PorkbunConnectionSeed,
    pub entity_id: &'a str,
    pub nameservers: &'a [String],
    pub at: &'a str,
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

/// One lowercase LDH host with at least two labels, as the Native parser produced it.
fn host_name(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

/// Storage re-checks the set at its own trust boundary and stores it in one canonical order, so
/// later comparisons are set comparisons.
fn canonical_set(nameservers: &[String]) -> Result<String> {
    let set: BTreeSet<&str> = nameservers.iter().map(String::as_str).collect();
    if nameservers.len() > MAX_NAMESERVERS
        || set.len() != nameservers.len()
        || !set.iter().all(|host| host_name(host))
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    serde_json::to_string(&set).map_err(|_| BusinessDatabaseError::InvalidInput)
}

impl BusinessDatabase {
    /// Refuses, before any Provider call, a read the commit would refuse for its connection or
    /// asset. The commit re-checks all of it.
    ///
    /// # Errors
    /// The same refusals as [`Self::commit_porkbun_delegation_observation`].
    pub(crate) fn porkbun_delegation_preflight(
        &self,
        seed: &PorkbunConnectionSeed,
        entity_id: &str,
    ) -> Result<()> {
        admit_connection(
            self.store.raw_connection(),
            &self.workspace_id,
            seed,
            entity_id,
        )
    }

    /// Commits one registry nameserver read of an asset in this connection's latest inventory.
    ///
    /// # Errors
    /// A malformed set is `InvalidInput`; a changed, revoked or handed-off connection is
    /// `MutationStale`; an asset outside the latest scan is `ProviderBindingUnavailable`. Every
    /// refusal writes nothing.
    pub(crate) fn commit_porkbun_delegation_observation<G>(
        &mut self,
        input: &PorkbunDelegationCommit<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopPorkbunDelegationReceipt> {
        super::validate_timestamp(Some(input.at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let nameservers = canonical_set(input.nameservers)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        admit_connection(&tx, workspace, input.seed, input.entity_id)?;
        tx.execute(
            "INSERT INTO registrar_delegation_observations (workspace_id,delegation_observation_id,
               entity_id,connection_id,nameservers_json,observed_at) VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                workspace,
                random_id()?,
                input.entity_id,
                input.seed.connection_id,
                nameservers,
                input.at
            ],
        )
        .map_err(storage)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1
             WHERE singleton=1",
            [input.at],
        )
        .map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(DesktopPorkbunDelegationReceipt {
            nameserver_count: u32::try_from(input.nameservers.len())
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            observed_at: input.at.to_owned(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::{
        PorkbunInventoryCommit,
        registrar_inventory::{DesktopRegistrationFact, DesktopRegistrationStanding},
        tests::TestDatabase,
    };

    const AT: &str = "2026-11-24T00:00:00Z";
    const LATER: &str = "2026-11-24T01:00:00Z";
    const EXECUTION: (&str, u64) = ("device-local", 1);
    const DOMAIN: &str = "porkbun-delegation.test";

    fn hosts(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    fn connected(key: u8) -> (TestDatabase, PorkbunConnectionSeed) {
        let mut db = TestDatabase::open([key; 32]);
        let seed = db
            .prepare_porkbun_connection("Porkbun", AT, EXECUTION, || Ok(()))
            .unwrap();
        let fact = DesktopRegistrationFact {
            domain: DOMAIN.to_owned(),
            registered_on: "2025-04-01".to_owned(),
            expires_on: Some("2027-04-01".to_owned()),
            auto_renew: Some(true),
            locked: Some(true),
            standing: DesktopRegistrationStanding::Active,
        };
        db.import_porkbun_inventory(
            &PorkbunInventoryCommit {
                seed: &seed,
                registrations: std::slice::from_ref(&fact),
                device_id: EXECUTION.0,
                lease_epoch: EXECUTION.1,
                at: AT,
            },
            || Ok(()),
        )
        .unwrap();
        let seed = db.porkbun_connection(&seed.connection_id).unwrap();
        (db, seed)
    }

    fn commit(
        db: &mut BusinessDatabase,
        seed: &PorkbunConnectionSeed,
        entity_id: &str,
        nameservers: &[String],
        at: &str,
    ) -> Result<DesktopPorkbunDelegationReceipt> {
        db.commit_porkbun_delegation_observation(
            &PorkbunDelegationCommit {
                seed,
                entity_id,
                nameservers,
                at,
            },
            || Ok(()),
        )
    }

    fn stored(db: &BusinessDatabase) -> Vec<String> {
        let connection = db.store.raw_connection();
        let mut statement = connection
            .prepare(
                "SELECT nameservers_json FROM registrar_delegation_observations ORDER BY observed_at",
            )
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<std::result::Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn a_read_lands_as_a_sorted_append_only_set() {
        let (mut db, seed) = connected(0x91);
        let receipt = commit(
            &mut db,
            &seed,
            DOMAIN,
            &hosts(&["ns2.example.net", "ns1.example.net"]),
            AT,
        )
        .unwrap();
        assert_eq!(receipt.nameserver_count, 2);
        commit(&mut db, &seed, DOMAIN, &[], LATER).unwrap();
        assert_eq!(
            stored(&db),
            [r#"["ns1.example.net","ns2.example.net"]"#, "[]"]
        );
        assert!(
            db.store
                .fixture_connection()
                .execute(
                    "UPDATE registrar_delegation_observations SET nameservers_json='[]'",
                    []
                )
                .is_err()
        );
        // The trigger refuses what the Rust check refuses, at its own boundary.
        for bad in [
            r#"["NS1.example.net"]"#,
            r#"["ns1.example.net."]"#,
            r#"["ns1.example.net","ns1.example.net"]"#,
            r#"["localhost"]"#,
            r"[1]",
        ] {
            assert!(
                db.store
                    .fixture_connection()
                    .execute(
                        "INSERT INTO registrar_delegation_observations VALUES
                           ('workspace-local','forged',?1,?2,?3,?4)",
                        params![DOMAIN, seed.connection_id, bad, AT],
                    )
                    .is_err(),
                "{bad}"
            );
        }
    }

    /// Commits a Cloudflare Zone observation of `DOMAIN` naming `nameservers`.
    fn observe_cloudflare(db: &mut BusinessDatabase, nameservers: &[&str]) {
        db.store
            .fixture_connection()
            .execute(
                "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,
                   active_credential_changed_at,capabilities_json,credential_use_state,active_credential_generation,
                   active_credential_scope_digest,active_credential_zone_digest,active_credential_public_proof,
                   validation_status)
                 VALUES ('workspace-local','cf-observe','cloudflare','Cloudflare',?1,'[\"dns\"]','active',1,?2,?3,?4,'valid')",
                params![AT, "a".repeat(64), "c".repeat(64), "b".repeat(64)],
            )
            .unwrap();
        db.commit_cloudflare_dns_observation(&super::super::CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000001".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000002".into(),
            entity_id: DOMAIN.into(),
            connection_id: "cf-observe".into(),
            lease_epoch: 3,
            observed_at: AT.into(),
            zone_name_ascii: DOMAIN.into(),
            authoritative_nameservers: hosts(nameservers),
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: Vec::new(),
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
        .unwrap();
    }

    fn health(db: &BusinessDatabase) -> (String, Option<Vec<String>>, u32) {
        let snapshot = db.read_dns_health(0, 10, "").unwrap();
        let row = &snapshot.window.rows[0];
        (
            row.delegation_status.clone(),
            row.delegation
                .as_ref()
                .map(|value| value.nameservers.clone()),
            snapshot.delegation_issue_count,
        )
    }

    #[test]
    fn dns_health_compares_the_latest_delegation_with_the_shown_zone() {
        let (mut db, seed) = connected(0x93);
        // No delegation read and no Zone: unknown, no issue.
        assert_eq!(health(&db), ("unknown".to_owned(), None, 0));
        // A delegation without a Zone that names nameservers stays unknown.
        commit(
            &mut db,
            &seed,
            DOMAIN,
            &hosts(&["ada.ns.cloudflare.com"]),
            AT,
        )
        .unwrap();
        assert_eq!(health(&db).0, "unknown");
        observe_cloudflare(&mut db, &["bob.ns.cloudflare.com", "ada.ns.cloudflare.com"]);
        // A subset is not the Zone's set.
        assert_eq!(
            health(&db),
            (
                "mismatch".to_owned(),
                Some(hosts(&["ada.ns.cloudflare.com"])),
                1
            )
        );
        let both = hosts(&["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"]);
        commit(&mut db, &seed, DOMAIN, &both, LATER).unwrap();
        assert_eq!(health(&db), ("healthy".to_owned(), Some(both), 0));
        commit(&mut db, &seed, DOMAIN, &[], "2026-11-24T02:00:00Z").unwrap();
        assert_eq!(health(&db), ("unresolved".to_owned(), Some(Vec::new()), 1));
    }

    #[test]
    fn malformed_sets_and_assets_outside_the_scan_write_nothing() {
        let (mut db, seed) = connected(0x92);
        for bad in [
            hosts(&["NS1.example.net"]),
            hosts(&["ns1.example.net."]),
            hosts(&["ns1.example.net", "ns1.example.net"]),
            hosts(&["localhost"]),
            hosts(&["-ns.example.net"]),
            (0..=MAX_NAMESERVERS)
                .map(|n| format!("ns{n}.example.net"))
                .collect(),
        ] {
            assert_eq!(
                commit(&mut db, &seed, DOMAIN, &bad, AT),
                Err(BusinessDatabaseError::InvalidInput)
            );
        }
        let other = super::super::DomainAssetWrite {
            entity_id: "other.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: Vec::new(),
            target_price: None,
        };
        db.upsert_domain_asset("seed-other", AT, &other).unwrap();
        assert_eq!(
            db.porkbun_delegation_preflight(&seed, "other.test"),
            Err(BusinessDatabaseError::ProviderBindingUnavailable)
        );
        assert_eq!(
            commit(&mut db, &seed, "other.test", &[], AT),
            Err(BusinessDatabaseError::ProviderBindingUnavailable)
        );
        let mut forged = db.porkbun_connection(&seed.connection_id).unwrap();
        forged.credential_proof = "f".repeat(64);
        assert_eq!(
            commit(&mut db, &forged, DOMAIN, &[], AT),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            db.commit_porkbun_delegation_observation(
                &PorkbunDelegationCommit {
                    seed: &seed,
                    entity_id: DOMAIN,
                    nameservers: &[],
                    at: AT,
                },
                || -> Result<()> { Err(BusinessDatabaseError::MutationStale) },
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert!(stored(&db).is_empty());
    }
}
