//! Portable artifacts open only into an isolated encrypted dataset. This path does not depend
//! on the active workspace's database key, authority, device identity, or revision.

mod codec;
#[cfg(any(target_os = "linux", target_os = "macos", windows))]
mod dialog;
#[cfg(any(target_os = "linux", target_os = "macos"))]
mod native_file;
#[cfg(windows)]
#[path = "portable_backup/native_windows.rs"]
mod native_file;
#[cfg(any(target_os = "linux", target_os = "macos", windows))]
mod workflow;

#[cfg(windows)]
use crate::windows_private_files::PrivateSnapshotDirectory as OfflineDirectory;
use rusqlite::{Connection, params};
use std::io::{self, Write};
#[cfg(not(windows))]
use tempfile::TempDir as OfflineDirectory;
use zeroize::Zeroizing;

use super::source::{ALLOWLIST_VERSION, IsolatedBackupCandidate, private_snapshot_directory};
use crate::portfolio_projection::{DomainAssetProjectionRow, Money, validate_domain_asset_id};
use codec::{PortableArtifactRejected, RecoveryMaterial};

#[derive(Default)]
pub(super) struct Selection {
    opened: Option<(String, OfflineDataset)>,
    #[cfg(any(target_os = "linux", target_os = "macos", windows))]
    import_plan: Option<workflow::ImportPlan>,
}

struct BoundedOutput<'a> {
    target: &'a mut dyn Write,
    written: usize,
}

impl<'a> BoundedOutput<'a> {
    fn new(target: &'a mut dyn Write) -> Self {
        Self { target, written: 0 }
    }

    const fn written(&self) -> usize {
        self.written
    }
}

impl Write for BoundedOutput<'_> {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        let limit = codec::artifact_len(codec::MAX_PROJECTION_LEN);
        if bytes.len() > limit - self.written {
            return Err(io::ErrorKind::InvalidData.into());
        }
        let progress = self.target.write(bytes)?;
        self.written += progress;
        Ok(progress)
    }

    fn flush(&mut self) -> io::Result<()> {
        self.target.flush()
    }
}

struct OfflineDataset {
    // Drop the connection before the private directory and its ciphertext are removed.
    database: Connection,
    #[cfg_attr(
        not(all(test, any(target_os = "linux", target_os = "macos"))),
        allow(
            dead_code,
            reason = "retains the private directory until SQLCipher closes"
        )
    )]
    directory: OfflineDirectory,
    created_at: u64,
    projection_digest: [u8; 32],
}

impl OfflineDataset {
    fn open(
        material: &RecoveryMaterial,
        artifact: &[u8],
    ) -> Result<Self, PortableArtifactRejected> {
        let opened = codec::open(material, artifact)?;
        if opened.manifest.allowlist_version != ALLOWLIST_VERSION
            || !(1..=253_402_300_799).contains(&opened.manifest.created_at)
        {
            return Err(PortableArtifactRejected);
        }
        let frames: Vec<_> = opened.frames().collect();
        let candidate = IsolatedBackupCandidate::from_authenticated_frames(
            "portable-offline",
            1,
            &opened.manifest.projection_digest,
            &frames,
        )
        .map_err(|_| PortableArtifactRejected)?;
        let directory = private_snapshot_directory().map_err(|_| PortableArtifactRejected)?;
        let mut key = Zeroizing::new([0; 32]);
        getrandom::fill(key.as_mut()).map_err(|_| PortableArtifactRejected)?;
        #[cfg(windows)]
        directory.verify().map_err(|_| PortableArtifactRejected)?;
        let mut database = crate::active_workspace::open_keyed(
            &directory.path().join("active-workspace.snapshot.db"),
            &key,
        )
        .map_err(|_| PortableArtifactRejected)?;
        drop(key);
        let transaction = database.transaction().map_err(database_error)?;
        transaction
            .execute_batch(
                "CREATE TABLE recovered_assets (
                entity_id TEXT PRIMARY KEY NOT NULL,
                note TEXT,
                portfolio_id TEXT,
                currency TEXT,
                target_price TEXT,
                CHECK ((currency IS NULL)=(target_price IS NULL))
             ) STRICT;
             CREATE TABLE recovered_asset_tags (
                entity_id TEXT NOT NULL REFERENCES recovered_assets(entity_id),
                tag TEXT NOT NULL,
                PRIMARY KEY (entity_id,tag)
             ) STRICT;
             CREATE TABLE authenticated_projection (
                singleton INTEGER PRIMARY KEY CHECK (singleton=1),
                payload BLOB NOT NULL
             ) STRICT;",
            )
            .map_err(database_error)?;
        {
            let mut insert = transaction.prepare(
                "INSERT INTO recovered_assets (entity_id,note,portfolio_id,currency,target_price)
                 VALUES (?1,?2,?3,?4,?5)",
            ).map_err(database_error)?;
            let mut insert_tag = transaction
                .prepare("INSERT INTO recovered_asset_tags (entity_id,tag) VALUES (?1,?2)")
                .map_err(database_error)?;
            for row in &candidate.body.assets {
                let (currency, amount) = row.target_price.as_ref().map_or((None, None), |money| {
                    (Some(money.currency.as_str()), Some(money.amount.as_str()))
                });
                insert
                    .execute(params![
                        row.entity_id,
                        row.note,
                        row.portfolio_id,
                        currency,
                        amount
                    ])
                    .map_err(database_error)?;
                for tag in &row.tags {
                    insert_tag
                        .execute(params![row.entity_id, tag])
                        .map_err(database_error)?;
                }
            }
        }
        // Rebuilding an import candidate reads the authenticated representation from the same
        // isolated SQLCipher connection, with its original generation facts intact.
        transaction
            .execute(
                "INSERT INTO authenticated_projection (singleton,payload) VALUES (1,?1)",
                [opened.authenticated_projection()],
            )
            .map_err(database_error)?;
        transaction.commit().map_err(database_error)?;
        database
            .pragma_update(None, "query_only", true)
            .map_err(database_error)?;
        #[cfg(windows)]
        directory.verify().map_err(|_| PortableArtifactRejected)?;
        Ok(Self {
            database,
            directory,
            created_at: opened.manifest.created_at,
            projection_digest: opened.manifest.projection_digest,
        })
    }

    fn import_candidate(
        &self,
        artifact_id: &str,
    ) -> Result<IsolatedBackupCandidate, PortableArtifactRejected> {
        let projection = self
            .database
            .query_row(
                "SELECT payload FROM authenticated_projection WHERE singleton=1",
                [],
                |row| row.get::<_, Vec<u8>>(0).map(Zeroizing::new),
            )
            .map_err(database_error)?;
        let frames = codec::projection_frames(&projection).collect::<Vec<_>>();
        IsolatedBackupCandidate::from_authenticated_frames(
            artifact_id,
            1,
            &self.projection_digest,
            &frames,
        )
        .map_err(|_| PortableArtifactRejected)
    }

    fn read(
        &self,
        after: Option<&str>,
        limit: u32,
    ) -> Result<Vec<DomainAssetProjectionRow>, PortableArtifactRejected> {
        if !(1..=100).contains(&limit)
            || after.is_some_and(|domain| validate_domain_asset_id(domain).is_err())
        {
            return Err(PortableArtifactRejected);
        }
        let mut statement = self
            .database
            .prepare(
                "SELECT entity_id,note,portfolio_id,currency,target_price
             FROM recovered_assets WHERE entity_id>?1 ORDER BY entity_id LIMIT ?2",
            )
            .map_err(database_error)?;
        let mut tags = self
            .database
            .prepare("SELECT tag FROM recovered_asset_tags WHERE entity_id=?1 ORDER BY tag")
            .map_err(database_error)?;
        let mut window = Vec::new();
        let mut rows = statement
            .query(params![after.unwrap_or(""), limit])
            .map_err(database_error)?;
        while let Some(row) = rows.next().map_err(database_error)? {
            let entity_id: String = row.get(0).map_err(database_error)?;
            let (currency, amount): (Option<String>, Option<String>) = (
                row.get(3).map_err(database_error)?,
                row.get(4).map_err(database_error)?,
            );
            let target_price = match (currency, amount) {
                (None, None) => None,
                (Some(currency), Some(amount)) => Some(Money { currency, amount }),
                _ => return Err(PortableArtifactRejected),
            };
            let tags = tags
                .query_map([&entity_id], |tag| tag.get(0))
                .map_err(database_error)?
                .collect::<rusqlite::Result<_>>()
                .map_err(database_error)?;
            window.push(DomainAssetProjectionRow {
                entity_id,
                note: row.get(1).map_err(database_error)?,
                portfolio_id: row.get(2).map_err(database_error)?,
                tags,
                target_price,
            });
        }
        Ok(window)
    }
}

fn database_error(_: rusqlite::Error) -> PortableArtifactRejected {
    PortableArtifactRejected
}

#[cfg(all(test, any(target_os = "linux", target_os = "macos")))]
#[test]
fn an_exported_workspace_can_be_read_after_removing_the_source_database_and_key() {
    use crate::{BusinessDatabase, DomainAssetWrite, LocalDatabaseKey};
    let dir = crate::test_tempdir::tempdir().unwrap();
    let selected = native_file::SelectedPath::admit(&dir.path().join("portable.gdbk")).unwrap();
    let material = {
        let source = crate::test_tempdir::tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x61; 32]);
        let mut database =
            BusinessDatabase::open(&source.path().join("workspace.db"), &key, "workspace-local")
                .unwrap();
        let write = DomainAssetWrite {
            entity_id: "example.test".into(),
            note: Some("portable-offline-canary".into()),
            portfolio_id: None,
            tags: vec!["recovered".into()],
            target_price: Some(Money {
                currency: "USD".into(),
                amount: "1234".into(),
            }),
        };
        database
            .upsert_domain_asset("recovery-sample", "2026-11-20T00:00:00Z", &write)
            .unwrap();
        let projection = database.backup_source().snapshot().unwrap();
        let manifest = codec::Manifest {
            created_at: 1_795_132_800,
            allowlist_version: ALLOWLIST_VERSION,
            projection_digest: *projection.source_proof_digest(),
        };
        let material = RecoveryMaterial::generate().unwrap();
        let artifact = codec::seal(&material, manifest, &projection.data_frames()).unwrap();
        assert_eq!(
            selected.publish(&artifact, || Ok(())),
            Ok(native_file::Publication::Durable)
        );
        material.encode().unwrap()
    };

    let figure = selected.read_artifact().unwrap();
    let offline = OfflineDataset::open(
        &RecoveryMaterial::parse(material.as_ref()).unwrap(),
        &figure,
    )
    .unwrap();
    assert_eq!(offline.created_at, 1_795_132_800);
    let rows = offline.read(None, 1).unwrap();
    assert_eq!(rows[0].entity_id, "example.test");
    assert_eq!(rows[0].note.as_deref(), Some("portable-offline-canary"));
    assert!(offline.read(Some("example.test"), 1).unwrap().is_empty());
    assert!(
        offline
            .database
            .execute("DELETE FROM recovered_assets", [])
            .is_err()
    );
    let file = offline
        .directory
        .path()
        .join("active-workspace.snapshot.db");
    let unkeyed = Connection::open(&file).unwrap();
    assert!(
        unkeyed
            .query_row("SELECT count(*) FROM recovered_assets", [], |row| row
                .get::<_, i64>(0))
            .is_err()
    );
    drop(unkeyed);
    drop(offline);
    assert!(!file.exists());
}
