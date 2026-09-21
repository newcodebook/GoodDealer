use std::io::{self, Write};
use std::ops::Deref;
use std::path::Path;

use getrandom::fill as fill_random;
use rusqlite::{Connection, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::TempDir;
use zeroize::{Zeroize, Zeroizing};

use crate::active_workspace::business::{BusinessDatabase, BusinessDatabaseError};
use crate::portfolio_projection::{DomainAssetProjectionRow, Money, validate_projection};

const PROJECTION_MAGIC: &[u8; 8] = b"GDBP\0V1\0";
const PROJECTION_VERSION: u8 = 1;
pub(super) const ALLOWLIST_VERSION: u16 = 1;
const DATA_FRAME_LIMIT: usize = 1024 * 1024;
const MAX_PROJECTION_BYTES: usize = 64 * 1024 * 1024;
const MAX_ASSETS: usize = 100_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[cfg(test)]
static ZEROIZED_ASSET_DROPS: std::sync::atomic::AtomicUsize =
    std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
static NONZERO_ASSET_DROPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
static ZEROIZED_WIRE_DROPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
#[cfg(test)]
static NONZERO_WIRE_DROPS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);

#[cfg(test)]
pub(super) fn asset_drop_probe_counts() -> (usize, usize) {
    use std::sync::atomic::Ordering;

    (
        ZEROIZED_ASSET_DROPS.load(Ordering::SeqCst),
        NONZERO_ASSET_DROPS.load(Ordering::SeqCst),
    )
}

#[derive(Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(super) struct ProjectionBody {
    pub(super) schema_version: u8,
    pub(super) allowlist_version: u16,
    pub(super) complete_domain_asset_set: bool,
    pub(super) assets: Vec<SensitiveAsset>,
}

#[derive(Serialize, PartialEq, Eq)]
#[serde(transparent)]
pub(super) struct SensitiveAsset(DomainAssetProjectionRow);

trait Erase {
    fn erase(&mut self);

    #[cfg(test)]
    fn is_erased(&self) -> bool;
}

impl Erase for String {
    fn erase(&mut self) {
        self.zeroize();
    }

    #[cfg(test)]
    fn is_erased(&self) -> bool {
        self.is_empty()
    }
}

impl Erase for Option<String> {
    fn erase(&mut self) {
        self.zeroize();
    }

    #[cfg(test)]
    fn is_erased(&self) -> bool {
        self.as_ref().is_none_or(String::is_empty)
    }
}

impl Erase for Vec<String> {
    fn erase(&mut self) {
        self.zeroize();
    }

    #[cfg(test)]
    fn is_erased(&self) -> bool {
        self.iter().all(String::is_empty)
    }
}

impl Erase for Option<Money> {
    fn erase(&mut self) {
        if let Some(money) = self {
            money.currency.zeroize();
            money.amount.zeroize();
        }
    }

    #[cfg(test)]
    fn is_erased(&self) -> bool {
        self.as_ref()
            .is_none_or(|money| money.currency.is_empty() && money.amount.is_empty())
    }
}

struct SensitiveWireValue<T: Erase>(Option<T>);

impl<T: Erase> SensitiveWireValue<T> {
    fn into_inner(mut self) -> T {
        self.0
            .take()
            .expect("deserialized sensitive value is present")
    }
}

impl<T: Erase> Drop for SensitiveWireValue<T> {
    fn drop(&mut self) {
        if let Some(value) = &mut self.0 {
            value.erase();
            #[cfg(test)]
            if value.is_erased() {
                ZEROIZED_WIRE_DROPS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            } else {
                NONZERO_WIRE_DROPS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }
        }
    }
}

impl<'de, T> Deserialize<'de> for SensitiveWireValue<T>
where
    T: Deserialize<'de> + Erase,
{
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        // The third-party return allocation is moved into its erasing owner in the same expression.
        T::deserialize(deserializer).map(|value| Self(Some(value)))
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SensitiveAssetWire {
    entity_id: SensitiveWireValue<String>,
    note: SensitiveWireValue<Option<String>>,
    portfolio_id: SensitiveWireValue<Option<String>>,
    tags: SensitiveWireValue<Vec<String>>,
    target_price: SensitiveWireValue<Option<Money>>,
}

impl<'de> Deserialize<'de> for SensitiveAsset {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: serde::Deserializer<'de>,
    {
        let wire = SensitiveAssetWire::deserialize(deserializer)?;
        Ok(Self(DomainAssetProjectionRow {
            entity_id: wire.entity_id.into_inner(),
            note: wire.note.into_inner(),
            portfolio_id: wire.portfolio_id.into_inner(),
            tags: wire.tags.into_inner(),
            target_price: wire.target_price.into_inner(),
        }))
    }
}

impl SensitiveAsset {
    pub(super) fn identity_and_tags_mut(&mut self) -> (&str, &mut Vec<String>) {
        (self.0.entity_id.as_str(), &mut self.0.tags)
    }
}

impl Deref for SensitiveAsset {
    type Target = DomainAssetProjectionRow;

    fn deref(&self) -> &Self::Target {
        &self.0
    }
}

impl Drop for SensitiveAsset {
    fn drop(&mut self) {
        zeroize_asset(&mut self.0);
        #[cfg(test)]
        if asset_is_zeroized(&self.0) {
            ZEROIZED_ASSET_DROPS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        } else {
            NONZERO_ASSET_DROPS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
        }
    }
}

pub(super) struct SensitiveDatabaseRow {
    entity_id: String,
    note: Option<String>,
    portfolio_id: Option<String>,
    currency: Option<String>,
    amount: Option<String>,
}

impl SensitiveDatabaseRow {
    pub(super) fn read(row: &rusqlite::Row<'_>) -> rusqlite::Result<Self> {
        let mut value = Self {
            entity_id: String::new(),
            note: None,
            portfolio_id: None,
            currency: None,
            amount: None,
        };
        value.entity_id = row.get(0)?;
        value.note = row.get(1)?;
        value.portfolio_id = row.get(2)?;
        value.currency = row.get(3)?;
        value.amount = row.get(4)?;
        Ok(value)
    }

    pub(super) fn into_sensitive_asset(mut self) -> Result<SensitiveAsset, BusinessDatabaseError> {
        if self.currency.is_some() != self.amount.is_some() {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
        let target_price = if self.currency.is_some() {
            Some(Money {
                currency: self.currency.take().expect("currency presence checked"),
                amount: self.amount.take().expect("amount presence checked"),
            })
        } else {
            None
        };
        Ok(SensitiveAsset(DomainAssetProjectionRow {
            entity_id: std::mem::take(&mut self.entity_id),
            note: self.note.take(),
            portfolio_id: self.portfolio_id.take(),
            tags: Vec::new(),
            target_price,
        }))
    }
}

impl Drop for SensitiveDatabaseRow {
    fn drop(&mut self) {
        self.entity_id.zeroize();
        self.note.zeroize();
        self.portfolio_id.zeroize();
        self.currency.zeroize();
        self.amount.zeroize();
    }
}

struct SensitiveBytes {
    bytes: Vec<u8>,
    #[cfg(test)]
    drop_probe: Option<std::rc::Rc<std::cell::RefCell<Option<Vec<u8>>>>>,
}

impl SensitiveBytes {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            bytes: Vec::with_capacity(capacity),
            #[cfg(test)]
            drop_probe: None,
        }
    }

    fn as_slice(&self) -> &[u8] {
        &self.bytes
    }

    #[cfg(test)]
    fn set_drop_probe(&mut self, probe: std::rc::Rc<std::cell::RefCell<Option<Vec<u8>>>>) {
        self.drop_probe = Some(probe);
    }
}

impl Deref for SensitiveBytes {
    type Target = [u8];

    fn deref(&self) -> &Self::Target {
        self.as_slice()
    }
}

impl Write for SensitiveBytes {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        let new_len = self
            .bytes
            .len()
            .checked_add(buffer.len())
            .filter(|length| *length <= self.bytes.capacity())
            .ok_or_else(|| io::Error::other("sensitive buffer capacity exceeded"))?;
        self.bytes.extend_from_slice(buffer);
        debug_assert_eq!(self.bytes.len(), new_len);
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

impl Drop for SensitiveBytes {
    fn drop(&mut self) {
        self.bytes.as_mut_slice().zeroize();
        #[cfg(test)]
        if let Some(probe) = &self.drop_probe {
            *probe.borrow_mut() = Some(self.bytes.clone());
        }
    }
}

struct ByteCounter(usize);

impl Write for ByteCounter {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        self.0 = self
            .0
            .checked_add(buffer.len())
            .filter(|length| *length <= MAX_PROJECTION_BYTES)
            .ok_or_else(|| io::Error::other("projection size exceeded"))?;
        Ok(buffer.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

/// Bounded deterministic plaintext borrowed by the Host GDBK encoder.
///
/// Raw workspace identity, revision/authority floors, Provider data, credentials, sync-control
/// rows, and catalog rows are deliberately metadata-side and absent from `data_frames`.
pub(super) struct BackupProjection {
    workspace_id: Zeroizing<String>,
    through_local_commit_sequence: u64,
    source_proof_digest: Zeroizing<[u8; 32]>,
    bytes: SensitiveBytes,
}

impl std::fmt::Debug for BackupProjection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("BackupProjection { <redacted> }")
    }
}

impl BackupProjection {
    #[must_use]
    pub(super) fn workspace_id(&self) -> &str {
        self.workspace_id.as_str()
    }

    #[must_use]
    pub(super) const fn through_local_commit_sequence(&self) -> u64 {
        self.through_local_commit_sequence
    }

    #[must_use]
    pub(super) fn source_proof_digest(&self) -> &[u8; 32] {
        &self.source_proof_digest
    }

    #[must_use]
    pub(super) const fn allowlist_version() -> u16 {
        ALLOWLIST_VERSION
    }

    #[must_use]
    pub(super) fn plaintext_bytes(&self) -> usize {
        self.bytes.len()
    }

    /// Fixed one-MiB chunks for the Host container. The caller cannot change projection framing.
    #[must_use]
    pub(super) fn data_frames(&self) -> Vec<&[u8]> {
        self.bytes.as_slice().chunks(DATA_FRAME_LIMIT).collect()
    }
}

/// Opened-connection source. It accepts no path, key, VFS, or workspace selector.
pub(super) struct BackupSource<'a> {
    database: &'a mut BusinessDatabase,
}

impl BusinessDatabase {
    /// Borrows this already-open `SQLCipher` connection as the only backup source.
    #[must_use]
    pub(super) fn backup_source(&mut self) -> BackupSource<'_> {
        BackupSource::from_database(self)
    }
}

impl<'a> BackupSource<'a> {
    const fn from_database(database: &'a mut BusinessDatabase) -> Self {
        Self { database }
    }

    /// Creates a fresh-key encrypted temporary snapshot, projects it, verifies the source proof,
    /// closes it, and synchronously removes the temporary slot before returning any plaintext.
    ///
    /// # Errors
    ///
    /// A snapshot, projection, proof, close, or cleanup failure rejects the operation.
    pub(super) fn snapshot(&mut self) -> Result<BackupProjection, BusinessDatabaseError> {
        self.snapshot_with_hook(|| {})
    }

    fn snapshot_with_hook(
        &mut self,
        after_snapshot_pinned: impl FnOnce(),
    ) -> Result<BackupProjection, BusinessDatabaseError> {
        let workspace_id = Zeroizing::new(self.database.workspace_id().to_owned());
        let temporary = TempDir::new().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let snapshot_path = temporary.path().join("active-workspace.snapshot.db");
        let mut key = Zeroizing::new([0_u8; 32]);
        fill_random(key.as_mut()).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (through_local, through_server) = export_snapshot(
            self.database.backup_connection_mut(),
            &snapshot_path,
            &key,
            workspace_id.as_str(),
            after_snapshot_pinned,
        )?;
        let snapshot = crate::active_workspace::open_keyed(&snapshot_path, &key)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let projection = project_snapshot(
            &snapshot,
            workspace_id.as_str(),
            through_local,
            through_server,
        )?;
        drop(snapshot);
        temporary
            .close()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(projection)
    }
}

fn export_snapshot(
    connection: &Connection,
    destination: &Path,
    key: &[u8; 32],
    workspace_id: &str,
    after_snapshot_pinned: impl FnOnce(),
) -> Result<(u64, u64), BusinessDatabaseError> {
    if destination.exists() {
        return Err(BusinessDatabaseError::StorageRejected);
    }
    let destination_path = destination;
    let destination = destination_path
        .to_str()
        .ok_or(BusinessDatabaseError::StorageRejected)?
        .replace('\'', "''");
    let mut key_hex = Zeroizing::new(String::with_capacity(64));
    for byte in key {
        use std::fmt::Write as _;
        write!(key_hex, "{byte:02x}").map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    // `format!` must return an owned SQL string because rusqlite does not bind SQLCipher raw-key
    // syntax. Transfer that third-party/macro allocation directly into a zeroizing owner and
    // clear it immediately after ATTACH instead of ordinarily dropping a key-bearing `String`.
    let attach_sql = Zeroizing::new(format!(
        "ATTACH DATABASE '{destination}' AS backup_snapshot KEY \"x'{}'\";",
        key_hex.as_str()
    ));
    connection
        .execute_batch(attach_sql.as_str())
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    drop(attach_sql);
    let exported: Result<(u64, u64), BusinessDatabaseError> = (|| {
        connection
            .execute_batch("BEGIN DEFERRED")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let revisions: (i64, i64) = connection
            .query_row(
                "SELECT local_commit_sequence,applied_through_server_revision
                   FROM active_workspace_metadata
                  WHERE singleton=1 AND workspace_id=?1 AND workspace_schema_version=1",
                [workspace_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        after_snapshot_pinned();
        connection
            .query_row("SELECT sqlcipher_export('backup_snapshot')", [], |row| {
                row.get_ref(0).map(|_| ())
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        connection
            .execute_batch("COMMIT")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok((
            bounded_revision(revisions.0)?,
            bounded_revision(revisions.1)?,
        ))
    })();
    if exported.is_err() {
        let _ = connection.execute_batch("ROLLBACK");
    }
    let detached = connection.execute_batch("DETACH DATABASE backup_snapshot");
    match (exported, detached) {
        (Ok(revisions), Ok(())) => {
            std::fs::File::open(destination_path)
                .and_then(|file| file.sync_all())
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            Ok(revisions)
        }
        _ => Err(BusinessDatabaseError::StorageRejected),
    }
}

fn project_snapshot(
    connection: &Connection,
    workspace_id: &str,
    expected_local: u64,
    expected_server: u64,
) -> Result<BackupProjection, BusinessDatabaseError> {
    connection
        .execute_batch("BEGIN DEFERRED")
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    let result = (|| {
        let revisions: (i64, i64) = connection
            .query_row(
                "SELECT local_commit_sequence,applied_through_server_revision
                   FROM active_workspace_metadata
                  WHERE singleton=1 AND workspace_id=?1 AND workspace_schema_version=1",
                [workspace_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| BusinessDatabaseError::WorkspaceRejected)?;
        if bounded_revision(revisions.0)? != expected_local
            || bounded_revision(revisions.1)? != expected_server
        {
            return Err(BusinessDatabaseError::RevisionRejected);
        }
        let mut body = ProjectionBody {
            schema_version: PROJECTION_VERSION,
            allowlist_version: ALLOWLIST_VERSION,
            complete_domain_asset_set: true,
            assets: Vec::new(),
        };
        read_assets(connection, workspace_id, &mut body)?;
        validate_sensitive_projection(&body.assets)?;

        // Count without retaining plaintext so the sole serialized owner can be allocated exactly;
        // `SensitiveBytes::write` rejects growth beyond that capacity and therefore cannot release
        // an earlier allocation containing a plaintext prefix during serialization.
        let mut counter = ByteCounter(0);
        serde_json::to_writer(&mut counter, &body)
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        let body_len =
            u32::try_from(counter.0).map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        let total_len = PROJECTION_MAGIC
            .len()
            .checked_add(4)
            .and_then(|length| length.checked_add(counter.0))
            .filter(|length| *length <= MAX_PROJECTION_BYTES)
            .ok_or(BusinessDatabaseError::ProjectionRejected)?;
        let mut bytes = SensitiveBytes::with_capacity(total_len);
        bytes
            .write_all(PROJECTION_MAGIC)
            .and_then(|()| bytes.write_all(&body_len.to_be_bytes()))
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        serde_json::to_writer(&mut bytes, &body)
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        if bytes.bytes.len() != total_len {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
        let source_proof_digest = Sha256::digest(bytes.as_slice()).into();
        Ok(BackupProjection {
            workspace_id: Zeroizing::new(workspace_id.to_owned()),
            through_local_commit_sequence: expected_local,
            source_proof_digest: Zeroizing::new(source_proof_digest),
            bytes,
        })
    })();
    match result {
        Ok(projection) => {
            connection
                .execute_batch("COMMIT")
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            Ok(projection)
        }
        Err(error) => {
            let _ = connection.execute_batch("ROLLBACK");
            Err(error)
        }
    }
}

fn read_assets(
    connection: &Connection,
    workspace_id: &str,
    body: &mut ProjectionBody,
) -> Result<(), BusinessDatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT a.entity_id,d.note,d.portfolio_id,d.target_price_currency,d.target_price_amount
               FROM domain_assets a JOIN domain_asset_desired_state d
                 ON d.workspace_id=a.workspace_id AND d.entity_id=a.entity_id
              WHERE a.workspace_id=?1 AND a.deleted_at IS NULL
              ORDER BY a.entity_id COLLATE BINARY",
        )
        .map_err(|_| BusinessDatabaseError::SchemaRejected)?;
    let rows = statement
        .query_map([workspace_id], SensitiveDatabaseRow::read)
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for row in rows {
        if body.assets.len() == MAX_ASSETS {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
        let mut asset = row
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?
            .into_sensitive_asset()?;
        let SensitiveAsset(inner) = &mut asset;
        read_tags_into(
            connection,
            workspace_id,
            inner.entity_id.as_str(),
            &mut inner.tags,
        )?;
        body.assets.push(asset);
    }
    Ok(())
}

pub(super) fn read_tags_into(
    connection: &Connection,
    workspace_id: &str,
    entity_id: &str,
    tags: &mut Vec<String>,
) -> Result<(), BusinessDatabaseError> {
    let mut statement = connection
        .prepare(
            "SELECT tag FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2
             ORDER BY tag COLLATE BINARY",
        )
        .map_err(|_| BusinessDatabaseError::SchemaRejected)?;
    let rows = statement
        .query_map(params![workspace_id, entity_id], |row| row.get(0))
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for row in rows {
        // `rusqlite` returns the allocation; moving it directly into the already-zeroizing asset
        // transfers ownership without a plaintext copy or an intermediate collection.
        tags.push(row.map_err(|_| BusinessDatabaseError::ProjectionRejected)?);
    }
    Ok(())
}

fn validate_sensitive_projection(assets: &[SensitiveAsset]) -> Result<(), BusinessDatabaseError> {
    let mut previous: Option<&str> = None;
    for asset in assets {
        if previous.is_some_and(|value| value.as_bytes() >= asset.entity_id.as_bytes()) {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
        validate_projection(std::slice::from_ref(&asset.0))
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        previous = Some(&asset.entity_id);
    }
    Ok(())
}

pub(super) fn zeroize_asset(asset: &mut DomainAssetProjectionRow) {
    asset.entity_id.zeroize();
    asset.note.zeroize();
    asset.portfolio_id.zeroize();
    asset.tags.zeroize();
    if let Some(money) = &mut asset.target_price {
        money.currency.zeroize();
        money.amount.zeroize();
    }
}

#[cfg(test)]
fn asset_is_zeroized(asset: &DomainAssetProjectionRow) -> bool {
    asset.entity_id.is_empty()
        && asset.note.as_ref().is_none_or(String::is_empty)
        && asset.portfolio_id.as_ref().is_none_or(String::is_empty)
        && asset.tags.iter().all(String::is_empty)
        && asset
            .target_price
            .as_ref()
            .is_none_or(|money| money.currency.is_empty() && money.amount.is_empty())
}

pub(super) fn bounded_revision(value: i64) -> Result<u64, BusinessDatabaseError> {
    let value = u64::try_from(value).map_err(|_| BusinessDatabaseError::RevisionRejected)?;
    if value > MAX_SAFE_INTEGER {
        return Err(BusinessDatabaseError::RevisionRejected);
    }
    Ok(value)
}

/// Strict isolated candidate populated only from authenticated GDBK data-frame borrows.
pub(super) struct IsolatedBackupCandidate {
    pub(super) artifact_id: Zeroizing<String>,
    pub(super) candidate_set_version: u64,
    source_proof_digest: Zeroizing<[u8; 32]>,
    pub(super) body: ProjectionBody,
}

impl std::fmt::Debug for IsolatedBackupCandidate {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("IsolatedBackupCandidate { <redacted> }")
    }
}

impl IsolatedBackupCandidate {
    /// # Errors
    ///
    /// Rejects non-canonical, mismatched, truncated, oversized, reordered, duplicate, or unknown
    /// projection content.
    pub(super) fn from_authenticated_frames(
        artifact_id: &str,
        candidate_set_version: u64,
        expected_source_proof_digest: &[u8; 32],
        frames: &[&[u8]],
    ) -> Result<Self, BusinessDatabaseError> {
        crate::portfolio_projection::validate_identifier(artifact_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if candidate_set_version == 0 || candidate_set_version > MAX_SAFE_INTEGER {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let total = frames
            .iter()
            .try_fold(0usize, |sum, frame| {
                if frame.is_empty() || frame.len() > DATA_FRAME_LIMIT {
                    None
                } else {
                    sum.checked_add(frame.len())
                }
            })
            .ok_or(BusinessDatabaseError::ProjectionRejected)?;
        if total == 0 || total > MAX_PROJECTION_BYTES {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
        let mut bytes = SensitiveBytes::with_capacity(total);
        for frame in frames {
            bytes
                .write_all(frame)
                .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
        }
        let digest: [u8; 32] = Sha256::digest(bytes.as_slice()).into();
        if &digest != expected_source_proof_digest {
            return Err(BusinessDatabaseError::ProjectionRejected);
        }
        let body = parse_canonical_projection(bytes.as_slice())?;
        Ok(Self {
            artifact_id: Zeroizing::new(artifact_id.to_owned()),
            candidate_set_version,
            source_proof_digest: Zeroizing::new(digest),
            body,
        })
    }

    #[must_use]
    pub(super) fn source_proof_digest_hex(&self) -> String {
        hex_digest(&self.source_proof_digest[..])
    }
}

fn parse_canonical_projection(bytes: &[u8]) -> Result<ProjectionBody, BusinessDatabaseError> {
    if bytes.len() < PROJECTION_MAGIC.len() + 4 || !bytes.starts_with(PROJECTION_MAGIC) {
        return Err(BusinessDatabaseError::ProjectionRejected);
    }
    let body_len = u32::from_be_bytes(
        bytes[PROJECTION_MAGIC.len()..PROJECTION_MAGIC.len() + 4]
            .try_into()
            .map_err(|_| BusinessDatabaseError::ProjectionRejected)?,
    ) as usize;
    let body_start = PROJECTION_MAGIC.len() + 4;
    if body_start.checked_add(body_len) != Some(bytes.len()) {
        return Err(BusinessDatabaseError::ProjectionRejected);
    }
    let body_bytes = &bytes[body_start..];
    // `serde_json` constructs the returned strings directly in `SensitiveAsset` elements. Each
    // element owns a zeroizing Drop implementation, including elements discarded by a partially
    // failed sequence parse; the authenticated input itself remains in `SensitiveBytes`.
    let body: ProjectionBody = serde_json::from_slice(body_bytes)
        .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
    if body.schema_version != PROJECTION_VERSION
        || body.allowlist_version != ALLOWLIST_VERSION
        || !body.complete_domain_asset_set
        || body.assets.len() > MAX_ASSETS
    {
        return Err(BusinessDatabaseError::ProjectionRejected);
    }
    validate_sensitive_projection(&body.assets)?;
    // The third-party serializer writes into the exact-sized zeroizing owner; no ordinary
    // `Vec<u8>` return value or reallocating plaintext prefix exists on this path.
    let mut canonical = SensitiveBytes::with_capacity(body_bytes.len());
    serde_json::to_writer(&mut canonical, &body)
        .map_err(|_| BusinessDatabaseError::ProjectionRejected)?;
    if canonical.as_slice() != body_bytes {
        return Err(BusinessDatabaseError::ProjectionRejected);
    }
    Ok(body)
}

pub(super) fn hex_digest(value: &[u8]) -> String {
    Sha256::digest(value)
        .iter()
        .fold(String::with_capacity(64), |mut output, byte| {
            use std::fmt::Write as _;
            write!(output, "{byte:02x}").expect("writing into a String cannot fail");
            output
        })
}

#[cfg(test)]
mod tests {
    use tempfile::tempdir;

    use super::*;
    use crate::{BusinessDatabase, DomainAssetWrite, LocalDatabaseKey};

    const TIME: &str = "2026-09-15T08:00:00Z";

    fn asset(entity_id: &str, note: &str) -> DomainAssetWrite {
        DomainAssetWrite {
            entity_id: entity_id.to_owned(),
            note: Some(note.to_owned()),
            portfolio_id: None,
            tags: vec!["alpha".to_owned(), "beta".to_owned()],
            target_price: Some(Money {
                currency: "USD".to_owned(),
                amount: "1200".to_owned(),
            }),
        }
    }

    #[test]
    fn projection_is_deterministic_and_excludes_secret_control_and_catalog_canaries() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x41; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("mutation-z", TIME, &asset("z.example", "z-note"))
            .unwrap();
        database
            .upsert_domain_asset("mutation-a", TIME, &asset("a.example", "a-note"))
            .unwrap();
        let canary = "PROVIDER-CREDENTIAL-AUTHORITY-CANARY";
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO local_provider_connections
             (workspace_id,connection_id,provider_kind,display_label,
              active_credential_changed_at,capabilities_json,credential_use_state,
              active_credential_generation,active_credential_scope_digest,
              active_credential_zone_digest,active_credential_public_proof,validation_status)
             VALUES ('workspace-local','provider-canary','cloudflare',?1,?2,'[]','active',1,
                     ?3,?4,?5,'unknown')",
                params![canary, TIME, "a".repeat(64), "b".repeat(64), "c".repeat(64)],
            )
            .unwrap();
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO sync_reader_state
             (workspace_id,device_id,cursor_generation,read_through_server_revision,
              continuation_token,status,updated_at)
             VALUES ('workspace-local','device-canary',1,0,?1,'active',?2)",
                params![canary, TIME],
            )
            .unwrap();
        database
            .backup_connection_mut()
            .execute(
                "INSERT INTO local_backup_catalog
             (workspace_id,backup_id,backup_class,workspace_schema_version,
              through_local_commit_sequence,through_server_revision,manifest_digest,
              crypto_profile,storage_locator_digest,status,created_at)
             VALUES ('workspace-local','catalog-canary','local_full',1,0,0,?1,?2,?3,'creating',?4)",
                params!["A".repeat(43), canary, "c".repeat(64), TIME],
            )
            .unwrap();

        let first = database.backup_source().snapshot().unwrap();
        let second = database.backup_source().snapshot().unwrap();
        let first_bytes = first.data_frames().concat();
        assert_eq!(first_bytes, second.data_frames().concat());
        assert!(!String::from_utf8_lossy(&first_bytes).contains(canary));
        assert!(!String::from_utf8_lossy(&first_bytes).contains("workspace-local"));
        assert!(!String::from_utf8_lossy(&first_bytes).contains("sync_reader_state"));
        let candidate = IsolatedBackupCandidate::from_authenticated_frames(
            "artifact-1",
            1,
            first.source_proof_digest(),
            &first.data_frames(),
        )
        .unwrap();
        assert_eq!(candidate.body.assets[0].entity_id, "a.example");
        assert_eq!(candidate.body.assets[1].entity_id, "z.example");
    }

    #[test]
    fn wal_writer_after_snapshot_pin_is_not_mixed_into_projection() {
        let directory = tempdir().unwrap();
        let path = directory.path().join("active.db");
        let first_key = LocalDatabaseKey::from_bytes([0x42; 32]);
        let second_key = LocalDatabaseKey::from_bytes([0x42; 32]);
        let mut reader = BusinessDatabase::open(&path, &first_key, "workspace-local").unwrap();
        reader
            .upsert_domain_asset("mutation-old", TIME, &asset("old.example", "old"))
            .unwrap();
        let mut writer = BusinessDatabase::open(&path, &second_key, "workspace-local").unwrap();
        let mut source = BackupSource::from_database(&mut reader);
        let projection = source
            .snapshot_with_hook(|| {
                writer
                    .upsert_domain_asset("mutation-new", TIME, &asset("new.example", "new"))
                    .unwrap();
            })
            .unwrap();
        assert_eq!(projection.through_local_commit_sequence(), 1);
        let candidate = IsolatedBackupCandidate::from_authenticated_frames(
            "artifact-wal",
            1,
            projection.source_proof_digest(),
            &projection.data_frames(),
        )
        .unwrap();
        assert_eq!(candidate.body.assets.len(), 1);
        assert_eq!(candidate.body.assets[0].entity_id, "old.example");
        assert_eq!(writer.recovery_proof().unwrap().local_commit_sequence, 2);
    }

    #[test]
    fn isolated_candidate_rejects_wrong_proof_and_noncanonical_bytes() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x43; 32]);
        let mut database =
            BusinessDatabase::open(&directory.path().join("active.db"), &key, "workspace-local")
                .unwrap();
        database
            .upsert_domain_asset("mutation-a", TIME, &asset("a.example", "a"))
            .unwrap();
        let projection = database.backup_source().snapshot().unwrap();
        let wrong = [0_u8; 32];
        assert_eq!(
            IsolatedBackupCandidate::from_authenticated_frames(
                "artifact-wrong",
                1,
                &wrong,
                &projection.data_frames(),
            )
            .unwrap_err(),
            BusinessDatabaseError::ProjectionRejected
        );
        let mut bytes = projection.data_frames().concat();
        bytes.push(0);
        let digest: [u8; 32] = Sha256::digest(&bytes).into();
        assert_eq!(
            IsolatedBackupCandidate::from_authenticated_frames(
                "artifact-extra",
                1,
                &digest,
                &[bytes.as_slice()],
            )
            .unwrap_err(),
            BusinessDatabaseError::ProjectionRejected
        );
    }

    #[test]
    fn projection_and_candidate_debug_output_is_opaque() {
        let directory = tempdir().unwrap();
        let key = LocalDatabaseKey::from_bytes([0x44; 32]);
        let mut database = BusinessDatabase::open(
            &directory.path().join("active.db"),
            &key,
            "workspace-secret",
        )
        .unwrap();
        database
            .upsert_domain_asset(
                "mutation-secret",
                TIME,
                &asset("secret.example", "plaintext-secret"),
            )
            .unwrap();
        let projection = database.backup_source().snapshot().unwrap();
        let candidate = IsolatedBackupCandidate::from_authenticated_frames(
            "artifact-secret",
            1,
            projection.source_proof_digest(),
            &projection.data_frames(),
        )
        .unwrap();

        assert_eq!(format!("{projection:?}"), "BackupProjection { <redacted> }");
        assert_eq!(
            format!("{candidate:?}"),
            "IsolatedBackupCandidate { <redacted> }"
        );
    }

    #[test]
    fn bounded_plaintext_owners_zeroize_before_releasing_storage() {
        let buffer_probe = std::rc::Rc::new(std::cell::RefCell::new(None));
        {
            let mut bytes = SensitiveBytes::with_capacity(4096);
            bytes.set_drop_probe(std::rc::Rc::clone(&buffer_probe));
            for _ in 0..64 {
                bytes.write_all(&[0x5a; 64]).unwrap();
            }
            assert_eq!(bytes.bytes.capacity(), 4096);
            assert!(bytes.as_slice().iter().all(|byte| *byte == 0x5a));
        }
        let observed = buffer_probe
            .borrow_mut()
            .take()
            .expect("drop probe observes the allocation before release");
        assert_eq!(observed.len(), 4096);
        assert!(observed.iter().all(|byte| *byte == 0));

        let zeroized_before = ZEROIZED_ASSET_DROPS.load(std::sync::atomic::Ordering::SeqCst);
        {
            let _asset = SensitiveAsset(DomainAssetProjectionRow {
                entity_id: "secret.example".to_owned(),
                note: Some("sensitive note".to_owned()),
                portfolio_id: Some("private-portfolio".to_owned()),
                tags: vec!["private-tag".to_owned()],
                target_price: Some(Money {
                    currency: "USD".to_owned(),
                    amount: "1234".to_owned(),
                }),
            });
        }
        assert!(ZEROIZED_ASSET_DROPS.load(std::sync::atomic::Ordering::SeqCst) > zeroized_before);
        assert_eq!(
            NONZERO_ASSET_DROPS.load(std::sync::atomic::Ordering::SeqCst),
            0
        );

        let wire_before = ZEROIZED_WIRE_DROPS.load(std::sync::atomic::Ordering::SeqCst);
        let malformed = serde_json::from_str::<SensitiveAsset>(
            r#"{"entityId":"wire-secret.example","unknown":"reject"}"#,
        );
        assert!(malformed.is_err());
        assert!(ZEROIZED_WIRE_DROPS.load(std::sync::atomic::Ordering::SeqCst) > wire_before);
        assert_eq!(
            NONZERO_WIRE_DROPS.load(std::sync::atomic::Ordering::SeqCst),
            0
        );
    }
}
