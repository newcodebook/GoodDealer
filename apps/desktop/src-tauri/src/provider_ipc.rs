//! Bounded, duplicate-key-rejecting raw Provider command decoding.

use std::collections::HashSet;

use serde::de::{DeserializeOwned, Deserializer, Error as _, MapAccess, SeqAccess, Visitor};
use serde_json::{Map, Value};
use tauri::ipc::{InvokeBody, Request};

pub(crate) fn decode_provider_request<T: DeserializeOwned>(
    request: &Request<'_>,
    maximum_wire_bytes: usize,
) -> Result<T, String> {
    decode_provider_body(request.body(), maximum_wire_bytes)
}

fn decode_provider_body<T: DeserializeOwned>(
    body: &InvokeBody,
    maximum_wire_bytes: usize,
) -> Result<T, String> {
    let InvokeBody::Raw(wire) = body else {
        return Err(input_rejected());
    };
    if maximum_wire_bytes == 0 || !(1..=maximum_wire_bytes).contains(&wire.len()) {
        return Err(input_rejected());
    }
    let mut deserializer = serde_json::Deserializer::from_slice(wire);
    let value = deserializer
        .deserialize_any(UniqueValueVisitor)
        .map_err(|_| input_rejected())?;
    deserializer.end().map_err(|_| input_rejected())?;
    serde_json::from_value(value).map_err(|_| input_rejected())
}

struct UniqueValueVisitor;

impl<'de> Visitor<'de> for UniqueValueVisitor {
    type Value = Value;

    fn expecting(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("bounded JSON without duplicate object keys")
    }

    fn visit_bool<E: serde::de::Error>(self, value: bool) -> Result<Self::Value, E> {
        Ok(Value::Bool(value))
    }

    fn visit_i64<E: serde::de::Error>(self, value: i64) -> Result<Self::Value, E> {
        Ok(Value::from(value))
    }

    fn visit_u64<E: serde::de::Error>(self, value: u64) -> Result<Self::Value, E> {
        Ok(Value::from(value))
    }

    fn visit_f64<E: serde::de::Error>(self, value: f64) -> Result<Self::Value, E> {
        serde_json::Number::from_f64(value)
            .map(Value::Number)
            .ok_or_else(|| E::custom("non-finite number"))
    }

    fn visit_str<E: serde::de::Error>(self, value: &str) -> Result<Self::Value, E> {
        Ok(Value::String(value.to_owned()))
    }

    fn visit_string<E: serde::de::Error>(self, value: String) -> Result<Self::Value, E> {
        Ok(Value::String(value))
    }

    fn visit_none<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_unit<E: serde::de::Error>(self) -> Result<Self::Value, E> {
        Ok(Value::Null)
    }

    fn visit_some<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(Self)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut sequence: A) -> Result<Self::Value, A::Error> {
        let mut values = Vec::new();
        while let Some(value) = sequence.next_element_seed(UniqueValueSeed)? {
            values.push(value);
        }
        Ok(Value::Array(values))
    }

    fn visit_map<A: MapAccess<'de>>(self, mut object: A) -> Result<Self::Value, A::Error> {
        let mut values = Map::new();
        let mut keys = HashSet::new();
        while let Some(key) = object.next_key::<String>()? {
            if !keys.insert(key.clone()) {
                return Err(A::Error::custom("duplicate object key"));
            }
            let value = object.next_value_seed(UniqueValueSeed)?;
            values.insert(key, value);
        }
        Ok(Value::Object(values))
    }
}

struct UniqueValueSeed;

impl<'de> serde::de::DeserializeSeed<'de> for UniqueValueSeed {
    type Value = Value;

    fn deserialize<D: Deserializer<'de>>(self, deserializer: D) -> Result<Self::Value, D::Error> {
        deserializer.deserialize_any(UniqueValueVisitor)
    }
}

fn input_rejected() -> String {
    "CLOUDFLARE_INPUT_REJECTED".to_owned()
}

#[cfg(test)]
mod tests {
    use serde::Deserialize;

    use super::*;

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RequestFixture {
        schema_version: u8,
        connection_id: String,
    }

    #[derive(Debug, Deserialize, PartialEq, Eq)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct ObservationReadFixture {
        schema_version: u8,
        entity_id: String,
    }

    #[test]
    fn raw_provider_json_is_bounded_and_strict_before_deserialization() {
        let valid = br#"{"schemaVersion":1,"connectionId":"connection-1"}"#.to_vec();
        assert_eq!(
            decode_provider_body::<RequestFixture>(&InvokeBody::Raw(valid), 512).unwrap(),
            RequestFixture {
                schema_version: 1,
                connection_id: "connection-1".to_owned()
            }
        );
        for invalid in [
            br#"{"schemaVersion":1,"connectionId":"a","connectionId":"b"}"#.to_vec(),
            br#"{"schemaVersion":1,"connectionId":"a","generation":7}"#.to_vec(),
            br#"{"connectionId":"a"}"#.to_vec(),
            vec![b'x'; 513],
        ] {
            assert_eq!(
                decode_provider_body::<RequestFixture>(&InvokeBody::Raw(invalid), 512),
                Err("CLOUDFLARE_INPUT_REJECTED".to_owned())
            );
        }
        assert_eq!(
            decode_provider_body::<RequestFixture>(
                &InvokeBody::Json(serde_json::json!({
                    "schemaVersion": 1, "connectionId": "connection-1"
                })),
                512
            ),
            Err("CLOUDFLARE_INPUT_REJECTED".to_owned())
        );
    }

    #[test]
    fn observation_read_rejects_duplicate_unknown_oversize_and_json_body() {
        let valid = br#"{"schemaVersion":1,"entityId":"example.com"}"#.to_vec();
        assert!(
            decode_provider_body::<ObservationReadFixture>(&InvokeBody::Raw(valid), 1_024).is_ok()
        );
        for invalid in [
            br#"{"schemaVersion":1,"entityId":"a.com","entityId":"b.com"}"#.to_vec(),
            br#"{"schemaVersion":1,"entityId":"a.com","token":"secret"}"#.to_vec(),
            vec![b'x'; 1_025],
        ] {
            assert!(
                decode_provider_body::<ObservationReadFixture>(&InvokeBody::Raw(invalid), 1_024)
                    .is_err()
            );
        }
        assert!(
            decode_provider_body::<ObservationReadFixture>(
                &InvokeBody::Json(serde_json::json!({"schemaVersion":1,"entityId":"example.com"})),
                1_024
            )
            .is_err()
        );
    }
}
