use std::collections::BTreeSet;

use serde::Deserialize;
use sha2::{Digest, Sha256};

use super::{AtomError, AtomListing, AtomListingState, MAX_LISTINGS, PAGE_SIZE};

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListingWire {
    id: u64,
    domain_name: String,
    status: String,
    full_price: Option<f64>,
    selling_price: Option<f64>,
    discount: Option<f64>,
    primary_category: Option<String>,
    description: Option<String>,
    logo_image: Option<String>,
    listing_type: Option<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct MessageWire {
    message: String,
}

pub(super) fn parse_exact_listing(
    body: &[u8],
    expected_domain: &str,
) -> Result<AtomListing, AtomError> {
    let row: ListingWire = serde_json::from_slice(body).map_err(|_| AtomError::ProtocolRejected)?;
    let (listing, _) = decode_listing(row)?;
    if listing.domain != expected_domain {
        return Err(AtomError::ProtocolRejected);
    }
    Ok(listing)
}

pub(super) fn require_remove_acknowledgement(body: &[u8]) -> Result<(), AtomError> {
    let wire: MessageWire =
        serde_json::from_slice(body).map_err(|_| AtomError::ProtocolRejected)?;
    if wire.message != "Successfully removed the domain" {
        return Err(AtomError::ProtocolRejected);
    }
    Ok(())
}

/// Accepts only the two documented `add-domain` receipts: the response example reads
/// "Successfully uploaded" and the schema example "Successfully updated" (`OpenAPI` 1.0.0,
/// read 2026-11-24). Neither proves the listing exists.
pub(super) fn require_add_acknowledgement(body: &[u8]) -> Result<(), AtomError> {
    let wire: MessageWire =
        serde_json::from_slice(body).map_err(|_| AtomError::ProtocolRejected)?;
    if !matches!(
        wire.message.as_str(),
        "Successfully uploaded" | "Successfully updated"
    ) {
        return Err(AtomError::ProtocolRejected);
    }
    Ok(())
}

/// The selling price as an exact whole number in the sendable range; anything else is unknown.
#[allow(
    clippy::cast_possible_truncation,
    clippy::cast_sign_loss,
    clippy::cast_precision_loss,
    reason = "the value is checked to be a finite whole number below 2^53 before the cast"
)]
fn whole_price(value: Option<f64>) -> Option<u64> {
    let value = value?;
    (value.is_finite()
        && value.fract() == 0.0
        && (1.0..=super::MAX_ATOM_STANDARD_PRICE_USD as f64).contains(&value))
    .then_some(value as u64)
}

fn decode_listing(record: ListingWire) -> Result<(AtomListing, u64), AtomError> {
    let domain = record.domain_name.to_ascii_lowercase();
    let reported_standard = record.listing_type.as_deref() == Some("Standard");
    if record.id == 0
        || !valid_domain(&domain)
        || !valid_text(&record.status, 128)
        || [
            (record.primary_category, 512),
            (record.description, 32 * 1024),
            (record.logo_image, 4096),
            (record.listing_type, 128),
        ]
        .into_iter()
        .any(|(value, max)| value.is_some_and(|text| text.len() > max))
        || [record.full_price, record.selling_price, record.discount]
            .into_iter()
            .flatten()
            .any(|value| !value.is_finite() || value < 0.0)
    {
        return Err(AtomError::ProtocolRejected);
    }
    let state = match record.status.as_str() {
        "Seller Approved" => AtomListingState::SellerApproved,
        "Transfer Complete" => AtomListingState::TransferComplete,
        _ => AtomListingState::Unclassified,
    };
    let mut digest = Sha256::new();
    digest.update(b"GOODDEALER-ATOM-LISTING-V1\0");
    digest.update(record.id.to_be_bytes());
    Ok((
        AtomListing {
            domain,
            resource_digest: digest.finalize().into(),
            state,
            reported_standard,
            observed_in_standard_scan: false,
            selling_price_whole_usd: whole_price(record.selling_price),
        },
        record.id,
    ))
}

// The API has no cursor, stable ordering parameter or total. Reject observable drift and
// require a terminal empty page; a short page alone is insufficient evidence of completion.
#[derive(Default)]
pub(super) struct PortfolioScan {
    ids: BTreeSet<u64>,
    domains: BTreeSet<String>,
    listings: Vec<AtomListing>,
}

impl PortfolioScan {
    pub(super) fn accept(&mut self, body: &[u8]) -> Result<bool, AtomError> {
        let invalid = AtomError::ProtocolRejected;
        let records: Vec<ListingWire> = serde_json::from_slice(body).map_err(|_| invalid)?;
        if records.len() > PAGE_SIZE || records.len() > MAX_LISTINGS - self.listings.len() {
            return Err(invalid);
        }
        if records.is_empty() {
            return Ok(true);
        }
        for record in records {
            let (listing, id) = decode_listing(record)?;
            if !self.ids.insert(id) || !self.domains.insert(listing.domain.clone()) {
                return Err(invalid);
            }
            self.listings.push(listing);
        }
        Ok(false)
    }

    pub(super) fn into_listings(self) -> Vec<AtomListing> {
        self.listings
    }
}

fn valid_text(value: &str, max: usize) -> bool {
    !value.is_empty() && value.len() <= max && !value.chars().any(char::is_control)
}

pub(super) fn valid_domain(value: &str) -> bool {
    value.len() <= 253
        && value.contains('.')
        && value.split('.').all(|label| {
            (1..=63).contains(&label.len())
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
        && value
            .rsplit('.')
            .next()
            .is_some_and(|tld| tld.bytes().any(|byte| byte.is_ascii_lowercase()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn only_an_empty_page_finishes_and_projection_drops_raw_provider_fields() {
        let mut scan = PortfolioScan::default();
        assert_eq!(
            scan.accept(br#"[{"id":2725,"domain_name":"Grandopia.com","status":"Seller Approved","selling_price":9999,"description":"private description","logo_image":null}]"#),
            Ok(false)
        );
        assert_eq!(
            scan.accept(br#"[{"id":3488,"domain_name":"Pivotis.com","status":"A future status"}]"#),
            Ok(false)
        );
        assert_eq!(scan.accept(b"[]"), Ok(true));
        let listings = scan.into_listings();
        assert_eq!(listings[0].domain, "grandopia.com");
        assert_eq!(listings[0].state, AtomListingState::SellerApproved);
        assert_eq!(listings[1].state, AtomListingState::Unclassified);
        assert_ne!(listings[0].resource_digest, listings[1].resource_digest);
    }

    #[test]
    fn rejects_error_envelopes_bad_names_extra_fields_and_duplicate_identity() {
        for wire in [
            r#"{"message":"API Token and UserId are required"}"#,
            r#"[{"id":1,"id":2,"domain_name":"example.com","status":"Seller Approved"}]"#,
            r#"[{"id":1,"domain_name":"example.com","status":"Seller Approved","accountId":5}]"#,
            r#"[{"id":1,"domain_name":"example.com.","status":"Seller Approved"}]"#,
            r#"[{"id":1,"domain_name":"127.0.0.1","status":"Seller Approved"}]"#,
            r#"[{"id":1,"domain_name":"example.com","status":""}]"#,
            r#"[{"id":1,"domain_name":"example.com","status":"Seller Approved","selling_price":"1"}]"#,
        ] {
            assert_eq!(
                PortfolioScan::default().accept(wire.as_bytes()),
                Err(AtomError::ProtocolRejected)
            );
        }
        for second in [
            r#"[{"id":1,"domain_name":"different.test","status":"Seller Approved"}]"#,
            r#"[{"id":2,"domain_name":"EXAMPLE.com","status":"Seller Approved"}]"#,
        ] {
            let mut scan = PortfolioScan::default();
            scan.accept(br#"[{"id":1,"domain_name":"example.com","status":"Seller Approved"}]"#)
                .unwrap();
            assert_eq!(
                scan.accept(second.as_bytes()),
                Err(AtomError::ProtocolRejected)
            );
        }
    }

    #[test]
    fn exact_listing_requires_the_requested_domain_and_keeps_uncertain_reads_uncertain() {
        let listing = br#"{"id":2725,"domain_name":"Test.com","status":"Seller Approved","listing_type":"Standard"}"#;
        let exact = parse_exact_listing(listing, "test.com").unwrap();
        assert!(exact.reported_standard);
        assert!(parse_exact_listing(listing, "other.test").is_err());
        for wire in [
            br"[]" as &[u8],
            br"null",
            br#"{"message":"Domain not found"}"#,
            br#"{"id":2725,"domain_name":"test.com","status":"Seller Approved","id":4}"#,
        ] {
            assert_eq!(
                parse_exact_listing(wire, "test.com"),
                Err(AtomError::ProtocolRejected)
            );
        }
    }

    #[test]
    fn add_receipt_accepts_only_the_two_documented_messages() {
        for wire in [
            br#"{"message":"Successfully uploaded"}"# as &[u8],
            br#"{"message":"Successfully updated"}"#,
        ] {
            assert_eq!(require_add_acknowledgement(wire), Ok(()));
        }
        for wire in [
            br#"{"message":"Successfully removed the domain"}"# as &[u8],
            br#"{"message":"successfully uploaded"}"#,
            br#"{"message":"Successfully uploaded","success":true}"#,
            br#"{"message":"Rejected","message":"Successfully uploaded"}"#,
            br#"{"success":true,"message":"DNS check request accepted"}"#,
            br"<html>Successfully uploaded</html>",
            br"[]",
        ] {
            assert_eq!(
                require_add_acknowledgement(wire),
                Err(AtomError::ProtocolRejected)
            );
        }
    }

    #[test]
    fn exact_listing_keeps_only_an_exact_whole_selling_price() {
        let read = |price: &str| {
            parse_exact_listing(
                format!(r#"{{"id":7,"domain_name":"test.com","status":"Seller Approved","listing_type":"Standard","selling_price":{price}}}"#).as_bytes(),
                "test.com",
            )
            .unwrap()
            .selling_price_whole_usd()
        };
        assert_eq!(read("2500"), Some(2500));
        assert_eq!(read("2500.0"), Some(2500));
        for unknown in ["2500.5", "0", "null", "50000000"] {
            assert_eq!(read(unknown), None, "{unknown}");
        }
    }

    #[test]
    fn removal_receipt_accepts_the_documented_message_only() {
        assert_eq!(
            require_remove_acknowledgement(br#"{"message":"Successfully removed the domain"}"#),
            Ok(())
        );
        for wire in [
            br#"{"message":"Successfully updated"}"# as &[u8],
            br#"{"message":"Successfully removed the domain","cookie":"refuse"}"#,
            br#"{"message":"Rejected","message":"Successfully removed the domain"}"#,
        ] {
            assert_eq!(
                require_remove_acknowledgement(wire),
                Err(AtomError::ProtocolRejected)
            );
        }
    }
}
