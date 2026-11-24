//! Fixed masked Provider credential pairs on macOS. Each purpose owns its labels and decoder.
use zeroize::Zeroizing;

#[derive(Clone, Copy)]
pub(super) enum Purpose {
    Afternic,
    CloudflareRegistrar,
    Spaceship,
    Aliyun,
    Atom,
    SedoIdentity,
    SedoAccess,
    GoDaddy,
    Porkbun,
}

pub(super) enum CaptureError {
    Unavailable,
    Cancelled,
    AuthorityStale,
}

pub(super) fn capture(
    purpose: Purpose,
    guard: &mut dyn FnMut() -> bool,
) -> Result<Zeroizing<Vec<u8>>, CaptureError> {
    use std::{
        io::Read,
        process::{Command, Stdio},
        time::{Duration, Instant},
    };
    let output_bound = match purpose {
        Purpose::GoDaddy => u64::try_from(crate::godaddy::MAX_GODADDY_PAT_BYTES + 2)
            .expect("fixed credential bound"),
        _ => 1027,
    };
    let script = match purpose {
        Purpose::Afternic => {
            r#"set apiKey to text returned of (display dialog "Afternic API key" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Afternic API secret" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#
        }
        Purpose::CloudflareRegistrar => {
            r#"set accountId to text returned of (display dialog "Cloudflare Account ID" default answer "" with hidden answer)
set apiToken to text returned of (display dialog "Cloudflare user API token" default answer "" with hidden answer)
return accountId & linefeed & apiToken"#
        }
        Purpose::Spaceship => {
            r#"set apiKey to text returned of (display dialog "Spaceship API key" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Spaceship API secret" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#
        }
        Purpose::Aliyun => {
            r#"set apiKey to text returned of (display dialog "Alibaba Cloud AccessKey ID" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Alibaba Cloud AccessKey secret" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#
        }
        Purpose::Atom => {
            r#"set sellerId to text returned of (display dialog "Atom seller user ID" default answer "" with hidden answer)
set apiToken to text returned of (display dialog "Atom Seller API token" default answer "" with hidden answer)
return sellerId & linefeed & apiToken"#
        }
        Purpose::SedoIdentity => {
            r#"set partnerId to text returned of (display dialog "Sedo partner ID" default answer "" with hidden answer)
set userName to text returned of (display dialog "Sedo username" default answer "" with hidden answer)
return partnerId & linefeed & userName"#
        }
        Purpose::SedoAccess => {
            r#"set signKey to text returned of (display dialog "Sedo sign key" default answer "" with hidden answer)
set apiPassword to text returned of (display dialog "Sedo password" default answer "" with hidden answer)
return signKey & linefeed & apiPassword"#
        }
        Purpose::Porkbun => {
            r#"set apiKey to text returned of (display dialog "Porkbun API key" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Porkbun Secret API key" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#
        }
        Purpose::GoDaddy => {
            r#"return text returned of (display dialog "GoDaddy Personal Access Token" default answer "" with hidden answer)"#
        }
    };
    let mut child = Command::new("/usr/bin/osascript")
        .args(["-e", script])
        .env_clear()
        .stdin(Stdio::null())
        .stderr(Stdio::null())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|_| CaptureError::Unavailable)?;
    let stdout = child.stdout.take().ok_or(CaptureError::Unavailable)?;
    let reader = std::thread::spawn(move || {
        let mut bytes = Zeroizing::new(Vec::new());
        stdout
            .take(output_bound)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + Duration::from_secs(120);
    let status = loop {
        if !guard() || Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let _ = reader.join();
            return Err(CaptureError::AuthorityStale);
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => std::thread::sleep(Duration::from_millis(10)),
            Err(_) => {
                let _ = child.kill();
                let _ = child.wait();
                let _ = reader.join();
                return Err(CaptureError::Unavailable);
            }
        }
    };
    let bytes = reader
        .join()
        .map_err(|_| CaptureError::Unavailable)?
        .map_err(|_| CaptureError::Unavailable)?;
    if !guard() {
        return Err(CaptureError::AuthorityStale);
    }
    if !status.success() {
        return Err(CaptureError::Cancelled);
    }
    Ok(bytes)
}
