use super::*;
use serde_json::json;

pub(crate) fn request_view(id: &str, state: &str) -> Value {
    json!({"schemaVersion":2,"requestId":id,"mode":"normal","status":state,
        "fromDeviceId":"source-device","toDeviceId":"device-local","requestedAt":"2026-11-19T00:00:00Z",
        "earliestTakeoverAt":null,"bootstrapExpiresAt":if state == "bootstrapping" {Some("2099-12-31T23:59:59Z")} else {None},
        "normalHandoffReceipt":null})
}
fn encode(value: &Value) -> Vec<u8> {
    serde_json::to_vec(value).unwrap()
}
#[test]
fn target_status_accepts_only_bound_target_and_exact_current_workflow() {
    let good = json!({"schemaVersion":1,"found":true,"request":request_view("switch-one", "bootstrapping")});
    assert!(status(&encode(&good), "device-local", None).is_ok());
    assert!(status(&encode(&good), "other-device", None).is_err());
    assert!(status(&encode(&good), "device-local", Some("switch-other")).is_err());
    for state in ["cancelled", "completed", "failed"] {
        let answer =
            json!({"schemaVersion":1,"found":true,"request":request_view("switch-one", state)});
        assert!(status(&encode(&answer), "device-local", Some("switch-one")).is_ok());
        assert!(status(&encode(&answer), "device-local", None).is_err());
    }
}
#[test]
fn target_wire_rejects_missing_extra_duplicate_and_inconsistent_fields() {
    let good = json!({"schemaVersion":1,"found":true,"request":request_view("switch-one", "bootstrapping")});
    for key in good["request"].as_object().unwrap().keys() {
        let mut invalid = good.clone();
        invalid["request"].as_object_mut().unwrap().remove(key);
        assert!(
            status(&encode(&invalid), "device-local", None).is_err(),
            "missing {key}"
        );
    }
    for (key, value) in [
        ("schemaVersion", json!(1)),
        ("mode", json!("other")),
        ("status", json!("requested")),
        ("status", json!("unknown")),
        ("bootstrapExpiresAt", Value::Null),
        ("requestedAt", json!("2026-02-30T00:00:00Z")),
        ("mode", json!("forced")),
        ("earliestTakeoverAt", json!("2020-01-01T00:00:00Z")),
        ("extra", json!(true)),
    ] {
        let mut invalid = good.clone();
        invalid["request"][key] = value;
        assert!(
            status(&encode(&invalid), "device-local", None).is_err(),
            "invalid {key}"
        );
    }
    assert!(
        status(
            br#"{"schemaVersion":1,"found":false,"found":false}"#,
            "device-local",
            None
        )
        .is_err()
    );
    assert!(
        status(
            br#"{"schemaVersion":1,"found":false,"request":null}"#,
            "device-local",
            None
        )
        .is_err()
    );
    assert!(status(&vec![b' '; 8193], "device-local", None).is_err());
}
#[test]
fn target_receipt_validates_epoch_time_mode_and_distinct_source() {
    let mut good = json!({"schemaVersion":1,"found":true,"request":request_view("switch-one", "bootstrapping")});
    good["request"]["normalHandoffReceipt"] = json!({"sourceLeaseEpoch":7,"proofId":"proof-one","proofDigest":"A".repeat(43),"releasedAt":"2026-11-19T00:00:00Z"});
    assert!(status(&encode(&good), "device-local", None).is_ok());
    for (key, value) in [
        ("sourceLeaseEpoch", json!(0)),
        ("sourceLeaseEpoch", json!(9_007_199_254_740_992_u64)),
        ("proofDigest", json!("bad")),
        ("releasedAt", json!("2020-01-01T00:00:00Z")),
        ("extra", json!(true)),
    ] {
        let mut invalid = good.clone();
        invalid["request"]["normalHandoffReceipt"][key] = value;
        assert!(status(&encode(&invalid), "device-local", None).is_err());
    }
    for source in [Value::Null, json!("device-local")] {
        let mut invalid = good.clone();
        invalid["request"]["fromDeviceId"] = source;
        assert!(status(&encode(&invalid), "device-local", None).is_err());
    }
    good["request"]["mode"] = json!("forced");
    good["request"]["earliestTakeoverAt"] = json!("2026-11-20T00:00:00Z");
    assert!(status(&encode(&good), "device-local", None).is_err());
}
#[test]
fn cancellation_accepts_only_closed_rejection_or_exact_terminal() {
    let rejected = json!({"schemaVersion":1,"accepted":false,"code":"SWITCH_NOT_CANCELLABLE"});
    assert_eq!(
        cancel(&encode(&rejected), "device-local", "switch-one").unwrap(),
        None
    );
    assert!(
        cancel(
            br#"{"schemaVersion":1,"accepted":false,"code":"UNKNOWN"}"#,
            "device-local",
            "switch-one"
        )
        .is_err()
    );
    for state in ["cancelled", "completed", "failed", "bootstrapping"] {
        let answer =
            json!({"schemaVersion":1,"accepted":true,"request":request_view("switch-one", state)});
        assert_eq!(
            cancel(&encode(&answer), "device-local", "switch-one").is_ok(),
            state != "bootstrapping"
        );
        assert!(cancel(&encode(&answer), "device-local", "other").is_err());
    }
}
