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
            let domain = record.domain_name.to_ascii_lowercase();
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
                || !self.ids.insert(record.id)
                || !self.domains.insert(domain.clone())
            {
                return Err(invalid);
            }
            let state = match record.status.as_str() {
                "Seller Approved" => AtomListingState::SellerApproved,
                "Transfer Complete" => AtomListingState::TransferComplete,
                _ => AtomListingState::Unclassified,
            };
            let mut digest = Sha256::new();
            digest.update(b"GOODDEALER-ATOM-LISTING-V1\0");
            digest.update(record.id.to_be_bytes());
            self.listings.push(AtomListing {
                domain,
                resource_digest: digest.finalize().into(),
                state,
            });
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

fn valid_domain(value: &str) -> bool {
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
}
