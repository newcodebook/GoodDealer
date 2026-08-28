//! Private GoodDealer-owned Cloudflare provider protocol.
//!
//! This module is the source of truth for the closed Zone/DNS endpoint set and Provider wire
//! definitions. It grants no generic HTTP, credential, environment, or raw error authority.

use serde::Deserialize;
use serde_json::Value;

use crate::cloudflare_operation::CloudflareRecordType;

const API_PREFIX: &str = "/client/v4";

/// Closed v1 endpoint set for Zone details and DNS record listing.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(super) enum CloudflareEndpoint {
    ZoneDetails,
    ListDnsRecords {
        record_type: CloudflareRecordType,
        page: u16,
    },
}

impl CloudflareEndpoint {
    pub(super) fn path_and_query(self, zone_id: &str) -> String {
        match self {
            Self::ZoneDetails => format!("{API_PREFIX}/zones/{zone_id}"),
            Self::ListDnsRecords { record_type, page } => format!(
                "{API_PREFIX}/zones/{zone_id}/dns_records?type={}&page={page}&per_page=100&order=name&direction=asc",
                record_type.as_str()
            ),
        }
    }
}

/// Strict `GoodDealer` projection of Cloudflare's success envelope.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ZoneEnvelope {
    pub(crate) success: bool,
    pub(crate) result: RawZone,
    #[serde(default)]
    pub(crate) errors: Vec<Value>,
    #[serde(default)]
    pub(crate) messages: Vec<Value>,
}

/// Zone fields used by v1 plus named Provider fields returned in the same object.
/// Non-domain fields are bounded by the caller and discarded without crossing the Host boundary.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RawZone {
    pub(crate) id: String,
    pub(crate) name: String,
    pub(crate) status: String,
    #[serde(default, rename = "account")]
    _account: Option<Value>,
    #[serde(default, rename = "activated_on")]
    _activated_on: Option<Value>,
    #[serde(default, rename = "betas")]
    _betas: Option<Value>,
    #[serde(default, rename = "cname_suffix")]
    _cname_suffix: Option<Value>,
    #[serde(default, rename = "created_on")]
    _created_on: Option<Value>,
    #[serde(default, rename = "deactivation_reason")]
    _deactivation_reason: Option<Value>,
    #[serde(default, rename = "development_mode")]
    _development_mode: Option<Value>,
    #[serde(default, rename = "host")]
    _host: Option<Value>,
    #[serde(default, rename = "meta")]
    _meta: Option<Value>,
    #[serde(default, rename = "modified_on")]
    _modified_on: Option<Value>,
    #[serde(default, rename = "name_servers")]
    _name_servers: Option<Value>,
    #[serde(default, rename = "original_dnshost")]
    _original_dnshost: Option<Value>,
    #[serde(default, rename = "original_name_servers")]
    _original_name_servers: Option<Value>,
    #[serde(default, rename = "original_registrar")]
    _original_registrar: Option<Value>,
    #[serde(default, rename = "owner")]
    _owner: Option<Value>,
    #[serde(default, rename = "paused")]
    _paused: Option<Value>,
    #[serde(default, rename = "permissions")]
    _permissions: Option<Value>,
    #[serde(default, rename = "plan")]
    _plan: Option<Value>,
    #[serde(default, rename = "plan_pending")]
    _plan_pending: Option<Value>,
    #[serde(default, rename = "tenant")]
    _tenant: Option<Value>,
    #[serde(default, rename = "tenant_unit")]
    _tenant_unit: Option<Value>,
    #[serde(default, rename = "type")]
    _zone_type: Option<Value>,
    #[serde(default, rename = "vanity_name_servers")]
    _vanity_name_servers: Option<Value>,
    #[serde(default, rename = "verification_key")]
    _verification_key: Option<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RecordsEnvelope {
    pub(crate) success: bool,
    pub(crate) result: Vec<RawRecord>,
    pub(crate) result_info: ResultInfo,
    #[serde(default)]
    pub(crate) errors: Vec<Value>,
    #[serde(default)]
    pub(crate) messages: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct ResultInfo {
    pub(crate) page: u16,
    pub(crate) per_page: u16,
    pub(crate) count: usize,
    pub(crate) total_count: usize,
    pub(crate) total_pages: u16,
}

/// DNS record payloads do not carry a trusted Zone binding. `GoodDealer` binds each record to the
/// selected Zone through the fixed endpoint context and an apex-or-subdomain FQDN check.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
pub(crate) struct RawRecord {
    pub(crate) id: String,
    pub(crate) name: String,
    #[serde(rename = "type")]
    pub(crate) record_type: String,
    pub(crate) content: String,
    pub(crate) ttl: u32,
    pub(crate) proxied: bool,
    pub(crate) modified_on: String,
    #[serde(default, rename = "comment")]
    _comment: Option<Value>,
    #[serde(default, rename = "comment_modified_on")]
    _comment_modified_on: Option<Value>,
    #[serde(default, rename = "created_on")]
    _created_on: Option<Value>,
    #[serde(default, rename = "meta")]
    _meta: Option<Value>,
    #[serde(default, rename = "priority")]
    _priority: Option<Value>,
    #[serde(default, rename = "proxiable")]
    _proxiable: Option<Value>,
    #[serde(default, rename = "settings")]
    _settings: Option<Value>,
    #[serde(default, rename = "tags")]
    _tags: Option<Value>,
    #[serde(default, rename = "tags_modified_on")]
    _tags_modified_on: Option<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn endpoint_specs_match_cloudflare_v4_paths() {
        let zone_id = "0123456789abcdef0123456789abcdef";
        assert_eq!(
            CloudflareEndpoint::ZoneDetails.path_and_query(zone_id),
            format!("/client/v4/zones/{zone_id}")
        );
        assert_eq!(
            CloudflareEndpoint::ListDnsRecords {
                record_type: CloudflareRecordType::TXT,
                page: 7,
            }
            .path_and_query(zone_id),
            format!(
                "/client/v4/zones/{zone_id}/dns_records?type=TXT&page=7&per_page=100&order=name&direction=asc"
            )
        );
    }
}
