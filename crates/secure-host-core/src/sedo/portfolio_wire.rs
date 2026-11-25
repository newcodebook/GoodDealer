//! Closed XML boundary for the official Sedo `DomainListExtended` account response.
use super::{SedoCurrency, SedoListing};
use quick_xml::{Reader, events::Event};
use serde::Deserialize;
use std::collections::BTreeSet;

pub(super) const MAX_PAGE_BYTES: usize = 2 * 1024 * 1024;
const MAX_PAGE_ITEMS: usize = 100;
const MAX_MONEY_CENTS: u64 = 9_007_199_254_740_991;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum InventoryError {
    CredentialsRequired,
    Forbidden,
    Unavailable,
    ProviderFault,
    Malformed,
}

type Result<T> = std::result::Result<T, InventoryError>;

const INVALID: InventoryError = InventoryError::Malformed;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TypedValue {
    #[serde(rename = "@type")]
    kind: String,
    #[serde(rename = "$text", default)]
    value: String,
}

impl TypedValue {
    fn text(self, kind: &str, limit: usize) -> Result<String> {
        if self.kind != kind || !bounded(&self.value, limit) {
            return Err(INVALID);
        }
        Ok(self.value)
    }

    fn integer(self) -> Result<u32> {
        let text = self.text("xsd:int", 10)?;
        if text.is_empty() || !text.bytes().all(|byte| byte.is_ascii_digit()) {
            return Err(INVALID);
        }
        text.parse().map_err(|_| INVALID)
    }

    fn flag(self) -> Result<bool> {
        match self.integer()? {
            0 => Ok(false),
            1 => Ok(true),
            _ => Err(INVALID),
        }
    }

    fn money(self) -> Result<Option<u64>> {
        Ok(Some(cents(&self.text("xsd:double", 22)?)?).filter(|value| *value != 0))
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Document {
    #[serde(rename = "@ver")]
    version: String,
    #[serde(rename = "item", default)]
    entries: Vec<ListingWire>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Fault {
    #[serde(rename = "@ver")]
    version: String,
    faultcode: TypedValue,
    faultstring: TypedValue,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ListingWire {
    domain: TypedValue,
    category: Categories,
    #[serde(rename = "forsale")]
    for_sale: TypedValue,
    price: TypedValue,
    #[serde(rename = "minprice")]
    minimum_price: TypedValue,
    #[serde(rename = "fixedprice")]
    fixed_price: TypedValue,
    currency: TypedValue,
    domainlanguage: TypedValue,
    keywords: Keywords,
    inserted: TypedValue,
    earningscomplete: TypedValue,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Categories {
    cat1: Option<TypedValue>,
    cat2: Option<TypedValue>,
    cat3: Option<TypedValue>,
}

impl Categories {
    fn validate(self) -> Result<()> {
        let mut missing = false;
        for category in [self.cat1, self.cat2, self.cat3] {
            if let Some(category) = category {
                if missing {
                    return Err(INVALID);
                }
                category.integer()?;
            } else {
                missing = true;
            }
        }
        Ok(())
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Keywords {
    #[serde(rename = "@type")]
    kind: String,
    #[serde(rename = "keyword", default)]
    entries: Vec<Keyword>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Keyword {
    #[serde(rename = "keyword")]
    text: String,
    market: String,
    advertiser: String,
    views: String,
    clicks: String,
    earnings: String,
    rpm: String,
    inserted: String,
}

impl Keywords {
    fn validate(self) -> Result<()> {
        if self.kind != "xsd:string" || self.entries.len() > 100 {
            return Err(INVALID);
        }
        for entry in self.entries {
            if !bounded(&entry.text, 1024)
                || !bounded(&entry.market, 16)
                || [&entry.advertiser, &entry.views, &entry.clicks]
                    .into_iter()
                    .any(|text| {
                        text.is_empty()
                            || text.len() > 20
                            || !text.bytes().all(|byte| byte.is_ascii_digit())
                    })
                || !decimal(&entry.earnings)
                || !decimal(&entry.rpm)
                || !date(&entry.inserted)
            {
                return Err(INVALID);
            }
        }
        Ok(())
    }
}

impl ListingWire {
    fn into_listing(self) -> Result<SedoListing> {
        let domain = self.domain.text("xsd:string", 253)?;
        self.category.validate()?;
        self.keywords.validate()?;
        let language = self.domainlanguage.text("xsd:string", 2)?;
        if !domain_name(&domain)
            || (!language.is_empty()
                && (language.len() != 2 || !language.bytes().all(|byte| byte.is_ascii_lowercase())))
            || !date(&self.inserted.text("xsd:string", 19)?)
            || !decimal(&self.earningscomplete.text("xsd:double", 32)?)
        {
            return Err(INVALID);
        }
        let currency = match self.currency.integer()? {
            0 => SedoCurrency::Eur,
            1 => SedoCurrency::Usd,
            2 => SedoCurrency::Gbp,
            _ => return Err(INVALID),
        };
        Ok(SedoListing {
            domain,
            for_sale: self.for_sale.flag()?,
            fixed_price: self.fixed_price.flag()?,
            price_cents: self.price.money()?,
            minimum_price_cents: self.minimum_price.money()?,
            currency,
        })
    }
}

fn bounded(value: &str, max: usize) -> bool {
    value.len() <= max && !value.chars().any(char::is_control)
}

fn domain_name(value: &str) -> bool {
    value
        .rsplit_once('.')
        .is_some_and(|(_, suffix)| suffix.bytes().any(|byte| byte.is_ascii_lowercase()))
        && value.split('.').all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && !label.starts_with('-')
                && !label.ends_with('-')
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        })
}

fn date(value: &str) -> bool {
    // Sedo documents both an ASCII calendar timestamp and a Unix integer for insertion time.
    if value.len() == 19 {
        if !value.bytes().enumerate().all(|(index, byte)| match index {
            4 | 7 => byte == b'-',
            10 => byte == b' ',
            13 | 16 => byte == b':',
            _ => byte.is_ascii_digit(),
        }) {
            return false;
        }
        let bytes = value.as_bytes();
        let pair = |index: usize| (bytes[index] - b'0') * 10 + (bytes[index + 1] - b'0');
        let year = i32::from(pair(0)) * 100 + i32::from(pair(2));
        time::Month::try_from(pair(5))
            .is_ok_and(|month| time::Date::from_calendar_date(year, month, pair(8)).is_ok())
            && time::Time::from_hms(pair(11), pair(14), pair(17)).is_ok()
    } else {
        !value.is_empty() && value.len() <= 16 && value.bytes().all(|byte| byte.is_ascii_digit())
    }
}

fn decimal(value: &str) -> bool {
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    !whole.is_empty()
        && value.len() <= 32
        && whole.bytes().all(|byte| byte.is_ascii_digit())
        && (!value.contains('.')
            || (!fraction.is_empty() && fraction.bytes().all(|byte| byte.is_ascii_digit())))
}

fn cents(value: &str) -> Result<u64> {
    if !decimal(value) {
        return Err(INVALID);
    }
    let (whole, fraction) = value.split_once('.').unwrap_or((value, ""));
    let subunits = match fraction.len() {
        0 => 0,
        1 => fraction.parse::<u64>().map_err(|_| INVALID)? * 10,
        2 => fraction.parse().map_err(|_| INVALID)?,
        _ => return Err(INVALID),
    };
    whole
        .parse::<u64>()
        .ok()
        .and_then(|value| value.checked_mul(100))
        .and_then(|value| value.checked_add(subunits))
        .filter(|value| *value <= MAX_MONEY_CENTS)
        .ok_or(INVALID)
}

#[derive(Clone, Copy)]
enum Envelope {
    Inventory,
    Fault,
}

fn validate_envelope(bytes: &[u8]) -> Result<Envelope> {
    if bytes.is_empty() || bytes.len() > MAX_PAGE_BYTES {
        return Err(INVALID);
    }
    let mut reader = Reader::from_reader(bytes);
    let mut envelope = None;
    let mut depth = 0u8;
    let mut declaration_seen = false;
    loop {
        let event = reader.read_event().map_err(|_| INVALID)?;
        match event {
            Event::Start(ref tag) | Event::Empty(ref tag) => {
                if depth == 0 {
                    if envelope.is_some() {
                        return Err(INVALID);
                    }
                    envelope = Some(match tag.name().as_ref() {
                        "SEDODOMAINLIST" => Envelope::Inventory,
                        "SEDOFAULT" => Envelope::Fault,
                        _ => return Err(INVALID),
                    });
                }
                if matches!(event, Event::Start(_)) {
                    depth += 1;
                    if depth > 12 {
                        return Err(INVALID);
                    }
                }
            }
            Event::End(_) => depth = depth.checked_sub(1).ok_or(INVALID)?,
            Event::Decl(declaration) if envelope.is_none() && !declaration_seen => {
                declaration_seen = true;
                if declaration.version().map_err(|_| INVALID)?.as_ref() != "1.0"
                    || declaration
                        .encoding()
                        .transpose()
                        .map_err(|_| INVALID)?
                        .is_some_and(|value| !value.eq_ignore_ascii_case("UTF-8"))
                {
                    return Err(INVALID);
                }
            }
            Event::Text(text)
                if depth > 0 || text.as_ref().bytes().all(|byte| byte.is_ascii_whitespace()) => {}
            Event::GeneralRef(reference)
                if depth > 0
                    && matches!(reference.as_ref(), "amp" | "lt" | "gt" | "quot" | "apos") => {}
            Event::Eof if depth == 0 => return envelope.ok_or(INVALID),
            // The Sedo envelope needs no entities, declarations inside the root, or instructions.
            _ => return Err(INVALID),
        }
    }
}

pub(super) fn parse_inventory_page(bytes: &[u8], limit: usize) -> Result<Vec<SedoListing>> {
    if !(1..=MAX_PAGE_ITEMS).contains(&limit) {
        return Err(INVALID);
    }
    let envelope = validate_envelope(bytes)?;
    let text = std::str::from_utf8(bytes).map_err(|_| INVALID)?;
    match envelope {
        Envelope::Fault => {
            let fault: Fault = quick_xml::de::from_str(text).map_err(|_| INVALID)?;
            let code = fault.faultcode.text("xsd:string", 5)?;
            fault.faultstring.text("xsd:string", 4096)?;
            if fault.version != "1.0"
                || !code.strip_prefix('E').is_some_and(|suffix| {
                    !suffix.is_empty() && suffix.bytes().all(|byte| byte.is_ascii_digit())
                })
            {
                return Err(INVALID);
            }
            Err(match code.as_str() {
                "E1" | "E2" | "E3" | "E4" | "E5" | "E6" | "E7" | "E8" | "E9" => {
                    InventoryError::CredentialsRequired
                }
                "E10" | "E12" => InventoryError::Forbidden,
                "E11" | "E17" => InventoryError::Unavailable,
                // The common E15 "no data" fault does not describe how this list ends for a seller.
                _ => InventoryError::ProviderFault,
            })
        }
        Envelope::Inventory => {
            let doc: Document = quick_xml::de::from_str(text).map_err(|_| INVALID)?;
            if doc.version != "1.0" || doc.entries.len() > limit {
                return Err(INVALID);
            }
            let listings: Vec<_> = doc
                .entries
                .into_iter()
                .map(ListingWire::into_listing)
                .collect::<Result<_>>()?;
            let unique: BTreeSet<_> = listings
                .iter()
                .map(|listing| listing.domain.as_str())
                .collect();
            if unique.len() != listings.len() {
                return Err(INVALID);
            }
            Ok(listings)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ITEM: &str = r#"<item>
      <domain type="xsd:string">example.com</domain>
      <category><cat1 type="xsd:int">1</cat1><cat2 type="xsd:int">2</cat2><cat3 type="xsd:int">3</cat3></category>
      <forsale type="xsd:int">1</forsale><price type="xsd:double">99.99</price>
      <minprice type="xsd:double">0.00</minprice><fixedprice type="xsd:int">1</fixedprice>
      <currency type="xsd:int">1</currency><domainlanguage type="xsd:string">en</domainlanguage>
      <keywords type="xsd:string"><keyword>
        <keyword>A &amp; B</keyword><market>xyz</market><advertiser>0</advertiser>
        <views>0</views><clicks>0</clicks><earnings>0</earnings><rpm>0</rpm>
        <inserted>2012-12-04 15:16:27</inserted>
      </keyword></keywords>
      <inserted type="xsd:string">989704800</inserted><earningscomplete type="xsd:double">0.94</earningscomplete>
    </item>"#;

    fn document(items: &str) -> String {
        format!(
            r#"<?xml version="1.0" encoding="UTF-8"?><SEDODOMAINLIST ver="1.0">{items}</SEDODOMAINLIST>"#
        )
    }

    #[test]
    fn official_page_preserves_listing_price_without_treating_membership_as_sale() {
        let listing = parse_inventory_page(document(ITEM).as_bytes(), 100).unwrap();
        assert_eq!(
            listing,
            [SedoListing {
                domain: "example.com".into(),
                for_sale: true,
                fixed_price: true,
                price_cents: Some(9999),
                minimum_price_cents: None,
                currency: SedoCurrency::Usd,
            }]
        );
        let parked = ITEM.replace(
            r#"<forsale type="xsd:int">1"#,
            r#"<forsale type="xsd:int">0"#,
        );
        assert!(!parse_inventory_page(document(&parked).as_bytes(), 100).unwrap()[0].for_sale);
        assert_eq!(
            parse_inventory_page(document("").as_bytes(), 100).unwrap(),
            Vec::<SedoListing>::new()
        );
    }

    #[test]
    fn actual_anonymous_fault_and_untrusted_markup_never_become_empty_inventory() {
        let fault = br#"<?xml version="1.0" encoding="UTF-8"?>
        <SEDOFAULT ver="1.0"><faultcode type="xsd:string">E1</faultcode>
        <faultstring type="xsd:string">Username is empty</faultstring></SEDOFAULT>"#;
        assert_eq!(
            parse_inventory_page(fault, 100),
            Err(InventoryError::CredentialsRequired)
        );
        let no_data = std::str::from_utf8(fault)
            .unwrap()
            .replace(">E1<", ">E15<")
            .replace("Username is empty", "There is no data for your request!");
        assert_eq!(
            parse_inventory_page(no_data.as_bytes(), 100),
            Err(InventoryError::ProviderFault)
        );
        for malformed in [
            "<html/>".to_owned(),
            "<!DOCTYPE SEDODOMAINLIST [<!ENTITY fake 'example.com'>]><SEDODOMAINLIST ver=\"1.0\"/>"
                .to_owned(),
            document(&ITEM.replace("example.com", "&account;")),
            document(&ITEM.replace(">99.99<", ">99.999<")),
            document(&ITEM.replace("2012-12-04 15:16:27", "2012-02-30 15:16:27")),
            document(&ITEM.replace(">example.com<", ">other.test<domain/>")),
            document(&ITEM.repeat(2)),
        ] {
            assert_eq!(
                parse_inventory_page(malformed.as_bytes(), 100),
                Err(INVALID)
            );
        }
    }
}
