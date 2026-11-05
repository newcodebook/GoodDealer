//! Read-only DNS health projection: each local domain asset joined with its Provider Zone binding
//! and the latest Host-committed Zone observation summary.
//!
//! The projection reports only what the Host has observed. It never judges delegation, record
//! health or ownership: those need registrar and verification capabilities that are not composed,
//! so the Renderer presents them as unavailable instead of inferring a healthy state.

use rusqlite::{Connection, params};
use serde::Serialize;

use crate::portfolio_projection::{
    PortfolioReadError, PortfolioReadFreshness, valid_connection_label, validate_timestamp,
};

use super::launch_platforms::LAUNCH_PLATFORMS;
use super::portfolio::{read_freshness, validate_workspace};

const MAX_NAMESERVERS: usize = 16;

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsHealthReadSnapshot {
    pub schema_version: u8,
    pub kind: String,
    pub read_generation: u64,
    pub freshness: PortfolioReadFreshness,
    /// Rows matching the search prefix; the window pages through these.
    pub total_rows: u32,
    /// Workspace-wide counts, unaffected by the search, so the metrics describe every asset even
    /// though the Renderer reads one page: assets, those with an applicable Zone observation, and
    /// those whose observation is not an available, confirmed, active Zone.
    pub asset_count: u32,
    pub observed_count: u32,
    pub warning_count: u32,
    pub window: DnsHealthWindow,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsHealthWindow {
    pub start_index: u32,
    pub size: u16,
    pub rows: Vec<DnsHealthRow>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsHealthRow {
    pub entity_id: String,
    pub zone_binding: Option<DnsZoneBinding>,
    pub observation: Option<DnsZoneObservationSummary>,
}

/// The asset's Zone binding on any launch platform. Connection identity and Provider resource IDs
/// stay in the Host.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsZoneBinding {
    pub provider_kind: String,
    pub connection_label: String,
    pub zone_label: String,
    pub validation_status: String,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsZoneObservationSummary {
    /// Only Cloudflare Zones are observed today; other platforms have no composed observation.
    pub provider_kind: String,
    pub observed_at: String,
    pub availability: String,
    pub evidence_status: String,
    pub zone_label: String,
    pub zone_status: String,
    pub authoritative_nameservers: Vec<String>,
    pub dnssec_status: String,
    pub record_counts: DnsRecordCounts,
}

#[derive(Clone, Copy, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct DnsRecordCounts {
    pub a: u32,
    pub aaaa: u32,
    pub cname: u32,
    pub txt: u32,
    pub other: u32,
}

type RawRow = (
    String,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    Option<String>,
    [i64; 5],
);

/// Non-deleted assets of the requested workspace (`?1`).
const ASSETS: &str = "a.workspace_id = ?1 AND a.deleted_at IS NULL";
/// The search: a canonical domain prefix (`?2`, empty for every asset) up to its successor (`?3`).
const PREFIX: &str = "(?2 = '' OR (a.entity_id >= ?2 AND a.entity_id < ?3))";
/// Each asset's Zone binding and its applicable Zone observation. Only Cloudflare Zones are
/// observed, and an observation says nothing about a Zone bound on another platform, so it joins
/// only for an unbound or detached asset or a Cloudflare-bound one. The Renderer applies the same
/// rule per row; joining here keeps the workspace-wide counts consistent with it.
const ZONE_JOINS: &str = "
     LEFT JOIN domain_asset_provider_bindings b
       ON b.workspace_id = a.workspace_id AND b.entity_id = a.entity_id AND b.resource_kind = 'zone'
     LEFT JOIN local_provider_connections c
       ON c.workspace_id = b.workspace_id AND c.connection_id = b.connection_id
     LEFT JOIN cloudflare_dns_projection_heads h
       ON h.workspace_id = a.workspace_id AND h.entity_id = a.entity_id
      AND (b.entity_id IS NULL OR b.validation_status = 'detached' OR b.provider_kind = 'cloudflare')
     LEFT JOIN dns_zone_observations z
       ON z.workspace_id = h.workspace_id AND z.zone_observation_id = h.observation_id";

pub(crate) struct ActiveDnsHealthReader<'a> {
    connection: &'a Connection,
}

impl<'a> ActiveDnsHealthReader<'a> {
    pub(crate) const fn new(connection: &'a Connection) -> Self {
        Self { connection }
    }

    pub(crate) fn read(
        &self,
        requested_workspace_id: &str,
        start_index: u32,
        size: u16,
        query: &str,
    ) -> Result<DnsHealthReadSnapshot, PortfolioReadError> {
        let transaction = self
            .connection
            .unchecked_transaction()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        validate_workspace(&transaction, requested_workspace_id)?;
        if start_index > 1_000_000 || !(1..=200).contains(&size) {
            return Err(PortfolioReadError::WindowRejected);
        }
        let query = super::portfolio::canonical_query(query)?;
        let upper = format!("{query}{{");
        let total_rows: i64 = transaction
            .query_row(
                &format!("SELECT count(*) FROM domain_assets a WHERE {ASSETS} AND {PREFIX}"),
                params![requested_workspace_id, query, upper],
                |row| row.get(0),
            )
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        let (asset_count, observed_count, warning_count) =
            workspace_counts(&transaction, requested_workspace_id)?;
        let mut statement = transaction
            .prepare(&format!(
                "SELECT a.entity_id,
                   b.provider_kind, c.provider_kind, c.display_label, b.resource_label, b.validation_status,
                   z.observed_at, z.observation_availability, z.evidence_status, z.zone_name_ascii,
                   coalesce(z.cloudflare_zone_status, 'unknown'), z.authoritative_nameservers_json,
                   z.dnssec_status,
                   (SELECT count(*) FROM dns_record_observations r WHERE r.workspace_id = z.workspace_id AND r.zone_observation_id = z.zone_observation_id AND r.record_type = 'A'),
                   (SELECT count(*) FROM dns_record_observations r WHERE r.workspace_id = z.workspace_id AND r.zone_observation_id = z.zone_observation_id AND r.record_type = 'AAAA'),
                   (SELECT count(*) FROM dns_record_observations r WHERE r.workspace_id = z.workspace_id AND r.zone_observation_id = z.zone_observation_id AND r.record_type = 'CNAME'),
                   (SELECT count(*) FROM dns_record_observations r WHERE r.workspace_id = z.workspace_id AND r.zone_observation_id = z.zone_observation_id AND r.record_type = 'TXT'),
                   (SELECT count(*) FROM dns_record_observations r WHERE r.workspace_id = z.workspace_id AND r.zone_observation_id = z.zone_observation_id AND r.record_type NOT IN ('A', 'AAAA', 'CNAME', 'TXT'))
                 FROM domain_assets a {ZONE_JOINS}
                 WHERE {ASSETS} AND {PREFIX}
                 ORDER BY a.entity_id COLLATE BINARY LIMIT ?4 OFFSET ?5"
            ))
            .map_err(|_| PortfolioReadError::SchemaRejected)?;
        let raw = statement
            .query_map(
                params![requested_workspace_id, query, upper, size, start_index],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                        row.get(5)?,
                        row.get(6)?,
                        row.get(7)?,
                        row.get(8)?,
                        row.get(9)?,
                        row.get(10)?,
                        row.get(11)?,
                        row.get(12)?,
                        [
                            row.get(13)?,
                            row.get(14)?,
                            row.get(15)?,
                            row.get(16)?,
                            row.get(17)?,
                        ],
                    ))
                },
            )
            .map_err(|_| PortfolioReadError::ProjectionRejected)?
            .collect::<Result<Vec<RawRow>, _>>()
            .map_err(|_| PortfolioReadError::ProjectionRejected)?;
        let rows = raw
            .into_iter()
            .map(project_row)
            .collect::<Result<Vec<_>, _>>()?;
        let freshness = read_freshness(&transaction)?;
        drop(statement);
        transaction
            .commit()
            .map_err(|_| PortfolioReadError::StorageRejected)?;
        Ok(DnsHealthReadSnapshot {
            schema_version: 1,
            kind: "dns_health".to_owned(),
            read_generation: 0,
            freshness,
            total_rows: count(total_rows)?,
            asset_count: count(asset_count)?,
            observed_count: count(observed_count)?,
            warning_count: count(warning_count)?,
            window: DnsHealthWindow {
                start_index,
                size,
                rows,
            },
        })
    }
}

/// Workspace-wide asset, observed and warning counts; a warning is an applicable observation that is
/// not an available, confirmed, active Zone, the Renderer's `current` rule.
fn workspace_counts(
    connection: &Connection,
    workspace_id: &str,
) -> Result<(i64, i64, i64), PortfolioReadError> {
    connection
        .query_row(
            &format!(
                "SELECT count(*), count(z.zone_observation_id),
                   coalesce(sum(z.zone_observation_id IS NOT NULL AND NOT (
                     z.observation_availability = 'available' AND z.evidence_status = 'confirmed'
                     AND coalesce(z.cloudflare_zone_status, 'unknown') = 'active')), 0)
                 FROM domain_assets a {ZONE_JOINS} WHERE {ASSETS}"
            ),
            [workspace_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| PortfolioReadError::StorageRejected)
}

fn closed(value: String, allowed: &[&str]) -> Result<String, PortfolioReadError> {
    if allowed.contains(&value.as_str()) {
        Ok(value)
    } else {
        Err(PortfolioReadError::ProjectionRejected)
    }
}

fn label(value: String) -> Result<String, PortfolioReadError> {
    if value.is_empty() || value.len() > 253 || value.chars().any(char::is_control) {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(value)
}

fn count(value: i64) -> Result<u32, PortfolioReadError> {
    u32::try_from(value).map_err(|_| PortfolioReadError::ProjectionRejected)
}

fn project_row(raw: RawRow) -> Result<DnsHealthRow, PortfolioReadError> {
    let (
        entity_id,
        provider_kind,
        connection_kind,
        connection_label,
        zone_label,
        validation_status,
    ) = (raw.0, raw.1, raw.2, raw.3, raw.4, raw.5);
    let zone_binding = match (
        provider_kind,
        connection_kind,
        connection_label,
        zone_label,
        validation_status,
    ) {
        (None, None, None, None, None) => None,
        // The binding must name the platform of the connection it was made through.
        (
            Some(provider_kind),
            Some(connection_kind),
            Some(connection_label),
            Some(zone_label),
            Some(validation_status),
        ) if provider_kind == connection_kind => Some(DnsZoneBinding {
            // A Zone may be bound on any launch platform; whether one can hold it is decided by its
            // capability manifest when the binding is made, not by this read.
            provider_kind: closed(provider_kind, &LAUNCH_PLATFORMS)?,
            connection_label: if valid_connection_label(&connection_label) {
                connection_label
            } else {
                return Err(PortfolioReadError::ProjectionRejected);
            },
            zone_label: label(zone_label)?,
            validation_status: closed(
                validation_status,
                &["unverified", "verified", "stale", "conflicted", "detached"],
            )?,
        }),
        _ => return Err(PortfolioReadError::ProjectionRejected),
    };
    let observation = match (raw.6, raw.7, raw.8, raw.9, raw.10, raw.11, raw.12) {
        (None, None, None, None, _, None, None) => None,
        (
            Some(observed_at),
            Some(availability),
            Some(evidence_status),
            Some(zone_label),
            Some(zone_status),
            Some(nameservers),
            Some(dnssec_status),
        ) => {
            let authoritative_nameservers: Vec<String> = serde_json::from_str(&nameservers)
                .map_err(|_| PortfolioReadError::ProjectionRejected)?;
            if authoritative_nameservers.len() > MAX_NAMESERVERS {
                return Err(PortfolioReadError::ProjectionRejected);
            }
            Some(DnsZoneObservationSummary {
                provider_kind: "cloudflare".to_owned(),
                observed_at: validate_timestamp(Some(observed_at))?
                    .ok_or(PortfolioReadError::ProjectionRejected)?,
                availability: closed(availability, &["available", "unavailable"])?,
                evidence_status: closed(
                    evidence_status,
                    &["confirmed", "stale", "conflicted", "unknown"],
                )?,
                zone_label: label(zone_label)?,
                zone_status: closed(zone_status, &["active", "pending", "unknown"])?,
                authoritative_nameservers: authoritative_nameservers
                    .into_iter()
                    .map(label)
                    .collect::<Result<_, _>>()?,
                dnssec_status: closed(
                    dnssec_status,
                    &["active", "inactive", "unknown", "unsupported"],
                )?,
                record_counts: DnsRecordCounts {
                    a: count(raw.13[0])?,
                    aaaa: count(raw.13[1])?,
                    cname: count(raw.13[2])?,
                    txt: count(raw.13[3])?,
                    other: count(raw.13[4])?,
                },
            })
        }
        _ => return Err(PortfolioReadError::ProjectionRejected),
    };
    Ok(DnsHealthRow {
        entity_id,
        zone_binding,
        observation,
    })
}
