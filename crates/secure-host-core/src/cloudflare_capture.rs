//! Fixed Native credential capture. Platform adapters never accept secrets through Renderer IPC.

use std::fmt;

use zeroize::Zeroizing;

#[cfg(any(target_os = "macos", target_os = "windows", test))]
const MAX_OUTPUT_BYTES: usize = 8 * 1024;
#[cfg(any(target_os = "macos", target_os = "windows", test))]
const MAX_TOKEN_BYTES: usize = 512;
#[cfg(target_os = "macos")]
const STATIC_APPLESCRIPT: &str = r#"set zoneId to text returned of (display dialog "Cloudflare Zone ID" default answer "")
set apiToken to text returned of (display dialog "Cloudflare API token" default answer "" with hidden answer)
return zoneId & linefeed & apiToken"#;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloudflareCaptureError {
    AuthorityStale,
    Unavailable,
    Cancelled,
    Timeout,
    Failed,
    OutputInvalid,
    OutputTooLarge,
}

impl fmt::Display for CloudflareCaptureError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(match self {
            Self::AuthorityStale => "authority_stale",
            Self::Unavailable => "capture_unavailable",
            Self::Cancelled => "capture_cancelled",
            Self::Timeout => "capture_timeout",
            Self::Failed => "capture_failed",
            Self::OutputInvalid => "capture_output_invalid",
            Self::OutputTooLarge => "capture_output_too_large",
        })
    }
}
impl std::error::Error for CloudflareCaptureError {}

#[derive(PartialEq, Eq)]
pub struct CloudflareCandidate {
    zone_id: String,
    #[allow(
        dead_code,
        reason = "consumed only by native credential activation composition"
    )]
    token: Zeroizing<String>,
}

impl fmt::Debug for CloudflareCandidate {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("CloudflareCandidate([REDACTED])")
    }
}

impl CloudflareCandidate {
    #[must_use]
    pub fn zone_id(&self) -> &str {
        &self.zone_id
    }

    /// Returns the non-secret domain-separated Zone binding used by durable activation staging.
    #[must_use]
    pub fn zone_binding_digest(&self) -> String {
        crate::cloudflare_keychain::cloudflare_zone_binding_digest(&self.zone_id)
    }

    pub(super) fn token(&self) -> &str {
        &self.token
    }

    pub(super) fn into_parts(self) -> (String, Zeroizing<String>) {
        (self.zone_id, self.token)
    }
}

pub struct CloudflareCapture;

impl CloudflareCapture {
    /// Whether this build has a fixed Native capture adapter. Windows uses masked Win32 controls;
    /// macOS uses its fixed system dialog. Runtime custody admission is still independent.
    #[must_use]
    pub const fn supported() -> bool {
        cfg!(any(target_os = "macos", target_os = "windows"))
    }

    /// Captures a candidate through the fixed Native adapter on Windows or macOS.
    ///
    /// # Errors
    ///
    /// Returns a closed error when native capture is unavailable, cancelled, times out, emits
    /// invalid data, or exceeds the bounded output limit.
    pub fn capture() -> Result<CloudflareCandidate, CloudflareCaptureError> {
        Self::capture_guarded(&mut || Ok(()))
    }

    /// Captures a candidate while checking the owning Host authority before spawn, while the
    /// native dialog is live, and after the child has been reaped. A failed guard kills and waits
    /// for the fixed child before returning, so cancellation cannot leave a credential-capture
    /// process detached from the Host lifetime.
    ///
    /// # Errors
    ///
    /// Returns the guard error or the same closed capture errors as [`Self::capture`].
    pub fn capture_guarded(
        guard: &mut dyn FnMut() -> Result<(), CloudflareCaptureError>,
    ) -> Result<CloudflareCandidate, CloudflareCaptureError> {
        guard()?;
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            Err(CloudflareCaptureError::Unavailable)
        }
        #[cfg(windows)]
        {
            use crate::windows_credential_capture::{CaptureError, Purpose, capture};
            let mut guard_error = None;
            let captured = capture(Purpose::Cloudflare, &mut || match guard() {
                Ok(()) => true,
                Err(error) => {
                    guard_error = Some(error);
                    false
                }
            });
            if let Some(error) = guard_error {
                return Err(error);
            }
            let bytes = captured.map_err(|error| match error {
                CaptureError::Unavailable => CloudflareCaptureError::Unavailable,
                CaptureError::Cancelled => CloudflareCaptureError::Cancelled,
                CaptureError::Timeout => CloudflareCaptureError::Timeout,
                CaptureError::AuthorityStale => CloudflareCaptureError::AuthorityStale,
            })?;
            guard()?;
            parse_capture_output(&bytes)
        }
        #[cfg(target_os = "macos")]
        {
            use std::io::Read;
            use std::process::{Command, Stdio};
            use std::time::{Duration, Instant};
            let mut child = Command::new("/usr/bin/osascript")
                .arg("-e")
                .arg(STATIC_APPLESCRIPT)
                .env_clear()
                .stdin(Stdio::null())
                .stderr(Stdio::null())
                .stdout(Stdio::piped())
                .spawn()
                .map_err(|_| CloudflareCaptureError::Unavailable)?;
            let stdout = child.stdout.take().ok_or(CloudflareCaptureError::Failed)?;
            let reader = std::thread::spawn(move || {
                let mut bytes = Zeroizing::new(Vec::with_capacity(MAX_OUTPUT_BYTES + 1));
                stdout
                    .take((MAX_OUTPUT_BYTES + 1) as u64)
                    .read_to_end(&mut bytes)
                    .map(|_| bytes)
            });
            let deadline = Instant::now() + Duration::from_mins(2);
            let status = loop {
                if let Err(error) = guard() {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err(error);
                }
                if let Some(status) = child
                    .try_wait()
                    .map_err(|_| CloudflareCaptureError::Failed)?
                {
                    break status;
                }
                if Instant::now() >= deadline {
                    let _ = child.kill();
                    let _ = child.wait();
                    let _ = reader.join();
                    return Err(CloudflareCaptureError::Timeout);
                }
                std::thread::sleep(Duration::from_millis(10));
            };
            let bytes = reader
                .join()
                .map_err(|_| CloudflareCaptureError::Failed)?
                .map_err(|_| CloudflareCaptureError::Failed)?;
            if bytes.len() > MAX_OUTPUT_BYTES {
                return Err(CloudflareCaptureError::OutputTooLarge);
            }
            if !status.success() {
                return Err(CloudflareCaptureError::Failed);
            }
            guard()?;
            parse_capture_output(bytes.as_slice())
        }
    }
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn parse_capture_output(bytes: &[u8]) -> Result<CloudflareCandidate, CloudflareCaptureError> {
    if bytes.len() > MAX_OUTPUT_BYTES {
        return Err(CloudflareCaptureError::OutputTooLarge);
    }
    let text = std::str::from_utf8(bytes).map_err(|_| CloudflareCaptureError::OutputInvalid)?;
    let text = text.strip_suffix('\n').unwrap_or(text);
    let mut lines = text.split('\n');
    let zone_id = lines.next().ok_or(CloudflareCaptureError::OutputInvalid)?;
    let token = lines.next().ok_or(CloudflareCaptureError::OutputInvalid)?;
    if lines.next().is_some()
        || !is_zone_id(zone_id)
        || token.is_empty()
        || token.len() > MAX_TOKEN_BYTES
        || token.bytes().any(|byte| !byte.is_ascii_graphic())
    {
        return Err(CloudflareCaptureError::OutputInvalid);
    }
    Ok(CloudflareCandidate {
        zone_id: zone_id.to_owned(),
        token: Zeroizing::new(token.to_owned()),
    })
}

#[cfg(any(target_os = "macos", target_os = "windows", test))]
fn is_zone_id(value: &str) -> bool {
    value.len() == 32
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn output_parser_is_exact_and_bounded() {
        let valid = b"0123456789abcdef0123456789abcdef\ntoken-123\n";
        let candidate = parse_capture_output(valid).unwrap();
        assert_eq!(candidate.zone_id, "0123456789abcdef0123456789abcdef");
        assert_eq!(format!("{candidate:?}"), "CloudflareCandidate([REDACTED])");
        assert!(!format!("{candidate:?}").contains("token-123"));
        for invalid in [
            b"bad\ntoken\n".as_slice(),
            b"0123456789abcdef0123456789abcdef\n\n",
            b"0123456789abcdef0123456789abcdef\ntoken\nextra",
        ] {
            assert_eq!(
                parse_capture_output(invalid).unwrap_err(),
                CloudflareCaptureError::OutputInvalid
            );
        }
        assert_eq!(
            parse_capture_output(&vec![b'x'; MAX_OUTPUT_BYTES + 1]).unwrap_err(),
            CloudflareCaptureError::OutputTooLarge
        );
    }
}
