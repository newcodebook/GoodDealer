//! One Spaceship connection: the Registrar and `SellerHub` roles share one API key, one
//! connection incarnation and one Native credential slot. Each declared role keeps its own slot
//! row, scan requests and receipts. Preparation, retirement and purge always cover every
//! declared role together, so no role can outlive the credential it depends on.
use super::{
    BusinessDatabase, BusinessDatabaseError,
    afternic::random_id,
    hex_digest, is_uuid_v4,
    spaceship_registrar::{self, DesktopSpaceshipConnectionState, SpaceshipConnectionSeed},
    spaceship_sellerhub::{self, SellerHubConnectionSeed},
};
use rusqlite::{Connection, TransactionBehavior, params};

type Result<T> = std::result::Result<T, BusinessDatabaseError>;

/// The roles a Spaceship key proved at connect time. At least one must be present.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct SpaceshipRoles {
    pub registrar: bool,
    pub marketplace: bool,
}

impl SpaceshipRoles {
    #[cfg(test)]
    pub(crate) const REGISTRAR: Self = Self {
        registrar: true,
        marketplace: false,
    };
    #[cfg(test)]
    pub(crate) const MARKETPLACE: Self = Self {
        registrar: false,
        marketplace: true,
    };

    /// The canonical, sorted role set stored on the connection; `None` for an empty set.
    const fn capabilities_json(self) -> Option<&'static str> {
        match (self.marketplace, self.registrar) {
            (true, true) => Some(r#"["marketplace","registrar"]"#),
            (true, false) => Some(r#"["marketplace"]"#),
            (false, true) => Some(r#"["registrar"]"#),
            (false, false) => None,
        }
    }
}

/// The current rows of every role one connection declared.
#[derive(PartialEq, Eq)]
pub(crate) struct SpaceshipAccountSeeds {
    pub registrar: Option<SpaceshipConnectionSeed>,
    pub sellerhub: Option<SellerHubConnectionSeed>,
}

impl SpaceshipAccountSeeds {
    pub(crate) fn connection_id(&self) -> &str {
        self.registrar.as_ref().map_or_else(
            || {
                self.sellerhub
                    .as_ref()
                    .map_or("", |seed| seed.connection_id.as_str())
            },
            |seed| seed.connection_id.as_str(),
        )
    }

    pub(crate) fn incarnation_id(&self) -> &str {
        self.registrar.as_ref().map_or_else(
            || {
                self.sellerhub
                    .as_ref()
                    .map_or("", |seed| seed.incarnation_id.as_str())
            },
            |seed| seed.incarnation_id.as_str(),
        )
    }

    pub(crate) fn credential_proof(&self) -> &str {
        self.registrar.as_ref().map_or_else(
            || {
                self.sellerhub
                    .as_ref()
                    .map_or("", |seed| seed.credential_proof.as_str())
            },
            |seed| seed.credential_proof.as_str(),
        )
    }

    pub(crate) fn is_revoked(&self) -> bool {
        self.registrar
            .as_ref()
            .is_none_or(|seed| seed.state == DesktopSpaceshipConnectionState::Revoked)
            && self
                .sellerhub
                .as_ref()
                .is_none_or(|seed| seed.state == DesktopSpaceshipConnectionState::Revoked)
    }
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}

/// Reads every unpurged role row of one Spaceship connection. Shared identity is re-verified
/// here because each role row is written separately.
fn account_seeds(tx: &Connection, workspace: &str, id: &str) -> Result<SpaceshipAccountSeeds> {
    let (registrar, sellerhub): (bool, bool) = tx
        .query_row(
            "SELECT EXISTS (SELECT 1 FROM spaceship_registrar_connections
                             WHERE workspace_id=?1 AND connection_id=?2 AND purged_at IS NULL),
                    EXISTS (SELECT 1 FROM spaceship_sellerhub_connections
                             WHERE workspace_id=?1 AND connection_id=?2 AND purged_at IS NULL)",
            params![workspace, id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(storage)?;
    let seeds = SpaceshipAccountSeeds {
        registrar: registrar
            .then(|| spaceship_registrar::connection_seed(tx, workspace, id))
            .transpose()?,
        sellerhub: sellerhub
            .then(|| spaceship_sellerhub::connection_seed(tx, workspace, id))
            .transpose()?,
    };
    match (&seeds.registrar, &seeds.sellerhub) {
        (None, None) => Err(BusinessDatabaseError::MutationStale),
        (Some(registrar), Some(sellerhub))
            if registrar.incarnation_id != sellerhub.incarnation_id
                || registrar.credential_proof != sellerhub.credential_proof =>
        {
            Err(BusinessDatabaseError::StorageRejected)
        }
        _ => Ok(seeds),
    }
}

impl BusinessDatabase {
    /// Stages one connection and every proven role before the credential is written.
    pub(crate) fn prepare_spaceship_account<G>(
        &mut self,
        label: &str,
        roles: SpaceshipRoles,
        at: &str,
        execution: (&str, u64),
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<SpaceshipAccountSeeds> {
        let capabilities = roles
            .capabilities_json()
            .ok_or(BusinessDatabaseError::InvalidInput)?;
        if !crate::portfolio_projection::valid_connection_label(label) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let connection_id = random_id()?;
        let incarnation_id = random_id()?;
        let credential_proof = hex_digest(random_id()?.as_bytes());
        let workspace = &self.workspace_id;
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let existing: i64 = tx
            .query_row(
                "SELECT count(*) FROM local_provider_connections WHERE workspace_id=?1 AND deleted_at IS NULL
                  AND lifecycle_status<>'deleted' AND credential_use_state<>'retired'",
                [workspace],
                |row| row.get(0),
            )
            .map_err(storage)?;
        if existing >= i64::from(super::super::settings::MAX_CONNECTIONS) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        tx.execute(
            "INSERT INTO local_provider_connections
             (workspace_id,connection_id,provider_kind,display_label,active_credential_changed_at,lifecycle_status,
              capabilities_json,created_at,validation_status,connection_incarnation_id,credential_use_state)
             VALUES (?1,?2,'spaceship',?3,?4,'invalid',?5,?4,'unknown',?6,'inactive')",
            params![workspace, connection_id, label, at, capabilities, incarnation_id],
        )
        .map_err(storage)?;
        let identity = (
            connection_id.as_str(),
            incarnation_id.as_str(),
            credential_proof.as_str(),
        );
        let seeds = SpaceshipAccountSeeds {
            registrar: roles
                .registrar
                .then(|| {
                    spaceship_registrar::stage_prepared(&tx, workspace, identity, at, execution)
                })
                .transpose()?,
            sellerhub: roles
                .marketplace
                .then(|| {
                    spaceship_sellerhub::stage_prepared(&tx, workspace, identity, at, execution)
                })
                .transpose()?,
        };
        if account_seeds(&tx, workspace, &connection_id)? != seeds {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(seeds)
    }

    pub(crate) fn spaceship_account(&self, id: &str) -> Result<SpaceshipAccountSeeds> {
        if !is_uuid_v4(id) {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        account_seeds(self.store.raw_connection(), &self.workspace_id, id)
    }

    /// Denies every declared role in one transaction before the shared slot is removed.
    /// Revoking an already revoked connection returns the same retirement for a retried purge.
    pub(crate) fn revoke_spaceship_account<G>(
        &mut self,
        current: &SpaceshipAccountSeeds,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<SpaceshipAccountSeeds> {
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let id = current.connection_id().to_owned();
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if account_seeds(&tx, workspace, &id)? != *current {
            return Err(BusinessDatabaseError::MutationStale);
        }
        if !current.is_revoked() {
            if current.registrar.is_some() {
                tx.execute(
                    "UPDATE spaceship_registrar_connections SET state='revoked',scan_pending=0
                      WHERE workspace_id=?1 AND connection_id=?2",
                    params![workspace, id],
                )
                .map_err(storage)?;
            }
            if current.sellerhub.is_some() {
                tx.execute(
                    "UPDATE spaceship_sellerhub_connections SET state='revoked'
                      WHERE workspace_id=?1 AND connection_id=?2",
                    params![workspace, id],
                )
                .map_err(storage)?;
            }
            tx.execute(
                "UPDATE local_provider_connections SET lifecycle_status='revoked',validation_status='unknown',
                   revoked_at=coalesce(revoked_at,?1),active_credential_changed_at=?1
                 WHERE workspace_id=?2 AND connection_id=?3",
                params![at, workspace, id],
            )
            .map_err(storage)?;
        }
        let revoked = account_seeds(&tx, workspace, &id)?;
        if !revoked.is_revoked() {
            return Err(BusinessDatabaseError::StorageRejected);
        }
        let _guard = guard()?;
        tx.commit().map_err(storage)?;
        Ok(revoked)
    }

    /// Records the verified absence of the shared Native slot for every declared role.
    pub(crate) fn confirm_spaceship_account_purge<G>(
        &mut self,
        revoked: &SpaceshipAccountSeeds,
        at: &str,
        guard: impl FnOnce() -> Result<G>,
    ) -> Result<()> {
        super::validate_timestamp(Some(at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let workspace = &self.workspace_id;
        let id = revoked.connection_id().to_owned();
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        if !revoked.is_revoked() || account_seeds(&tx, workspace, &id)? != *revoked {
            return Err(BusinessDatabaseError::MutationStale);
        }
        for table in [
            "spaceship_registrar_connections",
            "spaceship_sellerhub_connections",
        ] {
            tx.execute(
                &format!(
                    "UPDATE {table} SET purged_at=?1 WHERE workspace_id=?2 AND connection_id=?3"
                ),
                params![at, workspace, id],
            )
            .map_err(storage)?;
        }
        tx.execute(
            "UPDATE local_provider_connections SET lifecycle_status='deleted',deleted_at=?1
              WHERE workspace_id=?2 AND connection_id=?3",
            params![at, workspace, id],
        )
        .map_err(storage)?;
        let _guard = guard()?;
        tx.commit().map_err(storage)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::active_workspace::business::LocalDatabaseKey;

    const AT: &str = "2026-11-25T12:00:00Z";
    const EXECUTION: (&str, u64) = ("device-local", 1);

    fn database(directory: &std::path::Path) -> BusinessDatabase {
        BusinessDatabase::open(
            &directory.join("workspace.db"),
            &LocalDatabaseKey::from_bytes([0x5a; 32]),
            "workspace-local",
        )
        .unwrap()
    }

    const BOTH: SpaceshipRoles = SpaceshipRoles {
        registrar: true,
        marketplace: true,
    };

    #[test]
    fn one_connection_declares_every_proven_role_with_one_credential() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let mut db = database(directory.path());
        assert_eq!(
            db.prepare_spaceship_account(
                "Spaceship",
                SpaceshipRoles {
                    registrar: false,
                    marketplace: false
                },
                AT,
                EXECUTION,
                || Ok(())
            )
            .err(),
            Some(BusinessDatabaseError::InvalidInput)
        );
        let seeds = db
            .prepare_spaceship_account("Spaceship", BOTH, AT, EXECUTION, || Ok(()))
            .unwrap();
        let registrar = seeds.registrar.as_ref().unwrap();
        let sellerhub = seeds.sellerhub.as_ref().unwrap();
        assert_eq!(registrar.connection_id, sellerhub.connection_id);
        assert_eq!(registrar.incarnation_id, sellerhub.incarnation_id);
        assert_eq!(registrar.credential_proof, sellerhub.credential_proof);
        assert!(registrar.has_scan_for(EXECUTION.0, EXECUTION.1));
        assert!(sellerhub.has_scan_for(EXECUTION.0, EXECUTION.1));
        let declared: String = db
            .store
            .raw_connection()
            .query_row(
                "SELECT capabilities_json FROM local_provider_connections WHERE connection_id=?1",
                [seeds.connection_id()],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(declared, r#"["marketplace","registrar"]"#);
        assert!(db.spaceship_account(seeds.connection_id()).unwrap() == seeds);

        let only_market = db
            .prepare_spaceship_account(
                "Spaceship",
                SpaceshipRoles::MARKETPLACE,
                AT,
                EXECUTION,
                || Ok(()),
            )
            .unwrap();
        assert!(only_market.registrar.is_none() && only_market.sellerhub.is_some());
    }

    #[test]
    fn a_role_cannot_join_another_credential_or_change_the_declared_set() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let mut db = database(directory.path());
        let market = db
            .prepare_spaceship_account(
                "Spaceship",
                SpaceshipRoles::MARKETPLACE,
                AT,
                EXECUTION,
                || Ok(()),
            )
            .unwrap();
        let connection = db.store.fixture_connection();
        // A Registrar row cannot attach to a marketplace-only connection.
        assert!(
            connection
                .execute(
                    "INSERT INTO spaceship_registrar_connections
                       (workspace_id,connection_id,incarnation_id,credential_proof,state,scan_pending,created_at)
                     VALUES ('workspace-local',?1,?2,?3,'prepared',1,?4)",
                    params![
                        market.connection_id(),
                        market.incarnation_id(),
                        market.credential_proof(),
                        AT
                    ],
                )
                .is_err()
        );
        // The declared role set is part of the connection identity.
        assert!(
            connection
                .execute(
                    "UPDATE local_provider_connections SET capabilities_json='[\"marketplace\",\"registrar\"]'
                      WHERE connection_id=?1",
                    [market.connection_id()],
                )
                .is_err()
        );

        let both = db
            .prepare_spaceship_account("Spaceship", BOTH, AT, EXECUTION, || Ok(()))
            .unwrap();
        let connection = db.store.fixture_connection();
        // A second role row with a different credential proof is refused.
        connection
            .execute(
                "DELETE FROM spaceship_sellerhub_pending_scans WHERE connection_id=?1",
                [both.connection_id()],
            )
            .unwrap();
        assert!(
            connection
                .execute(
                    "UPDATE spaceship_sellerhub_connections SET credential_proof=?1 WHERE connection_id=?2",
                    params!["0".repeat(64), both.connection_id()],
                )
                .is_err()
        );
    }

    #[test]
    fn revocation_and_purge_cover_every_role_together() {
        let directory = crate::test_tempdir::tempdir().unwrap();
        let mut db = database(directory.path());
        let seeds = db
            .prepare_spaceship_account("Spaceship", BOTH, AT, EXECUTION, || Ok(()))
            .unwrap();
        let id = seeds.connection_id().to_owned();
        assert!(
            db.confirm_spaceship_account_purge(&seeds, AT, || Ok(()))
                .is_err()
        );
        assert!(
            db.revoke_spaceship_account(&seeds, AT, || {
                Err::<(), _>(BusinessDatabaseError::MutationStale)
            })
            .is_err()
        );
        assert!(db.spaceship_account(&id).unwrap() == seeds);
        let revoked = db.revoke_spaceship_account(&seeds, AT, || Ok(())).unwrap();
        assert!(revoked.is_revoked());
        assert!(revoked.registrar.is_some() && revoked.sellerhub.is_some());
        assert!(db.revoke_spaceship_account(&seeds, AT, || Ok(())).is_err());
        let retried = db
            .revoke_spaceship_account(&revoked, AT, || Ok(()))
            .unwrap();
        assert!(retried == revoked);
        db.confirm_spaceship_account_purge(&revoked, AT, || Ok(()))
            .unwrap();
        assert_eq!(
            db.spaceship_account(&id).err(),
            Some(BusinessDatabaseError::MutationStale)
        );
        let purged: (i64, i64) = db
            .store
            .raw_connection()
            .query_row(
                "SELECT (SELECT count(*) FROM spaceship_registrar_connections WHERE purged_at IS NOT NULL),
                        (SELECT count(*) FROM spaceship_sellerhub_connections WHERE purged_at IS NOT NULL)",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(purged, (1, 1));
    }
}
