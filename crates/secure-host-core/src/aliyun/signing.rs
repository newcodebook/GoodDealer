use super::{AliyunCredential, AliyunError, DOMAIN_HOST};
use reqwest::header::{self, HeaderMap, HeaderValue};
use ring::hmac;
use sha2::{Digest, Sha256};
use std::fmt::Write as _;
use zeroize::Zeroizing;

const ALGORITHM: &str = "ACS3-HMAC-SHA256";
const EMPTY_PAYLOAD_SHA256: &str =
    "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
const SIGNED_HEADERS: &str =
    "host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version";

pub(super) struct SignedRequest<'a> {
    host: &'a str,
    action: &'a str,
    version: &'a str,
    query: &'a str,
    date: &'a str,
    nonce: &'a str,
}

impl<'a> SignedRequest<'a> {
    pub(super) const fn query_domain_list(query: &'a str, date: &'a str, nonce: &'a str) -> Self {
        Self {
            host: DOMAIN_HOST,
            action: "QueryDomainList",
            version: "2018-01-29",
            query,
            date,
            nonce,
        }
    }

    fn string_to_sign(&self) -> String {
        // Header order is both ASCII order and the exact order in SignedHeaders. The query is
        // constructed from numeric PageNum/PageSize, so no untrusted URI data is signed.
        let canonical = format!(
            "POST\n/\n{}\nhost:{}\nx-acs-action:{}\nx-acs-content-sha256:{EMPTY_PAYLOAD_SHA256}\nx-acs-date:{}\nx-acs-signature-nonce:{}\nx-acs-version:{}\n\n{SIGNED_HEADERS}\n{EMPTY_PAYLOAD_SHA256}",
            self.query, self.host, self.action, self.date, self.nonce, self.version
        );
        format!(
            "{ALGORITHM}\n{}",
            lower_hex(&Sha256::digest(canonical.as_bytes()))
        )
    }

    pub(super) fn headers(&self, credential: &AliyunCredential) -> Result<HeaderMap, AliyunError> {
        let key = hmac::Key::new(hmac::HMAC_SHA256, credential.secret.as_bytes());
        let signature = hmac::sign(&key, self.string_to_sign().as_bytes());
        let signature = Zeroizing::new(lower_hex(signature.as_ref()));
        let authorization = Zeroizing::new(format!(
            "{ALGORITHM} Credential={},SignedHeaders={SIGNED_HEADERS},Signature={}",
            *credential.key, *signature
        ));
        let invalid = |_| AliyunError::InputRejected;
        let mut authorization = HeaderValue::from_str(&authorization).map_err(invalid)?;
        authorization.set_sensitive(true);
        let mut headers = HeaderMap::with_capacity(7);
        for (name, value) in [
            ("host", self.host),
            ("x-acs-action", self.action),
            ("x-acs-content-sha256", EMPTY_PAYLOAD_SHA256),
            ("x-acs-date", self.date),
            ("x-acs-signature-nonce", self.nonce),
            ("x-acs-version", self.version),
        ] {
            headers.insert(name, HeaderValue::from_str(value).map_err(invalid)?);
        }
        headers.insert(header::AUTHORIZATION, authorization);
        Ok(headers)
    }
}

pub(super) fn lower_hex(bytes: &[u8]) -> String {
    let mut output = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        write!(output, "{byte:02x}").expect("writing into String succeeds");
    }
    output
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn canonical_request_matches_alibaba_cloud_acs3_reference() {
        let example = SignedRequest {
            host: "ecs.cn-shanghai.aliyuncs.com",
            action: "RunInstances",
            version: "2014-05-26",
            query: "ImageId=win2019_1809_x64_dtc_zh-cn_40G_alibase_20230811.vhd&RegionId=cn-shanghai",
            date: "2023-10-26T10:22:32Z",
            nonce: "3156853299f313e23d1673dc12e1703d",
        };
        assert_eq!(
            example.string_to_sign(),
            "ACS3-HMAC-SHA256\n7ea06492da5221eba5297e897ce16e55f964061054b7695beedaac1145b1e259"
        );
        let fixture = AliyunCredential {
            key: Zeroizing::new("YourAccessKeyId".to_owned()),
            secret: Zeroizing::new("YourAccessKeySecret".to_owned()),
        };
        assert_eq!(
            example.headers(&fixture).unwrap()[header::AUTHORIZATION],
            "ACS3-HMAC-SHA256 Credential=YourAccessKeyId,SignedHeaders=host;x-acs-action;x-acs-content-sha256;x-acs-date;x-acs-signature-nonce;x-acs-version,Signature=06563a9e1b43f5dfe96b81484da74bceab24a1d853912eee15083a6f0f3283c0"
        );
    }
}
