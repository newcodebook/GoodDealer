use gooddealer_secure_host_core::{
    ActiveBackupOperation, BackupArtifactAdmission, BackupExportOperation, BackupOperationError,
    CloudflareContractError, CloudflareDnsRecord, CloudflareObservationError,
    CloudflareObservationErrorCode, CloudflareObservationResult,
    CloudflareObservationSubmitRequest, CloudflareRecordType, CloudflareUnavailableObservationCode,
    CloudflareZoneMetadata, CloudflareZoneReadIntent, CloudflareZoneStatus, SealedBackupFrame,
    SecureHost,
};

fn write_local_container_frame(frame: &SealedBackupFrame, output: &mut Vec<u8>) {
    output.extend_from_slice(frame.nonce());
    output.extend_from_slice(frame.ciphertext());
}

fn write_local_container_key_record(export: &BackupExportOperation<'_>, output: &mut Vec<u8>) {
    output.extend_from_slice(export.wrapped_content_key_bytes());
}

fn name_frozen_types(
    _host: Option<&SecureHost>,
    _operation: Option<&ActiveBackupOperation<'_>>,
    _admission: Option<&BackupArtifactAdmission<'_>>,
    _export: Option<&BackupExportOperation<'_>>,
    _frame: Option<&SealedBackupFrame>,
    _error: Option<BackupOperationError>,
) {
}

fn name_cloudflare_types(
    _cloudflare_intent: Option<&CloudflareZoneReadIntent>,
    _cloudflare_zone: Option<&CloudflareZoneMetadata>,
    _cloudflare_record: Option<&CloudflareDnsRecord>,
    _cloudflare_observation: Option<&CloudflareObservationSubmitRequest>,
    _cloudflare_result: Option<&CloudflareObservationResult>,
    _cloudflare_error: Option<&CloudflareObservationError>,
) {
}

fn name_cloudflare_discriminators(
    _cloudflare_contract_error: Option<&CloudflareContractError>,
    _cloudflare_error_code: Option<CloudflareObservationErrorCode>,
    _cloudflare_record_type: Option<CloudflareRecordType>,
    _cloudflare_zone_status: Option<CloudflareZoneStatus>,
    _cloudflare_unavailable_code: Option<CloudflareUnavailableObservationCode>,
) {
}

#[test]
fn external_consumer_can_compile_a_nonsecret_frame_serializer() {
    let serializer: fn(&SealedBackupFrame, &mut Vec<u8>) = write_local_container_frame;
    assert!(std::mem::size_of_val(&serializer) > 0);
    let key_record_serializer: fn(&BackupExportOperation<'_>, &mut Vec<u8>) =
        write_local_container_key_record;
    assert!(std::mem::size_of_val(&key_record_serializer) > 0);
    name_frozen_types(None, None, None, None, None, None);
    name_cloudflare_types(None, None, None, None, None, None);
    name_cloudflare_discriminators(None, None, None, None, None);
}

#[test]
fn external_consumer_can_only_construct_cloudflare_intent_by_parsing_nonsecret_json() {
    let intent = CloudflareZoneReadIntent::parse_json(
        br#"{"connectionId":"connection-1","zoneId":"0123456789abcdef0123456789abcdef"}"#,
    )
    .expect("valid nonsecret intent");
    assert_eq!(intent.connection_id(), "connection-1");
    assert_eq!(intent.zone_id(), "0123456789abcdef0123456789abcdef");
}
