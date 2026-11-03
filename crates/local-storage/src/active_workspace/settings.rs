//! Read-only settings projection: the workspace's Provider connections, their declared roles and
//! whether each role's capabilities are executable.
//!
//! Connection, credential and Provider account identifiers stay in the Host. No capability has an
//! ADR-0024 qualification yet, so every declared role is reported as unavailable with
//! `qualification_pending` instead of letting the Renderer infer availability from credential state.

use rusqlite::Connection;
use serde::Serialize;

use crate::portfolio_projection::{PortfolioReadError, PortfolioReadFreshness, validate_timestamp};

use super::portfolio::{read_freshness, validate_workspace};

/// Upper bound on connections in one read; a larger table fails closed instead of truncating.
const MAX_CONNECTIONS: u16 = 64;
/// Roles the settings surface can present. ADR-0027's `acquisition` role arrives with the phase 5
/// connection-role model; until then a connection declaring it fails the read instead of hiding.
const ROLES: [&str; 3] = ["registrar", "dns", "marketplace"];

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    pub connections: Vec<SettingsConnection>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsConnection {
    pub provider_kind: String,
    pub connection_label: String,
    pub lifecycle_status: String,
    pub validation_status: String,
    pub credential_use_state: String,
    pub last_validated_at: Option<String>,
    pub roles: Vec<SettingsConnectionRole>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SettingsConnectionRole {
    pub role: String,
    pub availability: String,
    pub unavailable_reason: String,
}

type RawConnection = (
    String,
    String,
    String,
    String,
    String,
    Option<String>,
    String,
);

pub(crate) struct ActiveSettingsReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveSettingsReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
    ) -> Result<SettingsReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        let mut statement = transaction
            .prepare(
                "SELECT provider_kind, display_label, lifecycle_status, validation_status,
                        credential_use_state, last_validated_at, capabilities_json
                 FROM local_provider_connections
                 WHERE workspace_id = ?1 AND deleted_at IS NULL AND lifecycle_status <> 'deleted'
                 ORDER BY provider_kind COLLATE BINARY, display_label COLLATE BINARY,
                          connection_id COLLATE BINARY
                 LIMIT ?2",
            )
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let raw = statement
            .query_map(
                rusqlite::params![requested_workspace_id, MAX_CONNECTIONS + 1],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                    ))
                },
            )
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<RawConnection>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        if raw.len() > usize::from(MAX_CONNECTIONS) {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        let connections = raw
            .into_iter()
            .map(project_connection)
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        drop(statement);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(SettingsReadSnapshot {
            schema_version: 1,
            kind: "settings".to_owned(),
            read_generation: 0,
            freshness,
            connections,
        })
    }
}

fn closed(value: String, allowed: &[&str]) -> Result<String, PortfolioReadError> {
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(PortfolioReadError::ProjectionRejected)
    }
}

fn project_connection(raw: RawConnection) -> Result<SettingsConnection, PortfolioReadError> {
    let (provider_kind, label, lifecycle, validation, use_state, validated_at, capabilities) = raw;
    if label.is_empty() || label.len() > 120 || label.chars().any(char::is_control) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let declared: Vec<String> =
        serde_json::from_str(&capabilities).map_err(|_| PortfolioReadError::ProjectionRejected)?;
    let mut roles = Vec::with_capacity(declared.len());
    for role in declared {
        let role = closed(role, &ROLES)?;
        if roles
            .iter()
            .any(|known: &SettingsConnectionRole| known.role == role)
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        roles.push(SettingsConnectionRole {
            role,
            availability: "unavailable".to_owned(),
            unavailable_reason: "qualification_pending".to_owned(),
        });
    }
    Ok(SettingsConnection {
        provider_kind: closed(provider_kind, &["cloudflare"])?,
        connection_label: label,
        lifecycle_status: closed(lifecycle, &["active", "invalid", "revoked"])?,
        validation_status: closed(
            validation,
            &[
                "unknown",
                "valid",
                "invalid",
                "insufficient_scope",
                "unreachable",
            ],
        )?,
        credential_use_state: closed(
            use_state,
            &[
                "inactive",
                "active",
                "transition_pending",
                "revocation_pending",
                "remediation_required",
                "revoked",
            ],
        )?,
        last_validated_at: validate_timestamp(validated_at)?,
        roles,
    })
}
