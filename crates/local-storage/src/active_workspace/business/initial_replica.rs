//! Frozen Cloud projection reconstruction and one guarded first-install transaction.
//! This path never creates a normal sync-reader token or imports Provider-owned state.
use super::{
    BusinessDatabase, BusinessDatabaseError, DomainAssetWrite, Money, SyncPageV2, append_frame,
    canonical_page_digest, canonical_wire_value, validate_cursor_token, validate_domain_asset,
    validate_domain_asset_id, validate_identifier, validate_sync_mutation_fields,
    validate_timestamp,
};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::OptionalExtension as _;
use rusqlite::{Connection, Transaction, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Asset {
    entity_id: String,
    entity_generation: u64,
    #[serde(deserialize_with = "required_option")]
    note: Option<String>,
    #[serde(deserialize_with = "required_option")]
    portfolio_id: Option<String>,
    tags: Vec<String>,
    #[serde(deserialize_with = "required_option")]
    target_price: Option<Money>,
}
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Tombstone {
    entity_id: String,
    entity_generation: u64,
    deleted_server_revision: u64,
    deleted_at: String,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct InitialReplicaProjection {
    assets: Vec<Asset>,
    tombstones: Vec<Tombstone>,
}
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub(crate) struct InitialReplicaReceipt {
    pub(crate) workflow_id: String,
    pub(crate) target_device_id: String,
    pub(crate) target_server_revision: u64,
    pub(crate) workspace_schema_version: u64,
    pub(crate) replica_digest: String,
}
fn required_option<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(
    d: D,
) -> Result<Option<T>, D::Error> {
    Option::deserialize(d)
}
fn invalid() -> BusinessDatabaseError {
    BusinessDatabaseError::InvalidInput
}
fn storage() -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
impl Asset {
    fn write(&self) -> DomainAssetWrite {
        DomainAssetWrite {
            entity_id: self.entity_id.clone(),
            note: self.note.clone(),
            portfolio_id: self.portfolio_id.clone(),
            tags: self.tags.clone(),
            target_price: self.target_price.clone(),
        }
    }
}
impl InitialReplicaProjection {
    pub(crate) fn parse(bytes: &[u8], through: u64) -> Result<Self, BusinessDatabaseError> {
        if bytes.len() > 32 * 1_048_576 {
            return Err(invalid());
        }
        let projection: Self =
            crate::desktop_native_cloud::strict_json(bytes).map_err(|_| invalid())?;
        projection.validate(through)?;
        Ok(projection)
    }
    fn validate(&self, through: u64) -> Result<(), BusinessDatabaseError> {
        if through > 9_007_199_254_740_991
            || self.assets.len().div_ceil(512).max(1) + self.tombstones.len().div_ceil(512) > 4096
        {
            return Err(invalid());
        }
        for (index, asset) in self.assets.iter().enumerate() {
            validate_domain_asset(&asset.write())?;
            if !(1..=9_007_199_254_740_991).contains(&asset.entity_generation)
                || (index > 0
                    && self.assets[index - 1].entity_id.as_bytes() >= asset.entity_id.as_bytes())
            {
                return Err(invalid());
            }
        }
        for (index, tombstone) in self.tombstones.iter().enumerate() {
            validate_domain_asset_id(&tombstone.entity_id).map_err(|_| invalid())?;
            validate_timestamp(Some(tombstone.deleted_at.clone())).map_err(|_| invalid())?;
            if !(1..=9_007_199_254_740_991).contains(&tombstone.entity_generation)
                || tombstone.deleted_server_revision == 0
                || tombstone.deleted_server_revision > through
                || (index > 0
                    && self.tombstones[index - 1].entity_id.as_bytes()
                        >= tombstone.entity_id.as_bytes())
                || self
                    .assets
                    .binary_search_by(|asset| {
                        asset
                            .entity_id
                            .as_bytes()
                            .cmp(tombstone.entity_id.as_bytes())
                    })
                    .is_ok()
            {
                return Err(invalid());
            }
        }
        Ok(())
    }
    pub(crate) fn entity_digests(&self) -> Result<serde_json::Value, BusinessDatabaseError> {
        let mut digests = Vec::new();
        if self.assets.is_empty() {
            digests.push(serde_json::json!({"entityType":"domain_asset","partitionId":"empty","digest":digest(b"GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-V3",&serde_json::json!([]))?}));
        }
        for (index, assets) in self.assets.chunks(512).enumerate() {
            digests.push(serde_json::json!({"entityType":"domain_asset","partitionId":format!("p{index:04}"),"digest":digest(b"GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-V3",&serde_json::to_value(assets).map_err(|_|invalid())?)?}));
        }
        for (index, tombstones) in self.tombstones.chunks(512).enumerate() {
            digests.push(serde_json::json!({"entityType":"domain_asset_tombstone","partitionId":format!("t{index:04}"),"digest":digest(b"GOODDEALER-WORKSPACE-CHECKPOINT-DOMAIN-ASSET-TOMBSTONE-V3",&serde_json::to_value(tombstones).map_err(|_|invalid())?)?}));
        }
        Ok(serde_json::Value::Array(digests))
    }
    pub(crate) fn digest(&self) -> Result<String, BusinessDatabaseError> {
        digest(
            b"GOODDEALER-WORKSPACE-CHECKPOINT-ENTITY-DIGESTS-V3",
            &self.entity_digests()?,
        )
    }
    /// Replays a complete contiguous page against the checkpoint's exact generation state.
    #[expect(
        clippy::too_many_lines,
        reason = "contiguous replay validation keeps each generation transition and page digest in one audit boundary"
    )]
    pub(crate) fn apply_page(
        &mut self,
        bytes: &[u8],
        workspace: &str,
        schema: u64,
        from: u64,
        target: u64,
    ) -> Result<u64, BusinessDatabaseError> {
        if bytes.len() > 1_048_576 {
            return Err(invalid());
        }
        let raw: serde_json::Value =
            crate::desktop_native_cloud::strict_json(bytes).map_err(|_| invalid())?;
        if raw.get("nextCursor").is_none() {
            return Err(invalid());
        }
        let page: SyncPageV2 = serde_json::from_value(raw.clone()).map_err(|_| invalid())?;
        if page.schema_version != 3
            || page.workspace_id != workspace
            || page.from_server_revision_exclusive != from
            || page.through_server_revision_inclusive != target
            || page.mutations.len() > 256
            || canonical_page_digest(&raw)? != page.page_digest
        {
            return Err(invalid());
        }
        validate_cursor_token(page.next_cursor.as_deref())?;
        let mut assets: BTreeMap<String, Asset> = self
            .assets
            .iter()
            .cloned()
            .map(|asset| (asset.entity_id.clone(), asset))
            .collect();
        let mut tombstones: BTreeMap<String, Tombstone> = self
            .tombstones
            .iter()
            .cloned()
            .map(|row| (row.entity_id.clone(), row))
            .collect();
        let mut revision = from;
        for (index, mutation) in page.mutations.into_iter().enumerate() {
            if ["reAddsDeletedRevision", "deletedAt"].iter().any(|field| {
                raw["mutations"][index]
                    .get(field)
                    .is_some_and(serde_json::Value::is_null)
            }) {
                return Err(invalid());
            }
            revision = revision.checked_add(1).ok_or_else(invalid)?;
            if mutation.schema_version != 3
                || mutation.workspace_id != workspace
                || mutation.workspace_schema_version != schema
                || mutation.entity_type != "domain_asset"
                || mutation.server_revision != revision
                || mutation.base_server_revision >= revision
                || !(1..=9_007_199_254_740_991).contains(&mutation.active_lease_epoch)
                || !(1..=9_007_199_254_740_991).contains(&mutation.device_mutation_sequence)
                || !(1..=9_007_199_254_740_991).contains(&mutation.entity_generation)
            {
                return Err(invalid());
            }
            for id in [&mutation.mutation_id, &mutation.source_device_id] {
                validate_identifier(id).map_err(|_| invalid())?;
            }
            validate_domain_asset_id(&mutation.entity_id).map_err(|_| invalid())?;
            validate_sync_mutation_fields(&mutation)?;
            if let Some(deleted) = mutation.re_adds_deleted_revision {
                let old = tombstones.get(&mutation.entity_id).ok_or_else(invalid)?;
                if mutation.operation_kind != "upsert"
                    || old.entity_generation.checked_add(1) != Some(mutation.entity_generation)
                    || old.deleted_server_revision != deleted
                    || deleted > mutation.base_server_revision
                    || mutation.changed_fields.len() != 4
                {
                    return Err(invalid());
                }
                tombstones.remove(&mutation.entity_id);
            } else if tombstones.contains_key(&mutation.entity_id) {
                return Err(invalid());
            }
            if let Some(asset) = assets.get(&mutation.entity_id) {
                if asset.entity_generation != mutation.entity_generation {
                    return Err(invalid());
                }
            } else if mutation.re_adds_deleted_revision.is_none() && mutation.entity_generation != 1
            {
                return Err(invalid());
            }
            match mutation.operation_kind.as_str() {
                "delete" => {
                    if !assets.contains_key(&mutation.entity_id)
                        || !mutation.changed_fields.is_empty()
                        || mutation.re_adds_deleted_revision.is_some()
                    {
                        return Err(invalid());
                    }
                    let deleted_at = mutation.deleted_at.ok_or_else(invalid)?;
                    validate_timestamp(Some(deleted_at.clone())).map_err(|_| invalid())?;
                    assets.remove(&mutation.entity_id);
                    tombstones.insert(
                        mutation.entity_id.clone(),
                        Tombstone {
                            entity_id: mutation.entity_id,
                            entity_generation: mutation.entity_generation,
                            deleted_server_revision: revision,
                            deleted_at,
                        },
                    );
                }
                "upsert" => {
                    if mutation.deleted_at.is_some() || mutation.changed_fields.is_empty() {
                        return Err(invalid());
                    }
                    let asset = assets
                        .entry(mutation.entity_id.clone())
                        .or_insert_with(|| Asset {
                            entity_id: mutation.entity_id,
                            entity_generation: mutation.entity_generation,
                            note: None,
                            portfolio_id: None,
                            tags: Vec::new(),
                            target_price: None,
                        });
                    for field in mutation.changed_fields {
                        match field.field_path.as_str() {
                            "note" => {
                                asset.note =
                                    serde_json::from_value(field.value).map_err(|_| invalid())?;
                            }
                            "portfolioId" => {
                                asset.portfolio_id =
                                    serde_json::from_value(field.value).map_err(|_| invalid())?;
                            }
                            "tags" => {
                                asset.tags =
                                    serde_json::from_value(field.value).map_err(|_| invalid())?;
                            }
                            "targetPrice" => {
                                asset.target_price =
                                    serde_json::from_value(field.value).map_err(|_| invalid())?;
                            }
                            _ => return Err(invalid()),
                        }
                    }
                    validate_domain_asset(&asset.write())?;
                }
                _ => return Err(invalid()),
            }
        }
        if revision != page.returned_through_server_revision
            || revision > target
            || (page.next_cursor.is_none()) != (revision == target)
            || (revision == from && revision != target)
        {
            return Err(invalid());
        }
        let candidate = Self {
            assets: assets.into_values().collect(),
            tombstones: tombstones.into_values().collect(),
        };
        candidate.validate(target)?;
        *self = candidate;
        Ok(revision)
    }
}
fn digest(domain: &[u8], value: &serde_json::Value) -> Result<String, BusinessDatabaseError> {
    let mut bytes = Vec::new();
    append_frame(&mut bytes, b'd', domain);
    append_frame(&mut bytes, b'v', &canonical_wire_value(value)?);
    Ok(URL_SAFE_NO_PAD.encode(Sha256::digest(bytes)))
}

impl BusinessDatabase {
    pub(crate) fn initial_replica_receipt(
        &self,
    ) -> Result<Option<InitialReplicaReceipt>, BusinessDatabaseError> {
        self.store.raw_connection().query_row("SELECT workflow_id,target_device_id,target_server_revision,workspace_schema_version,replica_digest FROM initial_replica_installation_receipts WHERE workspace_id=?1",[&self.workspace_id],|row|Ok(InitialReplicaReceipt{workflow_id:row.get(0)?,target_device_id:row.get(1)?,target_server_revision:read_unsigned(row,2)?,workspace_schema_version:read_unsigned(row,3)?,replica_digest:row.get(4)?})).optional().map_err(|_|storage())
    }
    pub(crate) fn verify_initial_replica_receipt(
        &self,
        expected: &InitialReplicaReceipt,
    ) -> Result<(), BusinessDatabaseError> {
        if self.initial_replica_receipt()?.as_ref() != Some(expected)
            || read_projection(self.store.raw_connection(), &self.workspace_id)?.digest()
                != Ok(expected.replica_digest.clone())
        {
            return Err(storage());
        }
        Ok(())
    }
    /// The caller has already hidden this fixed local file behind Native installation custody.
    /// Exact receipt replay is accepted; any prior business write prevents initial installation.
    pub(crate) fn install_initial_replica(
        &mut self,
        projection: &InitialReplicaProjection,
        receipt: &InitialReplicaReceipt,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        projection.validate(receipt.target_server_revision)?;
        for id in [&receipt.workflow_id, &receipt.target_device_id] {
            validate_identifier(id).map_err(|_| invalid())?;
        }
        if receipt.workspace_schema_version != 1 || projection.digest()? != receipt.replica_digest {
            return Err(invalid());
        }
        if self.initial_replica_receipt()?.is_some() {
            self.verify_initial_replica_receipt(receipt)?;
            commit_fence()?;
            return Ok(());
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| storage())?;
        let pristine:bool=transaction.query_row("SELECT local_commit_sequence=0 AND applied_through_server_revision=0 AND NOT EXISTS(SELECT 1 FROM domain_assets) AND NOT EXISTS(SELECT 1 FROM sync_tombstones) AND NOT EXISTS(SELECT 1 FROM sync_outbox) AND NOT EXISTS(SELECT 1 FROM local_provider_connections) AND NOT EXISTS(SELECT 1 FROM operations) AND NOT EXISTS(SELECT 1 FROM sync_reader_state) FROM active_workspace_metadata WHERE singleton=1",[],|row|row.get(0)).map_err(|_|storage())?;
        if !pristine {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        for asset in &projection.assets {
            install_asset(
                &transaction,
                &self.workspace_id,
                asset,
                receipt.target_server_revision,
            )?;
        }
        for tombstone in &projection.tombstones {
            transaction.execute("INSERT INTO domain_assets(workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,local_commit_sequence,entity_generation) VALUES(?1,?2,'archived',?3,?3,?3,1,?4)",params![self.workspace_id,tombstone.entity_id,tombstone.deleted_at,sql_unsigned(tombstone.entity_generation)?]).map_err(|_|storage())?;
            transaction.execute("INSERT INTO sync_tombstones(workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,deleted_server_revision,deleted_at,purge_after,state,barrier_state,order_server_revision,order_source_device_id,order_mutation_id,entity_generation,order_provenance) VALUES(?1,'domain_asset',?2,1,?3,?4,NULL,'replicated','replicated',?3,NULL,NULL,?5,'checkpoint')",params![self.workspace_id,tombstone.entity_id,sql_unsigned(tombstone.deleted_server_revision)?,tombstone.deleted_at,sql_unsigned(tombstone.entity_generation)?]).map_err(|_|storage())?;
        }
        transaction.execute("UPDATE active_workspace_metadata SET local_commit_sequence=1,applied_through_server_revision=?1,updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE singleton=1",[sql_unsigned(receipt.target_server_revision)?]).map_err(|_|storage())?;
        transaction.execute("INSERT INTO initial_replica_installation_receipts(workspace_id,workflow_id,target_device_id,target_server_revision,workspace_schema_version,replica_digest,installed_at) VALUES(?1,?2,?3,?4,?5,?6,strftime('%Y-%m-%dT%H:%M:%SZ','now'))",params![self.workspace_id,receipt.workflow_id,receipt.target_device_id,sql_unsigned(receipt.target_server_revision)?,sql_unsigned(receipt.workspace_schema_version)?,receipt.replica_digest]).map_err(|_|storage())?;
        if read_projection(&transaction, &self.workspace_id)?.digest()? != receipt.replica_digest {
            return Err(storage());
        }
        commit_fence()?;
        transaction.commit().map_err(|_| storage())?;
        self.verify_initial_replica_receipt(receipt)
    }
}
fn install_asset(
    transaction: &Transaction<'_>,
    workspace: &str,
    asset: &Asset,
    revision: u64,
) -> Result<(), BusinessDatabaseError> {
    transaction.execute("INSERT INTO domain_assets(workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,local_commit_sequence,entity_generation) VALUES(?1,?2,'active',strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,1,?3)",params![workspace,asset.entity_id,sql_unsigned(asset.entity_generation)?]).map_err(|_|storage())?;
    transaction.execute("INSERT INTO domain_asset_desired_state(workspace_id,entity_id,portfolio_id,note,target_price_currency,target_price_amount,desired_sale_status,desired_nameservers_json,local_commit_sequence,updated_at) VALUES(?1,?2,NULL,?3,?4,?5,'hold','[]',1,strftime('%Y-%m-%dT%H:%M:%SZ','now'))",params![workspace,asset.entity_id,asset.note,asset.target_price.as_ref().map(|value|&value.currency),asset.target_price.as_ref().map(|value|&value.amount)]).map_err(|_|storage())?;
    for tag in &asset.tags {
        transaction.execute("INSERT INTO domain_asset_tags(workspace_id,entity_id,tag,local_commit_sequence) VALUES(?1,?2,?3,1)",params![workspace,asset.entity_id,tag]).map_err(|_|storage())?;
    }
    let tags = serde_json::to_string(&asset.tags).map_err(|_| invalid())?;
    transaction.execute("INSERT INTO portfolio_domain_assets(workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,target_price_amount,note_server_revision,portfolio_id_server_revision,tags_server_revision,target_price_server_revision) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?8,?8,?8)",params![workspace,asset.entity_id,asset.note,asset.portfolio_id,tags,asset.target_price.as_ref().map(|value|&value.currency),asset.target_price.as_ref().map(|value|&value.amount),sql_unsigned(revision)?]).map_err(|_|storage())?;
    for field in ["note", "portfolioId", "tags", "targetPrice"] {
        transaction.execute("INSERT INTO domain_asset_field_versions(workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,provenance,freshness,updated_at) VALUES(?1,?2,?3,?4,0,'clean','replicated','confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now'))",params![workspace,asset.entity_id,field,sql_unsigned(revision)?]).map_err(|_|storage())?;
    }
    transaction.execute("INSERT INTO sync_asset_provenance(workspace_id,entity_id,root_provenance,replicated_server_revision,freshness,updated_at) VALUES(?1,?2,'replicated',?3,'confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now')) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET root_provenance='replicated',replicated_server_revision=excluded.replicated_server_revision,freshness='confirmed'",params![workspace,asset.entity_id,sql_unsigned(revision)?]).map_err(|_|storage())?;
    Ok(())
}
fn read_projection(
    connection: &Connection,
    workspace: &str,
) -> Result<InitialReplicaProjection, BusinessDatabaseError> {
    let mut statement=connection.prepare("SELECT p.entity_id,a.entity_generation,p.note,p.portfolio_id,p.tags_json,p.target_price_currency,p.target_price_amount FROM portfolio_domain_assets p JOIN domain_assets a ON a.workspace_id=p.workspace_id AND a.entity_id=p.entity_id WHERE p.workspace_id=?1 AND a.deleted_at IS NULL ORDER BY p.entity_id COLLATE BINARY").map_err(|_|storage())?;
    let rows = statement
        .query_map([workspace], |row| {
            let tags: String = row.get(4)?;
            let currency: Option<String> = row.get(5)?;
            let amount: Option<String> = row.get(6)?;
            Ok((
                row.get::<_, String>(0)?,
                read_unsigned(row, 1)?,
                row.get::<_, Option<String>>(2)?,
                row.get::<_, Option<String>>(3)?,
                tags,
                currency,
                amount,
            ))
        })
        .map_err(|_| storage())?;
    let mut assets = Vec::new();
    for row in rows {
        let (id, generation, note, portfolio, tags, currency, amount) =
            row.map_err(|_| storage())?;
        let price = match (currency, amount) {
            (None, None) => None,
            (Some(currency), Some(amount)) => Some(Money { currency, amount }),
            _ => return Err(storage()),
        };
        assets.push(Asset {
            entity_id: id,
            entity_generation: generation,
            note,
            portfolio_id: portfolio,
            tags: serde_json::from_str(&tags).map_err(|_| storage())?,
            target_price: price,
        });
    }
    let mut statement=connection.prepare("SELECT entity_id,entity_generation,deleted_server_revision,deleted_at FROM sync_tombstones WHERE workspace_id=?1 AND entity_kind='domain_asset' ORDER BY entity_id COLLATE BINARY").map_err(|_|storage())?;
    let tombstones = statement
        .query_map([workspace], |row| {
            Ok(Tombstone {
                entity_id: row.get(0)?,
                entity_generation: read_unsigned(row, 1)?,
                deleted_server_revision: read_unsigned(row, 2)?,
                deleted_at: row.get(3)?,
            })
        })
        .map_err(|_| storage())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| storage())?;
    Ok(InitialReplicaProjection { assets, tombstones })
}

fn sql_unsigned(value: u64) -> Result<i64, BusinessDatabaseError> {
    i64::try_from(value).map_err(|_| invalid())
}
fn read_unsigned(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<u64> {
    let value: i64 = row.get(index)?;
    u64::try_from(value).map_err(|_| rusqlite::Error::IntegralValueOutOfRange(index, value))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::LocalDatabaseKey;
    fn corpus() -> serde_json::Value {
        serde_json::from_str(include_str!(
            "../../../../../packages/protocol/test-vectors/target-installation/valid.json"
        ))
        .unwrap()
    }
    fn projection() -> InitialReplicaProjection {
        let value = corpus();
        let mut projection = InitialReplicaProjection::parse(
            &serde_json::to_vec(&value["checkpointState"]).unwrap(),
            5,
        )
        .unwrap();
        let page = &value["steps"][1]["result"]["resultPayload"]["mutationPage"];
        projection
            .apply_page(
                &serde_json::to_vec(page).unwrap(),
                page["workspaceId"].as_str().unwrap(),
                1,
                5,
                7,
            )
            .unwrap();
        assert_eq!(projection.digest().unwrap(), value["verifiedDigest"]);
        projection
    }
    fn receipt() -> InitialReplicaReceipt {
        InitialReplicaReceipt {
            workflow_id: "installation-workflow".into(),
            target_device_id: "installation-target".into(),
            target_server_revision: 7,
            workspace_schema_version: 1,
            replica_digest: corpus()["verifiedDigest"].as_str().unwrap().into(),
        }
    }
    #[test]
    fn shared_gen2_edit_and_delete_rebuild_exact_state() {
        let actual = serde_json::to_value(projection()).unwrap();
        assert_eq!(actual, corpus()["finalState"]);
    }
    #[test]
    fn sqlcipher_install_receipt_is_atomic_immutable_and_survives_reopen() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let path = directory.path().join("replica.db");
        let key = LocalDatabaseKey::from_bytes([71; 32]);
        let mut database = BusinessDatabase::open(&path, &key, "workspace").unwrap();
        let projection = projection();
        let receipt = receipt();
        assert!(
            database
                .install_initial_replica(&projection, &receipt, || Err(
                    BusinessDatabaseError::RevisionRejected
                ))
                .is_err()
        );
        assert!(database.initial_replica_receipt().unwrap().is_none());
        assert_eq!(
            read_projection(database.store.raw_connection(), "workspace")
                .unwrap()
                .assets
                .len(),
            0
        );
        database
            .install_initial_replica(&projection, &receipt, || Ok(()))
            .unwrap();
        drop(database);
        let mut database = BusinessDatabase::open(&path, &key, "workspace").unwrap();
        database
            .install_initial_replica(&projection, &receipt, || Ok(()))
            .unwrap();
        database.verify_initial_replica_receipt(&receipt).unwrap();
        for table in [
            "sync_outbox",
            "sync_inbox",
            "sync_reader_state",
            "local_provider_connections",
            "operation_plans",
            "domain_asset_provider_bindings",
        ] {
            let count: i64 = database
                .store
                .raw_connection()
                .query_row(&format!("SELECT count(*) FROM {table}"), [], |row| {
                    row.get(0)
                })
                .unwrap();
            assert_eq!(count, 0, "{table}");
        }
        assert!(
            database
                .store
                .fixture_connection()
                .execute("DELETE FROM initial_replica_installation_receipts", [])
                .is_err()
        );
        let mut other = receipt.clone();
        other.workflow_id = "other".into();
        assert!(
            database
                .install_initial_replica(&projection, &other, || Ok(()))
                .is_err()
        );
        assert!(BusinessDatabase::open(&path, &key, "foreign").is_err());
    }
    #[test]
    fn rejects_missing_nullable_fields_duplicates_wrong_generation_and_gaps() {
        let corpus = corpus();
        let mut state = corpus["checkpointState"].clone();
        state["assets"][0].as_object_mut().unwrap().remove("note");
        assert!(InitialReplicaProjection::parse(&serde_json::to_vec(&state).unwrap(), 5).is_err());
        assert!(
            InitialReplicaProjection::parse(br#"{"assets":[],"assets":[],"tombstones":[]}"#, 5)
                .is_err()
        );
        for mutation in ["gap", "generation", "resurrection", "foreign"] {
            let mut projection = InitialReplicaProjection::parse(
                &serde_json::to_vec(&corpus["checkpointState"]).unwrap(),
                5,
            )
            .unwrap();
            let mut page = corpus["steps"][1]["result"]["resultPayload"]["mutationPage"].clone();
            match mutation {
                "gap" => page["mutations"][0]["serverRevision"] = serde_json::json!(7),
                "generation" => page["mutations"][0]["entityGeneration"] = serde_json::json!(3),
                "resurrection" => {
                    page["mutations"][0]["reAddsDeletedRevision"] = serde_json::json!(4);
                }
                _ => page["mutations"][0]["workspaceId"] = serde_json::json!("foreign"),
            }
            page["pageDigest"] = serde_json::json!(canonical_page_digest(&page).unwrap());
            let workspace =
                corpus["steps"][1]["result"]["resultPayload"]["mutationPage"]["workspaceId"]
                    .as_str()
                    .unwrap();
            assert!(
                projection
                    .apply_page(&serde_json::to_vec(&page).unwrap(), workspace, 1, 5, 7)
                    .is_err(),
                "{mutation}"
            );
        }
    }
    #[test]
    fn replay_readd_then_gen2_edit_and_delete_and_reject_unknown_delete() {
        let value = corpus();
        let checkpoint = serde_json::to_vec(&value["checkpointState"]).unwrap();
        let source = &value["steps"][1]["result"]["resultPayload"]["mutationPage"];
        let mut page = source.clone();
        let mut first = source["mutations"][0].clone();
        first["entityId"] = serde_json::json!("deleted.test");
        first["entityGeneration"] = serde_json::json!(2);
        first["reAddsDeletedRevision"] = serde_json::json!(4);
        first["baseServerRevision"] = serde_json::json!(5);
        first["changedFields"] = serde_json::json!([{"fieldPath":"note","value":"re-added"},{"fieldPath":"portfolioId","value":null},{"fieldPath":"tags","value":[]},{"fieldPath":"targetPrice","value":null}]);
        let mut second = first.clone();
        second
            .as_object_mut()
            .unwrap()
            .remove("reAddsDeletedRevision");
        second["serverRevision"] = serde_json::json!(7);
        second["baseServerRevision"] = serde_json::json!(6);
        second["changedFields"] =
            serde_json::json!([{"fieldPath":"note","value":"ordinary gen2 edit"}]);
        let mut third = source["mutations"][1].clone();
        third["entityId"] = serde_json::json!("deleted.test");
        third["entityGeneration"] = serde_json::json!(2);
        third["serverRevision"] = serde_json::json!(8);
        third["baseServerRevision"] = serde_json::json!(7);
        page["mutations"] = serde_json::json!([first, second, third]);
        page["throughServerRevisionInclusive"] = serde_json::json!(8);
        page["returnedThroughServerRevision"] = serde_json::json!(8);
        page["pageDigest"] = serde_json::json!(canonical_page_digest(&page).unwrap());
        let workspace = page["workspaceId"].as_str().unwrap();
        let mut projection = InitialReplicaProjection::parse(&checkpoint, 5).unwrap();
        projection
            .apply_page(&serde_json::to_vec(&page).unwrap(), workspace, 1, 5, 8)
            .unwrap();
        assert!(
            projection
                .tombstones
                .iter()
                .any(|t| t.entity_id == "deleted.test"
                    && t.entity_generation == 2
                    && t.deleted_server_revision == 8)
        );
        let mut unknown = source.clone();
        unknown["mutations"][1]["entityId"] = serde_json::json!("unknown.test");
        unknown["pageDigest"] = serde_json::json!(canonical_page_digest(&unknown).unwrap());
        assert!(
            InitialReplicaProjection::parse(&checkpoint, 5)
                .unwrap()
                .apply_page(&serde_json::to_vec(&unknown).unwrap(), workspace, 1, 5, 7)
                .is_err()
        );
        let mut null_generation = source.clone();
        null_generation["mutations"][0]["reAddsDeletedRevision"] = serde_json::Value::Null;
        null_generation["pageDigest"] =
            serde_json::json!(canonical_page_digest(&null_generation).unwrap());
        assert!(
            InitialReplicaProjection::parse(&checkpoint, 5)
                .unwrap()
                .apply_page(
                    &serde_json::to_vec(&null_generation).unwrap(),
                    workspace,
                    1,
                    5,
                    7
                )
                .is_err()
        );
    }
}
