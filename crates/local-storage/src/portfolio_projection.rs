use std::fmt::{Debug, Display, Formatter};

use serde::{Deserialize, Serialize};

const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PortfolioReadError {
    StorageRejected,
    SchemaRejected,
    WorkspaceRejected,
    ProjectionRejected,
    RevisionRejected,
}

impl PortfolioReadError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::StorageRejected => "LOCAL_STORAGE_REJECTED",
            Self::SchemaRejected => "LOCAL_SCHEMA_REJECTED",
            Self::WorkspaceRejected => "LOCAL_WORKSPACE_REJECTED",
            Self::ProjectionRejected => "LOCAL_PROJECTION_REJECTED",
            Self::RevisionRejected => "LOCAL_REVISION_REJECTED",
        }
    }
}

impl Display for PortfolioReadError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl Debug for PortfolioReadError {
    fn fmt(&self, formatter: &mut Formatter<'_>) -> std::fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for PortfolioReadError {}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Money {
    pub currency: String,
    pub amount: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DomainAssetProjectionRow {
    pub entity_id: String,
    pub note: Option<String>,
    pub portfolio_id: Option<String>,
    pub tags: Vec<String>,
    pub target_price: Option<Money>,
}

#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct PortfolioReadSnapshot {
    pub workspace_id: String,
    pub domains: Vec<DomainAssetProjectionRow>,
    pub applied_through_server_revision: u64,
    pub last_replication_activity_at: Option<String>,
    pub last_successful_provider_observation_at: Option<String>,
}

pub(crate) fn validate_projection(
    rows: &[DomainAssetProjectionRow],
) -> Result<(), PortfolioReadError> {
    let mut previous: Option<&str> = None;
    for row in rows {
        validate_domain_asset_id(&row.entity_id)?;
        if previous.is_some_and(|value| value.as_bytes() >= row.entity_id.as_bytes()) {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        previous = Some(&row.entity_id);
        if let Some(note) = &row.note
            && (note.chars().count() > 10_000 || note.chars().any(is_forbidden_text_character))
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        if let Some(portfolio_id) = &row.portfolio_id {
            validate_identifier(portfolio_id)?;
        }
        if row.tags.len() > 128 {
            return Err(PortfolioReadError::ProjectionRejected);
        }
        let mut previous_tag: Option<&str> = None;
        for tag in &row.tags {
            if tag.is_empty()
                || tag.chars().count() > 64
                || tag.trim() != tag
                || tag.chars().any(is_forbidden_text_character)
                || previous_tag.is_some_and(|value| value.as_bytes() >= tag.as_bytes())
            {
                return Err(PortfolioReadError::ProjectionRejected);
            }
            previous_tag = Some(tag);
        }
        if let Some(price) = &row.target_price
            && (!valid_currency(&price.currency) || !valid_amount(&price.amount))
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
    }
    Ok(())
}

pub(crate) fn validate_identifier(value: &str) -> Result<(), PortfolioReadError> {
    if value.is_empty()
        || value.len() > 160
        || !value.bytes().all(|byte| (0x21..=0x7e).contains(&byte))
    {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(())
}

fn validate_domain_asset_id(value: &str) -> Result<(), PortfolioReadError> {
    if value.len() > 253 || value.len() < 3 || value != value.to_ascii_lowercase() {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let mut labels = value.split('.').peekable();
    if labels.peek().is_none() || !value.contains('.') {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    for label in labels {
        if label.is_empty()
            || label.len() > 63
            || label.starts_with('-')
            || label.ends_with('-')
            || !label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        {
            return Err(PortfolioReadError::ProjectionRejected);
        }
    }
    Ok(())
}

pub(crate) fn validate_revision(value: i64) -> Result<u64, PortfolioReadError> {
    let value = u64::try_from(value).map_err(|_| PortfolioReadError::RevisionRejected)?;
    if value > MAX_SAFE_INTEGER {
        return Err(PortfolioReadError::RevisionRejected);
    }
    Ok(value)
}

pub(crate) fn validate_timestamp(
    value: Option<String>,
) -> Result<Option<String>, PortfolioReadError> {
    let Some(value) = value else { return Ok(None) };
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
        || !bytes.iter().enumerate().all(|(index, byte)| {
            matches!(index, 4 | 7 | 10 | 13 | 16 | 19) || byte.is_ascii_digit()
        })
    {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    let number =
        |start: usize, end: usize| -> u32 { value[start..end].parse::<u32>().unwrap_or(u32::MAX) };
    let year = number(0, 4);
    let month = number(5, 7);
    let day = number(8, 10);
    let hour = number(11, 13);
    let minute = number(14, 16);
    let second = number(17, 19);
    let leap = year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400));
    let max_day = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => 0,
    };
    if day == 0 || day > max_day || hour > 23 || minute > 59 || second > 59 {
        return Err(PortfolioReadError::ProjectionRejected);
    }
    Ok(Some(value))
}

fn is_forbidden_text_character(character: char) -> bool {
    character.is_control()
        || matches!(character as u32, 0x00ad | 0x061c | 0x200b..=0x200f | 0x202a..=0x202e | 0x2060..=0x206f | 0xfeff | 0xfff9..=0xfffb)
}

fn valid_currency(value: &str) -> bool {
    value.len() == 3 && value.bytes().all(|byte| byte.is_ascii_uppercase())
}

fn valid_amount(value: &str) -> bool {
    let (whole, fractional) = value
        .split_once('.')
        .map_or((value, None), |(whole, part)| (whole, Some(part)));
    if whole.is_empty()
        || whole.len() > 16
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
        || (whole.len() > 1 && whole.starts_with('0'))
    {
        return false;
    }
    fractional.is_none_or(|part| {
        !part.is_empty()
            && part.len() <= 8
            && part.bytes().all(|byte| byte.is_ascii_digit())
            && !part.ends_with('0')
    })
}
