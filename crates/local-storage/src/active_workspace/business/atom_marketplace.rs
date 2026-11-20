//! Atom connection publication and receipts, owned by the workspace business writer.
use super::{
    BusinessDatabase, BusinessDatabaseError, afternic::random_id, assets::import_discovered_asset,
    hex_digest, is_uuid_v4, validate_domain_asset_id, validate_sha256_hex,
};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;

const STANDARD_SAMPLE_LIMIT: u16 = 12;

type Result<T> = std::result::Result<T, BusinessDatabaseError>;

#[derive(Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum DesktopAtomConnectionState {
    Prepared,
    Active,
    Revoked,
}

/// Native facts, never accepted from Renderer.
pub struct DesktopAtomListingFact {
    pub domain: String,
    pub resource_digest: String,
    pub state: DesktopAtomListingState,
    pub observed_in_standard_scan: bool,
}

#[derive(Clone, Copy, Debug, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopAtomListingState {
    SellerApproved,
    TransferComplete,
    Unclassified,
}

pub(super) fn listing_observation_digest(
    binding_digest: &str,
    domain: &str,
    state: DesktopAtomListingState,
) -> Result<String> {
    let state = serde_json::to_string(&state).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    Ok(hex_digest(
        format!("{binding_digest}:{domain}:{state}").as_bytes(),
    ))
}

pub(super) fn listing_binding_digest(incarnation: &str, resource_digest: &str) -> String {
    hex_digest(format!("gooddealer:atom:v1:{incarnation}:{resource_digest}").as_bytes())
}

#[derive(Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAtomInventoryReceipt {
    pub observed: u32,
    pub imported: u32,
    pub skipped: u32,
    pub completed_at: String,
    standard_review: Option<AtomStandardReview>,
}

#[derive(Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AtomStandardReview {
    observed: u32,
    sample: Vec<String>,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::LocalDatabaseKey;

    const AT: &str = "2026-11-20T00:00:00Z";
    const EXECUTION: (&str, u64) = ("device-local", 1);

    fn fact(name: &str) -> DesktopAtomListingFact {
        DesktopAtomListingFact {
            domain: name.to_owned(),
            resource_digest: hex_digest(name.as_bytes()),
            state: DesktopAtomListingState::SellerApproved,
            observed_in_standard_scan: false,
        }
    }

    fn import(
        db: &mut BusinessDatabase,
        seed: &AtomConnectionSeed,
        rows: &[DesktopAtomListingFact],
        fence: impl FnOnce() -> Result<()>,
    ) -> Result<DesktopAtomInventoryReceipt> {
        db.import_atom_inventory(
            &AtomInventoryCommit {
                seed,
                listings: rows,
                standard_scan_checked: false,
                device_id: "device-local",
                lease_epoch: 1,
                at: AT,
            },
            fence,
        )
    }

    fn counts(db: &BusinessDatabase) -> (i64, i64, i64, i64) {
        db.store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM domain_assets),
               (SELECT count(*) FROM sync_outbox),
               (SELECT count(*) FROM marketplace_listing_observations),
               (SELECT count(*) FROM atom_marketplace_scans)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap()
    }

    #[test]
    fn unfinished_scan_reopens_and_the_final_fence_covers_all_writes() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let path = dir.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x71; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let seed = db
            .prepare_atom_connection("Atom", AT, EXECUTION, || Ok(()))
            .unwrap();
        let rows = [fact("example.test")];
        assert_eq!(
            import(&mut db, &seed, &rows, || Err(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0));
        drop(db);

        let mut db = open();
        let reopened = db.atom_connection(&seed.connection_id).unwrap();
        assert!(reopened == seed);
        assert!(db.atom_connection_summaries(Some(EXECUTION)).unwrap()[0].scan_pending);
        let first = import(&mut db, &reopened, &rows, || Ok(())).unwrap();
        assert_eq!((first.observed, first.imported, first.skipped), (1, 1, 0));
        assert_eq!(counts(&db), (1, 1, 1, 1));
        assert_eq!(
            import(&mut db, &reopened, &rows, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.queue_atom_scan(&seed.connection_id, EXECUTION, || Ok(()))
            .unwrap();
        drop(db);

        let mut db = open();
        let refresh = db.atom_connection(&seed.connection_id).unwrap();
        assert!(refresh.scan_pending);
        assert!(refresh != reopened);
        let repeat = import(&mut db, &refresh, &rows, || Ok(())).unwrap();
        assert_eq!(
            (repeat.observed, repeat.imported, repeat.skipped),
            (1, 0, 0)
        );
        assert_eq!(counts(&db), (1, 1, 2, 2));
        assert!(!db.atom_connection_summaries(Some(EXECUTION)).unwrap()[0].scan_pending);
    }

    #[test]
    fn exact_connection_and_revocation_fence_reject_stale_or_cross_scope_results() {
        let mut db = super::super::tests::TestDatabase::open([0x72; 32]);
        let a = db
            .prepare_atom_connection("First", AT, EXECUTION, || Ok(()))
            .unwrap();
        let b = db
            .prepare_atom_connection("Second", AT, EXECUTION, || Ok(()))
            .unwrap();
        let swapped = AtomConnectionSeed {
            connection_id: b.connection_id,
            ..a
        };
        assert_eq!(
            import(&mut db, &swapped, &[fact("example.test")], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        let b = db.atom_connection(&swapped.connection_id).unwrap();
        assert_eq!(
            import(
                &mut db,
                &b,
                &[fact("example.test"), fact("example.test")],
                || Ok(())
            ),
            Err(BusinessDatabaseError::InvalidInput)
        );
        let revoked = db.revoke_atom_connection(&b, AT, || Ok(())).unwrap();
        assert_eq!(
            import(&mut db, &b, &[], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert!(
            db.queue_atom_scan(&b.connection_id, EXECUTION, || Ok(()))
                .is_err()
        );
        db.confirm_atom_purge(&revoked, AT, || Ok(())).unwrap();
        assert!(db.atom_connection(&b.connection_id).is_err());
        assert_eq!(counts(&db), (0, 0, 0, 0));
    }

    #[test]
    fn replacement_keeps_history_and_identity_is_scoped_to_the_exact_connection() {
        let mut db = super::super::tests::TestDatabase::open([0x73; 32]);
        let a = db
            .prepare_atom_connection("First", AT, EXECUTION, || Ok(()))
            .unwrap();
        let b = db
            .prepare_atom_connection("Second", AT, EXECUTION, || Ok(()))
            .unwrap();
        let original = fact("example.test");
        let replacement = DesktopAtomListingFact {
            resource_digest: hex_digest(b"replacement"),
            ..fact("example.test")
        };
        for seed in [&a, &b] {
            import(&mut db, seed, std::slice::from_ref(&original), || Ok(())).unwrap();
        }
        let head = db
            .queue_atom_scan(&a.connection_id, EXECUTION, || Ok(()))
            .unwrap();
        import(&mut db, &head, &[replacement], || Ok(())).unwrap();
        let head = db
            .queue_atom_scan(&a.connection_id, EXECUTION, || Ok(()))
            .unwrap();
        assert!(import(&mut db, &head, &[original], || Ok(())).is_err());
        assert_eq!(counts(&db), (1, 1, 3, 3));
        let identities: (i64, i64, i64) = db.store.raw_connection().query_row(
            "SELECT count(*),sum(validation_status='detached'),count(DISTINCT connection_id)
             FROM domain_asset_provider_bindings WHERE provider_kind='atom' AND resource_kind='listing'",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        ).unwrap();
        assert_eq!(identities, (3, 1, 2));
    }

    #[expect(
        clippy::too_many_lines,
        reason = "one reopen lifecycle distinguishes unavailable, matched and empty review evidence"
    )]
    #[test]
    fn standard_review_is_bounded_and_reopens_with_the_exact_complete_scan() {
        let dir = crate::test_tempdir::tempdir().unwrap();
        let path = dir.path().join("workspace.db");
        let key = LocalDatabaseKey::from_bytes([0x76; 32]);
        let open = || BusinessDatabase::open(&path, &key, "workspace-local").unwrap();
        let mut db = open();
        let seed = db
            .prepare_atom_connection("Atom", AT, EXECUTION, || Ok(()))
            .unwrap();
        let rows: Vec<_> = (0..15)
            .rev()
            .map(|n| DesktopAtomListingFact {
                observed_in_standard_scan: true,
                ..fact(&format!("domain-{n:02}.test"))
            })
            .collect();
        assert_eq!(
            import(&mut db, &seed, &rows, || Ok(())),
            Err(BusinessDatabaseError::InvalidInput)
        );
        let input = AtomInventoryCommit {
            seed: &seed,
            listings: &rows,
            standard_scan_checked: true,
            device_id: EXECUTION.0,
            lease_epoch: EXECUTION.1,
            at: AT,
        };
        let unclassified = [DesktopAtomListingFact {
            observed_in_standard_scan: true,
            state: DesktopAtomListingState::Unclassified,
            ..fact("unclassified.test")
        }];
        assert_eq!(
            db.import_atom_inventory(
                &AtomInventoryCommit {
                    listings: &unclassified,
                    ..input
                },
                || Ok(())
            ),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(
            db.import_atom_inventory(&input, || Err::<(), _>(
                BusinessDatabaseError::MutationStale
            )),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0));
        let receipt = db.import_atom_inventory(&input, || Ok(())).unwrap();
        let review = receipt.standard_review.unwrap();
        assert_eq!(review.observed, 15);
        assert_eq!(review.sample.len(), 12);
        assert_eq!(review.sample.first().unwrap(), "domain-00.test");
        assert_eq!(review.sample.last().unwrap(), "domain-11.test");
        assert!(
            db.store
                .fixture_connection()
                .execute(
                    "UPDATE marketplace_listing_observations SET atom_standard_asset_generation=2
              WHERE workspace_id='workspace-local' AND entity_id='domain-00.test'",
                    []
                )
                .is_err()
        );
        drop(db);

        let mut db = open();
        let summaries = db.atom_connection_summaries(Some(EXECUTION)).unwrap();
        assert_eq!(
            summaries[0]
                .last_scan
                .as_ref()
                .unwrap()
                .standard_review
                .as_ref(),
            Some(&review)
        );
        db.store
            .fixture_connection()
            .execute(
                "INSERT INTO storage_repair_receipts
             SELECT workspace_id,'listing_observation',listing_observation_id,?1,?2
             FROM marketplace_listing_observations WHERE entity_id='domain-14.test'",
                params!["a".repeat(64), AT],
            )
            .unwrap();
        let repaired = db.atom_connection_summaries(Some(EXECUTION)).unwrap();
        let saved = repaired[0].last_scan.as_ref().unwrap();
        assert_eq!(saved.observed, 15);
        assert!(saved.standard_review.is_none());
        let id = &seed.connection_id;
        let next = db.queue_atom_scan(id, EXECUTION, || Ok(())).unwrap();
        let partial = import(&mut db, &next, &[fact("domain-00.test")], || Ok(())).unwrap();
        assert_eq!(partial.observed, 1);
        assert!(
            db.atom_connection_summaries(Some(EXECUTION)).unwrap()[0]
                .last_scan
                .as_ref()
                .unwrap()
                .standard_review
                .is_none()
        );

        let next = db.queue_atom_scan(id, EXECUTION, || Ok(())).unwrap();
        let empty = db
            .import_atom_inventory(
                &AtomInventoryCommit {
                    seed: &next,
                    listings: &[],
                    ..input
                },
                || Ok(()),
            )
            .unwrap();
        assert_eq!(
            empty.standard_review,
            Some(AtomStandardReview {
                observed: 0,
                sample: vec![]
            })
        );
        assert_eq!(
            db.atom_connection_summaries(Some(EXECUTION)).unwrap()[0]
                .last_scan
                .as_ref(),
            Some(&empty)
        );
        let active = db.atom_connection(id).unwrap();
        db.revoke_atom_connection(&active, AT, || Ok(())).unwrap();
        assert!(
            db.atom_connection_summaries(Some(EXECUTION)).unwrap()[0]
                .last_scan
                .as_ref()
                .unwrap()
                .standard_review
                .is_none()
        );
    }

    #[test]
    fn a_legacy_pending_bit_cannot_restore_authority_and_a_late_scan_cannot_use_a_new_request() {
        let mut db = super::super::tests::TestDatabase::open([0x74; 32]);
        let connected = db
            .prepare_atom_connection("Atom", AT, EXECUTION, || Ok(()))
            .unwrap();
        let id = &connected.connection_id;
        import(&mut db, &connected, &[fact("example.test")], || Ok(())).unwrap();
        db.store
            .fixture_connection()
            .execute(
                "UPDATE atom_marketplace_connections SET scan_pending=1 WHERE connection_id=?1",
                [id],
            )
            .unwrap();
        let legacy = db.atom_connection(id).unwrap();
        assert!(legacy.scan_pending && !legacy.has_scan_for(EXECUTION.0, EXECUTION.1));
        assert!(!db.atom_connection_summaries(Some(EXECUTION)).unwrap()[0].scan_pending);
        assert_eq!(
            import(&mut db, &legacy, &[], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );

        let old = db.queue_atom_scan(id, EXECUTION, || Ok(())).unwrap();
        assert!(db.queue_atom_scan(id, EXECUTION, || Ok(())).unwrap() == old);
        let next_execution = ("device-local", 2);
        let next = db.queue_atom_scan(id, next_execution, || Ok(())).unwrap();
        assert!(next.has_scan_for(next_execution.0, next_execution.1));
        assert!(!next.has_scan_for("device-other", next_execution.1));
        assert!(next != old);
        assert_eq!(
            import(&mut db, &old, &[], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(
            import(&mut db, &next, &[], || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(counts(&db), (1, 1, 1, 1));
    }

    #[test]
    fn handoff_rejects_both_admission_and_completion_even_for_an_existing_request() {
        let mut db = super::super::tests::TestDatabase::open([0x75; 32]);
        let seed = db
            .prepare_atom_connection("Atom", AT, EXECUTION, || Ok(()))
            .unwrap();
        let id = &seed.connection_id;
        db.store.fixture_connection().execute(
            "INSERT INTO device_handoff_barriers(workspace_id,device_switch_request_id,began_at)
             VALUES ('workspace-local','test-switch',?1)", [AT],
        ).unwrap();
        assert!(matches!(
            db.queue_atom_scan(id, EXECUTION, || Ok(())),
            Err(BusinessDatabaseError::MutationStale)
        ));
        assert!(import(&mut db, &seed, &[], || Ok(())).is_err());
        assert!(db.atom_connection(id).unwrap() == seed);
        assert_eq!(counts(&db), (0, 0, 0, 0));
        db.store
            .fixture_connection()
            .execute("DELETE FROM device_handoff_barriers", [])
            .unwrap();
        import(&mut db, &seed, &[], || Ok(())).unwrap();
        let done = db.atom_connection(id).unwrap();
        assert!(!done.has_scan_for(EXECUTION.0, EXECUTION.1));
        assert_eq!(
            done.last_scan_id.as_deref(),
            seed.pending.as_ref().map(|request| request.id.as_str())
        );
    }
}

#[derive(PartialEq, Eq)]
pub(crate) struct AtomConnectionSeed {
    pub connection_id: String,
    pub incarnation_id: String,
    pub credential_proof: String,
    pub state: DesktopAtomConnectionState,
    pub scan_pending: bool,
    pub last_scan_id: Option<String>,
    pending: Option<AtomScanRequest>,
}

impl AtomConnectionSeed {
    pub(crate) fn has_scan_for(&self, device_id: &str, lease_epoch: u64) -> bool {
        self.pending.as_ref().is_some_and(|request| {
            request.device_id == device_id && i64::try_from(lease_epoch) == Ok(request.lease_epoch)
        })
    }
}

#[derive(PartialEq, Eq)]
struct AtomScanRequest {
    id: String,
    device_id: String,
    lease_epoch: i64,
}

fn insert_scan_request(
    tx: &Connection,
    workspace: &str,
    seed: &AtomConnectionSeed,
    (device_id, lease_epoch): (&str, u64),
) -> Result<()> {
    let epoch = i64::try_from(lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    tx.execute(
        "INSERT INTO atom_marketplace_pending_scans
           (workspace_id,connection_id,incarnation_id,device_id,lease_epoch,request_id)
         VALUES (?1,?2,?3,?4,?5,?6)",
        params![
            workspace,
            seed.connection_id,
            seed.incarnation_id,
            device_id,
            epoch,
            random_id()?
        ],
    )
    .map_err(storage)?;
    Ok(())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopAtomConnectionSummary {
    pub connection_id: String,
    pub state: DesktopAtomConnectionState,
    pub scan_pending: bool,
    pub last_scan: Option<DesktopAtomInventoryReceipt>,
}

pub(crate) struct AtomInventoryCommit<'a> {
    pub seed: &'a AtomConnectionSeed,
    pub listings: &'a [DesktopAtomListingFact],
    pub standard_scan_checked: bool,
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
}

impl AtomInventoryCommit<'_> {
    fn validate(&self) -> Result<()> {
        super::validate_timestamp(Some(self.at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if self.listings.len() > 10_000 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut domains = BTreeSet::new();
        let mut resources = BTreeSet::new();
        for item in self.listings {
            validate_domain_asset_id(&item.domain)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            validate_sha256_hex(&item.resource_digest)?;
            if !domains.insert(&item.domain)
                || !resources.insert(&item.resource_digest)
                || (item.observed_in_standard_scan
                    && (!self.standard_scan_checked
                        || matches!(item.state, DesktopAtomListingState::Unclassified)))
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        Ok(())
    }

    fn write<'a>(
        &self,
        tx: &rusqlite::Transaction<'_>,
        workspace: &str,
        run: &'a str,
    ) -> Result<(Option<&'a str>, DesktopAtomInventoryReceipt)> {
        let connection = &self.seed.connection_id;
        let mut persisted_run = None;
        let mut receipt = DesktopAtomInventoryReceipt {
            observed: u32::try_from(self.listings.len())
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            imported: 0,
            skipped: 0,
            completed_at: self.at.to_owned(),
            standard_review: self.standard_scan_checked.then(|| AtomStandardReview {
                observed: 0,
                sample: Vec::new(),
            }),
        };
        for (ordinal, item) in self.listings.iter().enumerate() {
            let Some(imported) = import_discovered_asset(
                tx,
                workspace,
                &random_id()?,
                self.device_id,
                self.lease_epoch,
                self.at,
                &item.domain,
            )?
            else {
                receipt.skipped += 1;
                continue;
            };
            if persisted_run.is_none() {
                tx.execute(
                    "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,
                     observation_capability,started_at,status,connector_version)
                     VALUES (?1,?2,?3,'marketplace',?4,'running','atom-seller-v1')",
                    params![workspace,run,connection,self.at],
                ).map_err(storage)?;
                persisted_run = Some(run);
            }
            receipt.imported += u32::from(imported);
            self.write_listing(tx, workspace, run, ordinal, item)?;
            if item.observed_in_standard_scan {
                let review = receipt
                    .standard_review
                    .as_mut()
                    .ok_or(BusinessDatabaseError::InvalidInput)?;
                review.observed += 1;
                review.sample.push(item.domain.clone());
            }
        }
        if let Some(review) = &mut receipt.standard_review {
            review.sample.sort_unstable();
            review.sample.truncate(usize::from(STANDARD_SAMPLE_LIMIT));
        }
        if persisted_run.is_some() {
            tx.execute(
                "UPDATE provider_observation_runs SET status='succeeded',completed_at=?1
                 WHERE workspace_id=?2 AND observation_run_id=?3",
                params![self.at, workspace, run],
            )
            .map_err(storage)?;
        }
        Ok((persisted_run, receipt))
    }

    fn write_listing(
        &self,
        tx: &Connection,
        workspace: &str,
        run: &str,
        ordinal: usize,
        item: &DesktopAtomListingFact,
    ) -> Result<()> {
        let id = &self.seed.connection_id;
        let domain = &item.domain;
        let resource = listing_binding_digest(&self.seed.incarnation_id, &item.resource_digest);
        let observation = listing_observation_digest(&resource, domain, item.state)?;
        let current: Option<String> = tx.query_row(
            "SELECT resource_binding_digest FROM domain_asset_provider_bindings WHERE workspace_id=?1
             AND entity_id=?2 AND connection_id=?3 AND provider_kind='atom' AND resource_kind='listing'
             AND validation_status!='detached'", params![workspace,domain,id], |row| row.get(0),
        ).optional().map_err(storage)?;
        let sequence: i64 = tx.query_row(
            "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
             WHERE singleton=1 RETURNING local_commit_sequence", [self.at], |row| row.get(0),
        ).map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
        if current.as_deref() == Some(&resource) {
            tx.execute(
                "UPDATE domain_asset_provider_bindings SET observation_digest=?1,local_commit_sequence=?2,
                 last_observed_at=?3,updated_at=?3 WHERE workspace_id=?4 AND entity_id=?5 AND connection_id=?6
                 AND resource_kind='listing' AND resource_binding_digest=?7 AND binding_generation=1",
                params![observation,sequence,self.at,workspace,domain,id,resource],
            ).map_err(storage)?;
        } else {
            if let Some(previous) = current {
                tx.execute(
                    "UPDATE domain_asset_provider_bindings SET validation_status='detached',verified_at=NULL,
                     local_commit_sequence=?1,updated_at=?2 WHERE workspace_id=?3 AND entity_id=?4 AND connection_id=?5
                     AND resource_kind='listing' AND resource_binding_digest=?6",
                    params![sequence,self.at,workspace,domain,id,previous],
                ).map_err(storage)?;
            }
            tx.execute(
                "INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,
                 resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,
                 local_commit_sequence,validation_status,last_observed_at,created_at,updated_at)
                 VALUES (?1,?2,?3,'atom','listing',?4,?5,?2,1,?6,'unverified',?7,?7,?7)",
                params![workspace,domain,id,resource,observation,sequence,self.at],
            ).map_err(storage)?;
        }
        tx.execute(
            "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at)
             VALUES (?1,?2,?3,?4,'requested',?5)",
            params![workspace,run,domain,i64::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?,self.at],
        ).map_err(storage)?;
        // The official seller labels do not confirm a current active sale or ownership.
        tx.execute(
            "INSERT INTO marketplace_listing_observations (workspace_id,listing_observation_id,observation_run_id,
             entity_id,marketplace_kind,listing_status,observed_at,provider_version_token,observation_availability,
             evidence_status,binding_connection_id,binding_resource_digest,binding_generation,atom_standard_asset_generation)
             VALUES (?1,?2,?3,?4,'atom','unknown',?5,?6,'available','confirmed',?7,?8,1,
                CASE WHEN ?9 THEN (SELECT entity_generation FROM domain_assets WHERE workspace_id=?1 AND entity_id=?4) END)",
            params![workspace,random_id()?,run,domain,self.at,observation,id,resource,item.observed_in_standard_scan],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE provider_observation_targets SET status='succeeded',completed_at=?1
             WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4",
            params![self.at, workspace, run, domain],
        )
        .map_err(storage)?;
        Ok(())
    }
}

fn read_standard_review(row: &rusqlite::Row<'_>) -> rusqlite::Result<Option<AtomStandardReview>> {
    let Some(raw) = row.get::<_, Option<String>>(7)? else {
        return Ok(None);
    };
    let review: AtomStandardReview =
        serde_json::from_str(&raw).map_err(|_| rusqlite::Error::InvalidQuery)?;
    let expected = usize::try_from(review.observed)
        .unwrap_or(usize::MAX)
        .min(usize::from(STANDARD_SAMPLE_LIMIT));
    if review.sample.len() != expected
        || review.sample.windows(2).any(|pair| pair[0] >= pair[1])
        || review
            .sample
            .iter()
            .any(|domain| validate_domain_asset_id(domain).is_err())
    {
        return Err(rusqlite::Error::InvalidQuery);
    }
    Ok(Some(review))
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn read_state(
    row: &rusqlite::Row<'_>,
    column: usize,
) -> rusqlite::Result<DesktopAtomConnectionState> {
    use DesktopAtomConnectionState::{Active, Prepared, Revoked};
    match row.get_ref(column)?.as_str()? {
        "prepared" => Ok(Prepared),
        "active" => Ok(Active),
        "revoked" => Ok(Revoked),
        _ => Err(rusqlite::Error::InvalidQuery),
    }
}

fn connection_seed(
    connection: &Connection,
    workspace: &str,
    id: &str,
) -> Result<AtomConnectionSeed> {
    let seed = connection.query_row(
        "SELECT s.connection_id,s.incarnation_id,s.credential_proof,s.state,s.scan_pending,
                (SELECT r.scan_id FROM atom_marketplace_scans r
                 WHERE r.workspace_id=s.workspace_id AND r.connection_id=s.connection_id
                 ORDER BY r.rowid DESC LIMIT 1), p.request_id,p.device_id,p.lease_epoch
           FROM atom_marketplace_connections s JOIN local_provider_connections c USING(workspace_id,connection_id)
           LEFT JOIN atom_marketplace_pending_scans p
             ON p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id
               AND p.incarnation_id=s.incarnation_id
          WHERE s.workspace_id=?1 AND s.connection_id=?2 AND c.provider_kind='atom'
            AND c.connection_incarnation_id=s.incarnation_id AND json(c.capabilities_json)='[\"marketplace\"]'
            AND s.purged_at IS NULL AND c.deleted_at IS NULL AND (
              (s.state='prepared' AND c.credential_use_state='inactive' AND c.lifecycle_status='invalid' AND c.revoked_at IS NULL)
              OR (s.state='active' AND c.credential_use_state='active' AND c.lifecycle_status='active' AND c.validation_status='valid' AND c.revoked_at IS NULL)
              OR (s.state='revoked' AND c.credential_use_state='revoked' AND c.lifecycle_status='revoked' AND c.revoked_at IS NOT NULL)
            )",
        params![workspace,id], |row| {
            let pending = if let Some(id) = row.get(6)? {
                Some(AtomScanRequest { id, device_id: row.get(7)?, lease_epoch: row.get(8)? })
            } else {
                None
            };
            Ok(AtomConnectionSeed {
                connection_id: row.get(0)?, incarnation_id: row.get(1)?, credential_proof: row.get(2)?,
                state: read_state(row, 3)?, scan_pending: row.get(4)?, last_scan_id: row.get(5)?, pending,
            })
        }
    ).optional().map_err(storage)?.ok_or(BusinessDatabaseError::MutationStale)?;
    validate_sha256_hex(&seed.credential_proof)?;
    if !is_uuid_v4(&seed.incarnation_id)
        || !is_uuid_v4(&seed.connection_id)
        || seed
            .pending
            .as_ref()
            .is_some_and(|request| !seed.scan_pending || !is_uuid_v4(&request.id))
    {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    Ok(seed)
}

impl BusinessDatabase {
    pub(crate) fn prepare_atom_connection<G>(
        &mut self,
        label: &str,
        at: &str,
        execution: (&str, u64),
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<AtomConnectionSeed> {
        if !crate::portfolio_projection::valid_connection_label(label) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let seed = AtomConnectionSeed {
            connection_id: random_id()?,
            incarnation_id: random_id()?,
            credential_proof: hex_digest(random_id()?.as_bytes()),
            state: DesktopAtomConnectionState::Prepared,
            scan_pending: true,
            last_scan_id: None,
            pending: None,
        };
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let existing: i64 = tx.query_row(
            "SELECT count(*) FROM local_provider_connections WHERE workspace_id=?1 AND deleted_at IS NULL
              AND lifecycle_status<>'deleted' AND credential_use_state<>'retired'",
            [workspace], |row| row.get(0),
        ).map_err(storage)?;
        if existing >= i64::from(super::super::settings::MAX_CONNECTIONS) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        tx.execute(
            "INSERT INTO local_provider_connections
             (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,lifecycle_status,
              capabilities_json,created_at,validation_status,connection_incarnation_id,credential_use_state)
             VALUES (?1,?2,'atom',?3,?4,'invalid','[\"marketplace\"]',?4,'unknown',?5,'inactive')",
             params![workspace,seed.connection_id,label,at,seed.incarnation_id],
        ).map_err(storage)?;
        tx.execute(
            "INSERT INTO atom_marketplace_connections (workspace_id,connection_id,incarnation_id,credential_proof,state,scan_pending,created_at)
             VALUES (?1,?2,?3,?4,'prepared',1,?5)",
             params![workspace,seed.connection_id,seed.incarnation_id,seed.credential_proof,at],
        ).map_err(storage)?;
        insert_scan_request(&tx, workspace, &seed, execution)?;
        let seed = connection_seed(&tx, workspace, &seed.connection_id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    pub(crate) fn atom_connection(&self, id: &str) -> Result<AtomConnectionSeed> {
        if !is_uuid_v4(id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        connection_seed(self.store.raw_connection(), &self.workspace_id, id)
    }

    pub(crate) fn atom_connection_summaries(
        &self,
        execution: Option<(&str, u64)>,
    ) -> Result<Vec<DesktopAtomConnectionSummary>> {
        let (device_id, lease_epoch) = match execution {
            Some((device, epoch)) => (
                Some(device),
                Some(i64::try_from(epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?),
            ),
            None => (None, None),
        };
        let mut query = self.store.raw_connection().prepare(
            "SELECT s.connection_id,s.state,r.observed_count,r.imported_count,r.skipped_count,r.completed_at,
               s.state='prepared' OR EXISTS (
                 SELECT 1 FROM atom_marketplace_pending_scans p
                 WHERE p.workspace_id=s.workspace_id AND p.connection_id=s.connection_id
                   AND p.incarnation_id=s.incarnation_id AND p.device_id=?2 AND p.lease_epoch=?3
               ),
               CASE WHEN s.state='active' AND r.standard_observed_count IS NOT NULL AND NOT EXISTS (
                 SELECT 1 FROM marketplace_listing_observations m
                 JOIN storage_repair_receipts x ON x.workspace_id=m.workspace_id
                   AND x.repair_kind='listing_observation' AND x.row_key=m.listing_observation_id
                 WHERE m.workspace_id=r.workspace_id AND m.observation_run_id=r.observation_run_id
                   AND m.binding_connection_id=r.connection_id AND m.atom_standard_asset_generation IS NOT NULL
               ) THEN json_object('observed',r.standard_observed_count,'sample',json((
                 SELECT json_group_array(entity_id) FROM (
                   SELECT o.entity_id FROM marketplace_listing_observations o
                   WHERE o.workspace_id=r.workspace_id AND o.observation_run_id=r.observation_run_id
                     AND o.binding_connection_id=r.connection_id AND o.atom_standard_asset_generation IS NOT NULL
                     AND o.confirmed=1
                   ORDER BY o.entity_id COLLATE BINARY LIMIT ?4
                 )
               ))) END
             FROM atom_marketplace_connections s
             JOIN local_provider_connections c USING(workspace_id,connection_id)
             LEFT JOIN atom_marketplace_scans r ON r.workspace_id=s.workspace_id
              AND r.scan_id=(SELECT latest.scan_id FROM atom_marketplace_scans latest
                WHERE latest.workspace_id=s.workspace_id AND latest.connection_id=s.connection_id
                ORDER BY latest.rowid DESC LIMIT 1)
             WHERE s.workspace_id=?1 AND s.purged_at IS NULL AND c.deleted_at IS NULL
             ORDER BY s.created_at DESC,s.connection_id",
        ).map_err(storage)?;
        let summaries = query
            .query_map(
                params![
                    self.workspace_id,
                    device_id,
                    lease_epoch,
                    STANDARD_SAMPLE_LIMIT
                ],
                |row| {
                    Ok(DesktopAtomConnectionSummary {
                        connection_id: row.get(0)?,
                        state: read_state(row, 1)?,
                        scan_pending: row.get(6)?,
                        last_scan: if let Some(completed_at) = row.get::<_, Option<String>>(5)? {
                            Some(DesktopAtomInventoryReceipt {
                                observed: row.get(2)?,
                                imported: row.get(3)?,
                                skipped: row.get(4)?,
                                completed_at,
                                standard_review: read_standard_review(row)?,
                            })
                        } else {
                            None
                        },
                    })
                },
            )
            .map_err(storage)?
            .collect::<rusqlite::Result<Vec<_>>>()
            .map_err(storage)?;
        if summaries.len() > usize::from(super::super::settings::MAX_CONNECTIONS) {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        Ok(summaries)
    }

    pub(crate) fn queue_atom_scan<G>(
        &mut self,
        id: &str,
        execution: (&str, u64),
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<AtomConnectionSeed> {
        if !is_uuid_v4(id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let seed = connection_seed(&tx, workspace, id)?;
        let handoff: bool = tx
            .query_row(
                "SELECT EXISTS (SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
                [workspace],
                |row| row.get(0),
            )
            .map_err(storage)?;
        if seed.state == DesktopAtomConnectionState::Revoked || handoff {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if !seed.has_scan_for(execution.0, execution.1) {
            tx.execute(
                "UPDATE atom_marketplace_connections SET scan_pending=1 WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,id],
            ).map_err(storage)?;
            tx.execute(
                "DELETE FROM atom_marketplace_pending_scans WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,id],
            ).map_err(storage)?;
            insert_scan_request(&tx, workspace, &seed, execution)?;
        }
        let seed = connection_seed(&tx, workspace, id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seed)
    }

    /// Absence in a scan can never delete an asset or assert loss of ownership.
    pub(crate) fn import_atom_inventory<G>(
        &mut self,
        input: &AtomInventoryCommit<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopAtomInventoryReceipt> {
        use DesktopAtomConnectionState::{Prepared, Revoked};
        let seed = input.seed;
        let workspace = &self.workspace_id;
        input.validate()?;
        if seed.state == Revoked || !seed.scan_pending {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let request = seed
            .pending
            .as_ref()
            .filter(|_| seed.has_scan_for(input.device_id, input.lease_epoch))
            .ok_or(BusinessDatabaseError::MutationStale)?;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if connection_seed(&tx, workspace, &seed.connection_id)? != *seed {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if seed.state == Prepared {
            tx.execute(
                "UPDATE atom_marketplace_connections SET state='active' WHERE workspace_id=?1 AND connection_id=?2",
                params![workspace,seed.connection_id],
            ).map_err(storage)?;
        }
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='active',credential_use_state='active',
             validation_status='valid',last_validated_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![input.at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let run = &request.id;
        let (observation_run, receipt) = input.write(&tx, workspace, run)?;
        tx.execute(
            "INSERT INTO atom_marketplace_scans (workspace_id,scan_id,connection_id,observation_run_id,
              observed_count,imported_count,skipped_count,completed_at,standard_observed_count)
              VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![workspace,run,seed.connection_id,observation_run,receipt.observed,receipt.imported,receipt.skipped,input.at,
                receipt.standard_review.as_ref().map(|review| review.observed)],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE atom_marketplace_connections SET scan_pending=0 WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace,seed.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1 WHERE singleton=1",
            [input.at],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(receipt)
    }

    pub(crate) fn revoke_atom_connection<G>(
        &mut self,
        seed: &AtomConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<AtomConnectionSeed> {
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if connection_seed(&tx, workspace, &seed.connection_id)? != *seed {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE atom_marketplace_connections SET state='revoked',scan_pending=0 WHERE workspace_id=?1 AND connection_id=?2",
            params![workspace,seed.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='revoked',validation_status='unknown',
               revoked_at=coalesce(revoked_at,?1),active_credential_changed_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let revoked = connection_seed(&tx, workspace, &seed.connection_id)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(revoked)
    }

    pub(crate) fn confirm_atom_purge<G>(
        &mut self,
        seed: &AtomConnectionSeed,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if seed.state != DesktopAtomConnectionState::Revoked
            || connection_seed(&tx, workspace, &seed.connection_id)? != *seed
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        tx.execute(
            "UPDATE atom_marketplace_connections SET purged_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,seed.connection_id],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='deleted',deleted_at=?1 WHERE workspace_id=?2 AND connection_id=?3",
            params![at,workspace,seed.connection_id],
        ).map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}
