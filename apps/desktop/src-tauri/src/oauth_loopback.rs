//! ADR-0026 loopback transport for one browser authorization attempt (RFC 8252 §7.3).
//!
//! This module only binds, reads, and answers HTTP on the literal IPv4 loopback. It never sees
//! the attempt's state or verifier and never logs a request target; `oauth_runtime` decides what a
//! callback means.

use std::io;
use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::time::Duration;

use tokio::io::{AsyncReadExt as _, AsyncWriteExt as _};
use tokio::net::TcpStream;
use url::Url;

const CALLBACK_PATH: &str = "/oauth/callback";
const MAX_REQUEST_HEAD_BYTES: usize = 8 * 1_024;
const REQUEST_READ_TIMEOUT: Duration = Duration::from_secs(5);
const MARK: &str = include_str!("../../../../packages/ui/src/assets/logo/mark-flat.svg");

/// Binds an operating-system-chosen port on 127.0.0.1 only; never `localhost` or a wildcard.
pub(crate) fn bind() -> io::Result<(TcpListener, u16)> {
    let listener = TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, 0))?;
    listener.set_nonblocking(true)?;
    let port = listener.local_addr()?.port();
    Ok((listener, port))
}

pub(crate) enum LoopbackRequest {
    /// `GET /oauth/callback?…` addressed to this exact listener.
    Callback(Url),
    /// Anything else, such as the browser's automatic `/favicon.ico`; answered and ignored.
    Unrelated,
    /// Unreadable, oversized, or addressed to another host name (DNS rebinding).
    Rejected,
}

/// Reads one request head and classifies it. Each connection carries at most one request.
pub(crate) async fn read_request(stream: &mut TcpStream, port: u16) -> LoopbackRequest {
    let Ok(Some(head)) = tokio::time::timeout(REQUEST_READ_TIMEOUT, read_head(stream)).await else {
        return LoopbackRequest::Rejected;
    };
    classify(&head, port)
}

async fn read_head(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(1_024);
    let mut chunk = [0_u8; 1_024];
    loop {
        let read = stream.read(&mut chunk).await.ok()?;
        if read == 0 {
            return None;
        }
        buffer.extend_from_slice(&chunk[..read]);
        if let Some(end) = buffer.windows(4).position(|window| window == b"\r\n\r\n") {
            buffer.truncate(end);
            return String::from_utf8(buffer).ok();
        }
        if buffer.len() > MAX_REQUEST_HEAD_BYTES {
            return None;
        }
    }
}

fn classify(head: &str, port: u16) -> LoopbackRequest {
    let mut lines = head.split("\r\n");
    let mut request_line = lines.next().unwrap_or_default().split(' ');
    let (Some(method), Some(target), Some(version), None) = (
        request_line.next(),
        request_line.next(),
        request_line.next(),
        request_line.next(),
    ) else {
        return LoopbackRequest::Rejected;
    };
    let expected_host = format!("127.0.0.1:{port}");
    let mut hosts = lines.filter_map(|line| {
        let (name, value) = line.split_once(':')?;
        name.trim()
            .eq_ignore_ascii_case("host")
            .then(|| value.trim())
    });
    // Exactly one Host header naming this listener: a page that rebinds its own DNS name to
    // 127.0.0.1 still sends that name, never the loopback literal and port.
    if !matches!(version, "HTTP/1.1" | "HTTP/1.0")
        || !target.starts_with('/')
        || hosts.next() != Some(expected_host.as_str())
        || hosts.next().is_some()
    {
        return LoopbackRequest::Rejected;
    }
    let Ok(url) = Url::parse(&format!("http://{expected_host}{target}")) else {
        return LoopbackRequest::Rejected;
    };
    if method == "GET" && url.path() == CALLBACK_PATH {
        LoopbackRequest::Callback(url)
    } else {
        LoopbackRequest::Unrelated
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ResultPage {
    SignedIn,
    Failed,
    Retry,
    NotFound,
    BadRequest,
}

/// Sends the browser on to the next authorization leg in the same tab.
pub(crate) async fn redirect(stream: &mut TcpStream, location: &Url) {
    let head = format!(
        "HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\n{}\r\n",
        common_headers()
    );
    write_and_close(stream, head.as_bytes(), &[]).await;
}

pub(crate) async fn respond(stream: &mut TcpStream, page: ResultPage) {
    let (status, body) = render(page);
    let head = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\n{}\r\n",
        body.len(),
        common_headers()
    );
    write_and_close(stream, head.as_bytes(), body.as_bytes()).await;
}

fn common_headers() -> &'static str {
    "Cache-Control: no-store\r\nReferrer-Policy: no-referrer\r\nX-Content-Type-Options: nosniff\r\n\
     Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; \
     form-action 'none'; frame-ancestors 'none'\r\nConnection: close\r\n"
}

async fn write_and_close(stream: &mut TcpStream, head: &[u8], body: &[u8]) {
    let _ = stream.write_all(head).await;
    let _ = stream.write_all(body).await;
    let _ = stream.shutdown().await;
}

/// Static, script-free pages on the brand ink/panel scale; nothing from the request is echoed.
fn render(page: ResultPage) -> (&'static str, String) {
    let (status, tone, title, body, meta) = match page {
        ResultPage::SignedIn => (
            "200 OK",
            "#5CAE7D",
            "已登录 GoodDealer",
            "可以关闭此标签页，回到 GoodDealer 继续。",
            "Signed in. You can close this tab.",
        ),
        ResultPage::Failed => (
            "400 Bad Request",
            "#E5735F",
            "登录未完成",
            "回到 GoodDealer 重新登录。",
            "Sign-in did not complete. Return to GoodDealer and try again.",
        ),
        ResultPage::Retry => (
            "503 Service Unavailable",
            "#E08A48",
            "GoodDealer 正忙",
            "稍后刷新此页面继续登录。",
            "GoodDealer is busy. Reload this page to continue.",
        ),
        ResultPage::NotFound => (
            "404 Not Found",
            "#8D93A3",
            "页面不存在",
            "此地址只用于 GoodDealer 登录回调。",
            "This address only receives GoodDealer sign-in callbacks.",
        ),
        ResultPage::BadRequest => (
            "400 Bad Request",
            "#E5735F",
            "请求无效",
            "此请求不属于当前的 GoodDealer 登录。",
            "This request does not belong to the current GoodDealer sign-in.",
        ),
    };
    let html = format!(
        r#"<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>{title} · GoodDealer</title><style>
:root{{color-scheme:dark}}
body{{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0B0F;color:#EAE8E1;font:13px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI Variable Text","Segoe UI","PingFang SC","Microsoft YaHei UI","Noto Sans","Noto Sans CJK SC",sans-serif}}
main{{box-sizing:border-box;width:min(400px,calc(100vw - 32px));padding:28px;background:#10131A;border:1px solid #1E2230;border-radius:7px}}
.mark{{width:32px;height:32px;display:block;margin-bottom:20px}}
h1{{display:flex;align-items:center;gap:10px;margin:0 0 6px;font-size:20px;font-weight:600}}
h1::before{{content:"";width:8px;height:8px;border-radius:999px;background:{tone}}}
p{{margin:0;color:#8D93A3}}
small{{display:block;margin-top:16px;padding-top:12px;border-top:1px solid #1E2230;font-size:11px;color:#5C6272}}
</style></head><body><main><span class="mark" aria-hidden="true">{MARK}</span><h1>{title}</h1><p>{body}</p><small lang="en">{meta}</small></main></body></html>"#
    );
    (status, html)
}

#[cfg(test)]
mod tests {
    use super::*;

    const PORT: u16 = 53_682;

    fn head(request_line: &str, host: &str) -> String {
        format!("{request_line}\r\nHost: {host}\r\nAccept: text/html")
    }

    #[test]
    fn admits_only_a_get_callback_addressed_to_this_listener() {
        let LoopbackRequest::Callback(url) = classify(
            &head(
                "GET /oauth/callback?code=x&state=y HTTP/1.1",
                "127.0.0.1:53682",
            ),
            PORT,
        ) else {
            panic!("callback must be admitted");
        };
        assert_eq!(
            url.as_str(),
            "http://127.0.0.1:53682/oauth/callback?code=x&state=y"
        );
        assert!(matches!(
            classify(&head("GET /favicon.ico HTTP/1.1", "127.0.0.1:53682"), PORT),
            LoopbackRequest::Unrelated
        ));
        assert!(matches!(
            classify(
                &head("POST /oauth/callback?code=x HTTP/1.1", "127.0.0.1:53682"),
                PORT
            ),
            LoopbackRequest::Unrelated
        ));
    }

    #[test]
    fn rejects_rebinding_hosts_absolute_targets_and_malformed_heads() {
        for request in [
            head(
                "GET /oauth/callback?code=x HTTP/1.1",
                "attacker.example:53682",
            ),
            head("GET /oauth/callback?code=x HTTP/1.1", "localhost:53682"),
            head("GET /oauth/callback?code=x HTTP/1.1", "127.0.0.1:53683"),
            head("GET /oauth/callback?code=x HTTP/1.1", "127.0.0.1"),
            "GET /oauth/callback?code=x HTTP/1.1\r\nAccept: */*".to_owned(),
            format!(
                "{}\r\nHost: 127.0.0.1:53682",
                head("GET /oauth/callback HTTP/1.1", "127.0.0.1:53682")
            ),
            head(
                "GET http://127.0.0.1:53682/oauth/callback HTTP/1.1",
                "127.0.0.1:53682",
            ),
            head("GET /oauth/callback HTTP/2", "127.0.0.1:53682"),
            head("GET  /oauth/callback HTTP/1.1", "127.0.0.1:53682"),
            head("GET /oauth/callback HTTP/1.1 extra", "127.0.0.1:53682"),
        ] {
            assert!(
                matches!(classify(&request, PORT), LoopbackRequest::Rejected),
                "{request}"
            );
        }
    }

    /// Drives one request through a real 127.0.0.1 socket and returns the raw response.
    fn exchange_over_loopback(request: impl FnOnce(u16) -> String) -> String {
        use std::io::{Read as _, Write as _};

        let (listener, port) = bind().unwrap();
        let mut client = std::net::TcpStream::connect(("127.0.0.1", port)).unwrap();
        client.write_all(request(port).as_bytes()).unwrap();
        tauri::async_runtime::block_on(async move {
            let listener = tokio::net::TcpListener::from_std(listener).unwrap();
            let (mut stream, _) = listener.accept().await.unwrap();
            match read_request(&mut stream, port).await {
                LoopbackRequest::Callback(_) => {
                    redirect(
                        &mut stream,
                        &Url::parse("https://account.gooddealer.test/next").unwrap(),
                    )
                    .await;
                }
                LoopbackRequest::Unrelated => respond(&mut stream, ResultPage::NotFound).await,
                LoopbackRequest::Rejected => respond(&mut stream, ResultPage::BadRequest).await,
            }
        });
        let mut response = String::new();
        client.read_to_string(&mut response).unwrap();
        response
    }

    #[test]
    fn serves_redirects_and_rejections_over_a_real_loopback_socket() {
        let redirected = exchange_over_loopback(|port| {
            format!("GET /oauth/callback?state=s HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n")
        });
        assert!(redirected.starts_with("HTTP/1.1 302 Found\r\n"));
        assert!(redirected.contains("\r\nLocation: https://account.gooddealer.test/next\r\n"));
        assert!(redirected.contains("\r\nCache-Control: no-store\r\n"));

        let favicon = exchange_over_loopback(|port| {
            format!("GET /favicon.ico HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n\r\n")
        });
        assert!(favicon.starts_with("HTTP/1.1 404 Not Found\r\n"));

        let rebound = exchange_over_loopback(|_| {
            "GET /oauth/callback?state=s HTTP/1.1\r\nHost: attacker.example\r\n\r\n".to_owned()
        });
        assert!(rebound.starts_with("HTTP/1.1 400 Bad Request\r\n"));
        assert!(!rebound.contains("Location:"));
    }

    #[test]
    fn result_pages_are_static_and_script_free() {
        for (page, expected) in [
            (ResultPage::SignedIn, "200 OK"),
            (ResultPage::Failed, "400 Bad Request"),
            (ResultPage::Retry, "503 Service Unavailable"),
            (ResultPage::NotFound, "404 Not Found"),
            (ResultPage::BadRequest, "400 Bad Request"),
        ] {
            let (status, html) = render(page);
            assert_eq!(status, expected);
            assert!(!html.contains("<script"));
            assert!(!html.contains("<a "));
            assert!(html.contains("<svg"));
        }
        assert!(common_headers().contains("default-src 'none'"));
        assert!(common_headers().contains("Cache-Control: no-store"));
    }
}
