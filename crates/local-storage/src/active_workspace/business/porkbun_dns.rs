//! `Porkbun` DNS read evidence and the asset's Zone binding, owned by the workspace business writer.
//!
//! A read is committed only as complete evidence: one run, its single target, the Zone observation
//! and every record land in one transaction with the receipt and the binding. Porkbun evidence
//! stays local; it has no Cloud projection.
use super::{
    BusinessDatabase, BusinessDatabaseError, afternic::random_id, hex_digest,
    porkbun_registrar::connection_seed,
};
use crate::active_workspace::business::{DesktopPorkbunConnectionState, PorkbunConnectionSeed};
use rusqlite::{Connection, OptionalExtension, TransactionBehavior, params};
use serde::Serialize;
use std::collections::BTreeSet;

type Result<T> = std::result::Result<T, BusinessDatabaseError>;

/// The 16 record types Porkbun's create request enumerates (`OpenAPI` v3.112). The Native parser
/// admits only these; storage re-checks because this is its own trust boundary.
const RECORD_TYPES: [&str; 16] = [
    "A",
    "AAAA",
    "MX",
    "CNAME",
    "ALIAS",
    "TXT",
    "NS",
    "SRV",
    "TLSA",
    "CAA",
    "SSHFP",
    "HTTPS",
    "SVCB",
    "DS",
    "SMIMEA",
    "OPENPGPKEY",
];
/// The local single-read Zone evidence cap shared with Cloudflare and `GoDaddy`.
const MAX_RECORDS: usize = 1024;
const MAX_CONTENT_BYTES: usize = 4096;
const CONNECTOR_VERSION: &str = "porkbun-dns-v3";

/// One record exactly as the Native Porkbun read accepted it.
pub struct DesktopPorkbunDnsRecord {
    pub record_id: String,
    pub owner_name_ascii: String,
    pub record_type: String,
    pub content: String,
    pub ttl_seconds: u32,
    pub priority: Option<u16>,
}

/// Public result of one committed read. Record values stay in the Host.
#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopPorkbunDnsReceipt {
    pub record_count: u32,
    /// `GoodDealer`'s inference from a Porkbun `warnings` entry; `false` proves nothing.
    pub answered_elsewhere: bool,
    /// The Zone binding after this read. It stays `unverified` until a delegation check exists.
    pub binding_status: String,
    pub observed_at: String,
}

pub(crate) struct PorkbunDnsCommit<'a> {
    pub seed: &'a PorkbunConnectionSeed,
    pub entity_id: &'a str,
    pub records: &'a [DesktopPorkbunDnsRecord],
    pub answered_elsewhere: bool,
    pub at: &'a str,
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

fn owner_in_zone(owner: &str, zone: &str) -> bool {
    owner.len() <= 253
        && owner.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || b"-_.*".contains(&byte)
        })
        && (owner == zone
            || owner
                .strip_suffix(zone)
                .and_then(|prefix| prefix.strip_suffix('.'))
                .is_some_and(|label| !label.is_empty() && !label.contains("..")))
}

/// Re-validates the Native result and returns its canonical digest. Sorting by the unique record
/// ID makes the digest independent of response order.
fn validate_records(zone: &str, records: &[DesktopPorkbunDnsRecord]) -> Result<String> {
    if records.len() > MAX_RECORDS {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let mut ids = BTreeSet::new();
    let mut canonical = Vec::with_capacity(records.len());
    for record in records {
        let id = &record.record_id;
        let decimal = (1..=20).contains(&id.len())
            && id.bytes().all(|byte| byte.is_ascii_digit())
            && (id == "0" || !id.starts_with('0'));
        if !decimal
            || !ids.insert(id.as_str())
            || !owner_in_zone(&record.owner_name_ascii, zone)
            || !RECORD_TYPES.contains(&record.record_type.as_str())
            || record.content.is_empty()
            || record.content.len() > MAX_CONTENT_BYTES
            || record.content.chars().any(char::is_control)
            || record.ttl_seconds == 0
            || i32::try_from(record.ttl_seconds).is_err()
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        canonical.push((
            id.as_str(),
            record.owner_name_ascii.as_str(),
            record.record_type.as_str(),
            record.content.as_str(),
            record.ttl_seconds,
            record.priority,
        ));
    }
    canonical.sort_unstable_by(|left, right| left.0.cmp(right.0));
    let mut tuples = canonical
        .iter()
        .map(|tuple| (tuple.1, tuple.2, tuple.3, tuple.4, tuple.5))
        .collect::<Vec<_>>();
    tuples.sort_unstable();
    if tuples.windows(2).any(|pair| pair[0] == pair[1]) {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let bytes = serde_json::to_vec(&canonical).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    Ok(hex_digest(
        &[b"gooddealer:porkbun:dns:v1\0".as_slice(), &bytes].concat(),
    ))
}

/// Whether the asset is in the connection's latest complete Porkbun inventory scan.
fn in_latest_scan(
    tx: &Connection,
    workspace: &str,
    connection: &str,
    entity: &str,
) -> Result<bool> {
    tx.query_row(
        "SELECT EXISTS (
           SELECT 1 FROM domain_assets a JOIN registrar_observations o
             ON o.workspace_id=a.workspace_id AND o.entity_id=a.entity_id
          WHERE a.workspace_id=?1 AND a.entity_id=?2 AND a.deleted_at IS NULL
            AND o.registrar_name='Porkbun'
            AND o.observation_run_id=(
              SELECT r.observation_run_id FROM porkbun_registrar_scans r
               WHERE r.workspace_id=?1 AND r.connection_id=?3 ORDER BY r.rowid DESC LIMIT 1))",
        params![workspace, entity, connection],
        |row| row.get(0),
    )
    .map_err(storage)
}

/// The asset's Zone binding this read may write: the binding digest and, when this connection
/// already holds the binding, its status.
struct ZoneAdmission {
    resource: String,
    existing: Option<String>,
}

/// Admits one read of `entity` through `seed`, before the Provider call and again in the commit.
///
/// Only the credential identity is fenced: an inventory refresh in between does not make the key
/// that reads the Zone any less current. Any other Zone binding, live or detached, keeps the asset:
/// ADR-0027 keeps one Zone binding per asset and replacing it waits on ADR-0033.
fn admit(
    tx: &Connection,
    workspace: &str,
    seed: &PorkbunConnectionSeed,
    entity: &str,
) -> Result<ZoneAdmission> {
    crate::portfolio_projection::validate_domain_asset_id(entity)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let current = connection_seed(tx, workspace, &seed.connection_id)?;
    let handoff: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1)",
            [workspace],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if seed.state != DesktopPorkbunConnectionState::Active
        || current.state != DesktopPorkbunConnectionState::Active
        || current.incarnation_id != seed.incarnation_id
        || current.credential_proof != seed.credential_proof
        || handoff
    {
        return Err(BusinessDatabaseError::MutationStale);
    }
    if !in_latest_scan(tx, workspace, &seed.connection_id, entity)? {
        return Err(BusinessDatabaseError::ProviderBindingUnavailable);
    }
    let resource = hex_digest(
        format!(
            "gooddealer:porkbun:zone:v1:{}:{entity}",
            seed.incarnation_id
        )
        .as_bytes(),
    );
    let existing: Option<(String, String, String, String)> = tx
        .query_row(
            "SELECT connection_id,provider_kind,resource_binding_digest,validation_status
               FROM domain_asset_provider_bindings
              WHERE workspace_id=?1 AND entity_id=?2 AND resource_kind='zone'",
            params![workspace, entity],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(storage)?;
    let existing = match existing {
        None => None,
        Some((connection, provider, digest, status))
            if connection == seed.connection_id
                && provider == "porkbun"
                && digest == resource
                && status != "detached" =>
        {
            Some(status)
        }
        Some(_) => return Err(BusinessDatabaseError::MutationConflict),
    };
    // Binding hides every other platform's evidence and nothing detaches it yet (ADR-0033), so a
    // first binding is never taken over an asset whose Cloudflare Zone is already observed.
    let cloudflare_observed: bool = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM cloudflare_dns_projection_heads
                             WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace, entity],
            |row| row.get(0),
        )
        .map_err(storage)?;
    if existing.is_none() && cloudflare_observed {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    Ok(ZoneAdmission { resource, existing })
}

/// Creates the asset's first Zone binding as `unverified` or refreshes this connection's own,
/// keeping its status. Returns the binding status after the write.
fn bind_zone(
    tx: &Connection,
    workspace: &str,
    seed: &PorkbunConnectionSeed,
    entity: &str,
    admission: ZoneAdmission,
    observation_digest: &str,
    at: &str,
) -> Result<String> {
    let ZoneAdmission { resource, existing } = admission;
    let sequence: i64 = tx
        .query_row(
            "UPDATE active_workspace_metadata SET local_commit_sequence=local_commit_sequence+1,
               updated_at=?1 WHERE singleton=1 RETURNING local_commit_sequence",
            [at],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::SequenceExhausted)?;
    if let Some(status) = existing {
        tx.execute(
            "UPDATE domain_asset_provider_bindings SET observation_digest=?1,local_commit_sequence=?2,
               last_observed_at=?3,updated_at=?3
             WHERE workspace_id=?4 AND entity_id=?5 AND resource_kind='zone' AND connection_id=?6
               AND resource_binding_digest=?7",
            params![observation_digest, sequence, at, workspace, entity, seed.connection_id, resource],
        )
        .map_err(storage)?;
        Ok(status)
    } else {
        tx.execute(
            "INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,
               resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,
               local_commit_sequence,validation_status,last_observed_at,created_at,updated_at)
             VALUES (?1,?2,?3,'porkbun','zone',?4,?5,?2,1,?6,'unverified',?7,?7,?7)",
            params![workspace, entity, seed.connection_id, resource, observation_digest, sequence, at],
        )
        .map_err(storage)?;
        Ok("unverified".to_owned())
    }
}

/// Writes the run, its single target, the Zone observation, every record and the receipt.
/// Returns the record count.
fn write_evidence(
    tx: &Connection,
    workspace: &str,
    input: &PorkbunDnsCommit<'_>,
    digest: &str,
) -> Result<u32> {
    let run = random_id()?;
    let zone_observation = random_id()?;
    let count =
        u32::try_from(input.records.len()).map_err(|_| BusinessDatabaseError::InvalidInput)?;
    tx.execute(
        "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,
           observation_capability,started_at,status,connector_version)
         VALUES (?1,?2,?3,'dns',?4,'running',?5)",
        params![
            workspace,
            run,
            input.seed.connection_id,
            input.at,
            CONNECTOR_VERSION
        ],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,
           status,requested_at) VALUES (?1,?2,?3,0,'requested',?4)",
        params![workspace, run, input.entity_id, input.at],
    )
    .map_err(storage)?;
    // Porkbun's read reports neither nameservers nor DNSSEC; both stay unknown rather than
    // empty proof. `normalized_evidence_sha256` and the version token carry the record digest.
    tx.execute(
        "INSERT INTO dns_zone_observations (workspace_id,zone_observation_id,observation_run_id,entity_id,
           zone_name_ascii,authoritative_nameservers_json,dnssec_status,observation_availability,
           evidence_status,observed_at,provider_version_token,normalized_evidence_sha256)
         VALUES (?1,?2,?3,?4,?4,'[]','unknown','available',?5,?6,?7,?7)",
        params![
            workspace,
            zone_observation,
            run,
            input.entity_id,
            if input.answered_elsewhere { "conflicted" } else { "confirmed" },
            input.at,
            digest
        ],
    )
    .map_err(storage)?;
    for record in input.records {
        tx.execute(
            "INSERT INTO dns_record_observations (workspace_id,zone_observation_id,record_key,record_type,
               owner_name_ascii,ttl_seconds,priority,canonical_value,proxied)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,NULL)",
            params![
                workspace,
                zone_observation,
                record.record_id,
                record.record_type,
                record.owner_name_ascii,
                i64::from(record.ttl_seconds),
                record.priority.map(i64::from),
                record.content
            ],
        )
        .map_err(storage)?;
    }
    tx.execute(
        "UPDATE provider_observation_targets SET status='succeeded',completed_at=?1
         WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4 AND status='requested'",
        params![input.at, workspace, run, input.entity_id],
    )
    .map_err(storage)?;
    tx.execute(
        "UPDATE provider_observation_runs SET status='succeeded',completed_at=?1
         WHERE workspace_id=?2 AND observation_run_id=?3 AND status='running'",
        params![input.at, workspace, run],
    )
    .map_err(storage)?;
    tx.execute(
        "INSERT INTO porkbun_dns_reads (workspace_id,observation_run_id,connection_id,entity_id,
           record_count,answered_elsewhere,completed_at) VALUES (?1,?2,?3,?4,?5,?6,?7)",
        params![
            workspace,
            run,
            input.seed.connection_id,
            input.entity_id,
            count,
            input.answered_elsewhere,
            input.at
        ],
    )
    .map_err(storage)?;
    Ok(count)
}

impl BusinessDatabase {
    /// Refuses, before any Provider call, a read the commit would refuse for its connection, asset
    /// or Zone binding. The commit re-checks all of it.
    ///
    /// # Errors
    /// The same refusals as [`Self::commit_porkbun_dns_observation`], without record checks.
    pub(crate) fn porkbun_dns_preflight(
        &self,
        seed: &PorkbunConnectionSeed,
        entity_id: &str,
    ) -> Result<()> {
        admit(
            self.store.raw_connection(),
            &self.workspace_id,
            seed,
            entity_id,
        )
        .map(|_| ())
    }

    /// Commits one complete Porkbun DNS read of an asset in this connection's latest inventory.
    ///
    /// # Errors
    /// Malformed records are `InvalidInput`; a changed, revoked or handed-off connection is
    /// `MutationStale`; an asset outside the latest scan is `ProviderBindingUnavailable`; an asset
    /// whose Zone is bound elsewhere is `MutationConflict`. Every refusal writes nothing.
    pub(crate) fn commit_porkbun_dns_observation<G>(
        &mut self,
        input: &PorkbunDnsCommit<'_>,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<DesktopPorkbunDnsReceipt> {
        crate::portfolio_projection::validate_domain_asset_id(input.entity_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        super::validate_timestamp(Some(input.at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let digest = validate_records(input.entity_id, input.records)?;
        let seed = input.seed;
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let admission = admit(&tx, workspace, seed, input.entity_id)?;
        // Porkbun answering that the Zone is served elsewhere is no basis for a first binding.
        if input.answered_elsewhere && admission.existing.is_none() {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let status = bind_zone(
            &tx,
            workspace,
            seed,
            input.entity_id,
            admission,
            &digest,
            input.at,
        )?;
        let count = write_evidence(&tx, workspace, input, &digest)?;
        tx.execute(
            "UPDATE active_workspace_metadata SET last_successful_provider_observation_at=?1,updated_at=?1
             WHERE singleton=1",
            [input.at],
        )
        .map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(DesktopPorkbunDnsReceipt {
            record_count: count,
            answered_elsewhere: input.answered_elsewhere,
            binding_status: status,
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
    const ZONE: &str = "porkbun-dns.test";

    fn record(id: &str, owner: &str, kind: &str, content: &str) -> DesktopPorkbunDnsRecord {
        DesktopPorkbunDnsRecord {
            record_id: id.to_owned(),
            owner_name_ascii: owner.to_owned(),
            record_type: kind.to_owned(),
            content: content.to_owned(),
            ttl_seconds: 600,
            priority: None,
        }
    }

    fn records() -> Vec<DesktopPorkbunDnsRecord> {
        vec![
            record("101", ZONE, "A", "192.0.2.1"),
            record("102", &format!("www.{ZONE}"), "CNAME", ZONE),
            DesktopPorkbunDnsRecord {
                priority: Some(10),
                ..record("103", ZONE, "MX", "mail.example.net")
            },
            record("104", ZONE, "TXT", "v=spf1 -all"),
        ]
    }

    /// An active Porkbun connection whose latest scan holds `ZONE`.
    fn connected(key: u8) -> (TestDatabase, PorkbunConnectionSeed) {
        let mut db = TestDatabase::open([key; 32]);
        let seed = db
            .prepare_porkbun_connection("Porkbun", AT, EXECUTION, || Ok(()))
            .unwrap();
        let fact = DesktopRegistrationFact {
            domain: ZONE.to_owned(),
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
        rows: &[DesktopPorkbunDnsRecord],
        answered_elsewhere: bool,
        at: &str,
    ) -> Result<DesktopPorkbunDnsReceipt> {
        db.commit_porkbun_dns_observation(
            &PorkbunDnsCommit {
                seed,
                entity_id,
                records: rows,
                answered_elsewhere,
                at,
            },
            || Ok(()),
        )
    }

    /// (DNS runs, Zone observations, records, receipts, Zone bindings)
    fn counts(db: &BusinessDatabase) -> (i64, i64, i64, i64, i64) {
        db.store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM provider_observation_runs WHERE observation_capability='dns'),
                   (SELECT count(*) FROM dns_zone_observations),
                   (SELECT count(*) FROM dns_record_observations),
                   (SELECT count(*) FROM porkbun_dns_reads),
                   (SELECT count(*) FROM domain_asset_provider_bindings WHERE resource_kind='zone')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
            )
            .unwrap()
    }

    #[test]
    fn a_complete_read_lands_as_local_evidence_with_an_unverified_binding() {
        let (mut db, seed) = connected(0x81);
        let receipt = commit(&mut db, &seed, ZONE, &records(), false, AT).unwrap();
        assert_eq!(
            receipt,
            DesktopPorkbunDnsReceipt {
                record_count: 4,
                answered_elsewhere: false,
                binding_status: "unverified".to_owned(),
                observed_at: AT.to_owned(),
            }
        );
        assert_eq!(counts(&db), (1, 1, 4, 1, 1));
        let (provider, status, verified): (String, String, Option<String>) = db
            .store
            .raw_connection()
            .query_row(
                "SELECT provider_kind,validation_status,verified_at FROM domain_asset_provider_bindings
                 WHERE entity_id=?1 AND resource_kind='zone'",
                [ZONE],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (provider.as_str(), status.as_str(), verified),
            ("porkbun", "unverified", None)
        );
        // Nothing is queued for Cloud: Porkbun DNS evidence stays local.
        let cloud: i64 = db
            .store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM sync_outbox WHERE entity_kind<>'domain_asset')
                   + (SELECT count(*) FROM cloudflare_dns_projection_outbox)",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(cloud, 0);

        // A later read, even one reporting another nameserver, refreshes the same binding.
        let receipt = commit(&mut db, &seed, ZONE, &records()[..1], true, LATER).unwrap();
        assert_eq!(
            (receipt.record_count, receipt.answered_elsewhere),
            (1, true)
        );
        assert_eq!(counts(&db), (2, 2, 5, 2, 1));
        let evidence: String = db
            .store
            .raw_connection()
            .query_row(
                "SELECT evidence_status FROM dns_zone_observations ORDER BY observed_at DESC LIMIT 1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(evidence, "conflicted");
        // DNS health shows the bound connection's latest read, attributed to Porkbun, and counts
        // it as a warning: no Zone status, and here another nameserver may be answering.
        let health = db.read_dns_health(0, 10, "").unwrap();
        assert_eq!((health.observed_count, health.warning_count), (1, 1));
        let row = &health.window.rows[0];
        let binding = row.zone_binding.as_ref().unwrap();
        assert_eq!(
            (
                binding.provider_kind.as_str(),
                binding.validation_status.as_str()
            ),
            ("porkbun", "unverified")
        );
        let observation = row.observation.as_ref().unwrap();
        assert_eq!(
            (
                observation.provider_kind.as_str(),
                observation.observed_at.as_str(),
                observation.evidence_status.as_str(),
                observation.zone_status.as_str(),
                observation.record_counts.a,
                observation.authoritative_nameservers.len(),
            ),
            ("porkbun", LATER, "conflicted", "unknown", 1, 0)
        );
        assert!(!row.bindable);
        for statement in [
            "UPDATE porkbun_dns_reads SET record_count=0",
            "DELETE FROM porkbun_dns_reads",
        ] {
            assert!(
                db.store
                    .fixture_connection()
                    .execute(statement, [])
                    .is_err()
            );
        }
    }

    #[test]
    fn malformed_records_are_refused_before_anything_is_written() {
        let (mut db, seed) = connected(0x82);
        let base = records();
        let mut cases: Vec<Vec<DesktopPorkbunDnsRecord>> = vec![
            vec![record("1", ZONE, "SOA", "ns.example.net")],
            vec![record("1", "example.org", "A", "192.0.2.1")],
            vec![record("1", &format!("x{ZONE}"), "A", "192.0.2.1")],
            vec![record("1", &format!(".{ZONE}"), "A", "192.0.2.1")],
            vec![record("1", &format!("WWW.{ZONE}"), "A", "192.0.2.1")],
            vec![record("1", ZONE, "TXT", "line\nbreak")],
            vec![record("1", ZONE, "TXT", "")],
            vec![record("1", ZONE, "TXT", &"x".repeat(MAX_CONTENT_BYTES + 1))],
            vec![record("01", ZONE, "A", "192.0.2.1")],
            vec![record("1a", ZONE, "A", "192.0.2.1")],
            vec![
                record("1", ZONE, "A", "192.0.2.1"),
                record("1", ZONE, "A", "192.0.2.2"),
            ],
            vec![
                record("1", ZONE, "A", "192.0.2.1"),
                record("2", ZONE, "A", "192.0.2.1"),
            ],
            vec![DesktopPorkbunDnsRecord {
                ttl_seconds: 0,
                ..record("1", ZONE, "A", "192.0.2.1")
            }],
            (0..=MAX_RECORDS)
                .map(|index| record(&(index + 1).to_string(), ZONE, "TXT", &index.to_string()))
                .collect(),
        ];
        cases.push(
            base.into_iter()
                .chain([record("9", ZONE, "a", "192.0.2.9")])
                .collect(),
        );
        for rows in &cases {
            assert_eq!(
                commit(&mut db, &seed, ZONE, rows, false, AT),
                Err(BusinessDatabaseError::InvalidInput)
            );
        }
        assert_eq!(
            commit(&mut db, &seed, "Porkbun-DNS.test", &[], false, AT),
            Err(BusinessDatabaseError::InvalidInput)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0, 0));
    }

    #[test]
    fn an_asset_outside_the_latest_scan_or_bound_elsewhere_is_refused() {
        let (mut db, seed) = connected(0x83);
        let other = super::super::DomainAssetWrite {
            entity_id: "other.test".to_owned(),
            note: None,
            portfolio_id: None,
            tags: Vec::new(),
            target_price: None,
        };
        db.upsert_domain_asset("seed-other", AT, &other).unwrap();
        assert_eq!(
            commit(&mut db, &seed, "other.test", &[], false, AT),
            Err(BusinessDatabaseError::ProviderBindingUnavailable)
        );
        assert_eq!(
            db.porkbun_dns_preflight(&seed, "other.test"),
            Err(BusinessDatabaseError::ProviderBindingUnavailable)
        );
        db.porkbun_dns_preflight(&seed, ZONE).unwrap();
        let cloudflare = "cf-connection";
        db.store
            .fixture_connection()
            .execute_batch(&format!(
                "INSERT INTO local_provider_connections (workspace_id,connection_id,provider_kind,display_label,
                   active_credential_changed_at,capabilities_json,credential_use_state)
                 VALUES ('workspace-local','{cloudflare}','cloudflare','Cloudflare','{AT}','[]','inactive');
                 INSERT INTO domain_asset_provider_bindings (workspace_id,entity_id,connection_id,provider_kind,
                   resource_kind,resource_binding_digest,observation_digest,resource_label,binding_generation,
                   local_commit_sequence,validation_status,created_at,updated_at)
                 VALUES ('workspace-local','{ZONE}','{cloudflare}','cloudflare','zone','{a}','{b}','{ZONE}',1,1,
                   'detached','{AT}','{AT}');",
                a = "a".repeat(64),
                b = "b".repeat(64),
            ))
            .unwrap();
        // Even a detached binding from another platform keeps the asset until ADR-0033 decides.
        assert_eq!(
            db.porkbun_dns_preflight(&seed, ZONE),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(
            commit(&mut db, &seed, ZONE, &records(), false, AT),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0, 1));
    }

    #[test]
    fn a_first_read_never_binds_over_other_evidence() {
        let (mut db, seed) = connected(0x85);
        // Porkbun answering that another nameserver serves the Zone is no basis for binding it.
        assert_eq!(
            commit(&mut db, &seed, ZONE, &records(), true, AT),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0, 0));
        // An asset whose Cloudflare Zone is already observed keeps that evidence visible.
        db.store
            .fixture_connection()
            .execute(
                "INSERT INTO cloudflare_dns_projection_heads (workspace_id,entity_id,lease_epoch,
                   source_sequence,observation_id,observed_at,projection_digest,updated_at)
                 VALUES ('workspace-local',?1,1,1,'cf-observation',?2,?3,?2)",
                params![ZONE, AT, "c".repeat(64)],
            )
            .unwrap();
        assert_eq!(
            db.porkbun_dns_preflight(&seed, ZONE),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(
            commit(&mut db, &seed, ZONE, &records(), false, AT),
            Err(BusinessDatabaseError::MutationConflict)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0, 0));
    }

    #[test]
    fn a_replaced_revoked_or_fenced_connection_writes_nothing() {
        let (mut db, seed) = connected(0x84);
        assert_eq!(
            db.commit_porkbun_dns_observation(
                &PorkbunDnsCommit {
                    seed: &seed,
                    entity_id: ZONE,
                    records: &records(),
                    answered_elsewhere: false,
                    at: AT,
                },
                || -> Result<()> { Err(BusinessDatabaseError::MutationStale) },
            ),
            Err(BusinessDatabaseError::MutationStale)
        );
        let mut forged = db.porkbun_connection(&seed.connection_id).unwrap();
        forged.credential_proof = "f".repeat(64);
        assert_eq!(
            commit(&mut db, &forged, ZONE, &records(), false, AT),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.store
            .fixture_connection()
            .execute(
                "INSERT INTO device_handoff_barriers(workspace_id,device_switch_request_id,began_at)
                 VALUES ('workspace-local','test-switch',?1)",
                [AT],
            )
            .unwrap();
        assert_eq!(
            commit(&mut db, &seed, ZONE, &records(), false, AT),
            Err(BusinessDatabaseError::MutationStale)
        );
        db.store
            .fixture_connection()
            .execute("DELETE FROM device_handoff_barriers", [])
            .unwrap();
        db.revoke_porkbun_connection(&seed, AT, || Ok(())).unwrap();
        assert_eq!(
            commit(&mut db, &seed, ZONE, &records(), false, AT),
            Err(BusinessDatabaseError::MutationStale)
        );
        assert_eq!(counts(&db), (0, 0, 0, 0, 0));
    }
}
