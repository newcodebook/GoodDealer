use std::fmt::Write as _;

use zeroize::Zeroizing;

pub(crate) fn raw_key_hex(key: &[u8; 32]) -> Zeroizing<String> {
    let mut key_hex = Zeroizing::new(String::with_capacity(64));
    for byte in key {
        write!(&mut key_hex, "{byte:02x}").expect("writing into a String cannot fail");
    }
    key_hex
}

pub(crate) fn key_pragma(key: &[u8; 32]) -> Zeroizing<String> {
    let key_hex = raw_key_hex(key);
    Zeroizing::new(format!("PRAGMA key = \"x'{}'\";", key_hex.as_str()))
}
