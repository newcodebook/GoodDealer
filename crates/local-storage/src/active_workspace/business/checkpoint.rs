//! Checkpoint installation and rebootstrap publication.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BusinessDatabase, BusinessDatabaseError, NativeCheckpointDescriptor, SyncProjectionEffect,
    TransactionBehavior, params, validate_identifier, validate_local_text, validate_timestamp,
};

impl BusinessDatabase {
    #[cfg(test)]
    pub(crate) fn prepare_rebootstrap_publication(&mut self) -> Result<(), BusinessDatabaseError> {
        self.store
            .fixture_connection()
            .execute_batch("PRAGMA wal_checkpoint(TRUNCATE); PRAGMA journal_mode=DELETE;")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        self.recovery_proof().map(|_| ())
    }

    /// Verifies the link from a Host publication record to this staged database's logical journal.
    ///
    /// # Errors
    ///
    /// Returns a closed storage error when the exact linked record is absent or unreadable.
    #[cfg(test)]
    pub fn verify_rebootstrap_journal_link(
        &self,
        link: &RebootstrapJournalLink,
    ) -> Result<(), BusinessDatabaseError> {
        verify_rebootstrap_journal_link_on_connection(
            self.store.raw_connection(),
            &self.workspace_id,
            link,
        )
    }

    #[cfg(all(test, unix))]
    pub(crate) fn active_rebootstrap_journal_link_snapshot_for_test(
        &self,
    ) -> Result<TestActiveRebootstrapJournalLinkSnapshot, BusinessDatabaseError> {
        active_rebootstrap_journal_link_snapshot_on_connection(
            self.store.raw_connection(),
            &self.workspace_id,
        )
    }

    #[cfg(all(test, unix))]
    pub(crate) fn apply_rebootstrap_journal_link_hostile_case_for_test(
        &mut self,
        hostile_case: TestRebootstrapJournalLinkHostileCase,
    ) -> Result<(), BusinessDatabaseError> {
        let workspace_id = self.workspace_id.clone();
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let publication_sequence: Option<i64> = transaction
            .query_row(
                "SELECT MAX(publication_sequence) FROM sync_rebootstrap_journal
                 WHERE workspace_id=?1",
                [&workspace_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let publication_sequence =
            publication_sequence.ok_or(BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute_batch(
                "DROP TRIGGER sync_rebootstrap_journal_no_delete;
                 DROP TRIGGER sync_rebootstrap_journal_no_update;",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let affected = match hostile_case {
            TestRebootstrapJournalLinkHostileCase::RemoveActive => transaction.execute(
                "DELETE FROM sync_rebootstrap_journal
                 WHERE workspace_id=?1 AND publication_sequence=?2",
                params![workspace_id, publication_sequence],
            ),
            TestRebootstrapJournalLinkHostileCase::DuplicateActive => {
                transaction
                    .execute_batch(
                        "CREATE TABLE sync_rebootstrap_journal_hostile AS
                           SELECT * FROM sync_rebootstrap_journal;
                         DROP TABLE sync_rebootstrap_journal;
                         ALTER TABLE sync_rebootstrap_journal_hostile
                           RENAME TO sync_rebootstrap_journal;",
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                transaction.execute(
                    "INSERT INTO sync_rebootstrap_journal
                     SELECT * FROM sync_rebootstrap_journal
                     WHERE workspace_id=?1 AND publication_sequence=?2 LIMIT 1",
                    params![workspace_id, publication_sequence],
                )
            }
            TestRebootstrapJournalLinkHostileCase::MutateBindingDigest => transaction.execute(
                "UPDATE sync_rebootstrap_journal SET binding_digest=?3
                 WHERE workspace_id=?1 AND publication_sequence=?2",
                params![workspace_id, publication_sequence, "d".repeat(64)],
            ),
            TestRebootstrapJournalLinkHostileCase::MarkNonVerified => transaction.execute(
                "UPDATE sync_rebootstrap_journal SET state='prepared',failure_code=NULL
                 WHERE workspace_id=?1 AND publication_sequence=?2",
                params![workspace_id, publication_sequence],
            ),
        }
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if affected != 1 {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        transaction
            .execute_batch(
                "CREATE TRIGGER sync_rebootstrap_journal_no_delete
                 BEFORE DELETE ON sync_rebootstrap_journal BEGIN
                   SELECT RAISE(ABORT, 'rebootstrap journal cannot be deleted');
                 END;
                 CREATE TRIGGER sync_rebootstrap_journal_no_update
                 BEFORE UPDATE ON sync_rebootstrap_journal BEGIN
                   SELECT RAISE(ABORT, 'rebootstrap journal cannot be updated');
                 END;",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Installs a verified complete checkpoint into replica-owned rows of a staged clone.
    /// Pending/conflicted local fields and all outbox/inbox/conflict/tombstone evidence remain intact.
    ///
    /// # Errors
    ///
    /// Returns an error for malformed, unordered, oversized input or storage rejection.
    #[allow(
        clippy::too_many_lines,
        reason = "checkpoint replacement keeps root, projection, field, and reader updates atomic"
    )]
    #[cfg(test)]
    pub fn install_rebootstrap_checkpoint(
        &mut self,
        snapshot: &[DomainAssetWrite],
        checkpoint_revision: u64,
        device_id: &str,
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        self.install_rebootstrap_checkpoint_guarded(
            snapshot,
            checkpoint_revision,
            device_id,
            make_journal,
            || Ok(()),
        )
    }

    /// Installs a checkpoint and, when supplied, its opaque SQL journal link in one transaction.
    /// The Host fence runs immediately before commit; a failed fence or journal insert rolls back
    /// every root, field, cursor and journal write.
    ///
    /// # Errors
    ///
    /// Returns a closed validation, storage, revision, conflict, or Host fence error.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    pub fn install_rebootstrap_checkpoint_guarded(
        &mut self,
        snapshot: &[DomainAssetWrite],
        checkpoint_revision: u64,
        device_id: &str,
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        let revision =
            i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let admission_floor =
            checkpoint_admission_floor(self.store.raw_connection(), &self.workspace_id)?;
        admission_floor.admit(revision)?;
        self.store
            .fixture_connection()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let snapshot = snapshot
            .iter()
            .cloned()
            .map(|asset| RebootstrapAsset {
                asset,
                entity_generation: 1,
            })
            .collect::<Vec<_>>();
        let result = self.install_rebootstrap_checkpoint_savepoint(
            &snapshot,
            &[],
            checkpoint_revision,
            device_id,
            Some(make_journal),
            commit_fence,
            admission_floor,
        );
        match result {
            Ok((proof, Some(link))) => {
                self.store
                    .fixture_connection()
                    .execute_batch("COMMIT")
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                Ok((proof, link))
            }
            Ok(_) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(BusinessDatabaseError::StorageRejected)
            }
            Err(error) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    /// Atomically installs a checkpoint, applies every replay page, derives the final recovery
    /// proof, appends its exact logical-journal link, and performs the Host commit fence.
    ///
    /// # Errors
    ///
    /// Returns a closed validation, storage, revision, conflict, or Host fence error. Any error
    /// rolls back the whole plan, including its logical journal row.
    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    pub fn install_rebootstrap_plan_guarded(
        &mut self,
        snapshot: &[DomainAssetWrite],
        tombstones: &[RebootstrapTombstone],
        checkpoint_revision: u64,
        device_id: &str,
        replay_pages: &[RebootstrapReplayPage],
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        let snapshot = snapshot
            .iter()
            .cloned()
            .map(|asset| RebootstrapAsset {
                asset,
                entity_generation: 1,
            })
            .collect::<Vec<_>>();
        self.install_rebootstrap_plan_with_generations_guarded(
            &snapshot,
            tombstones,
            checkpoint_revision,
            device_id,
            replay_pages,
            make_journal,
            commit_fence,
        )
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    pub(crate) fn install_rebootstrap_plan_with_generations_guarded(
        &mut self,
        snapshot: &[RebootstrapAsset],
        tombstones: &[RebootstrapTombstone],
        checkpoint_revision: u64,
        device_id: &str,
        replay_pages: &[RebootstrapReplayPage],
        make_journal: impl FnOnce(
            &DatabaseRecoveryProof,
        ) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(DatabaseRecoveryProof, RebootstrapJournalLink), BusinessDatabaseError> {
        if replay_pages.len() > 4_096
            || replay_pages
                .iter()
                .try_fold(0_usize, |total, page| {
                    total.checked_add(page.page_json.len() + page.confirmation_token.len())
                })
                .is_none_or(|total| total > 64 * 1_048_576)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let revision =
            i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let admission_floor =
            checkpoint_admission_floor(self.store.raw_connection(), &self.workspace_id)?;
        admission_floor.admit(revision)?;
        self.store
            .fixture_connection()
            .execute_batch("BEGIN IMMEDIATE")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let result = (|| {
            let _ = self.install_rebootstrap_checkpoint_savepoint(
                snapshot,
                tombstones,
                checkpoint_revision,
                device_id,
                None::<
                    fn(
                        &DatabaseRecoveryProof,
                    )
                        -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
                >,
                || Ok(()),
                admission_floor,
            )?;
            for page in replay_pages {
                self.apply_sync_page_v2_savepoint(
                    device_id,
                    &page.page_json,
                    &page.confirmation_token,
                    |_| Ok(()),
                )?;
            }
            let proof = self.recovery_proof()?;
            let link = make_journal(&proof)?;
            validate_rebootstrap_journal_link(&link)?;
            let publication_sequence = i64::try_from(link.publication_sequence)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            self.store.fixture_connection().execute(
                "INSERT INTO sync_rebootstrap_journal
                 (workspace_id,journal_id,slot_id,publication_sequence,manifest_digest,
                  authority_digest,floor_digest,binding_digest,state,failure_code,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'verified',NULL,
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                params![self.workspace_id,link.journal_id,link.slot_id.as_str(),publication_sequence,
                    link.manifest_digest,link.authority_digest,link.floor_digest,link.binding_digest],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            verify_rebootstrap_final_head(
                self.store.fixture_connection(),
                &self.workspace_id,
                device_id,
                revision,
                admission_floor,
            )?;
            commit_fence()?;
            Ok((proof, link))
        })();
        match result {
            Ok(value) => {
                self.store
                    .fixture_connection()
                    .execute_batch("COMMIT")
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                Ok(value)
            }
            Err(error) => {
                let _ = self.store.fixture_connection().execute_batch("ROLLBACK");
                Err(error)
            }
        }
    }

    #[allow(clippy::too_many_arguments, clippy::too_many_lines)]
    #[cfg(test)]
    fn install_rebootstrap_checkpoint_savepoint<F, G>(
        &mut self,
        snapshot: &[RebootstrapAsset],
        tombstones: &[RebootstrapTombstone],
        checkpoint_revision: u64,
        device_id: &str,
        make_journal: Option<F>,
        commit_fence: G,
        admission_floor: CheckpointAdmissionFloor,
    ) -> Result<(DatabaseRecoveryProof, Option<RebootstrapJournalLink>), BusinessDatabaseError>
    where
        F: FnOnce(&DatabaseRecoveryProof) -> Result<RebootstrapJournalLink, BusinessDatabaseError>,
        G: FnOnce() -> Result<(), BusinessDatabaseError>,
    {
        if snapshot.len() > 10_000 || checkpoint_revision > 9_007_199_254_740_991 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        for (index, checkpoint_asset) in snapshot.iter().enumerate() {
            validate_domain_asset(&checkpoint_asset.asset)?;
            if !(1..=9_007_199_254_740_991).contains(&checkpoint_asset.entity_generation)
                || (index > 0
                    && snapshot[index - 1].asset.entity_id.as_bytes()
                        >= checkpoint_asset.asset.entity_id.as_bytes())
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        validate_checkpoint_tombstones(
            &snapshot
                .iter()
                .map(|asset| asset.asset.clone())
                .collect::<Vec<_>>(),
            tombstones,
            checkpoint_revision,
        )?;
        let revision =
            i64::try_from(checkpoint_revision).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .savepoint()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        admission_floor.admit(revision)?;
        let transaction_floor = checkpoint_admission_floor(&transaction, &self.workspace_id)?;
        transaction_floor.admit(revision)?;
        let local_commit_sequence: i64 = transaction
            .query_row(
                "SELECT MAX(local_commit_sequence, 1) FROM active_workspace_metadata WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute_batch(
                "CREATE TEMP TABLE IF NOT EXISTS temp_checkpoint_entities(entity_id TEXT PRIMARY KEY) WITHOUT ROWID;
                 DELETE FROM temp_checkpoint_entities;",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for checkpoint_asset in snapshot {
            let asset = &checkpoint_asset.asset;
            let entity_generation = i64::try_from(checkpoint_asset.entity_generation)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction
                .execute(
                    "INSERT INTO temp_checkpoint_entities(entity_id) VALUES (?1)",
                    [&asset.entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let root: Option<(i64, Option<String>)> = transaction
                .query_row(
                    "SELECT entity_generation,deleted_at FROM domain_assets WHERE workspace_id=?1 AND entity_id=?2",
                    params![self.workspace_id, asset.entity_id],
                    |row| Ok((row.get(0)?,row.get(1)?)),
                )
                .optional()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            let tombstone_generation: Option<i64> = transaction
                .query_row(
                    "SELECT entity_generation FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
                    params![self.workspace_id, asset.entity_id],
                    |row| row.get(0),
                )
                .optional()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            // The confirmed local generation is the row's, or a tombstone's that arrived alone.
            let local_generation = root
                .as_ref()
                .map(|(generation, _)| *generation)
                .or(tombstone_generation);
            if let Some(local_generation) =
                local_generation.filter(|local| *local < entity_generation)
            {
                // Cloud moved on past every generation this replica holds; take its state. The
                // entity is then installed below exactly as one this replica never held.
                advance_to_checkpoint_generation(
                    &transaction,
                    &self.workspace_id,
                    &asset.entity_id,
                    local_generation,
                    entity_generation,
                    revision,
                    local_commit_sequence,
                )?;
            } else if root.is_none() && tombstone_generation.is_some() {
                // A tombstone of this generation or a later one: the live checkpoint asset is older.
                return Err(BusinessDatabaseError::InvalidInput);
            } else if let Some((local_generation, deleted_at)) = root {
                checkpoint_asset_may_merge(
                    &transaction,
                    &self.workspace_id,
                    &asset.entity_id,
                    entity_generation,
                    local_generation,
                    deleted_at.is_some(),
                )?;
                merge_checkpoint_existing_asset(
                    &transaction,
                    &self.workspace_id,
                    asset,
                    checkpoint_asset.entity_generation,
                    checkpoint_revision,
                )?;
                continue;
            }
            let tags_json = serde_json::to_string(&asset.tags)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction
                .execute(
                    "INSERT INTO domain_assets
                     (workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,local_commit_sequence,entity_generation)
                     VALUES (?1,?2,'active',strftime('%Y-%m-%dT%H:%M:%SZ','now'),
                             strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,?3,?4)
                     ON CONFLICT(workspace_id,entity_id) DO NOTHING",
                    params![self.workspace_id, asset.entity_id, local_commit_sequence, entity_generation],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "INSERT INTO domain_asset_desired_state
                     (workspace_id,entity_id,portfolio_id,note,target_price_currency,
                      target_price_amount,desired_sale_status,desired_nameservers_json,
                      local_commit_sequence,updated_at)
                     VALUES (?1,?2,NULL,?3,?4,?5,'hold','[]',?6,
                             strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                     ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
                       note=excluded.note,target_price_currency=excluded.target_price_currency,
                       target_price_amount=excluded.target_price_amount,
                       updated_at=excluded.updated_at",
                    params![
                        self.workspace_id,
                        asset.entity_id,
                        asset.note,
                        asset.target_price.as_ref().map(|money| &money.currency),
                        asset.target_price.as_ref().map(|money| &money.amount),
                        local_commit_sequence,
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            transaction
                .execute(
                    "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
                    params![self.workspace_id, asset.entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for tag in &asset.tags {
                transaction
                    .execute(
                        "INSERT INTO domain_asset_tags
                         (workspace_id,entity_id,tag,local_commit_sequence) VALUES (?1,?2,?3,?4)",
                        params![
                            self.workspace_id,
                            asset.entity_id,
                            tag,
                            local_commit_sequence
                        ],
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            transaction.execute(
                "INSERT INTO portfolio_domain_assets
                 (workspace_id,entity_id,note,portfolio_id,tags_json,target_price_currency,
                  target_price_amount,note_server_revision,portfolio_id_server_revision,
                  tags_server_revision,target_price_server_revision)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8,?8,?8)
                 ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
                  note=excluded.note,portfolio_id=excluded.portfolio_id,tags_json=excluded.tags_json,
                  target_price_currency=excluded.target_price_currency,target_price_amount=excluded.target_price_amount,
                  note_server_revision=excluded.note_server_revision,
                  portfolio_id_server_revision=excluded.portfolio_id_server_revision,
                  tags_server_revision=excluded.tags_server_revision,
                  target_price_server_revision=excluded.target_price_server_revision",
                params![self.workspace_id, asset.entity_id, asset.note, asset.portfolio_id, tags_json,
                    asset.target_price.as_ref().map(|money| &money.currency),
                    asset.target_price.as_ref().map(|money| &money.amount), revision],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            for field in ["note", "portfolioId", "tags", "targetPrice"] {
                transaction.execute(
                    "INSERT INTO domain_asset_field_versions
                     (workspace_id,entity_id,field_path,server_revision,local_commit_sequence,sync_state,provenance,freshness,updated_at)
                     VALUES (?1,?2,?3,?4,0,'clean','replicated','confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                     ON CONFLICT(workspace_id,entity_id,field_path) DO UPDATE SET
                      server_revision=excluded.server_revision,sync_state='clean',provenance='replicated',freshness='confirmed',updated_at=excluded.updated_at
                      WHERE domain_asset_field_versions.sync_state='clean'",
                    params![self.workspace_id, asset.entity_id, field, revision],
                ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            }
            transaction.execute(
                "INSERT INTO sync_asset_provenance(workspace_id,entity_id,root_provenance,replicated_server_revision,freshness,updated_at)
                 VALUES (?1,?2,'replicated',?3,'confirmed',strftime('%Y-%m-%dT%H:%M:%SZ','now'))
                 ON CONFLICT(workspace_id,entity_id) DO UPDATE SET root_provenance='replicated',replicated_server_revision=excluded.replicated_server_revision,freshness='confirmed',updated_at=excluded.updated_at",
                params![self.workspace_id, asset.entity_id, revision],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        for tombstone in tombstones {
            transaction
                .execute(
                    "INSERT INTO temp_checkpoint_entities(entity_id) VALUES (?1)",
                    [&tombstone.entity_id],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            install_checkpoint_tombstone(
                &transaction,
                &self.workspace_id,
                tombstone,
                revision,
                local_commit_sequence,
            )?;
        }
        transaction.execute(
            "UPDATE sync_asset_provenance SET freshness='stale', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND root_provenance='replicated' AND entity_id NOT IN
             (SELECT entity_id FROM temp_checkpoint_entities)",
            [&self.workspace_id],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute(
            "UPDATE domain_asset_field_versions SET freshness='stale', updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND provenance='replicated' AND sync_state='clean' AND entity_id NOT IN
             (SELECT entity_id FROM temp_checkpoint_entities)",
            [&self.workspace_id],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute_batch("DROP TABLE temp_checkpoint_entities;")
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "UPDATE active_workspace_metadata SET applied_through_server_revision=?1,
             updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE singleton=1",
                [revision],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO sync_reader_state
                 (workspace_id,device_id,cursor_generation,read_through_server_revision,
                  pinned_target_server_revision,continuation_token,checkpoint_id,
                  checkpoint_through_server_revision,status,updated_at,confirmation_token,
                  last_page_digest,anti_rollback_server_revision_floor,
                  anti_rollback_schema_version_floor,row_version)
                 VALUES (?2,?3,1,?1,?1,NULL,NULL,NULL,'active',
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,NULL,?1,2,1)
                 ON CONFLICT(workspace_id,device_id) DO UPDATE SET
                   read_through_server_revision=?1,status='active',
                   pinned_target_server_revision=?1,continuation_token=NULL,
                   confirmation_token=NULL,last_page_digest=NULL,
                   anti_rollback_server_revision_floor=MAX(anti_rollback_server_revision_floor,?1),
                   row_version=row_version+1,
                   updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')",
                params![revision, self.workspace_id, device_id],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let proof = recovery_proof_from_connection(&transaction)?;
        let link = if let Some(make_journal) = make_journal {
            let link = make_journal(&proof)?;
            validate_rebootstrap_journal_link(&link)?;
            let publication_sequence = i64::try_from(link.publication_sequence)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            transaction.execute(
                "INSERT INTO sync_rebootstrap_journal
                 (workspace_id,journal_id,slot_id,publication_sequence,manifest_digest,
                  authority_digest,floor_digest,binding_digest,state,failure_code,created_at,updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'verified',NULL,
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),strftime('%Y-%m-%dT%H:%M:%SZ','now'))",
                params![self.workspace_id, link.journal_id, link.slot_id.as_str(), publication_sequence,
                    link.manifest_digest, link.authority_digest, link.floor_digest, link.binding_digest],
            ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            Some(link)
        } else {
            None
        };
        verify_rebootstrap_final_head(
            &transaction,
            &self.workspace_id,
            device_id,
            revision,
            transaction_floor,
        )?;
        commit_fence()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok((proof, link))
    }

    /// Stops pull materialization after Cloud reports that this reader is behind compaction.
    /// Existing local business data and pending outbox rows are retained for local recovery.
    ///
    /// # Errors
    ///
    /// Returns a closed input or storage error.
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded rebootstrap marker remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn mark_sync_rebootstrap_required_v2(
        &mut self,
        device_id: &str,
    ) -> Result<(), BusinessDatabaseError> {
        self.mark_sync_rebootstrap_required_v2_guarded(device_id, |_| Ok(()))
            .map(|_| ())
    }

    /// Marks the reader as requiring rebootstrap with a final authority fence.
    ///
    /// # Errors
    ///
    /// Returns a closed input, authority-fence, or storage error.
    pub fn mark_sync_rebootstrap_required_v2_guarded(
        &mut self,
        device_id: &str,
        pre_commit_guard: impl FnOnce(SyncProjectionEffect) -> Result<(), BusinessDatabaseError>,
    ) -> Result<SyncProjectionEffect, BusinessDatabaseError> {
        validate_identifier(device_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let revision = i64::try_from(self.current_server_revision()?)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let already_required: bool = transaction
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM sync_reader_state
                 WHERE workspace_id=?1 AND device_id=?2 AND status='rebootstrap_required')",
                params![self.workspace_id, device_id],
                |row| row.get::<_, i64>(0),
            )
            .map(|value| value == 1)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO sync_reader_state
                 (workspace_id,device_id,cursor_generation,read_through_server_revision,
                  pinned_target_server_revision,continuation_token,status,updated_at,
                  confirmation_token,last_page_digest,anti_rollback_server_revision_floor,
                  anti_rollback_schema_version_floor,row_version)
                 VALUES (?1,?2,1,?3,NULL,NULL,'rebootstrap_required',
                         strftime('%Y-%m-%dT%H:%M:%SZ','now'),NULL,NULL,?3,2,1)
                 ON CONFLICT(workspace_id,device_id) DO UPDATE SET
                   status='rebootstrap_required',continuation_token=NULL,confirmation_token=NULL,
                   anti_rollback_server_revision_floor=MAX(sync_reader_state.anti_rollback_server_revision_floor,excluded.anti_rollback_server_revision_floor),
                   row_version=sync_reader_state.row_version+1,updated_at=excluded.updated_at",
                params![self.workspace_id, device_id, revision],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO native_cloud_checkpoint_state(workspace_id,checkpoint_due)
                 VALUES (?1,1)
                 ON CONFLICT(workspace_id) DO UPDATE SET checkpoint_due=1",
                [self.workspace_id.as_str()],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let effect = if already_required {
            SyncProjectionEffect::Unchanged
        } else {
            SyncProjectionEffect::VisibleStateChanged
        };
        pre_commit_guard(effect)?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(effect)
    }

    /// Returns the Host-durable checkpoint demand bit. It is initialized due for every active
    /// workspace and remains due across restart until a strictly parsed response is committed.
    pub fn native_checkpoint_due(&self) -> Result<bool, BusinessDatabaseError> {
        self.store.raw_connection().query_row(
            "SELECT COALESCE((SELECT checkpoint_due FROM native_cloud_checkpoint_state WHERE workspace_id=?1),1)",
            [self.workspace_id.as_str()],
            |row| row.get::<_, i64>(0),
        ).map(|value| value == 1).map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    /// Commits a valid checkpoint response and clears the durable due bit in one guarded
    /// transaction. `None` records a successful null response without inventing a descriptor.
    pub fn complete_native_checkpoint_guarded(
        &mut self,
        descriptor: Option<&NativeCheckpointDescriptor>,
        checked_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_timestamp(Some(checked_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if let Some(descriptor) = descriptor {
            // ADR-0029: only version 3 descriptors (checkpoints that carry tombstones) are stored.
            if descriptor.schema_version != 3
                || descriptor.workspace_id != self.workspace_id
                || descriptor.workspace_schema_version == 0
                || descriptor.workspace_schema_version > 9_007_199_254_740_991
                || descriptor.through_server_revision > 9_007_199_254_740_991
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            validate_local_text(&descriptor.checkpoint_id)?;
            if descriptor.checkpoint_digest.len() != 43
                || !descriptor
                    .checkpoint_digest
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let changed = if let Some(descriptor) = descriptor {
            transaction.execute(
                "INSERT INTO native_cloud_checkpoint_state
                    (workspace_id,checkpoint_due,checkpoint_id,checkpoint_schema_version,
                     through_server_revision,workspace_schema_version,checkpoint_digest,checked_at)
                 VALUES (?7,0,?1,?2,?3,?4,?5,?6)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    checkpoint_due=0,checkpoint_id=excluded.checkpoint_id,
                    checkpoint_schema_version=excluded.checkpoint_schema_version,
                    through_server_revision=excluded.through_server_revision,
                    workspace_schema_version=excluded.workspace_schema_version,
                    checkpoint_digest=excluded.checkpoint_digest,checked_at=excluded.checked_at
                 WHERE native_cloud_checkpoint_state.checkpoint_due=1",
                params![
                    descriptor.checkpoint_id,
                    i64::try_from(descriptor.schema_version)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    i64::try_from(descriptor.through_server_revision)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    i64::try_from(descriptor.workspace_schema_version)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    descriptor.checkpoint_digest,
                    checked_at,
                    self.workspace_id,
                ],
            )
        } else {
            transaction.execute(
                "INSERT INTO native_cloud_checkpoint_state(workspace_id,checkpoint_due,checked_at)
                 VALUES (?2,0,?1)
                 ON CONFLICT(workspace_id) DO UPDATE SET
                    checkpoint_due=0,checkpoint_id=NULL,checkpoint_schema_version=NULL,
                    through_server_revision=NULL,workspace_schema_version=NULL,
                    checkpoint_digest=NULL,checked_at=excluded.checked_at
                 WHERE native_cloud_checkpoint_state.checkpoint_due=1",
                params![checked_at, self.workspace_id],
            )
        }
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationStale);
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }
}

/// Checkpoint tombstones are strictly ordered by UTF-8 id, disjoint from the live assets, deleted at
/// or before the checkpoint revision, and first-generation until re-adding lands (ADR-0029 C2).
#[cfg(test)]
fn validate_checkpoint_tombstones(
    snapshot: &[DomainAssetWrite],
    tombstones: &[RebootstrapTombstone],
    checkpoint_revision: u64,
) -> Result<(), BusinessDatabaseError> {
    if tombstones.len() > 10_000 {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    for (index, tombstone) in tombstones.iter().enumerate() {
        validate_domain_asset_id(&tombstone.entity_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_rebootstrap_timestamp(&tombstone.deleted_at)?;
        if !(1..=9_007_199_254_740_991).contains(&tombstone.entity_generation)
            || tombstone.deleted_server_revision == 0
            || tombstone.deleted_server_revision > checkpoint_revision
            || (index > 0
                && tombstones[index - 1].entity_id.as_bytes() >= tombstone.entity_id.as_bytes())
            || snapshot
                .binary_search_by(|asset| {
                    asset
                        .entity_id
                        .as_bytes()
                        .cmp(tombstone.entity_id.as_bytes())
                })
                .is_ok()
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
    }
    Ok(())
}

/// Whether a live checkpoint asset of `generation` may merge into the local row (ADR-0029 decision
/// 5). Only a live, settled local row of the same generation merges. Two local states are still
/// moving and are waited for with `MutationConflict`: this device's own unsettled deletion of that
/// generation (Cloud has not answered it, so the asset is still live there), and a provisional
/// re-add that the checkpoint's generation may already contain. Anything else is older or
/// different data and refuses the installation.
#[cfg(test)]
fn checkpoint_asset_may_merge(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
    generation: i64,
    local_generation: i64,
    local_deleted: bool,
) -> Result<(), BusinessDatabaseError> {
    let (tombstone_state, provisional): (Option<String>, bool) = transaction
        .query_row(
            "SELECT (SELECT state FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                       AND entity_generation=?3),
                    EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
                           WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace_id, entity_id, generation],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if local_generation != generation {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    if local_deleted {
        return if tombstone_state.as_deref() == Some("pending") {
            Err(BusinessDatabaseError::MutationConflict)
        } else {
            Err(BusinessDatabaseError::InvalidInput)
        };
    }
    if provisional {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    Ok(())
}

/// Advances an entity from the confirmed local generation `from` to the checkpoint's later
/// generation `to` (ADR-0029 C3b2): Cloud deleted and re-added it in history compaction folded
/// away. Only settled local state advances. This device's unfinished work on the entity (an
/// unsettled or contested deletion, a provisional re-add, an Outbox row still to send, or a
/// conflicted field) belongs to a generation Cloud has superseded, and it must end
/// through its push result or conflict resolution first, so the installation waits with
/// `MutationConflict`. The row is then reset exactly as an Inbox re-add resets it (sync fields,
/// tags and local intent cleared, local lifecycle fields emptied, field versions removed; Provider
/// bindings and observations describe the real domain and stay), leaving a clean live row of
/// generation `to` for the checkpoint's values or tombstone.
#[cfg(test)]
fn advance_to_checkpoint_generation(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    entity_id: &str,
    from: i64,
    to: i64,
    checkpoint_revision: i64,
    local_commit_sequence: i64,
) -> Result<(), BusinessDatabaseError> {
    let unsettled: bool = transaction
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
                           WHERE workspace_id=?1 AND entity_id=?2)
                 OR EXISTS(SELECT 1 FROM sync_outbox
                           WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                             AND state IN ('pending','sending'))
                 OR EXISTS(SELECT 1 FROM sync_tombstones
                           WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                             AND (state NOT IN ('acknowledged','replicated')
                                  OR barrier_state='contested'
                                  OR deleted_server_revision IS NULL))
                 OR EXISTS(SELECT 1 FROM domain_asset_field_versions
                           WHERE workspace_id=?1 AND entity_id=?2 AND sync_state='conflicted')
                 OR EXISTS(SELECT 1 FROM sync_conflicts
                           WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2
                             AND status='open')",
            params![workspace_id, entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    // The schema re-checks the transition itself (current generation, confirmed uncontested
    // tombstone, no provisional re-add or unfinished Outbox row). Conflicted fields and open
    // conflicts are only checked here: they decide whether to wait, not whether the advance is a
    // valid transition. A `pending` field mark with no unfinished Outbox row is what a write Cloud
    // refused leaves behind; nothing is owed for it, so it does not hold the advance, and the reset
    // below retires it while the refused Outbox row keeps the evidence (decision 3).
    if unsettled {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    transaction
        .execute(
            "INSERT INTO sync_domain_asset_checkpoint_advances
             (workspace_id,entity_id,from_generation,to_generation,checkpoint_server_revision,
              local_commit_sequence)
             VALUES (?1,?2,?3,?4,?5,?6)",
            params![
                workspace_id,
                entity_id,
                from,
                to,
                checkpoint_revision,
                local_commit_sequence
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "DELETE FROM sync_tombstones
             WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2",
            params![workspace_id, entity_id],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "UPDATE domain_assets SET entity_generation=?3, lifecycle_status='active',
               deleted_at=NULL, acquired_on=NULL, expires_on=NULL,
               acquisition_cost_currency=NULL, acquisition_cost_amount=NULL, auto_renew=NULL,
               registrar_lock=NULL, local_commit_sequence=?4,
               updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, entity_id, to, local_commit_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "UPDATE portfolio_domain_assets SET note=NULL, portfolio_id=NULL, tags_json='[]',
               target_price_currency=NULL, target_price_amount=NULL, note_server_revision=?3,
               portfolio_id_server_revision=?3, tags_server_revision=?3,
               target_price_server_revision=?3
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, entity_id, checkpoint_revision],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "UPDATE domain_asset_desired_state SET portfolio_id=NULL, note=NULL,
               target_price_currency=NULL, target_price_amount=NULL, desired_sale_status='hold',
               desired_nameservers_json='[]', local_commit_sequence=?3,
               updated_at=strftime('%Y-%m-%dT%H:%M:%SZ','now')
             WHERE workspace_id=?1 AND entity_id=?2",
            params![workspace_id, entity_id, local_commit_sequence],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    for statement in [
        "DELETE FROM domain_asset_tags WHERE workspace_id=?1 AND entity_id=?2",
        "DELETE FROM domain_asset_field_versions WHERE workspace_id=?1 AND entity_id=?2",
    ] {
        transaction
            .execute(statement, params![workspace_id, entity_id])
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    }
    Ok(())
}

/// Installs one checkpoint tombstone exactly as a replicated delete of a clean entity would, with
/// the checkpoint's deletion revision as its only order evidence. A generation is deleted at most
/// once, so a confirmed local tombstone of the same generation and revision is this deletion and
/// is kept as is (under a provisional re-add it is only confirmed). A later checkpoint generation
/// first advances the entity to it. Unsynced local edits to the deleted entity make the whole
/// installation wait: a rebootstrap does not yet surface them as conflicts, and they must not be
/// silently dropped.
#[cfg(test)]
#[expect(
    clippy::too_many_lines,
    reason = "the generation comparison, the advance and the tombstone write share one decision"
)]
fn install_checkpoint_tombstone(
    transaction: &rusqlite::Connection,
    workspace_id: &str,
    tombstone: &RebootstrapTombstone,
    checkpoint_revision: i64,
    local_commit_sequence: i64,
) -> Result<(), BusinessDatabaseError> {
    let generation = i64::try_from(tombstone.entity_generation)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let revision = i64::try_from(tombstone.deleted_server_revision)
        .map_err(|_| BusinessDatabaseError::InvalidInput)?;
    let local_state = transaction
        .query_row(
            "SELECT (SELECT entity_generation FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2),
                    (SELECT state FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2),
                    (SELECT barrier_state FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2),
                    (SELECT deleted_server_revision FROM sync_tombstones
                     WHERE workspace_id=?1 AND entity_kind='domain_asset' AND entity_id=?2),
                    (SELECT entity_generation FROM domain_assets
                     WHERE workspace_id=?1 AND entity_id=?2),
                    (SELECT deleted_at FROM domain_assets
                     WHERE workspace_id=?1 AND entity_id=?2),
                    EXISTS(SELECT 1 FROM sync_domain_asset_provisional_re_adds
                           WHERE workspace_id=?1 AND entity_id=?2)",
            params![workspace_id, tombstone.entity_id],
            |row| {
                Ok(LocalTombstoneState {
                    tombstone_generation: row.get(0)?,
                    state: row.get(1)?,
                    barrier: row.get(2)?,
                    deleted_server_revision: row.get(3)?,
                    asset_generation: row.get(4)?,
                    asset_deleted: row.get::<_, Option<String>>(5)?.is_some(),
                    provisional_re_add: row.get(6)?,
                })
            },
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    // ADR-0029 decision 5: the confirmed local generation is the tombstone's, else the row's. A
    // later one makes the checkpoint older data; an earlier one means Cloud deleted and re-added
    // the entity since, so the replica advances to the checkpoint's generation first and then
    // installs its deletion like that of any live entity of that generation.
    let confirmed_generation = local_state
        .tombstone_generation
        .or(local_state.asset_generation);
    if let Some(local) = confirmed_generation.filter(|local| *local < generation) {
        if local_state.provisional_re_add {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        advance_to_checkpoint_generation(
            transaction,
            workspace_id,
            &tombstone.entity_id,
            local,
            generation,
            checkpoint_revision,
            local_commit_sequence,
        )?;
    } else if let Some(local) = local_state.tombstone_generation {
        if local != generation {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        // This device's own deletion is still unsettled (sent or waiting, no Cloud revision yet),
        // or a remote deletion met unsynced local edits. Both end through the existing push result
        // or conflict resolution, so the installation waits rather than deciding for them.
        if local_state.state.as_deref() == Some("pending")
            || local_state.barrier.as_deref() == Some("contested")
        {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let confirmed = matches!(
            local_state.state.as_deref(),
            Some("acknowledged" | "replicated")
        ) && local_state.deleted_server_revision == Some(revision);
        // A confirmed tombstone of this generation is the checkpoint's deletion. Under a
        // provisional re-add it only confirms that tombstone (decision 4): the provisional g + 1
        // row and its Outbox item are left to the acknowledgement or rejection.
        let row_matches = if local_state.provisional_re_add {
            local_state.asset_generation == Some(generation + 1) && !local_state.asset_deleted
        } else {
            local_state.asset_generation == Some(generation) && local_state.asset_deleted
        };
        return if confirmed && row_matches {
            Ok(())
        } else {
            Err(BusinessDatabaseError::InvalidInput)
        };
    } else if let Some(local) = local_state.asset_generation
        && local != generation
    {
        return Err(BusinessDatabaseError::InvalidInput);
    }
    let unsynced: i64 = transaction
        .query_row(
            "SELECT count(*) FROM domain_asset_field_versions
             WHERE workspace_id=?1 AND entity_id=?2 AND sync_state IN ('pending','conflicted')",
            params![workspace_id, tombstone.entity_id],
            |row| row.get(0),
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    if unsynced != 0 {
        return Err(BusinessDatabaseError::MutationConflict);
    }
    transaction
        .execute(
            "INSERT INTO sync_tombstones
             (workspace_id,entity_kind,entity_id,deleted_local_commit_sequence,
              deleted_server_revision,deleted_at,purge_after,state,barrier_state,
              order_server_revision,order_source_device_id,order_mutation_id,entity_generation,
              order_provenance)
             VALUES (?1,'domain_asset',?2,?3,?4,?5,NULL,'replicated','replicated',?4,NULL,NULL,?6,
                     'checkpoint')",
            params![
                workspace_id,
                tombstone.entity_id,
                local_commit_sequence,
                revision,
                tombstone.deleted_at,
                generation
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    transaction
        .execute(
            "INSERT INTO domain_assets
             (workspace_id,entity_id,lifecycle_status,created_at,updated_at,deleted_at,
              local_commit_sequence,entity_generation)
             VALUES (?1,?2,'archived',strftime('%Y-%m-%dT%H:%M:%SZ','now'),?3,?3,?4,?5)
             ON CONFLICT(workspace_id,entity_id) DO UPDATE SET
               lifecycle_status='archived',updated_at=excluded.updated_at,
               deleted_at=excluded.deleted_at,local_commit_sequence=excluded.local_commit_sequence",
            params![
                workspace_id,
                tombstone.entity_id,
                tombstone.deleted_at,
                local_commit_sequence,
                generation
            ],
        )
        .map_err(|_| BusinessDatabaseError::StorageRejected)?;
    Ok(())
}
