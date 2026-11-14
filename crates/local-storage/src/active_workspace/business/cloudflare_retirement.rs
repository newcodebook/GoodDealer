use rusqlite::{OptionalExtension, TransactionBehavior, params};

use super::{BusinessDatabase, BusinessDatabaseError, validate_local_text, validate_timestamp};

/// This identity comes only from the admitted database, never from a caller-supplied slot name.
#[derive(Clone)]
pub(crate) struct CloudflareRetirementSeed {
    pub(crate) connection_incarnation_id: String,
    pub(crate) requested_at: String,
}

impl BusinessDatabase {
    pub(crate) fn cloudflare_retirement_candidates(
        &self,
    ) -> Result<Vec<crate::DesktopCloudflareRetirementCandidate>, BusinessDatabaseError> {
        let mut statement = self.store.raw_connection().prepare(
            "SELECT c.connection_id,c.display_label,r.retirement_requested_at IS NOT NULL
               FROM cloudflare_credential_roots r JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
                AND c.connection_incarnation_id=r.connection_incarnation_id
              WHERE r.workspace_id=?1 AND c.provider_kind='cloudflare'
                AND c.deleted_at IS NULL AND c.lifecycle_status<>'deleted' AND r.retired_at IS NULL
                AND (c.credential_use_state='remediation_required' OR EXISTS (
                    SELECT 1 FROM cloudflare_credential_intents i
                     WHERE i.workspace_id=r.workspace_id
                       AND i.connection_incarnation_id=r.connection_incarnation_id
                       AND i.phase='recovery_required'))
                AND NOT EXISTS (SELECT 1 FROM cloudflare_credential_intents i
                     WHERE i.workspace_id=r.workspace_id
                       AND i.connection_incarnation_id=r.connection_incarnation_id
                       AND i.phase IN ('prepared','prewrite_inspection_started','keychain_write_started'))
              ORDER BY c.connection_id LIMIT 65"
        ).map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let rows = statement
            .query_map([&self.workspace_id], |row| {
                Ok(crate::DesktopCloudflareRetirementCandidate {
                    connection_ref: row.get(0)?,
                    display_label: row.get(1)?,
                    action: if row.get(2)? {
                        crate::DesktopCloudflareMaintenanceAction::RetryRetirement
                    } else {
                        crate::DesktopCloudflareMaintenanceAction::Retire
                    },
                })
            })
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut candidates = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        candidates.extend(self.cloudflare_revoke_retry_candidates()?);
        if candidates.len() > 64 {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        for candidate in &candidates {
            validate_local_text(&candidate.connection_ref)?;
            if !crate::portfolio_projection::valid_connection_label(&candidate.display_label) {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        Ok(candidates)
    }

    /// Cases 1 and 2 are offered only when the same seed admission the revoke path uses accepts
    /// them, so the list can never offer a retry that the Host would refuse.
    fn cloudflare_revoke_retry_candidates(
        &self,
    ) -> Result<Vec<crate::DesktopCloudflareRetirementCandidate>, BusinessDatabaseError> {
        let connection = self.store.raw_connection();
        let mut statement = connection
            .prepare(
                "SELECT connection_id FROM local_provider_connections
                  WHERE workspace_id=?1 AND provider_kind='cloudflare' AND deleted_at IS NULL
                    AND lifecycle_status<>'deleted'
                    AND credential_use_state IN ('revocation_pending','revoked')
                  ORDER BY connection_id LIMIT 65",
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let connection_ids = statement
            .query_map([&self.workspace_id], |row| row.get::<_, String>(0))
            .map_err(|_| BusinessDatabaseError::StorageRejected)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let mut candidates = Vec::new();
        for connection_id in connection_ids {
            // A refusal is the expected answer for an ordinary confirmed revocation; a storage
            // failure must fail the whole read rather than silently shrink the list.
            match self.cloudflare_revocation_seed(&connection_id) {
                Ok(seed) => candidates.push(crate::DesktopCloudflareRetirementCandidate {
                    connection_ref: seed.logical_connection_id,
                    display_label: seed.display_label,
                    action: crate::DesktopCloudflareMaintenanceAction::RetryRevoke,
                }),
                Err(BusinessDatabaseError::InvalidInput | BusinessDatabaseError::MutationStale) => {
                }
                Err(error) => return Err(error),
            }
        }
        Ok(candidates)
    }

    pub(crate) fn request_cloudflare_retirement_guarded(
        &mut self,
        connection_hint: &str,
        requested_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<CloudflareRetirementSeed, BusinessDatabaseError> {
        validate_local_text(connection_hint)?;
        validate_timestamp(Some(requested_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let (incarnation, state): (String, String) = transaction
            .query_row(
                "SELECT r.connection_incarnation_id,c.credential_use_state
               FROM cloudflare_credential_roots r JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
                AND c.connection_incarnation_id=r.connection_incarnation_id
              WHERE r.workspace_id=?1 AND c.connection_id=?2 AND c.provider_kind='cloudflare'
                AND c.deleted_at IS NULL AND c.lifecycle_status<>'deleted'
                AND r.retirement_requested_at IS NULL AND r.retired_at IS NULL",
                params![self.workspace_id, connection_hint],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
        validate_local_text(&incarnation)?;
        let live_phase: Option<String> = transaction.query_row(
            "SELECT phase FROM cloudflare_credential_intents
              WHERE workspace_id=?1 AND connection_incarnation_id=?2
                AND phase IN ('prepared','prewrite_inspection_started','keychain_write_started','recovery_required')",
            params![self.workspace_id, incarnation], |row| row.get(0),
        ).optional().map_err(|_| BusinessDatabaseError::StorageRejected)?;
        match live_phase.as_deref() {
            // An unresolved write must first be observed; never race a possible Keychain writer.
            Some("prepared" | "prewrite_inspection_started" | "keychain_write_started") => {
                return Err(BusinessDatabaseError::MutationStale);
            }
            Some("recovery_required") => {
                transaction.execute(
                    "UPDATE cloudflare_credential_intents
                        SET phase='abandoned_for_retirement',terminal_reason='retired',updated_at=?1
                      WHERE workspace_id=?2 AND connection_incarnation_id=?3 AND phase='recovery_required'",
                    params![requested_at, self.workspace_id, incarnation],
                ).map_err(|_| BusinessDatabaseError::StorageRejected)
            .and_then(exactly_one_row)?;
            }
            None if state == "remediation_required" => {}
            _ => return Err(BusinessDatabaseError::MutationStale),
        }
        // Drop publication permission without asserting any observation about the unknown slot.
        // In particular, do not append a burned ledger entry or change the known custody tuple.
        transaction
            .execute(
                "UPDATE local_provider_connections SET credential_use_state='remediation_required',
                    lifecycle_status='invalid',validation_status='unknown',
                    active_credential_generation=NULL,active_credential_scope_digest=NULL,
                    active_credential_zone_digest=NULL,active_credential_public_proof=NULL,
                    active_credential_changed_at=?1
              WHERE workspace_id=?2 AND connection_id=?3 AND connection_incarnation_id=?4",
                params![
                    requested_at,
                    self.workspace_id,
                    connection_hint,
                    incarnation
                ],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)
            .and_then(exactly_one_row)?;
        transaction
            .execute(
                "UPDATE cloudflare_credential_roots SET retirement_requested_at=?1,updated_at=?1
              WHERE workspace_id=?2 AND connection_incarnation_id=?3
                AND retirement_requested_at IS NULL AND retired_at IS NULL",
                params![requested_at, self.workspace_id, incarnation],
            )
            .map_err(|_| BusinessDatabaseError::StorageRejected)
            .and_then(exactly_one_row)?;
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(CloudflareRetirementSeed {
            connection_incarnation_id: incarnation,
            requested_at: requested_at.to_owned(),
        })
    }

    pub(crate) fn cloudflare_retirement_seed(
        &self,
        connection_hint: &str,
    ) -> Result<CloudflareRetirementSeed, BusinessDatabaseError> {
        validate_local_text(connection_hint)?;
        let seed = self
            .store
            .raw_connection()
            .query_row(
                "SELECT r.connection_incarnation_id,r.retirement_requested_at
               FROM cloudflare_credential_roots r JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
                AND c.connection_incarnation_id=r.connection_incarnation_id
              WHERE r.workspace_id=?1 AND c.connection_id=?2 AND c.provider_kind='cloudflare'
                AND c.credential_use_state='remediation_required'
                AND r.retirement_requested_at IS NOT NULL AND r.retired_at IS NULL",
                params![self.workspace_id, connection_hint],
                |row| {
                    Ok(CloudflareRetirementSeed {
                        connection_incarnation_id: row.get(0)?,
                        requested_at: row.get(1)?,
                    })
                },
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
        validate_local_text(&seed.connection_incarnation_id)?;
        validate_timestamp(Some(seed.requested_at.clone()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        Ok(seed)
    }

    pub(crate) fn resolve_cloudflare_retirement_guarded(
        &mut self,
        seed: &CloudflareRetirementSeed,
        verified_absent: bool,
        resolved_at: &str,
        pre_commit_guard: impl FnOnce() -> Result<(), BusinessDatabaseError>,
    ) -> Result<bool, BusinessDatabaseError> {
        validate_local_text(&seed.connection_incarnation_id)?;
        validate_timestamp(Some(seed.requested_at.clone()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        validate_timestamp(Some(resolved_at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let transaction = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        let connection_id: String = transaction
            .query_row(
                "SELECT r.logical_connection_id FROM cloudflare_credential_roots r
               JOIN local_provider_connections c
                 ON c.workspace_id=r.workspace_id AND c.connection_id=r.logical_connection_id
                AND c.connection_incarnation_id=r.connection_incarnation_id
              WHERE r.workspace_id=?1 AND r.connection_incarnation_id=?2
                AND r.retirement_requested_at=?3 AND r.retired_at IS NULL
                AND c.credential_use_state='remediation_required'",
                params![
                    self.workspace_id,
                    seed.connection_incarnation_id,
                    seed.requested_at
                ],
                |row| row.get(0),
            )
            .map_err(|_| BusinessDatabaseError::MutationStale)?;
        if verified_absent {
            transaction
                .execute(
                    "UPDATE cloudflare_credential_roots SET retired_at=?1,updated_at=?1
                  WHERE workspace_id=?2 AND connection_incarnation_id=?3",
                    params![
                        resolved_at,
                        self.workspace_id,
                        seed.connection_incarnation_id
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)
                .and_then(exactly_one_row)?;
            transaction
                .execute(
                    "UPDATE local_provider_connections SET credential_use_state='retired',
                        active_credential_changed_at=?1
                  WHERE workspace_id=?2 AND connection_id=?3 AND connection_incarnation_id=?4",
                    params![
                        resolved_at,
                        self.workspace_id,
                        connection_id,
                        seed.connection_incarnation_id
                    ],
                )
                .map_err(|_| BusinessDatabaseError::StorageRejected)
                .and_then(exactly_one_row)?;
        }
        pre_commit_guard()?;
        transaction
            .commit()
            .map_err(|_| BusinessDatabaseError::StorageRejected)?;
        Ok(verified_absent)
    }
}

/// Each retirement write targets one row already read in the same IMMEDIATE transaction; any other
/// count means the state moved underneath the decision, so the whole transaction fails closed.
fn exactly_one_row(changed: usize) -> Result<(), BusinessDatabaseError> {
    if changed == 1 {
        Ok(())
    } else {
        Err(BusinessDatabaseError::MutationStale)
    }
}
