//! ADR-0027's twelve launch platforms, the only Provider kinds a Host read may report.
//!
//! Every read that names a platform checks it against this list and fails closed on any other.
//! The desktop pins it to the Renderer's `launchPlatformKindSchema`, so adding or retiring a
//! platform is one change per runtime.

pub(crate) const LAUNCH_PLATFORMS: [&str; 12] = [
    "22cn",
    "afternic",
    "aliyun",
    "atom",
    "cloudflare",
    "dynadot",
    "ename",
    "godaddy",
    "namecheap",
    "porkbun",
    "sedo",
    "spaceship",
];
