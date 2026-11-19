use super::*;
use serde_json::{Value, json};
use std::{
    collections::VecDeque,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
};

type Sent = Arc<Mutex<Vec<(Method, String, Option<Value>)>>>;
struct Scripted {
    replies: VecDeque<Result<Response, AfternicError>>,
    sent: Sent,
    revoke: Option<Arc<AtomicBool>>,
}
impl Transport for Scripted {
    fn send<'a>(
        &'a mut self,
        request: Request,
        credential: &'a AfternicCredential,
        guard: &'a mut AfternicGuard<'_>,
    ) -> ResponseFuture<'a> {
        Box::pin(async move {
            guard()?;
            assert!(credential.authorization().starts_with("sso-key "));
            self.sent.lock().unwrap().push((
                request.method,
                request.path,
                request.body.map(|b| serde_json::from_slice(&b).unwrap()),
            ));
            if let Some(revoke) = &self.revoke {
                revoke.store(true, Ordering::SeqCst);
            }
            self.replies.pop_front().expect("scripted response")
        })
    }
}
fn client(replies: Vec<Result<Response, AfternicError>>) -> (AfternicProviderClient, Sent) {
    let sent = Arc::new(Mutex::new(Vec::new()));
    (
        AfternicProviderClient {
            transport: Box::new(Scripted {
                replies: replies.into(),
                sent: sent.clone(),
                revoke: None,
            }),
        },
        sent,
    )
}
fn credential() -> AfternicCredential {
    crate::afternic_credentials::parse_capture(
        b"fake-key-for-unit-tests\nfake-secret-for-unit-tests\n",
    )
    .unwrap()
}
fn listing(domain: &str) -> Value {
    json!({"name":domain,"createdAt":"2026-11-18T00:00:00Z","updatedAt":"2026-11-18T00:00:01Z","listStatus":"ACTIVE","buynowPrice":1_000_000_000,"floorPrice":900_000_000,"minbidPrice":20_000_000,"hidden":false})
}
#[expect(
    clippy::needless_pass_by_value,
    clippy::unnecessary_wraps,
    reason = "scripted transport fixtures pair owned JSON values with both successful and failed replies"
)]
fn response(status: u16, value: Value) -> Result<Response, AfternicError> {
    Ok(Response {
        retry_after: None,
        status,
        body: serde_json::to_vec(&value).unwrap(),
    })
}

#[tokio::test]
async fn scan_returns_only_a_complete_ordered_portfolio_on_fixed_my_paths() {
    let first = (0..50)
        .map(|i| listing(&format!("a{i:02}.test")))
        .collect::<Vec<_>>();
    let second = vec![listing("z.test")];
    let (mut client, sent) = client(vec![
        response(
            200,
            json!({"domains":first,"pagination":{"total":51,"next":format!("{ORIGIN}{DOMAIN_PATH}?offset=50&limit=50&order=NAME_ASC")}}),
        ),
        response(200, json!({"domains":second,"pagination":{"total":51}})),
    ]);
    let portfolio = client.scan(&credential(), &mut || Ok(())).await.unwrap();
    assert_eq!(portfolio.listings.len(), 51);
    let sent = sent.lock().unwrap();
    assert_eq!(sent[0].0, Method::GET);
    assert_eq!(
        sent[0].1,
        format!("{DOMAIN_PATH}?offset=0&limit=50&order=NAME_ASC")
    );
    assert_eq!(
        sent[1].1,
        format!("{DOMAIN_PATH}?offset=50&limit=50&order=NAME_ASC")
    );
}
#[tokio::test]
async fn hostile_pagination_never_controls_the_next_request() {
    let first = (0..50)
        .map(|i| listing(&format!("a{i:02}.test")))
        .collect::<Vec<_>>();
    for next in [
        "https://evil.test/v3/aftermarket/customers/my/domains?offset=50&limit=50&order=NAME_ASC"
            .to_owned(),
        format!(
            "{ORIGIN}/v3/aftermarket/customers/other/domains?offset=50&limit=50&order=NAME_ASC"
        ),
        format!("{DOMAIN_PATH}?offset=0&limit=50&order=NAME_ASC"),
        format!("{DOMAIN_PATH}?offset=50&limit=50&order=NAME_ASC&offset=50"),
        format!("{DOMAIN_PATH}?offset=50&limit=50&order=NAME_ASC#fragment"),
    ] {
        let (mut client, sent) = client(vec![response(
            200,
            json!({"domains":first,"pagination":{"total":51,"next":next}}),
        )]);
        assert_eq!(
            client
                .scan(&credential(), &mut || Ok(()))
                .await
                .unwrap_err(),
            AfternicError::ProtocolRejected
        );
        assert_eq!(sent.lock().unwrap().len(), 1);
    }
}
#[tokio::test]
async fn incomplete_duplicate_and_changing_scans_are_not_asset_absence() {
    for wire in [
        json!({"domains":[listing("a.test")],"pagination":{"total":2}}),
        json!({"domains":[listing("a.test"),listing("a.test")],"pagination":{"total":2}}),
        json!({"domains":[],"pagination":{}}),
    ] {
        let (mut client, _) = client(vec![response(200, wire)]);
        assert!(client.scan(&credential(), &mut || Ok(())).await.is_err());
    }
    let first = (0..50)
        .map(|i| listing(&format!("a{i:02}.test")))
        .collect::<Vec<_>>();
    let (mut client, _) = client(vec![
        response(
            200,
            json!({"domains":first,"pagination":{"total":51,"next":format!("{DOMAIN_PATH}?offset=50&limit=50&order=NAME_ASC")}}),
        ),
        response(
            200,
            json!({"domains":[listing("z.test"),listing("zz.test")],"pagination":{"total":52}}),
        ),
    ]);
    assert_eq!(
        client
            .scan(&credential(), &mut || Ok(()))
            .await
            .unwrap_err(),
        AfternicError::ProtocolRejected
    );
}
#[tokio::test]
async fn observe_matches_exact_domains_and_only_resource_not_found_means_absent() {
    let (mut c, _) = client(vec![
        response(200, listing("a.test")),
        response(404, json!({"code":"RESOURCE_NOT_FOUND"})),
    ]);
    let values = c
        .observe(
            &credential(),
            &["a.test".to_owned(), "b.test".to_owned()],
            &mut || Ok(()),
        )
        .await
        .unwrap();
    assert!(values[0].listing.is_some());
    assert!(values[1].listing.is_none());
    for answer in [
        response(404, json!({"code":"CUSTOMER_NOT_FOUND"})),
        response(200, listing("other.test")),
    ] {
        let (mut c, _) = client(vec![answer]);
        assert!(
            c.observe(&credential(), &["a.test".to_owned()], &mut || Ok(()))
                .await
                .is_err()
        );
    }
    let (mut c, sent) = client(vec![]);
    assert!(
        c.observe(
            &credential(),
            &["a.test".to_owned(), "a.test".to_owned()],
            &mut || Ok(())
        )
        .await
        .is_err()
    );
    assert!(sent.lock().unwrap().is_empty());
}
#[test]
fn strict_responses_reject_missing_duplicate_unknown_null_fractional_and_invalid_fields() {
    let valid = listing("a.test");
    for (key, value) in [
        ("listStatus", json!("FUTURE_UNKNOWN")),
        ("buynowPrice", json!(1.25)),
        ("floorPrice", json!(null)),
        ("minbidPrice", json!(1_000_000)),
        ("extra", json!(true)),
        ("updatedAt", json!("2026-02-30T12:00:00Z")),
        ("createdAt", json!("2026-+1-+1T+1:+1:+1Z")),
        ("updatedAt", json!("2026-11-18T00:00:+1Z")),
        ("hidden", json!("false")),
    ] {
        let mut wire = valid.clone();
        wire[key] = value;
        assert!(
            afternic_wire::parse_listing(&serde_json::to_vec(&wire).unwrap()).is_err(),
            "{key}"
        );
    }
    let mut missing = valid.clone();
    missing.as_object_mut().unwrap().remove("createdAt");
    assert!(afternic_wire::parse_listing(&serde_json::to_vec(&missing).unwrap()).is_err());
    let duplicate =
        serde_json::to_string(&valid)
            .unwrap()
            .replacen('{', "{\"name\":\"other.test\",", 1);
    assert!(afternic_wire::parse_listing(duplicate.as_bytes()).is_err());
}
#[tokio::test]
async fn writes_are_per_domain_and_patch_contains_only_approved_fields() {
    let fields = AfternicListingFields {
        buynow_price: Some(1_000_000_000),
        ..Default::default()
    };
    let (mut c, sent) = client(vec![
        response(201, listing("a.test")),
        response(200, listing("a.test")),
        Ok(Response {
            retry_after: None,
            status: 204,
            body: vec![],
        }),
    ]);
    for intent in [
        AfternicListingIntent::Create {
            domain: "a.test".into(),
            fields: fields.clone(),
        },
        AfternicListingIntent::Update {
            domain: "a.test".into(),
            fields,
        },
        AfternicListingIntent::Remove {
            domain: "a.test".into(),
        },
    ] {
        assert_eq!(
            c.execute(&credential(), &intent, &mut || Ok(())).await,
            Ok(AfternicWriteOutcome::AcceptedPendingVerification)
        );
    }
    let sent = sent.lock().unwrap();
    assert_eq!(sent[0].0, Method::POST);
    assert_eq!(sent[0].1, DOMAIN_PATH);
    assert_eq!(
        sent[0].2,
        Some(json!({"name":"a.test","buynowPrice":1_000_000_000}))
    );
    assert_eq!(sent[1].0, Method::PATCH);
    assert_eq!(sent[1].2, Some(json!({"buynowPrice":1_000_000_000})));
    assert_eq!(sent[2].0, Method::DELETE);
    assert!(sent[2].2.is_none());
}
#[tokio::test]
async fn uncertain_write_outcomes_never_retry_and_do_not_become_success() {
    for answer in [
        Err(AfternicError::OutcomeUnknown),
        response(503, json!({"code":"DEPENDENCY_ISSUE"})),
        response(200, listing("other.test")),
        Ok(Response {
            retry_after: None,
            status: 204,
            body: b"unexpected".to_vec(),
        }),
    ] {
        let (mut c, sent) = client(vec![answer]);
        let intent = AfternicListingIntent::Update {
            domain: "a.test".into(),
            fields: AfternicListingFields {
                hidden: Some(true),
                ..Default::default()
            },
        };
        assert_eq!(
            c.execute(&credential(), &intent, &mut || Ok(())).await,
            Err(AfternicError::OutcomeUnknown)
        );
        assert_eq!(sent.lock().unwrap().len(), 1);
    }
}
#[tokio::test]
async fn authority_change_after_send_discards_read_and_marks_mutation_unknown() {
    for mutation in [false, true] {
        let revoked = Arc::new(AtomicBool::new(false));
        let sent = Arc::new(Mutex::new(Vec::new()));
        let mut c = AfternicProviderClient {
            transport: Box::new(Scripted {
                replies: vec![response(200, listing("a.test"))].into(),
                sent: sent.clone(),
                revoke: Some(revoked.clone()),
            }),
        };
        let mut guard = || {
            if revoked.load(Ordering::SeqCst) {
                Err(AfternicError::AuthorityStale)
            } else {
                Ok(())
            }
        };
        let result = if mutation {
            c.execute(
                &credential(),
                &AfternicListingIntent::Remove {
                    domain: "a.test".into(),
                },
                &mut guard,
            )
            .await
            .map(|_| ())
        } else {
            c.observe(&credential(), &["a.test".into()], &mut guard)
                .await
                .map(|_| ())
        };
        assert_eq!(
            result,
            Err(if mutation {
                AfternicError::OutcomeUnknown
            } else {
                AfternicError::AuthorityStale
            })
        );
        assert_eq!(sent.lock().unwrap().len(), 1);
    }
}
#[test]
fn statuses_prices_domains_and_protocol_statuses_are_closed() {
    for (status, expected) in [
        (401, AfternicError::AuthenticationRequired),
        (403, AfternicError::Forbidden),
        (422, AfternicError::Rejected),
        (500, AfternicError::OutcomeUnknown),
    ] {
        assert_eq!(
            require_status(
                &Response {
                    retry_after: None,
                    status,
                    body: vec![]
                },
                &[200],
                true
            ),
            Err(expected)
        );
    }
    assert_eq!(
        require_status(
            &Response {
                retry_after: None,
                status: 429,
                body: br#"{"code":"RATE_LIMITED","retryAfterSec":123}"#.to_vec()
            },
            &[200],
            true
        ),
        Err(AfternicError::RateLimited {
            retry_after_seconds: 123
        })
    );
    for domain in [
        "A.test",
        "a.test/path",
        "a.test?x=1",
        "a..test",
        "-a.test",
        "a.t",
        "127.0.0.1",
    ] {
        assert!(!valid_domain(domain), "{domain}");
    }
    for value in [1, MAX_PRICE + 1, MAX_PRICE + 1_000_000] {
        assert!(!valid_price(value, false));
    }
    assert!(valid_price(MAX_PRICE, false));
}

#[tokio::test]
#[expect(
    clippy::too_many_lines,
    reason = "the local TLS server and all observed requests form one transport acceptance scenario"
)]
async fn fixed_https_transport_sends_real_requests_and_never_replays_an_uncertain_patch() {
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio_rustls::{
        TlsAcceptor,
        rustls::{ServerConfig, pki_types::PrivatePkcs8KeyDer},
    };
    let certified =
        rcgen::generate_simple_self_signed(vec!["api.afternic.com".to_owned()]).unwrap();
    let root = reqwest::Certificate::from_der(certified.cert.der().as_ref()).unwrap();
    let configuration = ServerConfig::builder()
        .with_no_client_auth()
        .with_single_cert(
            vec![certified.cert.der().clone()],
            PrivatePkcs8KeyDer::from(certified.signing_key.serialize_der()).into(),
        )
        .unwrap();
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = listener.local_addr().unwrap();
    let acceptor = TlsAcceptor::from(Arc::new(configuration));
    let server = tokio::spawn(async move {
        let mut requests = Vec::new();
        for (status, extra_headers, body) in [
            (
                "200 OK",
                "Content-Type: application/json\r\n",
                listing("a.test").to_string(),
            ),
            (
                "503 Service Unavailable",
                "Content-Type: text/plain\r\n",
                "upstream response lost".to_owned(),
            ),
            (
                "429 Too Many Requests",
                "Retry-After: 180\r\n",
                String::new(),
            ),
        ] {
            let (socket, _) = listener.accept().await.unwrap();
            let mut stream = acceptor.accept(socket).await.unwrap();
            let mut request = Vec::new();
            let mut chunk = [0; 4096];
            loop {
                let read = stream.read(&mut chunk).await.unwrap();
                assert!(read > 0);
                request.extend_from_slice(&chunk[..read]);
                assert!(request.len() < 8192);
                if let Some(end) = request.windows(4).position(|b| b == b"\r\n\r\n") {
                    let headers = std::str::from_utf8(&request[..end]).unwrap();
                    let length = headers
                        .lines()
                        .find_map(|line| line.strip_prefix("content-length: "))
                        .map_or(0, |v| v.parse::<usize>().unwrap());
                    if request.len() == end + 4 + length {
                        break;
                    }
                }
            }
            requests.push(String::from_utf8(request).unwrap());
            stream.write_all(format!("HTTP/1.1 {status}\r\n{extra_headers}Content-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).as_bytes()).await.unwrap();
            stream.shutdown().await.unwrap();
        }
        requests
    });
    let http = http_client_builder()
        .timeout(Duration::from_secs(5))
        .add_root_certificate(root)
        .resolve("api.afternic.com", address)
        .build()
        .unwrap();
    let mut client = AfternicProviderClient {
        transport: Box::new(HttpTransport { client: http }),
    };
    let observed = client
        .observe(&credential(), &["a.test".into()], &mut || Ok(()))
        .await
        .unwrap();
    assert_eq!(observed[0].listing.as_ref().unwrap().domain, "a.test");
    let outcome = client
        .execute(
            &credential(),
            &AfternicListingIntent::Update {
                domain: "a.test".into(),
                fields: AfternicListingFields {
                    hidden: Some(true),
                    ..Default::default()
                },
            },
            &mut || Ok(()),
        )
        .await;
    assert_eq!(outcome, Err(AfternicError::OutcomeUnknown));
    assert_eq!(
        client
            .observe(&credential(), &["a.test".into()], &mut || Ok(()))
            .await,
        Err(AfternicError::RateLimited {
            retry_after_seconds: 180
        })
    );
    let requests = server.await.unwrap();
    assert_eq!(requests.len(), 3);
    assert!(requests[0].starts_with(&format!("GET {DOMAIN_PATH}/a.test HTTP/1.1\r\n")));
    assert!(requests[1].starts_with(&format!(
        "PATCH {DOMAIN_PATH}/a.test?resource=true HTTP/1.1\r\n"
    )));
    assert!(requests[1].ends_with("{\"hidden\":true}"));
    assert!(requests.iter().all(|wire| wire.contains(
        "authorization: sso-key fake-key-for-unit-tests:fake-secret-for-unit-tests\r\n"
    ) && wire.contains("user-agent: GoodDealer/")));
}

#[test]
fn rate_limit_hints_are_bounded_and_never_shortened_or_silently_ignored() {
    let mut headers = header::HeaderMap::new();
    assert_eq!(retry_after_header(&headers).unwrap(), None);
    for (value, seconds) in [
        ("0", 1),
        ("180", 180),
        ("86401", 86401),
        ("4294967295", u32::MAX),
    ] {
        headers.insert(header::RETRY_AFTER, value.parse().unwrap());
        assert_eq!(retry_after_header(&headers).unwrap(), Some(seconds));
        assert_eq!(
            require_status(
                &Response {
                    status: 429,
                    retry_after: Some(seconds),
                    body: Vec::new()
                },
                &[200],
                false
            ),
            Err(AfternicError::RateLimited {
                retry_after_seconds: seconds
            })
        );
    }
    for value in [
        "",
        "+1",
        "1.0",
        "4294967296",
        "Wed, 21 Oct 2099 07:28:00 GMT",
    ] {
        headers.insert(header::RETRY_AFTER, value.parse().unwrap());
        assert_eq!(
            retry_after_header(&headers),
            Err(AfternicError::ProtocolRejected)
        );
    }
    headers.insert(header::RETRY_AFTER, "10".parse().unwrap());
    headers.append(header::RETRY_AFTER, "30".parse().unwrap());
    assert_eq!(
        retry_after_header(&headers),
        Err(AfternicError::ProtocolRejected)
    );
    for (header_seconds, body_seconds, expected) in
        [(90, 180, 180), (180, 90, 180), (60, 86401, 86401)]
    {
        let response = Response {
            status: 429,
            retry_after: Some(header_seconds),
            body: serde_json::to_vec(&json!({"code":"RATE_LIMITED","retryAfterSec":body_seconds}))
                .unwrap(),
        };
        assert_eq!(
            require_status(&response, &[200], false),
            Err(AfternicError::RateLimited {
                retry_after_seconds: expected
            })
        );
    }
    let malformed = Response {
        status: 429,
        retry_after: None,
        body: br#"{"code":"RATE_LIMITED","retryAfterSec":4294967296}"#.to_vec(),
    };
    assert_eq!(
        require_status(&malformed, &[200], false),
        Err(AfternicError::ProtocolRejected)
    );
}
