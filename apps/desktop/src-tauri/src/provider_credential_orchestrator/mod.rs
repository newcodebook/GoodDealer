//! Native credential adapter facade. Each platform owns its closed HTTP/custody bridge.
//! Durable plans and commit decisions remain in local-storage; secrets remain in Secure Host.

pub(crate) mod afternic;
pub(crate) mod afternic_delist;
mod cloudflare;

pub(crate) use cloudflare::{
    ProviderCredentialError, RevocationOutcome, activate, observe, purge, recover, revoke,
};
