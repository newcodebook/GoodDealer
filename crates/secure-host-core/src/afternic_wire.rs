//! Strict, bounded projections of the evidenced Afternic response shapes.
use crate::afternic_provider::{
    AfternicError, AfternicListing, AfternicListingStatus, DOMAIN_PATH, MAX_DOMAINS, MAX_PRICE,
    ORIGIN, PAGE_SIZE, valid_domain, valid_price,
};
use serde::{Deserialize, Deserializer};

fn present<'de, D: Deserializer<'de>, T: Deserialize<'de>>(
    input: D,
) -> Result<Option<T>, D::Error> {
    T::deserialize(input).map(Some)
}
macro_rules! listing_wire {
    ($($field:ident : $ty:ty),* $(,)?) => {
        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct ListingWire {
            name: String,
            list_status: AfternicListingStatus,
            created_at: String,
            updated_at: String,
            $(#[serde(default, deserialize_with = "present")] $field: Option<$ty>,)*
        }
    }
}
listing_wire! {
    buynow_price: u64, floor_price: u64, minbid_price: u64, hidden: bool,
    max_lease_period: u8, leasing_enabled: bool, lease_down_payment_amount: u64,
    display_name: String, intake_style: String, show_lander_make_offer_option: bool,
    show_lander_lease_to_own_option: bool, show_lander_buynow_option: bool,
    landing_page: String, featured: bool, tld: String, registrar: String,
    fast_transfer_status: String, intake_leads: u64, offer_count: u64, intake_views: u64,
    listed_at: String, transaction_link: String, searches: Searches, estimated_value: EstimatedValue,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Searches {
    #[serde(default, deserialize_with = "present")]
    total: Option<SearchCounts>,
    #[serde(default, deserialize_with = "present")]
    unique: Option<SearchCounts>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct SearchCounts {
    #[serde(default, rename = "30d", deserialize_with = "present")]
    days30: Option<u64>,
    #[serde(default, rename = "90d", deserialize_with = "present")]
    days90: Option<u64>,
    #[serde(default, rename = "365d", deserialize_with = "present")]
    days365: Option<u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EstimatedValue {
    #[serde(default, deserialize_with = "present")]
    price: Option<u64>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PageWire {
    domains: Vec<ListingWire>,
    pagination: Pagination,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Pagination {
    total: usize,
    #[serde(default, deserialize_with = "present")]
    first: Option<String>,
    #[serde(default, deserialize_with = "present")]
    last: Option<String>,
    #[serde(default, deserialize_with = "present")]
    next: Option<String>,
    #[serde(default, deserialize_with = "present")]
    previous: Option<String>,
}
pub(super) struct Page {
    pub listings: Vec<AfternicListing>,
    pub total: usize,
}
pub(super) fn parse_page(bytes: &[u8], offset: usize) -> Result<Page, AfternicError> {
    let wire: PageWire = decode(bytes)?;
    let page = &wire.pagination;
    let through = offset
        .checked_add(wire.domains.len())
        .ok_or(AfternicError::ProtocolRejected)?;
    if page.total > MAX_DOMAINS
        || through > page.total
        || wire.domains.len() > PAGE_SIZE
        || through < page.total && wire.domains.len() != PAGE_SIZE
    {
        return Err(AfternicError::ProtocolRejected);
    }
    for link in [&page.first, &page.last, &page.previous]
        .into_iter()
        .flatten()
    {
        pagination_offset(link)?;
    }
    if through < page.total {
        if page
            .next
            .as_ref()
            .map(|url| pagination_offset(url))
            .transpose()?
            != Some(through)
        {
            return Err(AfternicError::ProtocolRejected);
        }
    } else if page.next.as_ref().is_some_and(|next| !next.is_empty()) {
        return Err(AfternicError::ProtocolRejected);
    }
    Ok(Page {
        listings: wire
            .domains
            .into_iter()
            .map(project)
            .collect::<Result<_, _>>()?,
        total: page.total,
    })
}
fn pagination_offset(value: &str) -> Result<usize, AfternicError> {
    // Never follow a Provider URL. Its fixed origin, path and numeric cursor are evidence only;
    // the next request is rebuilt locally from the observed complete-page count.
    if value.is_empty() {
        return Ok(0);
    }
    if value.len() > 1024 {
        return Err(AfternicError::ProtocolRejected);
    }
    let base = url::Url::parse(ORIGIN).map_err(|_| AfternicError::ProtocolRejected)?;
    let url = base
        .join(value)
        .map_err(|_| AfternicError::ProtocolRejected)?;
    if url.origin() != base.origin()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.path() != DOMAIN_PATH
        || url.fragment().is_some()
    {
        return Err(AfternicError::ProtocolRejected);
    }
    let pairs: std::collections::BTreeMap<_, _> = url.query_pairs().collect();
    if pairs.len() != 3
        || url.query_pairs().count() != 3
        || pairs.get("limit").map(std::borrow::Cow::as_ref) != Some("50")
        || pairs.get("order").map(std::borrow::Cow::as_ref) != Some("NAME_ASC")
    {
        return Err(AfternicError::ProtocolRejected);
    }
    let offset = pairs.get("offset").ok_or(AfternicError::ProtocolRejected)?;
    let value: usize = offset
        .parse()
        .map_err(|_| AfternicError::ProtocolRejected)?;
    if value > MAX_DOMAINS || value.to_string() != *offset {
        return Err(AfternicError::ProtocolRejected);
    }
    Ok(value)
}
pub(super) fn parse_listing(bytes: &[u8]) -> Result<AfternicListing, AfternicError> {
    project(decode(bytes)?)
}
fn decode<T: for<'de> Deserialize<'de>>(bytes: &[u8]) -> Result<T, AfternicError> {
    if bytes.is_empty() || bytes.len() > 1_048_576 {
        return Err(AfternicError::ProtocolRejected);
    }
    serde_json::from_slice(bytes).map_err(|_| AfternicError::ProtocolRejected)
}
#[allow(
    clippy::too_many_lines,
    reason = "the complete evidenced Domain response is validated before projection"
)]
fn project(wire: ListingWire) -> Result<AfternicListing, AfternicError> {
    let strings = [&wire.display_name, &wire.registrar, &wire.transaction_link];
    if !valid_domain(&wire.name)
        || !valid_timestamp(&wire.created_at)
        || !valid_timestamp(&wire.updated_at)
        || wire.buynow_price.is_some_and(|v| !valid_price(v, false))
        || wire.floor_price.is_some_and(|v| !valid_price(v, false))
        || wire.minbid_price.is_some_and(|v| !valid_price(v, true))
        || wire
            .lease_down_payment_amount
            .is_some_and(|v| !valid_price(v, false))
        || wire
            .max_lease_period
            .is_some_and(|v| !(2..=60).contains(&v))
        || strings
            .into_iter()
            .flatten()
            .any(|s| s.len() > 1024 || s.chars().any(char::is_control))
        || wire
            .intake_style
            .as_ref()
            .is_some_and(|v| !["BUYNOW", "PRICE_FORM", "CUSTOM_LANDER"].contains(&v.as_str()))
        || wire
            .landing_page
            .as_ref()
            .is_some_and(|v| !["PARKING_TYPE", "SALES_TYPE"].contains(&v.as_str()))
        || wire
            .tld
            .as_ref()
            .is_some_and(|v| v.len() > 253 || !wire.name.ends_with(&format!(".{v}")))
        || wire.fast_transfer_status.as_ref().is_some_and(|v| {
            ![
                "ACTIVE",
                "AWAITING_OPT_IN",
                "INACTIVE",
                "INACTIVE_BUYNOW_HIGH",
                "INACTIVE_BUYNOW_MISSING",
                "INELIGIBLE_REGISTRAR",
                "INELIGIBLE_TLD",
                "PENDING_REVIEW",
                "USER_EXCLUDED",
                "UNKNOWN",
            ]
            .contains(&v.as_str())
        })
        || [wire.intake_leads, wire.offer_count, wire.intake_views]
            .into_iter()
            .flatten()
            .any(|n| n > 1_000_000_000)
        || wire.listed_at.as_ref().is_some_and(|v| !valid_timestamp(v))
        || wire
            .estimated_value
            .as_ref()
            .and_then(|v| v.price)
            .is_some_and(|v| v > MAX_PRICE)
        || wire.searches.as_ref().is_some_and(|s| {
            [&s.total, &s.unique].into_iter().flatten().any(|s| {
                [s.days30, s.days90, s.days365]
                    .into_iter()
                    .flatten()
                    .any(|n| n > 9_007_199_254_740_991)
            })
        })
    {
        return Err(AfternicError::ProtocolRejected);
    }
    // Typed optional booleans are validated by deserialization but are deliberately not projected
    // as GoodDealer-approved settings until their own business preview is implemented.
    let _ = (
        wire.leasing_enabled,
        wire.show_lander_make_offer_option,
        wire.show_lander_lease_to_own_option,
        wire.show_lander_buynow_option,
        wire.featured,
    );
    Ok(AfternicListing {
        domain: wire.name,
        status: wire.list_status,
        buynow_price: wire.buynow_price,
        floor_price: wire.floor_price,
        minbid_price: wire.minbid_price,
        hidden: wire.hidden,
        created_at: wire.created_at,
        updated_at: wire.updated_at,
    })
}
fn valid_timestamp(value: &str) -> bool {
    let b = value.as_bytes();
    if !(b.len() == 20 || b.len() == 24)
        || b[4] != b'-'
        || b[7] != b'-'
        || b[10] != b'T'
        || b[13] != b':'
        || b[16] != b':'
        || b.last() != Some(&b'Z')
    {
        return false;
    }
    let number = |a: usize, z: usize| {
        value
            .get(a..z)
            .filter(|v| v.bytes().all(|b| b.is_ascii_digit()))
            .and_then(|v| v.parse::<u32>().ok())
    };
    let Some(year) = number(0, 4) else {
        return false;
    };
    let Some(month) = number(5, 7) else {
        return false;
    };
    let Some(day) = number(8, 10) else {
        return false;
    };
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if year.is_multiple_of(4) && (!year.is_multiple_of(100) || year.is_multiple_of(400)) => {
            29
        }
        2 => 28,
        _ => 0,
    };
    year >= 1970
        && day > 0
        && day <= days
        && number(11, 13).is_some_and(|v| v < 24)
        && number(14, 16).is_some_and(|v| v < 60)
        && number(17, 19).is_some_and(|v| v < 60)
        && (b.len() == 20 || b[19] == b'.' && b[20..23].iter().all(u8::is_ascii_digit))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ErrorWire {
    code: String,
    #[serde(default, deserialize_with = "present")]
    message: Option<String>,
    #[serde(default, deserialize_with = "present")]
    fields: Option<Vec<ErrorField>>,
    #[serde(default, deserialize_with = "present")]
    retry_after_sec: Option<u32>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ErrorField {
    path: String,
    code: String,
    #[serde(default, deserialize_with = "present")]
    path_related: Option<String>,
    #[serde(default, deserialize_with = "present")]
    message: Option<String>,
}
fn error(bytes: &[u8]) -> Result<ErrorWire, AfternicError> {
    let e: ErrorWire = decode(bytes)?;
    if e.code.is_empty()
        || e.code.len() > 160
        || !e
            .code
            .bytes()
            .all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == b'_')
        || e.message.as_ref().is_some_and(|v| v.len() > 4096)
        || e.fields.as_ref().is_some_and(|f| {
            f.len() > 64
                || f.iter().any(|f| {
                    f.path.len() > 512
                        || f.code.len() > 160
                        || f.path_related.as_ref().is_some_and(|v| v.len() > 512)
                        || f.message.as_ref().is_some_and(|v| v.len() > 4096)
                })
        })
    {
        return Err(AfternicError::ProtocolRejected);
    }
    Ok(e)
}
pub(super) fn is_domain_missing(bytes: &[u8]) -> Result<bool, AfternicError> {
    Ok(error(bytes)?.code == "RESOURCE_NOT_FOUND")
}
pub(super) fn retry_after(bytes: &[u8]) -> Result<Option<u32>, AfternicError> {
    if bytes.is_empty() {
        return Ok(None);
    }
    let error = error(bytes)?;
    if error.code != "RATE_LIMITED" || error.retry_after_sec.is_none_or(|n| n == 0) {
        return Err(AfternicError::ProtocolRejected);
    }
    Ok(error.retry_after_sec)
}
