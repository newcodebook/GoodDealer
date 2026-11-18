//! Provider binding and observation transactions.
//! Transactions remain owned by the single `BusinessDatabase`; splitting capabilities adds no writer.

#[cfg(test)]
use super::*;
#[cfg(not(test))]
use super::{
    BindableZone, BusinessDatabase, BusinessDatabaseError, ClaimedCloudflareDnsProjection,
    CloudflareConnectionObservationAdmission, CloudflareDnsObservationWrite,
    CloudflareDnsProjectionAcknowledgement, DomainProviderBindingReceipt, OptionalExtension,
    PendingCloudflareDnsProjection, TransactionBehavior, hex_digest, is_uuid_v4,
    latest_bindable_zone, params, validate_domain_asset_id, validate_identifier,
    validate_local_text, validate_sha256_hex, validate_timestamp,
};

impl BusinessDatabase {
    #[cfg(test)]
    pub(crate) fn provider_binding_snapshot_for_test(&self) -> Vec<Vec<Vec<String>>> {
        [
            "domain_asset_provider_bindings",
            "active_workspace_metadata",
            "sync_outbox",
            "sync_outbox_fields",
            "cloudflare_dns_projection_outbox",
        ]
        .iter()
        .map(|table| {
            let mut statement = self
                .store
                .raw_connection()
                .prepare(&format!("SELECT * FROM {table} ORDER BY rowid"))
                .unwrap();
            let columns = statement.column_count();
            statement
                .query_map([], |row| {
                    (0..columns)
                        .map(|column| {
                            row.get::<_, rusqlite::types::Value>(column)
                                .map(|value| format!("{value:?}"))
                        })
                        .collect::<Result<Vec<_>, _>>()
                })
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        })
        .collect()
    }

    /// Binds an existing local asset to the latest Host-verified Cloudflare Zone observation.
    ///
    /// The Provider resource digest and connection are read from the local staged observation;
    /// callers cannot provide either value. A binding identity is immutable, so credential or
    /// resource drift fails closed until an explicit replacement workflow is implemented.
    #[expect(
        clippy::too_many_lines,
        clippy::type_complexity,
        reason = "the binding transaction keeps selection, replay, and commit-fence invariants together"
    )]
    pub(crate) fn bind_latest_cloudflare_zone(
        &mut self,
        entity_id: &str,
        allow_new: bool,
        sequence_available: bool,
        committed_at: &str,
        commit_fence: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<DomainProviderBindingReceipt, BusinessDatabaseError> {
        validate_domain_asset_id(entity_id).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(committed_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let Some(zone) = latest_bindable_zone(&transaction, &self.workspace_id, entity_id)? else {
            return Err(BusinessDatabaseError::ProviderBindingUnavailable);
        };
        let BindableZone {
            connection_id,
            resource_binding_digest,
            observation_digest,
            resource_label,
            generation: binding_generation,
            observed_at,
        } = zone.clone();
        if resource_label != entity_id {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let existing: Option<(
            String,
            String,
            String,
            String,
            i64,
            String,
            String,
            Option<String>,
            Option<String>,
        )> = transaction
            .query_row(
                "SELECT connection_id,provider_kind,resource_binding_digest,observation_digest,
                        binding_generation,resource_label,validation_status,verified_at,last_observed_at
                   FROM domain_asset_provider_bindings
                  WHERE workspace_id=?1 AND entity_id=?2 AND resource_kind='zone'",
                params![self.workspace_id, entity_id],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get::<_, Option<String>>(7)?,
                        row.get::<_, Option<String>>(8)?,
                    ))
                },
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if let Some((
            old_connection,
            old_provider,
            old_digest,
            old_observation,
            old_generation,
            old_label,
            old_status,
            old_verified_at,
            old_last_observed_at,
        )) = existing
        {
            let old_generation = u64::try_from(old_generation)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if !zone.admits_existing(
                &old_connection,
                &old_provider,
                &old_digest,
                &old_label,
                old_generation,
            ) {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            if old_observation == observation_digest
                && old_generation == binding_generation
                && old_status == "verified"
            {
                let local_commit_sequence: i64 = transaction
                    .query_row(
                        "SELECT local_commit_sequence
                           FROM domain_asset_provider_bindings
                          WHERE workspace_id=?1 AND entity_id=?2 AND resource_kind='zone'",
                        params![self.workspace_id, entity_id],
                        |row| row.get(0),
                    )
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                commit_fence()?;
                transaction
                    .commit()
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?;
                return Ok(DomainProviderBindingReceipt {
                    disposition: "replayed",
                    entity_id: entity_id.to_owned(),
                    connection_id,
                    provider_kind: "cloudflare".to_owned(),
                    resource_kind: "zone".to_owned(),
                    resource_binding_digest,
                    observation_digest,
                    resource_label,
                    binding_generation,
                    validation_status: "verified".to_owned(),
                    verified_at: old_verified_at.ok_or(BusinessDatabaseError::StorageRejected)?,
                    last_observed_at: old_last_observed_at
                        .ok_or(BusinessDatabaseError::StorageRejected)?,
                    local_commit_sequence: u64::try_from(local_commit_sequence)
                        .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                });
            }
            if !allow_new {
                return Err(BusinessDatabaseError::MutationStale);
            }
        } else if !allow_new {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if !sequence_available {
            return Err(BusinessDatabaseError::SequenceExhausted);
        }
        let local_commit_sequence: i64 = transaction
            .query_row(
                "UPDATE active_workspace_metadata
                    SET local_commit_sequence=local_commit_sequence+1,updated_at=?1
                  WHERE singleton=1
                RETURNING local_commit_sequence",
                [committed_at],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction
            .execute(
                "INSERT INTO domain_asset_provider_bindings
                 (workspace_id,entity_id,connection_id,provider_kind,resource_kind,
                  resource_binding_digest,observation_digest,resource_label,binding_generation,
                  local_commit_sequence,validation_status,verified_at,last_observed_at,created_at,updated_at)
                 VALUES (?1,?2,?3,'cloudflare','zone',?4,?5,?6,?7,?8,'verified',?9,?10,?9,?9)
                 ON CONFLICT(workspace_id,entity_id,resource_kind)
                 WHERE resource_kind IN ('zone', 'registration') DO UPDATE SET
                   observation_digest=excluded.observation_digest,
                   resource_label=excluded.resource_label,
                   binding_generation=excluded.binding_generation,
                   local_commit_sequence=excluded.local_commit_sequence,
                   validation_status='verified',
                   verified_at=excluded.verified_at,
                   last_observed_at=excluded.last_observed_at,
                   updated_at=excluded.updated_at",
                params![
                    self.workspace_id,
                    entity_id,
                    connection_id,
                    resource_binding_digest,
                    observation_digest,
                    resource_label,
                    i64::try_from(binding_generation)
                        .map_err(|_| BusinessDatabaseError::StorageRejected)?,
                    local_commit_sequence,
                    committed_at,
                    observed_at,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        commit_fence()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(DomainProviderBindingReceipt {
            disposition: "committed",
            entity_id: entity_id.to_owned(),
            connection_id,
            provider_kind: "cloudflare".to_owned(),
            resource_kind: "zone".to_owned(),
            resource_binding_digest,
            observation_digest,
            resource_label,
            binding_generation,
            validation_status: "verified".to_owned(),
            verified_at: committed_at.to_owned(),
            last_observed_at: observed_at,
            local_commit_sequence: u64::try_from(local_commit_sequence)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
        })
    }

    /// Reads the non-secret committed credential identity required for Provider observation.
    ///
    /// # Errors
    ///
    /// Rejects inactive, unvalidated, incomplete, or malformed connection state.
    pub fn cloudflare_connection_observation_admission(
        &self,
        connection_id: &str,
    ) -> Result<CloudflareConnectionObservationAdmission, BusinessDatabaseError> {
        validate_local_text(connection_id)?;
        let admission = self
            .store
            .raw_connection()
            .query_row(
                "SELECT active_credential_generation,active_credential_scope_digest,
                        active_credential_zone_digest,active_credential_public_proof
                   FROM local_provider_connections
                  WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='cloudflare'
                    AND lifecycle_status='active' AND validation_status='valid'
                    AND credential_use_state='active'
                    AND NOT EXISTS (SELECT 1 FROM cloudflare_credential_roots r
                      WHERE r.workspace_id=local_provider_connections.workspace_id
                        AND r.logical_connection_id=local_provider_connections.connection_id
                        AND (r.retirement_requested_at IS NOT NULL OR r.retired_at IS NOT NULL))
                    AND json_array_length(capabilities_json)=1
                    AND json_extract(capabilities_json,'$[0]')='dns'",
                params![self.workspace_id, connection_id],
                |row| {
                    Ok(CloudflareConnectionObservationAdmission {
                        generation: u64::try_from(row.get::<_, i64>(0)?)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        scope_digest: row.get(1)?,
                        zone_digest: row.get(2)?,
                        public_proof: row.get(3)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !(1..=9_007_199_254_740_991).contains(&admission.generation) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_sha256_hex(&admission.scope_digest)?;
        validate_sha256_hex(&admission.zone_digest)?;
        validate_sha256_hex(&admission.public_proof)?;
        Ok(admission)
    }

    /// Commits full local DNS evidence and its count-only Cloud projection in one transaction.
    /// Raw record values never enter the projection outbox.
    ///
    /// # Errors
    ///
    /// Rejects invalid evidence, stale lease epochs, exhausted sequences, or an atomic storage failure.
    #[allow(
        clippy::too_many_lines,
        reason = "the atomic observation/evidence/projection transaction keeps its fences contiguous"
    )]
    #[cfg_attr(
        not(test),
        expect(
            dead_code,
            reason = "the unguarded observation port remains private; production uses the Host-fenced operation"
        )
    )]
    pub fn commit_cloudflare_dns_observation(
        &mut self,
        input: &CloudflareDnsObservationWrite,
    ) -> Result<PendingCloudflareDnsProjection, BusinessDatabaseError> {
        self.commit_cloudflare_dns_observation_guarded(input, || Ok(()))
    }

    /// # Errors
    ///
    /// Returns the same validation, authority, or storage errors as the unguarded operation.
    #[allow(clippy::too_many_lines)]
    pub fn commit_cloudflare_dns_observation_guarded(
        &mut self,
        input: &CloudflareDnsObservationWrite,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<PendingCloudflareDnsProjection, BusinessDatabaseError> {
        for value in [
            &input.observation_id,
            &input.observation_run_id,
            &input.entity_id,
            &input.connection_id,
            &input.zone_name_ascii,
            &input.provider_version_token,
        ] {
            validate_local_text(value)?;
        }
        validate_domain_asset_id(&input.entity_id)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !is_uuid_v4(&input.observation_id) || !is_uuid_v4(&input.observation_run_id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(input.observed_at.clone()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_sha256_hex(&input.credential_scope_digest)?;
        validate_sha256_hex(&input.credential_zone_digest)?;
        validate_sha256_hex(&input.credential_public_proof)?;
        let epoch =
            i64::try_from(input.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if epoch < 1
            || input.records.len() > 1_024
            || !(1..=9_007_199_254_740_991).contains(&input.credential_generation)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        if input.authoritative_nameservers.len() > 32
            || input
                .authoritative_nameservers
                .iter()
                .any(|v| v.is_empty() || v.len() > 253)
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut counts = serde_json::Map::from_iter([
            ("a".to_owned(), serde_json::Value::from(0)),
            ("aaaa".to_owned(), serde_json::Value::from(0)),
            ("cname".to_owned(), serde_json::Value::from(0)),
            ("txt".to_owned(), serde_json::Value::from(0)),
            ("proxied".to_owned(), serde_json::Value::from(0)),
        ]);
        for record in &input.records {
            validate_local_text(&record.record_key)?;
            validate_local_text(&record.record_type)?;
            validate_local_text(&record.owner_name_ascii)?;
            validate_local_text(&record.canonical_value)?;
            let key = record.record_type.to_ascii_lowercase();
            let value = counts
                .get_mut(&key)
                .ok_or(BusinessDatabaseError::InvalidInput)?;
            *value = serde_json::Value::from(value.as_u64().unwrap_or(0) + 1);
            if record.proxied == Some(true) {
                if !matches!(key.as_str(), "a" | "aaaa" | "cname") {
                    return Err(BusinessDatabaseError::InvalidInput);
                }
                let value = counts
                    .get_mut("proxied")
                    .ok_or(BusinessDatabaseError::StorageRejected)?;
                *value = serde_json::Value::from(value.as_u64().unwrap_or(0) + 1);
            }
        }
        let counts = if input.availability == "unavailable" {
            if input.zone_status != "unknown" || !input.records.is_empty() {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            serde_json::json!({ "a": null, "aaaa": null, "cname": null, "txt": null, "proxied": null })
        } else if input.availability == "available"
            && matches!(input.zone_status.as_str(), "active" | "pending")
        {
            serde_json::Value::Object(counts)
        } else {
            return Err(BusinessDatabaseError::InvalidInput);
        };
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let connection_ready: i64 = transaction.query_row("SELECT count(*) FROM local_provider_connections WHERE workspace_id=?1 AND connection_id=?2 AND provider_kind='cloudflare' AND lifecycle_status='active' AND validation_status='valid' AND credential_use_state='active' AND NOT EXISTS (SELECT 1 FROM cloudflare_credential_roots r WHERE r.workspace_id=local_provider_connections.workspace_id AND r.logical_connection_id=local_provider_connections.connection_id AND (r.retirement_requested_at IS NOT NULL OR r.retired_at IS NOT NULL)) AND active_credential_generation=?3 AND active_credential_scope_digest=?4 AND active_credential_zone_digest=?5 AND active_credential_public_proof=?6 AND json_array_length(capabilities_json)=1 AND json_extract(capabilities_json,'$[0]')='dns'", params![self.workspace_id,input.connection_id,i64::try_from(input.credential_generation).map_err(|_| BusinessDatabaseError::InvalidInput)?,input.credential_scope_digest,input.credential_zone_digest,input.credential_public_proof], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if connection_ready != 1 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        transaction.execute("INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status) VALUES (?1,?2,?3,'dns',?4,'running')", params![self.workspace_id,input.observation_run_id,input.connection_id,input.observed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at) VALUES (?1,?2,?3,0,'requested',?4)", params![self.workspace_id,input.observation_run_id,input.entity_id,input.observed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let prior: Option<(i64, i64)> = transaction.query_row("SELECT lease_epoch, source_sequence FROM cloudflare_dns_source_heads WHERE workspace_id=?1 AND entity_id=?2", params![self.workspace_id, input.entity_id], |row| Ok((row.get(0)?, row.get(1)?))).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let source = prior.map_or(1, |(prior_epoch, prior_source)| {
            match epoch.cmp(&prior_epoch) {
                std::cmp::Ordering::Greater => 1,
                std::cmp::Ordering::Equal => prior_source.saturating_add(1),
                std::cmp::Ordering::Less => 0,
            }
        });
        if !(1..=9_007_199_254_740_991).contains(&source) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let projection = serde_json::json!({
            "schemaVersion": 1,
            "providerKind": "cloudflare",
            "observationCapability": "dns",
            "observationId": input.observation_id,
            "entityId": input.entity_id,
            "leaseEpoch": input.lease_epoch,
            "sourceSequence": source,
            "observedAt": input.observed_at,
            "availability": input.availability,
            "zoneStatus": input.zone_status,
            "counts": counts,
        });
        let projection_json =
            serde_json::to_string(&projection).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if projection_json.len() > 65_536 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        transaction.execute(
            "INSERT INTO dns_zone_observations (workspace_id,zone_observation_id,observation_run_id,entity_id,zone_name_ascii,authoritative_nameservers_json,dnssec_status,observation_availability,evidence_status,observed_at,provider_version_token,normalized_evidence_sha256,cloudflare_zone_status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'confirmed',?9,?10,NULL,?11)",
            params![self.workspace_id,input.observation_id,input.observation_run_id,input.entity_id,input.zone_name_ascii,serde_json::to_string(&input.authoritative_nameservers).map_err(|_| BusinessDatabaseError::InvalidInput)?,input.dnssec_status,input.availability,input.observed_at,input.provider_version_token,input.zone_status],
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        for record in &input.records {
            transaction.execute("INSERT INTO dns_record_observations (workspace_id,zone_observation_id,record_key,record_type,owner_name_ascii,ttl_seconds,priority,canonical_value,proxied) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)", params![self.workspace_id,input.observation_id,record.record_key,record.record_type,record.owner_name_ascii,record.ttl_seconds.map(i64::from),record.priority.map(i64::from),record.canonical_value,record.proxied.map(i64::from)]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        transaction.execute("UPDATE provider_observation_targets SET status='succeeded', completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND entity_id=?4 AND status='requested'", params![input.observed_at,self.workspace_id,input.observation_run_id,input.entity_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("UPDATE provider_observation_runs SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3 AND status='running'", params![input.observed_at,self.workspace_id,input.observation_run_id]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO cloudflare_dns_source_heads (workspace_id,entity_id,lease_epoch,source_sequence,updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET lease_epoch=excluded.lease_epoch,source_sequence=excluded.source_sequence,updated_at=excluded.updated_at", params![self.workspace_id,input.entity_id,epoch,source,input.observed_at]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let digest = canonical_cloudflare_projection_digest(&projection)?;
        transaction.execute("INSERT INTO cloudflare_dns_projection_outbox (workspace_id,observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest,state) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending')", params![self.workspace_id,input.observation_id,input.entity_id,epoch,source,input.observed_at,projection_json,digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        transaction.execute("INSERT INTO cloudflare_dns_projection_heads (workspace_id,entity_id,lease_epoch,source_sequence,observation_id,observed_at,projection_digest,updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?6) ON CONFLICT(workspace_id,entity_id) DO UPDATE SET lease_epoch=excluded.lease_epoch,source_sequence=excluded.source_sequence,observation_id=excluded.observation_id,observed_at=excluded.observed_at,projection_digest=excluded.projection_digest,updated_at=excluded.updated_at", params![self.workspace_id,input.entity_id,epoch,source,input.observation_id,input.observed_at,digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(PendingCloudflareDnsProjection {
            observation_id: input.observation_id.clone(),
            entity_id: input.entity_id.clone(),
            lease_epoch: input.lease_epoch,
            source_sequence: u64::try_from(source)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            observed_at: input.observed_at.clone(),
            projection_json,
            canonical_request_digest: digest,
        })
    }

    /// Reads a bounded pending projection page without changing delivery ownership.
    ///
    /// # Errors
    ///
    /// Rejects an invalid limit or unreadable/tampered storage.
    pub fn pending_cloudflare_dns_projections(
        &self,
        limit: usize,
    ) -> Result<Vec<PendingCloudflareDnsProjection>, BusinessDatabaseError> {
        if !(1..=256).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let mut statement = self.store.raw_connection().prepare("SELECT observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest FROM cloudflare_dns_projection_outbox WHERE workspace_id=?1 AND state='pending' ORDER BY observed_at,observation_id LIMIT ?2").map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map(
                params![
                    self.workspace_id,
                    i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?
                ],
                |row| {
                    Ok(PendingCloudflareDnsProjection {
                        observation_id: row.get(0)?,
                        entity_id: row.get(1)?,
                        lease_epoch: u64::try_from(row.get::<_, i64>(2)?)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        source_sequence: u64::try_from(row.get::<_, i64>(3)?)
                            .map_err(|_| rusqlite::Error::InvalidQuery)?,
                        observed_at: row.get(4)?,
                        projection_json: row.get(5)?,
                        canonical_request_digest: row.get(6)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    pub(crate) fn next_cloudflare_projection_attempt_unix_seconds(
        &self,
        now_unix_seconds: i64,
    ) -> Result<Option<i64>, BusinessDatabaseError> {
        self.store
            .raw_connection()
            .query_row(
                "SELECT CASE
                    WHEN state='pending' THEN COALESCE(unixepoch(next_attempt_at), ?2)
                    WHEN state='sending' THEN unixepoch(delivery_lease_expires_at)
                    ELSE NULL
                 END
                 FROM cloudflare_dns_projection_outbox
                 WHERE workspace_id=?1 AND state IN ('pending','sending')
                 ORDER BY lease_epoch,source_sequence
                 LIMIT 1",
                params![self.workspace_id, now_unix_seconds],
                |row| row.get(0),
            )
            .optional()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
            .and_then(|deadline| {
                deadline
                    .flatten()
                    .map_or(Ok(None), |deadline| Ok(Some(deadline)))
            })
    }

    /// Claims count-only projections using a durable lease and monotonically increasing fence.
    ///
    /// # Errors
    ///
    /// Rejects invalid lease inputs, digest corruption, sequence exhaustion, or a failed claim CAS.
    pub fn claim_cloudflare_dns_projections_guarded(
        &mut self,
        delivery_owner: &str,
        now: &str,
        lease_expires_at: &str,
        limit: usize,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<Vec<ClaimedCloudflareDnsProjection>, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(now.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(lease_expires_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if now >= lease_expires_at || !(1..=256).contains(&limit) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let candidates = {
            let mut statement = transaction.prepare("SELECT observation_id,entity_id,lease_epoch,source_sequence,observed_at,projection_json,canonical_request_digest,delivery_attempt_fence,state,next_attempt_at,delivery_lease_expires_at FROM cloudflare_dns_projection_outbox WHERE workspace_id=?1 AND state IN ('pending','sending') ORDER BY lease_epoch,source_sequence LIMIT ?4").map_err(|_| BusinessDatabaseError::StorageRejected)?;
            statement
                .query_map(
                    params![
                        self.workspace_id,
                        now,
                        delivery_owner,
                        i64::try_from(limit).map_err(|_| BusinessDatabaseError::InvalidInput)?
                    ],
                    |row| {
                        Ok((
                            PendingCloudflareDnsProjection {
                                observation_id: row.get(0)?,
                                entity_id: row.get(1)?,
                                lease_epoch: u64::try_from(row.get::<_, i64>(2)?)
                                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                                source_sequence: u64::try_from(row.get::<_, i64>(3)?)
                                    .map_err(|_| rusqlite::Error::InvalidQuery)?,
                                observed_at: row.get(4)?,
                                projection_json: row.get(5)?,
                                canonical_request_digest: row.get(6)?,
                            },
                            row.get::<_, i64>(7)?,
                            row.get::<_, String>(8)?,
                            row.get::<_, Option<String>>(9)?,
                            row.get::<_, Option<String>>(10)?,
                        ))
                    },
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
                .collect::<Result<Vec<_>, _>>()
                .map_err(|_| BusinessDatabaseError::StorageRejected)?
        };
        let mut claimed = Vec::with_capacity(candidates.len());
        for (projection, prior_fence, state, next_attempt_at, delivery_lease_expires_at) in
            candidates
        {
            let due = match state.as_str() {
                "pending" => next_attempt_at
                    .as_deref()
                    .is_none_or(|deadline| deadline <= now),
                "sending" => delivery_lease_expires_at
                    .as_deref()
                    .is_some_and(|deadline| deadline <= now),
                _ => false,
            };
            if !due {
                break;
            }
            let parsed: serde_json::Value = serde_json::from_str(&projection.projection_json)
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if canonical_cloudflare_projection_digest(&parsed)?
                != projection.canonical_request_digest
            {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            let fence = prior_fence
                .checked_add(1)
                .filter(|v| *v <= 9_007_199_254_740_991)
                .ok_or(BusinessDatabaseError::SequenceExhausted)?;
            let changed = transaction.execute("UPDATE cloudflare_dns_projection_outbox SET state='sending',delivery_owner=?1,delivery_lease_expires_at=?2,delivery_attempt_fence=?3,next_attempt_at=NULL,last_error_code=NULL WHERE workspace_id=?4 AND observation_id=?5 AND (state='pending' OR (state='sending' AND delivery_lease_expires_at<=?6))", params![delivery_owner,lease_expires_at,fence,self.workspace_id,projection.observation_id,now]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if changed != 1 {
                return Err(BusinessDatabaseError::StorageRejected);
            }
            claimed.push(ClaimedCloudflareDnsProjection {
                projection,
                delivery_attempt_fence: u64::try_from(fence)
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            });
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(claimed)
    }

    /// Returns one exact claimed projection to pending and reports its durable retry deadline.
    pub(crate) fn defer_cloudflare_dns_projection_guarded(
        &mut self,
        delivery_owner: &str,
        projection: &ClaimedCloudflareDnsProjection,
        now: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<i64, BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(now.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let fence = i64::try_from(projection.delivery_attempt_fence)
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let delay_seconds = 1_i64
            .checked_shl(
                u32::try_from(fence.clamp(0, 9))
                    .map_err(|_| BusinessDatabaseError::StorageRejected)?,
            )
            .unwrap_or(256)
            .min(300);
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let changed = transaction
            .execute(
                "UPDATE cloudflare_dns_projection_outbox
             SET state='pending',delivery_owner=NULL,delivery_lease_expires_at=NULL,
                 next_attempt_at=strftime('%Y-%m-%dT%H:%M:%SZ',datetime(?1,?2)),
                 last_error_code='transport_retryable'
             WHERE workspace_id=?3 AND observation_id=?4 AND state='sending'
               AND delivery_owner=?5 AND delivery_attempt_fence=?6
               AND lease_epoch=?7 AND source_sequence=?8 AND canonical_request_digest=?9",
                params![
                    now,
                    format!("+{delay_seconds} seconds"),
                    self.workspace_id,
                    projection.projection.observation_id,
                    delivery_owner,
                    fence,
                    i64::try_from(projection.projection.lease_epoch)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    i64::try_from(projection.projection.source_sequence)
                        .map_err(|_| BusinessDatabaseError::InvalidInput)?,
                    projection.projection.canonical_request_digest,
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            return Err(BusinessDatabaseError::MutationConflict);
        }
        let deadline = transaction
            .query_row(
                "SELECT unixepoch(next_attempt_at) FROM cloudflare_dns_projection_outbox
             WHERE workspace_id=?1 AND observation_id=?2",
                params![self.workspace_id, projection.projection.observation_id],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(deadline)
    }

    /// Applies one exact projection ACK. Exact replay is idempotent; every mismatch fails closed.
    ///
    /// # Errors
    ///
    /// Rejects malformed or mismatched ACK identity, stale ownership, or storage failure.
    pub fn acknowledge_cloudflare_dns_projection_guarded(
        &mut self,
        delivery_owner: &str,
        acknowledgement: &CloudflareDnsProjectionAcknowledgement,
        acknowledged_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<(), BusinessDatabaseError> {
        validate_identifier(delivery_owner).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_local_text(&acknowledgement.observation_id)?;
        validate_sha256_hex(&acknowledgement.canonical_request_digest)?;
        validate_timestamp(Some(acknowledged_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        if !matches!(acknowledgement.disposition.as_str(), "current" | "stale") {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let values = [
            acknowledgement.lease_epoch,
            acknowledgement.source_sequence,
            acknowledgement.delivery_attempt_fence,
            acknowledgement.observation_sequence,
        ];
        if values
            .iter()
            .any(|value| !(1..=9_007_199_254_740_991).contains(value))
        {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let changed = transaction.execute("UPDATE cloudflare_dns_projection_outbox SET state='acknowledged',observation_sequence=?1,disposition=?2,acknowledged_at=?3,delivery_owner=NULL,delivery_lease_expires_at=NULL,next_attempt_at=NULL,last_error_code=NULL WHERE workspace_id=?4 AND observation_id=?5 AND state='sending' AND delivery_owner=?6 AND delivery_attempt_fence=?7 AND lease_epoch=?8 AND source_sequence=?9 AND canonical_request_digest=?10", params![i64::try_from(acknowledgement.observation_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.disposition,acknowledged_at,self.workspace_id,acknowledgement.observation_id,delivery_owner,i64::try_from(acknowledgement.delivery_attempt_fence).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.source_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.canonical_request_digest]).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        if changed != 1 {
            let exact: i64 = transaction.query_row("SELECT count(*) FROM cloudflare_dns_projection_outbox WHERE workspace_id=?1 AND observation_id=?2 AND state='acknowledged' AND lease_epoch=?3 AND source_sequence=?4 AND delivery_attempt_fence=?5 AND canonical_request_digest=?6 AND observation_sequence=?7 AND disposition=?8", params![self.workspace_id,acknowledgement.observation_id,i64::try_from(acknowledgement.lease_epoch).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.source_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,i64::try_from(acknowledgement.delivery_attempt_fence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.canonical_request_digest,i64::try_from(acknowledgement.observation_sequence).map_err(|_| BusinessDatabaseError::InvalidInput)?,acknowledgement.disposition], |row| row.get(0)).map_err(|_| BusinessDatabaseError::StorageRejected)?;
            if exact != 1 {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)
    }

    #[cfg(test)]
    pub(crate) fn seed_cloudflare_projection_for_test(
        &mut self,
    ) -> Result<PendingCloudflareDnsProjection, BusinessDatabaseError> {
        let observed_at = "2026-09-15T00:00:00Z";
        {
            let connection = self.store.fixture_connection();
            connection
                .execute(
                    "INSERT INTO domain_assets
                     (workspace_id,entity_id,lifecycle_status,created_at,updated_at,local_commit_sequence)
                     VALUES (?1,'projection.test','active',?2,?2,1)",
                    params![self.workspace_id, observed_at],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
            connection
                .execute(
                    "INSERT INTO local_provider_connections
                     (workspace_id,connection_id,provider_kind,display_label,
                      active_credential_changed_at,capabilities_json,credential_use_state,
                      active_credential_generation,active_credential_scope_digest,
                      active_credential_zone_digest,active_credential_public_proof,validation_status)
                     VALUES (?1,'cf-projection','cloudflare','Cloudflare',?2,'[\"dns\"]',
                             'active',1,?3,?4,?5,'valid')",
                    params![
                        self.workspace_id,
                        observed_at,
                        "a".repeat(64),
                        "c".repeat(64),
                        "b".repeat(64)
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        }
        self.commit_cloudflare_dns_observation(&CloudflareDnsObservationWrite {
            observation_id: "00000000-0000-4000-8000-000000000011".into(),
            observation_run_id: "00000000-0000-4000-8000-000000000012".into(),
            entity_id: "projection.test".into(),
            connection_id: "cf-projection".into(),
            lease_epoch: 1,
            observed_at: observed_at.into(),
            zone_name_ascii: "projection.test".into(),
            authoritative_nameservers: vec![],
            dnssec_status: "unknown".into(),
            availability: "available".into(),
            zone_status: "active".into(),
            records: vec![],
            provider_version_token: "v1".into(),
            credential_generation: 1,
            credential_scope_digest: "a".repeat(64),
            credential_zone_digest: "c".repeat(64),
            credential_public_proof: "b".repeat(64),
        })
    }
}

pub(super) fn canonical_cloudflare_projection_digest(
    value: &serde_json::Value,
) -> Result<String, BusinessDatabaseError> {
    fn frame(tag: u8, payload: &[u8]) -> Vec<u8> {
        let mut output = Vec::with_capacity(payload.len() + 24);
        output.push(tag);
        output.extend_from_slice(payload.len().to_string().as_bytes());
        output.push(b':');
        output.extend_from_slice(payload);
        output
    }
    fn encode(value: &serde_json::Value) -> Result<Vec<u8>, BusinessDatabaseError> {
        match value {
            serde_json::Value::Null => Ok(b"z0:".to_vec()),
            serde_json::Value::Bool(value) => Ok(if *value { b"b1:1" } else { b"b1:0" }.to_vec()),
            serde_json::Value::Number(value) => value
                .as_i64()
                .map(|value| frame(b'n', value.to_string().as_bytes()))
                .ok_or(BusinessDatabaseError::InvalidInput),
            serde_json::Value::String(value) => Ok(frame(b's', value.as_bytes())),
            serde_json::Value::Array(values) => {
                let mut payload = Vec::new();
                for value in values {
                    payload.extend(frame(b'e', &encode(value)?));
                }
                Ok(frame(b'a', &payload))
            }
            serde_json::Value::Object(values) => {
                let mut payload = Vec::new();
                let mut entries: Vec<_> = values.iter().collect();
                entries.sort_by(|(left, _), (right, _)| left.as_bytes().cmp(right.as_bytes()));
                for (key, value) in entries {
                    let mut entry = frame(b'k', key.as_bytes());
                    entry.extend(frame(b'v', &encode(value)?));
                    payload.extend(frame(b'e', &entry));
                }
                Ok(frame(b'o', &payload))
            }
        }
    }
    let domain = frame(b'd', b"GOODDEALER-CLOUDFLARE-DNS-PROJECTION-V1");
    let mut input = domain;
    input.extend(frame(b'v', &encode(value)?));
    Ok(hex_digest(&input))
}
