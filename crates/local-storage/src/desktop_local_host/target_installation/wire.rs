//! Installation wire has secret capability/nonce strings. Every owned value string and transcript
//! buffer is zeroizing, including partially decoded objects rejected by the JSON visitor.
use super::super::DesktopLocalHostError as Error;
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{
    Deserialize, Deserializer, Serialize, Serializer,
    de::{Error as _, MapAccess, SeqAccess, Visitor},
    ser::{SerializeMap, SerializeSeq},
};
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;
use zeroize::Zeroizing;

#[derive(Clone, PartialEq, Eq)]
pub(super) enum Value {
    Null,
    Bool(bool),
    Number(u64),
    String(Zeroizing<String>),
    Array(Vec<Self>),
    Object(BTreeMap<String, Self>),
}
impl Value {
    pub(super) fn object(fields: impl IntoIterator<Item = (&'static str, Self)>) -> Self {
        Self::Object(
            fields
                .into_iter()
                .map(|(key, value)| (key.into(), value))
                .collect(),
        )
    }
    pub(super) fn string(value: &str) -> Self {
        let mut protected = Zeroizing::new(String::with_capacity(value.len()));
        protected.push_str(value);
        Self::String(protected)
    }
    pub(super) fn get(&self, key: &str) -> Result<&Self, Error> {
        match self {
            Self::Object(fields) => fields.get(key).ok_or_else(rejected),
            _ => Err(rejected()),
        }
    }
    pub(super) fn text(&self) -> Result<&str, Error> {
        match self {
            Self::String(value) => Ok(value),
            _ => Err(rejected()),
        }
    }
    pub(super) fn number(&self) -> Result<u64, Error> {
        match self {
            Self::Number(value) => Ok(*value),
            _ => Err(rejected()),
        }
    }
    pub(super) fn array(&self) -> Result<&[Self], Error> {
        match self {
            Self::Array(values) => Ok(values),
            _ => Err(rejected()),
        }
    }
    pub(super) fn shape(&self, required: &[&str], optional: &[&str]) -> Result<(), Error> {
        match self {
            Self::Object(fields)
                if required.iter().all(|key| fields.contains_key(*key))
                    && fields.keys().all(|key| {
                        required.contains(&key.as_str()) || optional.contains(&key.as_str())
                    }) =>
            {
                Ok(())
            }
            _ => Err(rejected()),
        }
    }
    pub(super) fn without(&self, keys: &[&str]) -> Result<Self, Error> {
        match self {
            Self::Object(fields) => Ok(Self::Object(
                fields
                    .iter()
                    .filter(|(key, _)| !keys.contains(&key.as_str()))
                    .map(|(key, value)| (key.clone(), value.clone()))
                    .collect(),
            )),
            _ => Err(rejected()),
        }
    }
    pub(super) fn set(&mut self, key: &str, value: Self) -> Result<(), Error> {
        match self {
            Self::Object(fields) => {
                fields.insert(key.into(), value);
                Ok(())
            }
            _ => Err(rejected()),
        }
    }
    pub(super) fn is_null(&self) -> bool {
        matches!(self, Self::Null)
    }
    pub(super) fn equals_text(&self, text: &str) -> bool {
        self.text() == Ok(text)
    }
    pub(super) fn bytes(&self) -> Result<Zeroizing<Vec<u8>>, Error> {
        let mut bytes = Zeroizing::new(Vec::new());
        serde_json::to_writer(&mut *bytes, self).map_err(|_| rejected())?;
        Ok(bytes)
    }
}
impl Serialize for Value {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Null => serializer.serialize_unit(),
            Self::Bool(value) => serializer.serialize_bool(*value),
            Self::Number(value) => serializer.serialize_u64(*value),
            Self::String(value) => serializer.serialize_str(value),
            Self::Array(values) => {
                let mut sequence = serializer.serialize_seq(Some(values.len()))?;
                for value in values {
                    sequence.serialize_element(value)?;
                }
                sequence.end()
            }
            Self::Object(values) => {
                let mut map = serializer.serialize_map(Some(values.len()))?;
                for (key, value) in values {
                    map.serialize_entry(key, value)?;
                }
                map.end()
            }
        }
    }
}
impl<'de> Deserialize<'de> for Value {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ProtectedVisitor)
    }
}
struct ProtectedVisitor;
impl<'de> Visitor<'de> for ProtectedVisitor {
    type Value = Value;
    fn expecting(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("bounded installation JSON")
    }
    fn visit_unit<E: serde::de::Error>(self) -> Result<Value, E> {
        Ok(Value::Null)
    }
    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Value, E> {
        Ok(Value::Bool(value))
    }
    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Value, E> {
        if value > 9_007_199_254_740_991 {
            return Err(E::custom("invalid integer"));
        }
        Ok(Value::Number(value))
    }
    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Value, E> {
        self.visit_u64(u64::try_from(value).map_err(|_| E::custom("invalid integer"))?)
    }
    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Value, E> {
        Ok(Value::string(value))
    }
    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Value, E> {
        Ok(Value::String(Zeroizing::new(value)))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element::<Value>()? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Value, A::Error> {
        let mut values = BTreeMap::new();
        while let Some(key) = map.next_key::<String>()? {
            if values.contains_key(&key) {
                return Err(A::Error::custom("duplicate field"));
            }
            values.insert(key, map.next_value::<Value>()?);
        }
        Ok(Value::Object(values))
    }
}
pub(super) fn parse(bytes: &[u8], limit: usize) -> Result<Value, Error> {
    if bytes.is_empty() || bytes.len() > limit {
        return Err(rejected());
    }
    serde_json::from_slice(bytes).map_err(|_| rejected())
}
pub(super) fn rejected() -> Error {
    Error::CloudProtocolRejected
}
fn frame(tag: u8, bytes: &[u8]) -> Zeroizing<Vec<u8>> {
    let mut result = Zeroizing::new(Vec::new());
    result.push(tag);
    result.extend_from_slice(bytes.len().to_string().as_bytes());
    result.push(b':');
    result.extend_from_slice(bytes);
    result
}
pub(super) fn canonical(value: &Value) -> Zeroizing<Vec<u8>> {
    match value {
        Value::Null => frame(b'z', b""),
        Value::Bool(value) => frame(b'b', if *value { b"1" } else { b"0" }),
        Value::Number(value) => frame(b'n', value.to_string().as_bytes()),
        Value::String(value) => frame(b's', value.as_bytes()),
        Value::Array(values) => {
            let mut parts = Zeroizing::new(Vec::new());
            for value in values {
                parts.extend_from_slice(&frame(b'e', &canonical(value)));
            }
            frame(b'a', &parts)
        }
        Value::Object(values) => {
            let mut parts = Zeroizing::new(Vec::new());
            for (key, value) in values {
                let mut entry = frame(b'k', key.as_bytes());
                entry.extend_from_slice(&frame(b'v', &canonical(value)));
                parts.extend_from_slice(&frame(b'e', &entry));
            }
            frame(b'o', &parts)
        }
    }
}
pub(super) fn transcript(domain: &str, value: &Value) -> Zeroizing<Vec<u8>> {
    let mut bytes = frame(b'd', domain.as_bytes());
    bytes.extend_from_slice(&frame(b'v', &canonical(value)));
    bytes
}
pub(super) fn digest(domain: &str, value: &Value) -> String {
    URL_SAFE_NO_PAD.encode(Sha256::digest(transcript(domain, value)))
}
pub(super) fn capability_digest(value: &Value) -> String {
    digest("GOODDEALER-BOOTSTRAP-CAPABILITY-SIGNED-ENVELOPE-V1", value)
}
pub(super) fn encoded(value: &Value, length: usize) -> Result<(), Error> {
    let string = value.text()?;
    let bytes = Zeroizing::new(URL_SAFE_NO_PAD.decode(string).map_err(|_| rejected())?);
    if bytes.len() != length || Zeroizing::new(URL_SAFE_NO_PAD.encode(&*bytes)).as_str() != string {
        return Err(rejected());
    }
    Ok(())
}
pub(super) fn id(value: &Value) -> Result<(), Error> {
    crate::desktop_native_cloud::validate_identifier(value.text()?, 160)
}
pub(super) fn positive(value: &Value) -> Result<u64, Error> {
    let number = value.number()?;
    if number == 0 {
        return Err(rejected());
    }
    Ok(number)
}
pub(super) fn utc(value: &Value) -> Result<i64, Error> {
    super::super::authority::parse_canonical_utc(value.text()?).map_err(|_| rejected())
}
pub(super) fn accepted(value: &Value, field: &str) -> Result<(), Error> {
    value.shape(&["schemaVersion", "accepted", field], &[])?;
    if value.get("schemaVersion")?.number() != Ok(1) || value.get("accepted")? != &Value::Bool(true)
    {
        return Err(rejected());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn protected_json_rejects_duplicates_floats_trailing_and_unknown_shape() {
        for wire in [
            r#"{"value":"secret","value":"other"}"#,
            r#"{"value":{"key":1,"key":2}}"#,
            r#"{"value":1.2}"#,
            "{}{}",
            r#"{"value":9007199254740992}"#,
        ] {
            assert!(parse(wire.as_bytes(), 1024).is_err());
        }
        assert!(
            parse(b"{\"value\":null,\"extra\":false}", 1024)
                .unwrap()
                .shape(&["value"], &[])
                .is_err()
        );
    }
    #[test]
    fn canonical_transcripts_match_shared_corpus() {
        let corpus = parse(
            include_bytes!(
                "../../../../../packages/protocol/test-vectors/target-installation/valid.json"
            ),
            1_048_576,
        )
        .unwrap();
        let requests = corpus.get("steps").unwrap().array().unwrap();
        for request in requests {
            let step = request.get("request").unwrap();
            assert_eq!(
                digest(
                    "GOODDEALER-BOOTSTRAP-STEP-REQUEST-V2",
                    &step.without(&["requestDigest", "stepNonce"]).unwrap()
                ),
                step.get("requestDigest").unwrap().text().unwrap()
            );
        }
    }
}
