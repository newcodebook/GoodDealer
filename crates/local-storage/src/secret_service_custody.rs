//! Linux Secret Service custody for the Host's fixed secret items (ADR-0025).
//!
//! This file is kept byte-identical in `gooddealer-local-storage` and
//! `gooddealer-secure-host-core`: the crates are independent trust domains and neither may expose
//! a general secret API to the other (ADR-0010). Callers pass only their own fixed service and
//! account constants and map [`SecretServiceError`] into their module error.

use std::collections::HashMap;

use zeroize::Zeroizing;

/// Fixed `application` attribute; it scopes every item to this product.
const APPLICATION: &str = "app.gooddealer.desktop";
const CONTENT_TYPE: &str = "application/octet-stream";

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum SecretServiceError {
    /// No reachable, unlocked Secret Service; the caller fails closed without guessing.
    Unavailable,
    /// The store answered, but its state is ambiguous or does not match what was written.
    Rejected,
}

/// What a search permits, decided apart from D-Bus so every branch is testable.
#[derive(Debug, PartialEq, Eq)]
enum Selection {
    Absent,
    Single,
    Unavailable,
    Rejected,
}

fn select(unlocked: usize, locked: usize) -> Selection {
    match (unlocked, locked) {
        // Two items with the same identity cannot be told apart; one may be planted.
        (unlocked, locked) if unlocked + locked > 1 => Selection::Rejected,
        (0, 0) => Selection::Absent,
        (1, 0) => Selection::Single,
        // A locked match is the `WhenUnlocked` case: unreadable now, never treated as absent.
        _ => Selection::Unavailable,
    }
}

fn expected_attributes<'a>(service: &'a str, account: &'a str) -> HashMap<&'a str, &'a str> {
    HashMap::from([("application", APPLICATION), ("service", service), ("account", account)])
}

/// Re-checks the item's identity after the search: the three identity attributes must match
/// exactly, and the only extra attributes tolerated are the `xdg:` keys some daemons add.
fn attributes_match(actual: &HashMap<String, String>, service: &str, account: &str) -> bool {
    let expected = expected_attributes(service, account);
    expected
        .iter()
        .all(|(key, value)| actual.get(*key).is_some_and(|actual| actual == value))
        && actual
            .keys()
            .all(|key| expected.contains_key(key.as_str()) || key.starts_with("xdg:"))
}

#[cfg(target_os = "linux")]
fn connect() -> Result<secret_service::blocking::SecretService<'static>, SecretServiceError> {
    // DH is mandatory: a plain session would move secret bytes over the bus unencrypted.
    secret_service::blocking::SecretService::connect(secret_service::EncryptionType::Dh)
        .map_err(|_| SecretServiceError::Unavailable)
}

/// Reads one item, or `None` when it has never been written.
///
/// # Errors
///
/// [`SecretServiceError::Unavailable`] when the service is unreachable or the item is locked;
/// [`SecretServiceError::Rejected`] for duplicate or mismatched items.
#[cfg(target_os = "linux")]
pub(crate) fn load(
    service: &str,
    account: &str,
) -> Result<Option<Zeroizing<Vec<u8>>>, SecretServiceError> {
    let store = connect()?;
    load_with(&store, service, account)
}

#[cfg(target_os = "linux")]
fn load_with(
    store: &secret_service::blocking::SecretService<'_>,
    service: &str,
    account: &str,
) -> Result<Option<Zeroizing<Vec<u8>>>, SecretServiceError> {
    let found = store
        .search_items(expected_attributes(service, account))
        .map_err(|_| SecretServiceError::Unavailable)?;
    match select(found.unlocked.len(), found.locked.len()) {
        Selection::Absent => return Ok(None),
        Selection::Unavailable => return Err(SecretServiceError::Unavailable),
        Selection::Rejected => return Err(SecretServiceError::Rejected),
        Selection::Single => {}
    }
    let item = found.unlocked.first().ok_or(SecretServiceError::Rejected)?;
    let attributes = item
        .get_attributes()
        .map_err(|_| SecretServiceError::Unavailable)?;
    if !attributes_match(&attributes, service, account) {
        return Err(SecretServiceError::Rejected);
    }
    let secret = Zeroizing::new(
        item.get_secret()
            .map_err(|_| SecretServiceError::Unavailable)?,
    );
    Ok(Some(secret))
}

/// Writes one item into the default collection, replacing the same identity, and confirms it
/// by reading back exactly one byte-identical item.
///
/// # Errors
///
/// [`SecretServiceError::Unavailable`] when the default collection is missing or locked;
/// [`SecretServiceError::Rejected`] when the readback is ambiguous or differs.
#[cfg(target_os = "linux")]
pub(crate) fn store(service: &str, account: &str, value: &[u8]) -> Result<(), SecretServiceError> {
    let store = connect()?;
    let collection = store
        .get_default_collection()
        .map_err(|_| SecretServiceError::Unavailable)?;
    // Refuse rather than raise an unlock prompt from a background Host path.
    if collection
        .is_locked()
        .map_err(|_| SecretServiceError::Unavailable)?
    {
        return Err(SecretServiceError::Unavailable);
    }
    collection
        .create_item(
            &format!("GoodDealer {service}"),
            expected_attributes(service, account),
            value,
            true,
            CONTENT_TYPE,
        )
        .map_err(|_| SecretServiceError::Unavailable)?;
    match load_with(&store, service, account)? {
        Some(readback) if readback.as_slice() == value => Ok(()),
        _ => Err(SecretServiceError::Rejected),
    }
}

/// Removes the item; an absent item is already removed.
///
/// # Errors
///
/// [`SecretServiceError::Unavailable`] when removal cannot be confirmed.
#[cfg(target_os = "linux")]
#[allow(dead_code, reason = "local-storage never removes its items; secure-host-core does")]
pub(crate) fn delete(service: &str, account: &str) -> Result<(), SecretServiceError> {
    let store = connect()?;
    let found = store
        .search_items(expected_attributes(service, account))
        .map_err(|_| SecretServiceError::Unavailable)?;
    if !found.locked.is_empty() {
        return Err(SecretServiceError::Unavailable);
    }
    for item in &found.unlocked {
        item.delete().map_err(|_| SecretServiceError::Unavailable)?;
    }
    let remaining = store
        .search_items(expected_attributes(service, account))
        .map_err(|_| SecretServiceError::Unavailable)?;
    if remaining.unlocked.is_empty() && remaining.locked.is_empty() {
        Ok(())
    } else {
        Err(SecretServiceError::Unavailable)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn attributes(pairs: &[(&str, &str)]) -> HashMap<String, String> {
        pairs
            .iter()
            .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
            .collect()
    }

    #[test]
    fn selection_admits_only_one_unlocked_item() {
        assert_eq!(select(0, 0), Selection::Absent);
        assert_eq!(select(1, 0), Selection::Single);
        assert_eq!(select(0, 1), Selection::Unavailable);
        assert_eq!(select(2, 0), Selection::Rejected);
        assert_eq!(select(1, 1), Selection::Rejected);
        assert_eq!(select(0, 2), Selection::Rejected);
    }

    #[test]
    fn attributes_must_match_identity_exactly() {
        let exact = attributes(&[
            ("application", APPLICATION),
            ("service", "svc"),
            ("account", "acct"),
        ]);
        assert!(attributes_match(&exact, "svc", "acct"));
        let mut with_schema = exact.clone();
        with_schema.insert("xdg:schema".to_owned(), "org.freedesktop.Secret.Generic".to_owned());
        assert!(attributes_match(&with_schema, "svc", "acct"));

        assert!(!attributes_match(&exact, "svc", "other"));
        assert!(!attributes_match(&exact, "other", "acct"));
        let mut foreign = exact.clone();
        foreign.insert("application".to_owned(), "org.example.other".to_owned());
        assert!(!attributes_match(&foreign, "svc", "acct"));
        let mut extra = exact.clone();
        extra.insert("origin".to_owned(), "synced".to_owned());
        assert!(!attributes_match(&extra, "svc", "acct"));
        let missing = attributes(&[("application", APPLICATION), ("service", "svc")]);
        assert!(!attributes_match(&missing, "svc", "acct"));
    }
}
