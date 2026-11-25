use std::collections::BTreeSet;

use serde::Deserialize;

use super::{PorkbunDelegation, PorkbunDnsZone, PorkbunError, dns_wire};

/// Local bound on one registry nameserver set; the schema sets none.
pub(super) const MAX_NAMESERVERS: usize = 16;

/// `getNs` 200 body (v3.112): `{status, ns}`. Neither is declared required; `GoodDealer` requires
/// both and refuses any other field, a fail-closed choice rather than a documented rule.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NameserversWire {
    status: String,
    ns: Vec<String>,
}

/// Projects one registry nameserver set. The API documents the set as unordered, so it is
/// lowercased, checked for duplicates and returned sorted.
pub(super) fn accept(body: &[u8]) -> Result<PorkbunDelegation, PorkbunError> {
    let invalid = PorkbunError::ProtocolRejected;
    let wire: NameserversWire = serde_json::from_slice(body).map_err(|_| invalid)?;
    if wire.status != "SUCCESS" || wire.ns.len() > MAX_NAMESERVERS {
        return Err(invalid);
    }
    let mut nameservers = BTreeSet::new();
    for host in &wire.ns {
        let canonical = dns_wire::canonical_zone(host).ok_or(invalid)?;
        if !nameservers.insert(canonical) {
            return Err(invalid);
        }
    }
    Ok(PorkbunDelegation::Nameservers(
        nameservers.into_iter().collect(),
    ))
}

/// Maps one response: 400 carries the documented error body shared with the DNS read; every other
/// status goes through the shared status classes first.
pub(super) fn classify(
    status: reqwest::StatusCode,
    body: &[u8],
) -> Result<PorkbunDelegation, PorkbunError> {
    if status == reqwest::StatusCode::BAD_REQUEST {
        return match dns_wire::rejection(body)? {
            PorkbunDnsZone::ApiAccessDisabled => Ok(PorkbunDelegation::ApiAccessDisabled),
            PorkbunDnsZone::NotInAccount => Ok(PorkbunDelegation::NotInAccount),
            PorkbunDnsZone::DomainNotActive => Ok(PorkbunDelegation::DomainNotActive),
            PorkbunDnsZone::Records { .. } => Err(PorkbunError::ProtocolRejected),
        };
    }
    super::status_class(status)?;
    accept(body)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn body(value: &serde_json::Value) -> Vec<u8> {
        serde_json::to_vec(value).unwrap()
    }

    #[test]
    fn an_unordered_set_is_lowercased_and_sorted() {
        assert_eq!(
            accept(&body(
                &json!({"status":"SUCCESS","ns":["NS2.Porkbun.com","ns1.porkbun.com"]})
            ))
            .unwrap(),
            PorkbunDelegation::Nameservers(vec![
                "ns1.porkbun.com".to_owned(),
                "ns2.porkbun.com".to_owned()
            ])
        );
        assert_eq!(
            accept(&body(&json!({"status":"SUCCESS","ns":[]}))).unwrap(),
            PorkbunDelegation::Nameservers(Vec::new())
        );
    }

    #[test]
    fn malformed_duplicate_or_oversized_sets_are_refused() {
        let many: Vec<String> = (0..=MAX_NAMESERVERS)
            .map(|n| format!("ns{n}.example.net"))
            .collect();
        for value in [
            json!({"status":"SUCCESS"}),
            json!({"ns":["ns1.porkbun.com"]}),
            json!({"status":"ERROR","ns":["ns1.porkbun.com"]}),
            json!({"status":"SUCCESS","ns":["ns1.porkbun.com"],"extra":1}),
            json!({"status":"SUCCESS","ns":["ns1.porkbun.com."]}),
            json!({"status":"SUCCESS","ns":["localhost"]}),
            json!({"status":"SUCCESS","ns":["bad host.example.net"]}),
            json!({"status":"SUCCESS","ns":["192.0.2.1"]}),
            json!({"status":"SUCCESS","ns":[""]}),
            json!({"status":"SUCCESS","ns":[1]}),
            json!({"status":"SUCCESS","ns":["NS1.porkbun.com","ns1.porkbun.com"]}),
            json!({"status":"SUCCESS","ns":many}),
        ] {
            assert_eq!(
                accept(&body(&value)),
                Err(PorkbunError::ProtocolRejected),
                "{value}"
            );
        }
    }

    #[test]
    fn documented_refusals_map_to_closed_outcomes_without_text() {
        let bad = reqwest::StatusCode::BAD_REQUEST;
        for (code, expected) in [
            (
                "API_ACCESS_DISABLED",
                Ok(PorkbunDelegation::ApiAccessDisabled),
            ),
            ("INVALID_DOMAIN", Ok(PorkbunDelegation::NotInAccount)),
            ("DOMAIN_NOT_FOUND", Ok(PorkbunDelegation::NotInAccount)),
            ("DOMAIN_NOT_ACTIVE", Ok(PorkbunDelegation::DomainNotActive)),
            ("INVALID_INPUT", Err(PorkbunError::ProtocolRejected)),
            ("SOMETHING_NEW", Err(PorkbunError::AuthenticationRequired)),
        ] {
            let error = json!({"status":"ERROR","code":code,"message":"secret account text"});
            assert_eq!(classify(bad, &body(&error)), expected, "{code}");
        }
        assert_eq!(
            classify(reqwest::StatusCode::TOO_MANY_REQUESTS, b"{}"),
            Err(PorkbunError::RateLimited)
        );
        assert_eq!(
            classify(reqwest::StatusCode::NOT_FOUND, b"{}"),
            Err(PorkbunError::ProtocolRejected)
        );
    }
}
