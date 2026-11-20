//! Official `SellerHub` verification records are account-scoped. This read path admits
//! only complete TXT options for a future mutation in an explicitly approved zone.
use super::SpaceshipError;
use serde::Deserialize;
use std::{
    collections::BTreeSet,
    net::{Ipv4Addr, Ipv6Addr},
};

pub(super) const MAX_VERIFICATION_BODY: usize = 64 * 1024;

pub struct SpaceshipSellerHubTxtRecord {
    relative_name: String,
    value: String,
}

impl SpaceshipSellerHubTxtRecord {
    /// The relative DNS owner, or `@` for the zone apex.
    #[must_use]
    pub fn relative_name(&self) -> &str {
        &self.relative_name
    }

    /// Provider-supplied verification data for an admitted Native DNS call.
    #[must_use]
    pub fn value(&self) -> &str {
        &self.value
    }
}

pub struct SpaceshipSellerHubTxtOption {
    records: Vec<SpaceshipSellerHubTxtRecord>,
}

impl SpaceshipSellerHubTxtOption {
    /// All of these records are required for the option.
    #[must_use]
    pub fn records(&self) -> &[SpaceshipSellerHubTxtRecord] {
        &self.records
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VerificationResponse {
    options: Vec<VerificationOption>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VerificationOption {
    records: Vec<VerificationRecord>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct VerificationRecord {
    #[serde(rename = "type")]
    kind: RecordType,
    name: String,
    value: String,
}

#[derive(Clone, Copy, Deserialize, Eq, Ord, PartialEq, PartialOrd)]
#[serde(rename_all = "UPPERCASE")]
enum RecordType {
    Txt,
    A,
    Aaaa,
}

pub(super) fn parse_txt_options(
    body: &[u8],
) -> Result<Vec<SpaceshipSellerHubTxtOption>, SpaceshipError> {
    let invalid = SpaceshipError::ProtocolRejected;
    let response: VerificationResponse = serde_json::from_slice(body).map_err(|_| invalid)?;
    if !(1..=5).contains(&response.options.len()) {
        return Err(invalid);
    }
    let mut txt_options = Vec::new();
    for option in response.options {
        if !(1..=10).contains(&option.records.len()) {
            return Err(invalid);
        }
        let mut groups = BTreeSet::new();
        for row in option.records {
            if !valid_relative_dns_name(&row.name) || !row.valid_value() {
                return Err(invalid);
            }
            if !groups.insert((row.kind, row.name.to_ascii_lowercase(), row.value)) {
                return Err(invalid);
            }
        }
        // SellerHub requires every record in a selected option. A valid address
        // option can be present alongside TXT, but projecting only its TXT
        // subset would produce an incomplete option.
        if groups.iter().all(|(kind, _, _)| *kind == RecordType::Txt) {
            txt_options.push(SpaceshipSellerHubTxtOption {
                records: groups
                    .into_iter()
                    .map(|(_, relative_name, value)| SpaceshipSellerHubTxtRecord {
                        relative_name,
                        value,
                    })
                    .collect(),
            });
        }
    }
    Ok(txt_options)
}

impl VerificationRecord {
    fn valid_value(&self) -> bool {
        if !(1..=256).contains(&self.value.len()) {
            return false;
        }
        match self.kind {
            RecordType::Txt => self.value.bytes().all(|byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b':' | b'/' | b'-')
            }),
            RecordType::A => self.value.parse::<Ipv4Addr>().is_ok(),
            RecordType::Aaaa => self.value.parse::<Ipv6Addr>().is_ok(),
        }
    }
}

fn valid_relative_dns_name(name: &str) -> bool {
    name == "@"
        || ((1..=253).contains(&name.len())
            && name.split('.').all(|label| {
                (1..=63).contains(&label.len())
                    && !label.starts_with('-')
                    && !label.ends_with('-')
                    && label
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-'))
            }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn txt_options_retain_the_complete_and_group_and_skip_address_options() {
        let body = json!({"options": [
            {"records": [
                {"type":"TXT","name":"@","value":"token-a"},
                {"type":"TXT","name":"_Proof","value":"token-b"}
            ]},
            {"records": [
                {"type":"TXT","name":"@","value":"token-c"},
                {"type":"A","name":"_spaceship_verify","value":"192.0.2.1"},
                {"type":"AAAA","name":"_spaceship_verify","value":"2001:db8::1"}
            ]}
        ]});
        let options = parse_txt_options(&serde_json::to_vec(&body).unwrap()).unwrap();
        assert_eq!(options.len(), 1);
        assert_eq!(
            options[0]
                .records()
                .iter()
                .map(|row| (row.relative_name(), row.value()))
                .collect::<Vec<_>>(),
            vec![("@", "token-a"), ("_proof", "token-b")]
        );
    }

    #[test]
    fn refuses_incomplete_options_and_untrusted_record_data() {
        for body in [
            json!({"options":[]}),
            json!({"options":[{"records":[]}]}),
            json!({"options":[{"records":[{"type":"TXT","name":"a.example.","value":"token"}]}]}),
            json!({"options":[{"records":[{"type":"TXT","name":"*","value":"token"}]}]}),
            json!({"options":[{"records":[{"type":"TXT","name":"@","value":"token\nheader"}]}]}),
            json!({"options":[{"records":[{"type":"TXT","name":"@","value":"token","ttl":300}]}]}),
            json!({"options":[{"records":[{"type":"NS","name":"@","value":"other.example"}]}]}),
            json!({"options":[{"records":[
                {"type":"TXT","name":"A","value":"token"},
                {"type":"TXT","name":"a","value":"token"}
            ]}]}),
        ] {
            assert!(matches!(
                parse_txt_options(&serde_json::to_vec(&body).unwrap()),
                Err(SpaceshipError::ProtocolRejected)
            ));
        }
    }
}
