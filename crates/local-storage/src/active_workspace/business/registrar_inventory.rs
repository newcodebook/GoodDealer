//! Complete registrar inventory, persisted by the same business transaction as asset creation.
use super::{
    BusinessDatabaseError, afternic::random_id, assets::import_discovered_asset,
    validate_domain_asset_id, validate_timestamp,
};
use crate::portfolio_projection::valid_date;
use rusqlite::{Transaction, params};
use serde::Serialize;
use std::collections::BTreeSet;

/// Bounded Native-only fields from a complete account Registrar scan.
pub struct DesktopRegistrationFact {
    pub domain: String,
    pub registered_on: String,
    pub expires_on: Option<String>,
    pub auto_renew: Option<bool>,
    pub locked: Option<bool>,
    pub standing: DesktopRegistrationStanding,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum DesktopRegistrationStanding {
    Active,
    Pending,
    Inactive,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DesktopRegistrarScanReceipt {
    pub observed: u32,
    pub imported: u32,
    pub skipped: u32,
    pub completed_at: String,
}

#[derive(Clone, Copy)]
pub(super) enum RegistrarInventorySource {
    Cloudflare,
    Spaceship,
    Aliyun,
}

impl RegistrarInventorySource {
    const fn name(self) -> &'static str {
        match self {
            Self::Cloudflare => "Cloudflare",
            Self::Spaceship => "Spaceship",
            Self::Aliyun => "Aliyun",
        }
    }

    const fn connector_version(self) -> &'static str {
        match self {
            Self::Cloudflare => "cloudflare-registrar-v4",
            Self::Spaceship => "spaceship-registrar-v1",
            Self::Aliyun => "aliyun-registrar-v1",
        }
    }
}

pub(super) struct RegistrarInventoryBatch<'a> {
    pub workspace: &'a str,
    pub connection_id: &'a str,
    pub registrations: &'a [DesktopRegistrationFact],
    pub device_id: &'a str,
    pub lease_epoch: u64,
    pub at: &'a str,
    pub source: RegistrarInventorySource,
}

impl RegistrarInventoryBatch<'_> {
    pub(super) fn validate(&self) -> Result<(), BusinessDatabaseError> {
        if self.registrations.len() > 10_000 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        validate_timestamp(Some(self.at.to_owned()))
            .map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let mut domains = BTreeSet::new();
        for row in self.registrations {
            validate_domain_asset_id(&row.domain)
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            if !domains.insert(&row.domain)
                || !valid_date(&row.registered_on)
                || row.expires_on.as_ref().map_or(
                    row.standing != DesktopRegistrationStanding::Pending,
                    |expiry| !valid_date(expiry) || expiry < &row.registered_on,
                )
            {
                return Err(BusinessDatabaseError::InvalidInput);
            }
        }
        Ok(())
    }

    pub(super) fn write<'run>(
        &self,
        tx: &Transaction<'_>,
        run: &'run str,
    ) -> Result<(Option<&'run str>, DesktopRegistrarScanReceipt), BusinessDatabaseError> {
        let workspace = self.workspace;
        let mut has_targets = false;
        let mut receipt = DesktopRegistrarScanReceipt {
            observed: u32::try_from(self.registrations.len())
                .map_err(|_| BusinessDatabaseError::InvalidInput)?,
            imported: 0,
            skipped: 0,
            completed_at: self.at.to_owned(),
        };
        for (ordinal, row) in self.registrations.iter().enumerate() {
            let Some(created) = import_discovered_asset(
                tx,
                workspace,
                &random_id()?,
                self.device_id,
                self.lease_epoch,
                self.at,
                &row.domain,
            )?
            else {
                receipt.skipped += 1;
                continue;
            };
            receipt.imported += u32::from(created);
            if !has_targets {
                tx.execute(
                    "INSERT INTO provider_observation_runs (workspace_id,observation_run_id,connection_id,observation_capability,started_at,status,connector_version)
                     VALUES (?1,?2,?3,'registrar',?4,'running',?5)",
                    params![workspace,run,self.connection_id,self.at,self.source.connector_version()],
                ).map_err(storage)?;
                has_targets = true;
            }
            let ordinal =
                u32::try_from(ordinal).map_err(|_| BusinessDatabaseError::InvalidInput)?;
            tx.execute(
                "INSERT INTO provider_observation_targets (workspace_id,observation_run_id,entity_id,ordinal,status,requested_at)
                 VALUES (?1,?2,?3,?4,'requested',?5)",
                params![workspace,run,row.domain,ordinal,self.at],
            ).map_err(storage)?;
            tx.execute(
                "INSERT INTO registrar_observations (workspace_id,observation_id,observation_run_id,entity_id,
                        registrar_name,registered_on,expires_on,auto_renew,registrar_lock,observation_availability,
                        evidence_status,observed_at,provider_version_token)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'available',?10,?11,?3)",
                params![workspace,random_id()?,run,row.domain,self.source.name(),row.registered_on,row.expires_on,row.auto_renew,row.locked,
                    if row.standing == DesktopRegistrationStanding::Active { "confirmed" } else { "unknown" },self.at],
            ).map_err(storage)?;
        }
        tx.execute(
            "UPDATE provider_observation_targets SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3",
            params![self.at,workspace,run],
        ).map_err(storage)?;
        tx.execute(
            "UPDATE provider_observation_runs SET status='succeeded',completed_at=?1 WHERE workspace_id=?2 AND observation_run_id=?3",
            params![self.at,workspace,run],
        ).map_err(storage)?;
        Ok((has_targets.then_some(run), receipt))
    }
}

fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
