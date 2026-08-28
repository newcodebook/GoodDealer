//! Immutable Host-created canonical navigation policy.

use url::{Host, Origin, Url};

const MAX_URL_BYTES: usize = 2_048;

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
struct AllowedOrigin {
    host: String,
    port: u16,
}

impl AllowedOrigin {
    fn host_created(origin: &str) -> Result<Self, NavigationError> {
        if origin.is_empty() || origin.len() > MAX_URL_BYTES || !origin.is_ascii() {
            return Err(NavigationError::InvalidUrl);
        }
        let url = Url::parse(origin).map_err(|_| NavigationError::InvalidUrl)?;
        if url.scheme() != "https"
            || !url.username().is_empty()
            || url.password().is_some()
            || url.query().is_some()
            || url.fragment().is_some()
            || url.path() != "/"
        {
            return Err(NavigationError::OriginNotCanonical);
        }
        let host = canonical_domain_host(&url)?;
        let port = url
            .port_or_known_default()
            .ok_or(NavigationError::InvalidUrl)?;
        if port != 443 {
            return Err(NavigationError::PortDenied);
        }
        Ok(Self { host, port })
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct NavigationPolicy {
    allowed_origins: Vec<AllowedOrigin>,
}

impl NavigationPolicy {
    pub(crate) fn host_created(origins: &[&str]) -> Result<Self, NavigationError> {
        if origins.is_empty() || origins.len() > 16 {
            return Err(NavigationError::UnknownOrigin);
        }
        let mut allowed_origins = Vec::with_capacity(origins.len());
        for origin in origins {
            let parsed = AllowedOrigin::host_created(origin)?;
            if allowed_origins.contains(&parsed) {
                return Err(NavigationError::UnknownOrigin);
            }
            allowed_origins.push(parsed);
        }
        Ok(Self { allowed_origins })
    }

    pub(crate) fn decide(&self, input: &str) -> Result<(), NavigationError> {
        if input.is_empty() || input.len() > MAX_URL_BYTES || !input.is_ascii() {
            return Err(NavigationError::InvalidUrl);
        }
        let url = Url::parse(input).map_err(|_| NavigationError::InvalidUrl)?;
        if url.scheme() != "https" {
            return Err(NavigationError::SchemeDenied);
        }
        if !url.username().is_empty() || url.password().is_some() {
            return Err(NavigationError::UserInfoDenied);
        }
        if url.fragment().is_some() {
            return Err(NavigationError::FragmentDenied);
        }
        let host = canonical_domain_host(&url)?;
        let port = url
            .port_or_known_default()
            .ok_or(NavigationError::InvalidUrl)?;
        if port != 443 {
            return Err(NavigationError::PortDenied);
        }
        let origin = match url.origin() {
            Origin::Tuple(_, _, _) => AllowedOrigin { host, port },
            Origin::Opaque(_) => return Err(NavigationError::InvalidUrl),
        };
        if !self.allowed_origins.contains(&origin) {
            return Err(NavigationError::UnknownOrigin);
        }
        Ok(())
    }
}

fn canonical_domain_host(url: &Url) -> Result<String, NavigationError> {
    match url.host() {
        Some(Host::Domain(host))
            if !host.is_empty()
                && !host.ends_with('.')
                && host.is_ascii()
                && host == host.to_ascii_lowercase() =>
        {
            Ok(host.to_owned())
        }
        Some(Host::Ipv4(_) | Host::Ipv6(_)) => Err(NavigationError::IpLiteralDenied),
        _ => Err(NavigationError::InvalidUrl),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum NavigationError {
    InvalidUrl,
    OriginNotCanonical,
    SchemeDenied,
    UserInfoDenied,
    FragmentDenied,
    PortDenied,
    IpLiteralDenied,
    UnknownOrigin,
    StalePolicyBinding,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_navigation_matrix_rejects_origin_confusion() {
        let policy = NavigationPolicy::host_created(&["https://spaceship.com"]).unwrap();
        assert_eq!(policy.decide("https://spaceship.com/account?tab=1"), Ok(()));
        for candidate in [
            "http://spaceship.com",
            "https://user@spaceship.com",
            "https://spaceship.com:444",
            "https://evilspaceship.com",
            "https://spaceship.com.evil.example",
            "https://spaceship.com./",
            "https://127.0.0.1/",
            "https://[::1]/",
            "https://spaceship.com/#secret",
            "not a url",
            "",
        ] {
            assert!(policy.decide(candidate).is_err(), "accepted {candidate}");
        }
        assert!(
            policy
                .decide(&format!(
                    "https://spaceship.com/{}",
                    "a".repeat(MAX_URL_BYTES)
                ))
                .is_err()
        );
    }

    #[test]
    fn host_policy_rejects_noncanonical_origins() {
        for origin in [
            "http://spaceship.com",
            "https://spaceship.com/path",
            "https://spaceship.com?query=1",
            "https://spaceship.com:444",
            "https://127.0.0.1",
            "https://spaceship.com.",
        ] {
            assert!(NavigationPolicy::host_created(&[origin]).is_err());
        }
    }
}
