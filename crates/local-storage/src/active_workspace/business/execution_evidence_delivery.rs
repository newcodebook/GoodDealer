//! Exact immutable source delivery and Cloud receipts share the business database owner.
use super::{BusinessDatabase, BusinessDatabaseError, ExecutionEvidenceContext};
use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use rusqlite::{OptionalExtension, TransactionBehavior, params};
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
type Result<T> = std::result::Result<T, BusinessDatabaseError>;
fn storage(_: rusqlite::Error) -> BusinessDatabaseError {
    BusinessDatabaseError::StorageRejected
}
fn rejected() -> BusinessDatabaseError {
    BusinessDatabaseError::MutationStale
}
fn sql(value: u64) -> Result<i64> {
    i64::try_from(value).map_err(|_| rejected())
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum DesktopExecutionEvidenceStream {
    DeviceAudit,
    ExecutionFact,
}
impl DesktopExecutionEvidenceStream {
    fn name(self) -> &'static str {
        match self {
            Self::DeviceAudit => "device_audit",
            Self::ExecutionFact => "execution_fact",
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DesktopExecutionEvidenceDeliveryOutcome {
    Accepted,
    Quarantined,
    Pending,
}
pub(crate) struct EvidenceUploadSeed {
    pub(crate) stream: DesktopExecutionEvidenceStream,
    pub(crate) request: Vec<u8>,
    workspace: String,
    source: String,
    epoch: i64,
    sequence: i64,
    event_id: String,
    digest: String,
    origin: String,
    generation: i64,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcceptedReceipt {
    schema_version: u8,
    stream: DesktopExecutionEvidenceStream,
    workspace_id: String,
    source_device_id: String,
    active_lease_epoch: u64,
    sequence: u64,
    event_id: String,
    envelope_digest: String,
    received_at: String,
    outcome: AcceptedOutcome,
    classification: Classification,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum AcceptedOutcome {
    Accepted,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum Classification {
    Current,
    Late,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct QuarantinedReceipt {
    schema_version: u8,
    stream: DesktopExecutionEvidenceStream,
    workspace_id: String,
    source_device_id: String,
    active_lease_epoch: u64,
    sequence: u64,
    event_id: String,
    envelope_digest: String,
    received_at: String,
    outcome: QuarantinedOutcome,
    reason: QuarantineReason,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum QuarantinedOutcome {
    Quarantined,
}
#[derive(Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
enum QuarantineReason {
    Signature,
    EpochUnknown,
    TimeUnprovable,
    Authorization,
    SequenceReplay,
    DrainSealViolation,
    RemovalBoundary,
    AuditChain,
}
#[derive(Deserialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
enum PendingCode {
    #[serde(rename = "PREDECESSOR_MISSING")]
    Predecessor,
    #[serde(rename = "PAIRED_AUDIT_MISSING")]
    PairedAudit,
    #[serde(rename = "APPROVAL_AUDIT_MISSING")]
    ApprovalAudit,
    #[serde(rename = "ORIGINAL_FACT_MISSING")]
    OriginalFact,
}
#[derive(Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case", deny_unknown_fields)]
enum IngestResponse {
    Accepted {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        receipt: AcceptedReceipt,
    },
    Quarantined {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        receipt: QuarantinedReceipt,
    },
    Pending {
        #[serde(rename = "schemaVersion")]
        schema_version: u8,
        code: PendingCode,
    },
}
impl BusinessDatabase {
    pub(crate) fn next_execution_evidence_upload(
        &self,
        context: &ExecutionEvidenceContext,
    ) -> Result<Option<EvidenceUploadSeed>> {
        if context.workspace_id != self.workspace_id {
            return Err(rejected());
        }
        let c = self.store.raw_connection();
        let quarantined:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM execution_evidence_receipts WHERE workspace_id=?1 AND source_device_id=?2 AND outcome='quarantined')",params![self.workspace_id,context.source_device_id],|r|r.get(0)).map_err(storage)?;
        if quarantined {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        // An observation audit depends on its original fact, which in turn depends on its claim audit.
        // Filter those exact dependencies before choosing; blindly draining all audits would deadlock.
        let query="WITH sources AS (
          SELECT 'device_audit' stream,a.active_lease_epoch epoch,a.audit_sequence sequence,a.audit_event_id event_id,a.envelope_digest digest,a.envelope_json wire,a.canonical_envelope canonical,a.source_installation_digest origin FROM workspace_device_audit_outbox a
          WHERE a.workspace_id=?1 AND a.source_device_id=?2 AND a.source_installation_digest=?3
          AND (json_extract(a.envelope_json,'$.payloadRedacted.stage')!='reconciled' OR EXISTS(SELECT 1 FROM execution_evidence_receipts r WHERE r.workspace_id=a.workspace_id AND r.stream='execution_fact' AND r.event_id=json_extract(a.envelope_json,'$.payloadRedacted.originalExecutionFactId') AND r.envelope_digest=json_extract(a.envelope_json,'$.payloadRedacted.originalExecutionFactDigest') AND r.outcome='accepted'))
          UNION ALL
          SELECT 'execution_fact',f.active_lease_epoch,f.execution_fact_sequence,f.execution_fact_id,f.envelope_digest,f.envelope_json,f.canonical_envelope,f.source_installation_digest FROM device_execution_fact_outbox f
          WHERE f.workspace_id=?1 AND f.source_device_id=?2 AND f.source_installation_digest=?3
          AND EXISTS(SELECT 1 FROM execution_evidence_receipts r WHERE r.workspace_id=f.workspace_id AND r.source_device_id=f.source_device_id AND r.active_lease_epoch=f.active_lease_epoch AND r.stream='device_audit' AND r.event_id=f.audit_event_id AND r.outcome='accepted')
        ) SELECT s.stream,s.epoch,s.sequence,s.event_id,s.digest,s.wire,s.canonical,s.origin,h.admission_generation FROM sources s JOIN execution_evidence_stream_heads h ON h.workspace_id=?1 AND h.source_device_id=?2 AND h.active_lease_epoch=s.epoch AND h.stream=s.stream AND h.source_installation_digest=s.origin
          WHERE h.producer_state IN ('open','frozen') AND NOT EXISTS(SELECT 1 FROM execution_evidence_receipts r WHERE r.workspace_id=?1 AND r.source_device_id=?2 AND r.active_lease_epoch=s.epoch AND r.stream=s.stream AND r.sequence=s.sequence)
          AND (s.sequence=1 OR EXISTS(SELECT 1 FROM execution_evidence_receipts r WHERE r.workspace_id=?1 AND r.source_device_id=?2 AND r.active_lease_epoch=s.epoch AND r.stream=s.stream AND r.sequence=s.sequence-1 AND r.outcome='accepted'))
          ORDER BY s.epoch,s.stream='execution_fact',s.sequence LIMIT 1";
        #[expect(
            clippy::type_complexity,
            reason = "one exact persisted source row and its producer generation"
        )]
        let row: Option<(
            String,
            i64,
            i64,
            String,
            String,
            String,
            Vec<u8>,
            String,
            i64,
        )> = c
            .query_row(
                query,
                params![
                    self.workspace_id,
                    context.source_device_id,
                    context.source_installation_digest
                ],
                |r| {
                    Ok((
                        r.get(0)?,
                        r.get(1)?,
                        r.get(2)?,
                        r.get(3)?,
                        r.get(4)?,
                        r.get(5)?,
                        r.get(6)?,
                        r.get(7)?,
                        r.get(8)?,
                    ))
                },
            )
            .optional()
            .map_err(storage)?;
        let Some((stream, epoch, sequence, event_id, digest, wire, canonical, origin, generation)) =
            row
        else {
            return Ok(None);
        };
        if URL_SAFE_NO_PAD.encode(Sha256::digest(&canonical)) != digest {
            return Err(rejected());
        }
        let stream = match stream.as_str() {
            "device_audit" => DesktopExecutionEvidenceStream::DeviceAudit,
            "execution_fact" => DesktopExecutionEvidenceStream::ExecutionFact,
            _ => return Err(rejected()),
        };
        let value = super::execution_evidence::validate_delivery_source(
            &wire,
            &canonical,
            context,
            stream == DesktopExecutionEvidenceStream::DeviceAudit,
        )?;
        let request = delivery_request(stream, &value)?;
        Ok(Some(EvidenceUploadSeed {
            stream,
            request,
            workspace: self.workspace_id.clone(),
            source: context.source_device_id.clone(),
            epoch,
            sequence,
            event_id,
            digest,
            origin,
            generation,
        }))
    }
    pub(crate) fn record_execution_evidence_response(
        &mut self,
        context: &ExecutionEvidenceContext,
        upload: &EvidenceUploadSeed,
        response: &[u8],
        guard: impl FnOnce() -> Result<()>,
    ) -> Result<DesktopExecutionEvidenceDeliveryOutcome> {
        if response.is_empty() || response.len() > 65536 {
            return Err(BusinessDatabaseError::InvalidInput);
        }
        let response: IngestResponse =
            serde_json::from_slice(response).map_err(|_| BusinessDatabaseError::InvalidInput)?;
        let (outcome, receipt) = match response {
            IngestResponse::Accepted {
                schema_version: 1,
                receipt,
            } => (
                DesktopExecutionEvidenceDeliveryOutcome::Accepted,
                Some(serde_json::to_value(receipt).map_err(|_| rejected())?),
            ),
            IngestResponse::Quarantined {
                schema_version: 1,
                receipt,
            } => (
                DesktopExecutionEvidenceDeliveryOutcome::Quarantined,
                Some(serde_json::to_value(receipt).map_err(|_| rejected())?),
            ),
            IngestResponse::Pending {
                schema_version: 1,
                code,
            } => {
                let _ = code;
                (DesktopExecutionEvidenceDeliveryOutcome::Pending, None)
            }
            _ => return Err(BusinessDatabaseError::InvalidInput),
        };
        if context.workspace_id != self.workspace_id
            || upload.workspace != self.workspace_id
            || upload.source != context.source_device_id
            || upload.origin != context.source_installation_digest
        {
            return Err(rejected());
        }
        let tx = self
            .store
            .fixture_connection()
            .transaction_with_behavior(TransactionBehavior::Immediate)
            .map_err(storage)?;
        let valid:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM execution_evidence_stream_heads h WHERE h.workspace_id=?1 AND h.source_device_id=?2 AND h.active_lease_epoch=?3 AND h.stream=?4 AND h.source_installation_digest=?5 AND h.admission_generation=?6)",params![upload.workspace,upload.source,upload.epoch,upload.stream.name(),upload.origin,upload.generation],|r|r.get(0)).map_err(storage)?;
        if !valid {
            return Err(rejected());
        }
        if let Some(receipt) = receipt {
            let matches = receipt["schemaVersion"] == 1
                && receipt["stream"] == upload.stream.name()
                && receipt["workspaceId"] == upload.workspace
                && receipt["sourceDeviceId"] == upload.source
                && receipt["activeLeaseEpoch"]
                    .as_u64()
                    .is_some_and(|v| sql(v).ok() == Some(upload.epoch))
                && receipt["sequence"]
                    .as_u64()
                    .is_some_and(|v| sql(v).ok() == Some(upload.sequence))
                && receipt["eventId"] == upload.event_id
                && receipt["envelopeDigest"] == upload.digest;
            if !matches {
                return Err(BusinessDatabaseError::InvalidInput);
            }
            super::validate_timestamp(receipt["receivedAt"].as_str().map(str::to_owned))
                .map_err(|_| BusinessDatabaseError::InvalidInput)?;
            let wire = serde_json::to_string(&receipt).map_err(|_| rejected())?;
            let previous:Option<String>=tx.query_row("SELECT receipt_json FROM execution_evidence_receipts WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND stream=?4 AND sequence=?5",params![upload.workspace,upload.source,upload.epoch,upload.stream.name(),upload.sequence],|r|r.get(0)).optional().map_err(storage)?;
            if previous.as_ref().is_some_and(|old| old != &wire) {
                return Err(BusinessDatabaseError::MutationConflict);
            }
            tx.execute("INSERT INTO execution_evidence_receipts(workspace_id,source_device_id,active_lease_epoch,stream,sequence,event_id,envelope_digest,outcome,receipt_json) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT DO NOTHING",params![upload.workspace,upload.source,upload.epoch,upload.stream.name(),upload.sequence,upload.event_id,upload.digest,receipt["outcome"].as_str().ok_or_else(rejected)?,wire]).map_err(storage)?;
        }
        guard()?;
        tx.commit().map_err(storage)?;
        Ok(outcome)
    }
}

impl BusinessDatabase {
    pub(crate) fn execution_evidence_drain_claims(
        &self,
        source: &str,
        epoch: u64,
    ) -> Result<Option<[super::drain_claims::DrainStreamClaim; 2]>> {
        let c = self.store.raw_connection();
        let barrier:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM device_handoff_barriers WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3)",params![self.workspace_id,source,sql(epoch)?],|r|r.get(0)).map_err(storage)?;
        if !barrier {
            return Ok(None);
        }
        let mut claims = Vec::with_capacity(2);
        for stream in [
            DesktopExecutionEvidenceStream::ExecutionFact,
            DesktopExecutionEvidenceStream::DeviceAudit,
        ] {
            let head:Option<(i64,String,Option<String>,String)>=c.query_row("SELECT last_sequence,rolling_digest,audit_head_hash,producer_state FROM execution_evidence_stream_heads WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3 AND stream=?4",params![self.workspace_id,source,sql(epoch)?,stream.name()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional().map_err(storage)?;
            if head.as_ref().is_some_and(|h| h.3 != "frozen") {
                return Ok(None);
            }
            let query = match stream {
                DesktopExecutionEvidenceStream::DeviceAudit => {
                    "SELECT a.audit_sequence,a.canonical_envelope,a.envelope_digest,a.previous_hash,a.event_hash,r.outcome FROM workspace_device_audit_outbox a LEFT JOIN execution_evidence_receipts r ON r.workspace_id=a.workspace_id AND r.source_device_id=a.source_device_id AND r.active_lease_epoch=a.active_lease_epoch AND r.stream='device_audit' AND r.sequence=a.audit_sequence AND r.event_id=a.audit_event_id AND r.envelope_digest=a.envelope_digest WHERE a.workspace_id=?1 AND a.source_device_id=?2 AND a.active_lease_epoch=?3 ORDER BY a.audit_sequence"
                }
                DesktopExecutionEvidenceStream::ExecutionFact => {
                    "SELECT f.execution_fact_sequence,f.canonical_envelope,f.envelope_digest,NULL,NULL,r.outcome FROM device_execution_fact_outbox f LEFT JOIN execution_evidence_receipts r ON r.workspace_id=f.workspace_id AND r.source_device_id=f.source_device_id AND r.active_lease_epoch=f.active_lease_epoch AND r.stream='execution_fact' AND r.sequence=f.execution_fact_sequence AND r.event_id=f.execution_fact_id AND r.envelope_digest=f.envelope_digest WHERE f.workspace_id=?1 AND f.source_device_id=?2 AND f.active_lease_epoch=?3 ORDER BY f.execution_fact_sequence"
                }
            };
            let mut statement = c.prepare(query).map_err(storage)?;
            let rows = statement
                .query_map(params![self.workspace_id, source, sql(epoch)?], |r| {
                    Ok((
                        r.get::<_, i64>(0)?,
                        r.get::<_, Vec<u8>>(1)?,
                        r.get::<_, String>(2)?,
                        r.get::<_, Option<String>>(3)?,
                        r.get::<_, Option<String>>(4)?,
                        r.get::<_, Option<String>>(5)?,
                    ))
                })
                .map_err(storage)?;
            let mut rolling = Sha256::digest(b"GOODDEALER-DRAIN-SHA256-V1").to_vec();
            let mut audit_hash =
                URL_SAFE_NO_PAD.encode(Sha256::digest(b"GOODDEALER-DEVICE-AUDIT-CHAIN-GENESIS-V1"));
            let mut last = 0_u64;
            for row in rows {
                let (sequence, envelope, digest, previous, event_hash, receipt) =
                    row.map_err(storage)?;
                if u64::try_from(sequence).ok() != Some(last + 1)
                    || URL_SAFE_NO_PAD.encode(Sha256::digest(&envelope)) != digest
                {
                    return Err(rejected());
                }
                if receipt.as_deref() != Some("accepted") {
                    return Ok(None);
                }
                if stream == DesktopExecutionEvidenceStream::DeviceAudit {
                    if previous.as_ref() != Some(&audit_hash) {
                        return Err(rejected());
                    }
                    audit_hash = event_hash.ok_or_else(rejected)?;
                }
                rolling.extend(
                    u32::try_from(envelope.len())
                        .map_err(|_| rejected())?
                        .to_be_bytes(),
                );
                rolling.extend(envelope);
                rolling = Sha256::digest(&rolling).to_vec();
                last += 1;
            }
            let digest = URL_SAFE_NO_PAD.encode(rolling);
            match head {
                Some((sequence, expected, audit, _))
                    if u64::try_from(sequence).ok() == Some(last)
                        && expected == digest
                        && (stream != DesktopExecutionEvidenceStream::DeviceAudit
                            || audit.as_ref() == Some(&audit_hash)) => {}
                None if last == 0 => {}
                _ => return Err(rejected()),
            }
            claims.push(super::drain_claims::DrainStreamClaim {
                last_assigned_sequence: last,
                contiguous_received_through: last,
                rolling_digest: digest,
            });
        }
        Ok(Some(claims.try_into().map_err(|_| rejected())?))
    }
}

#[cfg(all(test, unix))]
impl EvidenceUploadSeed {
    pub(crate) fn test_accepted_response(&self, at: &str) -> Vec<u8> {
        serde_json::to_vec(&json!({"schemaVersion":1,"outcome":"accepted","receipt":{"schemaVersion":1,"stream":self.stream,"workspaceId":self.workspace,"sourceDeviceId":self.source,"activeLeaseEpoch":self.epoch,"sequence":self.sequence,"eventId":self.event_id,"envelopeDigest":self.digest,"outcome":"accepted","classification":"current","receivedAt":at}})).unwrap()
    }
}

impl BusinessDatabase {
    pub(crate) fn execution_evidence_pending_count(&self) -> Result<Option<u64>> {
        let c = self.store.raw_connection();
        let blocked:bool=c.query_row("SELECT EXISTS(SELECT 1 FROM operation_attempts a JOIN operation_plans p USING(workspace_id,plan_id) WHERE a.workspace_id=?1 AND p.operation_kind='afternic_delist' AND NOT EXISTS(SELECT 1 FROM afternic_delist_item_authorizations i WHERE i.workspace_id=a.workspace_id AND i.operation_id=a.operation_id AND i.item_id=a.item_id AND i.attempt_number=a.attempt_number)) OR EXISTS(SELECT 1 FROM execution_evidence_receipts WHERE workspace_id=?1 AND outcome='quarantined')",[&self.workspace_id],|r|r.get(0)).map_err(storage)?;
        if blocked {
            return Ok(None);
        }
        let pending:i64=c.query_row("SELECT (SELECT count(*) FROM workspace_device_audit_outbox a WHERE a.workspace_id=?1 AND NOT EXISTS(SELECT 1 FROM execution_evidence_receipts r WHERE r.workspace_id=a.workspace_id AND r.source_device_id=a.source_device_id AND r.active_lease_epoch=a.active_lease_epoch AND r.stream='device_audit' AND r.sequence=a.audit_sequence AND r.event_id=a.audit_event_id AND r.envelope_digest=a.envelope_digest AND r.outcome='accepted'))+(SELECT count(*) FROM device_execution_fact_outbox f WHERE f.workspace_id=?1 AND NOT EXISTS(SELECT 1 FROM execution_evidence_receipts r WHERE r.workspace_id=f.workspace_id AND r.source_device_id=f.source_device_id AND r.active_lease_epoch=f.active_lease_epoch AND r.stream='execution_fact' AND r.sequence=f.execution_fact_sequence AND r.event_id=f.execution_fact_id AND r.envelope_digest=f.envelope_digest AND r.outcome='accepted'))",[&self.workspace_id],|r|r.get(0)).map_err(storage)?;
        Ok(Some(u64::try_from(pending).map_err(|_| rejected())?))
    }
    pub(crate) fn device_handoff_frozen_unresolved_count(
        &self,
        source: &str,
        epoch: u64,
    ) -> Result<u64> {
        let count:Option<i64>=self.store.raw_connection().query_row("SELECT frozen_unresolved_count FROM device_handoff_barriers WHERE workspace_id=?1 AND source_device_id=?2 AND active_lease_epoch=?3",params![self.workspace_id,source,sql(epoch)?],|r|r.get(0)).optional().map_err(storage)?;
        u64::try_from(count.unwrap_or(0)).map_err(|_| rejected())
    }
}

fn delivery_request(
    stream: DesktopExecutionEvidenceStream,
    value: &serde_json::Value,
) -> Result<Vec<u8>> {
    let body = match stream {
        DesktopExecutionEvidenceStream::DeviceAudit => json!({"schemaVersion":1,"event":value}),
        DesktopExecutionEvidenceStream::ExecutionFact => {
            json!({"schemaVersion":1,"fact":value})
        }
    };
    let request = serde_json::to_vec(&body).map_err(|_| rejected())?;
    let limit = match stream {
        DesktopExecutionEvidenceStream::DeviceAudit => 16384,
        DesktopExecutionEvidenceStream::ExecutionFact => 32768,
    };
    if request.len() > limit {
        return Err(rejected());
    }
    Ok(request)
}
