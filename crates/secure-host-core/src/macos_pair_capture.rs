//! Fixed masked Provider credential pairs on macOS. Each purpose owns its labels and decoder.
use zeroize::Zeroizing;

pub(super) enum Purpose {
    Afternic,
    Spaceship,
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
    let script = match purpose {
        Purpose::Afternic => {
            r#"set apiKey to text returned of (display dialog "Afternic API key" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Afternic API secret" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#
        }
        Purpose::Spaceship => {
            r#"set apiKey to text returned of (display dialog "Spaceship API key" default answer "" with hidden answer)
set apiSecret to text returned of (display dialog "Spaceship API secret" default answer "" with hidden answer)
return apiKey & linefeed & apiSecret"#
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
        stdout.take(1027).read_to_end(&mut bytes).map(|_| bytes)
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
