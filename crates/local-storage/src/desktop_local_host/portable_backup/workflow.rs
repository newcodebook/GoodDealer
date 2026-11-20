use std::{io::Write, sync::atomic::Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    OfflineDataset, PortableArtifactRejected, RecoveryMaterial, Selection, codec,
    native_file::{Publication, SelectedPath},
};
use crate::desktop_local_host::{
    BusinessDatabaseError, DesktopBackupError, DesktopLocalHost, DesktopLocalHostError,
    RuntimeRestriction, WorkspaceAuthorityKind, WorkspaceAuthorityState, current_unix_seconds,
    format_timestamp, hex_digest, map_database_error, random_identifier,
    restore::{
        PortableImportDisposition, PortableImportRow, RestoreAuthoritySnapshot, RestoreRequest,
    },
    source::ALLOWLIST_VERSION,
};
use crate::portfolio_projection::DomainAssetProjectionRow;

#[derive(Clone, Copy, Deserialize)]
enum Locale {
    #[serde(rename = "zh-CN")]
    Zh,
    #[serde(rename = "en-US")]
    En,
}

#[derive(Deserialize)]
#[serde(
    tag = "action",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
enum Action {
    Create {
        locale: Locale,
    },
    Open {
        locale: Locale,
    },
    Page {
        view_id: String,
        after: String,
    },
    Export {
        locale: Locale,
        view_id: String,
    },
    PreviewImport {
        view_id: String,
        #[serde(default)]
        fill_missing_fields: bool,
    },
    ImportPage {
        plan_id: String,
        after: String,
    },
    ApplyImport {
        plan_id: String,
    },
    CancelImport {
        plan_id: String,
    },
    Close {
        view_id: String,
    },
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    schema_version: u8,
    intent: Action,
}

#[derive(Serialize)]
#[serde(
    tag = "state",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
enum Response {
    Opened {
        view_id: String,
        created_at: String,
        rows: Vec<DomainAssetProjectionRow>,
        next: Option<String>,
    },
    ImportPreview {
        plan_id: String,
        rows: Vec<PortableImportRow>,
        next: Option<String>,
        additions: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        filled: Option<std::num::NonZeroUsize>,
        total: usize,
    },
    ImportApplied {
        additions: usize,
        #[serde(skip_serializing_if = "Option::is_none")]
        filled: Option<std::num::NonZeroUsize>,
    },
    ImportCancelled,
    Cancelled,
    Closed,
    BackupSaved,
    MaterialSaved,
    ExportSaved,
    PublicationUnknown,
}

impl DesktopLocalHost {
    /// Runs a bounded portable backup intent. File selection, recovery material and artifact
    /// publication stay within this aggregate. Opening a backup needs no workspace authority.
    ///
    /// # Errors
    /// Rejects malformed intents, invalid or stale selections, failed authentication or I/O, and
    /// creation after current workspace export authority is lost.
    pub fn portable_backup(&self, wire: &[u8]) -> Result<Value, DesktopBackupError> {
        let request = parse(wire)?;
        let mut selection = self
            .portable_backup_selection
            .try_lock()
            .map_err(|_| DesktopBackupError::OperationRejected)?;
        let response = match request.intent {
            Action::Create { locale } => self.create_portable_backup(locale)?,
            Action::Open { locale } => selection.open(locale)?,
            Action::Page { view_id, after } => {
                selection.get(&view_id)?.page(view_id, Some(&after))?
            }
            Action::Export { locale, view_id } => selection.get(&view_id)?.export(locale)?,
            Action::PreviewImport {
                view_id,
                fill_missing_fields,
            } => self.preview_portable_import(&mut selection, &view_id, fill_missing_fields)?,
            Action::ImportPage { plan_id, after } => {
                self.page_portable_import(&selection, &plan_id, &after)?
            }
            Action::ApplyImport { plan_id } => self.apply_portable_import(&selection, &plan_id)?,
            Action::CancelImport { plan_id } => {
                let _ = selection.get_import_plan(&plan_id)?;
                selection.import_plan = None;
                Response::ImportCancelled
            }
            Action::Close { view_id } => {
                let _ = selection.get(&view_id)?;
                selection.opened = None;
                selection.import_plan = None;
                Response::Closed
            }
        };
        serde_json::to_value(response).map_err(|_| DesktopBackupError::StorageRejected)
    }

    fn create_portable_backup(&self, locale: Locale) -> Result<Response, DesktopBackupError> {
        // The authority epoch is captured before presenting the dialogs and checked again after
        // they close. Nothing from the old workspace can be exported under a replacement Grant.
        let epoch = {
            let state = self
                .authority_publication
                .lock()
                .map_err(|_| DesktopBackupError::StorageRejected)?;
            self.require_portable_export(&state, state.applied_authority_epoch)?;
            state.applied_authority_epoch
        };
        let Some(artifact) = select(locale, FilePurpose::SaveArtifact)? else {
            return Ok(Response::Cancelled);
        };
        let Some(key_file) = select(locale, FilePurpose::SaveMaterial)? else {
            return Ok(Response::Cancelled);
        };
        self.write_portable_backup(epoch, &artifact, &key_file)
    }

    fn require_portable_export(
        &self,
        state: &WorkspaceAuthorityState,
        epoch: u64,
    ) -> Result<(), DesktopBackupError> {
        let authority = state
            .authority
            .as_ref()
            .ok_or(DesktopBackupError::AuthorityRejected)?;
        let admitted = match (state.restriction, authority.kind) {
            (RuntimeRestriction::Active, WorkspaceAuthorityKind::Active) => true,
            (
                RuntimeRestriction::CommercialReadOnly,
                WorkspaceAuthorityKind::VerifiedLocalContinuation,
            ) => {
                let now = current_unix_seconds()?;
                state.continuity.is_some()
                    && state
                        .verified_continuation
                        .as_ref()
                        .is_some_and(|proof| proof.is_current_at(now))
            }
            _ => false,
        };
        if !admitted || self.installation_context_gate.load(Ordering::Acquire) {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        self.require_captured_epoch(state, epoch, false)
    }

    fn write_portable_backup(
        &self,
        epoch: u64,
        artifact: &SelectedPath,
        key_file: &SelectedPath,
    ) -> Result<Response, DesktopBackupError> {
        if artifact.same_destination(key_file).map_err(file_error)? {
            return Err(DesktopBackupError::OperationRejected);
        }
        let state = self
            .authority_publication
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let check = || self.require_portable_export(&state, epoch);
        check()?;
        let mut runtime = self
            .runtime_state
            .lock()
            .map_err(|_| DesktopBackupError::StorageRejected)?;
        let projection = runtime
            .as_mut()
            .ok_or(DesktopBackupError::AuthorityRejected)?
            .business
            .database_for_backup_mut()
            .backup_source()
            .snapshot()
            .map_err(map_database_error)?;
        drop(runtime);
        if state
            .authority
            .as_ref()
            .map(|authority| authority.workspace_id.as_str())
            != Some(projection.workspace_id())
        {
            return Err(DesktopBackupError::AuthorityRejected);
        }
        let material = RecoveryMaterial::generate().map_err(file_error)?;
        let created_at = u64::try_from(current_unix_seconds()?)
            .map_err(|_| DesktopBackupError::OperationRejected)?;
        let ciphertext = codec::seal(
            &material,
            codec::Manifest {
                created_at,
                allowlist_version: ALLOWLIST_VERSION,
                projection_digest: *projection.source_proof_digest(),
            },
            &projection.data_frames(),
        )
        .map_err(file_error)?;
        let encoded = material.encode().map_err(file_error)?;
        check()?;
        let fence = || check().map_err(|_| PortableArtifactRejected);
        if key_file
            .publish(encoded.as_ref(), fence)
            .map_err(file_error)?
            != Publication::Durable
        {
            return Ok(Response::PublicationUnknown);
        }
        // The encrypted backup is published only after durable recovery material exists. When
        // the second destination fails, keep the first file and report that exact partial result.
        Ok(match artifact.publish(&ciphertext, fence) {
            Ok(Publication::Durable) => Response::BackupSaved,
            Ok(Publication::OutcomeUnknown) => Response::PublicationUnknown,
            Err(_) => Response::MaterialSaved,
        })
    }
}

pub(super) struct ImportPlan {
    id: String,
    view_id: String,
    epoch: u64,
    authority_digest: [u8; 32],
    workspace_id: String,
    revision: u64,
    rows: Vec<PortableImportRow>,
    fill_missing_fields: bool,
}

impl ImportPlan {
    fn count(&self, disposition: PortableImportDisposition) -> usize {
        self.rows
            .iter()
            .filter(|row| row.disposition == disposition)
            .count()
    }

    fn fill_count(&self) -> Option<std::num::NonZeroUsize> {
        std::num::NonZeroUsize::new(self.count(PortableImportDisposition::FillMissingFields))
    }

    fn page(&self, after: Option<&str>) -> Result<Response, DesktopBackupError> {
        let start = if let Some(after) = after {
            self.rows
                .binary_search_by(|row| row.entity_id.as_str().cmp(after))
                .map_err(|_| DesktopBackupError::OperationRejected)?
                + 1
        } else {
            0
        };
        let end = start
            .saturating_add(PAGE_SIZE as usize)
            .min(self.rows.len());
        let rows = &self.rows[start..end];
        Ok(Response::ImportPreview {
            plan_id: self.id.clone(),
            next: (end < self.rows.len()).then(|| self.rows[end - 1].entity_id.clone()),
            additions: self.count(PortableImportDisposition::Add),
            filled: self.fill_count(),
            total: self.rows.len(),
            rows: rows.to_vec(),
        })
    }

    fn require_current(
        &self,
        epoch: u64,
        digest: &[u8; 32],
        workspace_id: &str,
    ) -> Result<(), BusinessDatabaseError> {
        if self.epoch != epoch
            || &self.authority_digest != digest
            || self.workspace_id != workspace_id
        {
            return Err(BusinessDatabaseError::MutationStale);
        }
        Ok(())
    }
}

impl DesktopLocalHost {
    fn preview_portable_import(
        &self,
        selection: &mut Selection,
        view_id: &str,
        fill_missing_fields: bool,
    ) -> Result<Response, DesktopBackupError> {
        let candidate = selection
            .get(view_id)?
            .import_candidate(view_id)
            .map_err(file_error)?;
        let id = random_identifier("portable-import")?;
        let plan = self
            .with_authorized_business(false, |runtime, authority, epoch, restriction| {
                if restriction != RuntimeRestriction::Active {
                    return Err(BusinessDatabaseError::MutationStale);
                }
                let database = runtime.database_for_backup_mut();
                if database.workspace_id() != authority.workspace_id {
                    return Err(BusinessDatabaseError::WorkspaceRejected);
                }
                let (revision, rows) =
                    database.preview_portable_import(&candidate, fill_missing_fields)?;
                Ok(ImportPlan {
                    id,
                    view_id: view_id.to_owned(),
                    epoch,
                    authority_digest: authority.digest,
                    workspace_id: authority.workspace_id.clone(),
                    revision,
                    rows,
                    fill_missing_fields,
                })
            })
            .map_err(import_host_error)?;
        let response = plan.page(None)?;
        selection.import_plan = Some(plan);
        Ok(response)
    }

    fn page_portable_import(
        &self,
        selection: &Selection,
        plan_id: &str,
        after: &str,
    ) -> Result<Response, DesktopBackupError> {
        let plan = selection.get_import_plan(plan_id)?;
        self.with_authorized_business(false, |_, authority, epoch, restriction| {
            if restriction != RuntimeRestriction::Active {
                return Err(BusinessDatabaseError::MutationStale);
            }
            plan.require_current(epoch, &authority.digest, &authority.workspace_id)
        })
        .map_err(import_host_error)?;
        plan.page(Some(after))
    }

    fn apply_portable_import(
        &self,
        selection: &Selection,
        plan_id: &str,
    ) -> Result<Response, DesktopBackupError> {
        let plan = selection.get_import_plan(plan_id)?;
        let candidate = selection
            .get(&plan.view_id)?
            .import_candidate(&plan.view_id)
            .map_err(file_error)?;
        self.with_authorized_business(true, |runtime, authority, epoch, _| {
            plan.require_current(epoch, &authority.digest, &authority.workspace_id)?;
            let has_generation_capacity = runtime.has_read_generation_capacity();
            let database = runtime.database_for_backup_mut();
            if database.workspace_id() != authority.workspace_id {
                return Err(BusinessDatabaseError::WorkspaceRejected);
            }
            let snapshot = RestoreAuthoritySnapshot {
                authority_snapshot_digest: hex_digest(&authority.digest),
                source_device_id: authority.device_id.clone(),
                active_lease_epoch: authority.lease_epoch,
                committed_at: format_timestamp(
                    current_unix_seconds().map_err(|_| BusinessDatabaseError::MutationStale)?,
                ),
            };
            let request = RestoreRequest {
                operation_id: plan_id,
                expected_current_revision: plan.revision,
                expected_candidate_set_version: candidate.candidate_set_version,
                expected_authority_snapshot_digest: &snapshot.authority_snapshot_digest,
            };
            let receipt = database.import_portable_backup_guarded(
                &candidate,
                &request,
                &plan.rows,
                plan.fill_missing_fields,
                &snapshot,
                |replay| {
                    if !replay && !has_generation_capacity {
                        return Err(BusinessDatabaseError::SequenceExhausted);
                    }
                    self.require_business_commit_fence(epoch, authority)
                },
            )?;
            if receipt.disposition == "committed" {
                runtime.advance_read_generation_after_sync_commit();
            }
            Ok(())
        })
        .map_err(import_host_error)?;
        Ok(Response::ImportApplied {
            additions: plan.count(PortableImportDisposition::Add),
            filled: plan.fill_count(),
        })
    }
}

fn import_host_error(error: DesktopLocalHostError) -> DesktopBackupError {
    match error {
        DesktopLocalHostError::AuthorityRejected => DesktopBackupError::AuthorityRejected,
        _ => DesktopBackupError::OperationRejected,
    }
}

impl Selection {
    fn open(&mut self, locale: Locale) -> Result<Response, DesktopBackupError> {
        let Some(artifact) = select(locale, FilePurpose::OpenArtifact)? else {
            return Ok(Response::Cancelled);
        };
        let Some(material) = select(locale, FilePurpose::OpenMaterial)? else {
            return Ok(Response::Cancelled);
        };
        self.open_files(&artifact, &material)
    }

    fn open_files(
        &mut self,
        artifact: &SelectedPath,
        material: &SelectedPath,
    ) -> Result<Response, DesktopBackupError> {
        let material = material
            .read_bounded(codec::MATERIAL_LENGTH)
            .map_err(file_error)?;
        let material = RecoveryMaterial::parse(material.as_slice()).map_err(file_error)?;
        let bytes = artifact.read_artifact().map_err(file_error)?;
        let offline = OfflineDataset::open(&material, bytes.as_slice()).map_err(file_error)?;
        let view = random_identifier("portable")?;
        let first = offline.page(view.clone(), None)?;
        self.opened = Some((view, offline));
        self.import_plan = None;
        Ok(first)
    }

    fn get(&self, view_id: &str) -> Result<&OfflineDataset, DesktopBackupError> {
        match self.opened.as_ref() {
            Some((id, offline)) if id == view_id => Ok(offline),
            _ => Err(DesktopBackupError::OperationRejected),
        }
    }

    fn get_import_plan(&self, plan_id: &str) -> Result<&ImportPlan, DesktopBackupError> {
        match self.import_plan.as_ref() {
            Some(plan) if plan.id == plan_id => Ok(plan),
            _ => Err(DesktopBackupError::OperationRejected),
        }
    }
}

const PAGE_SIZE: u32 = 50;

impl OfflineDataset {
    fn page(&self, view_id: String, after: Option<&str>) -> Result<Response, DesktopBackupError> {
        let mut rows = self.read(after, PAGE_SIZE + 1).map_err(file_error)?;
        let next = if rows.len() > PAGE_SIZE as usize {
            rows.pop();
            rows.last().map(|row| row.entity_id.clone())
        } else {
            None
        };
        Ok(Response::Opened {
            view_id,
            created_at: format_timestamp(
                i64::try_from(self.created_at).map_err(|_| DesktopBackupError::ArtifactRejected)?,
            ),
            rows,
            next,
        })
    }

    fn export(&self, locale: Locale) -> Result<Response, DesktopBackupError> {
        let Some(destination) = select(locale, FilePurpose::SaveCopy)? else {
            return Ok(Response::Cancelled);
        };
        Ok(
            match destination
                .publish_with(|out| self.write_copy(out), || Ok(()))
                .map_err(file_error)?
            {
                Publication::Durable => Response::ExportSaved,
                Publication::OutcomeUnknown => Response::PublicationUnknown,
            },
        )
    }

    fn write_copy(&self, out: &mut dyn Write) -> Result<(), PortableArtifactRejected> {
        out.write_all(b"{\"schemaVersion\":1,\"domains\":[")
            .map_err(|_| PortableArtifactRejected)?;
        let mut after = None::<String>;
        loop {
            let rows = self.read(after.as_deref(), PAGE_SIZE)?;
            if rows.is_empty() {
                break;
            }
            for row in rows {
                if after.is_some() {
                    out.write_all(b",").map_err(|_| PortableArtifactRejected)?;
                }
                serde_json::to_writer(&mut *out, &row).map_err(|_| PortableArtifactRejected)?;
                after = Some(row.entity_id);
            }
        }
        out.write_all(b"]}\n").map_err(|_| PortableArtifactRejected)
    }
}

#[derive(Clone, Copy)]
enum FilePurpose {
    OpenArtifact,
    OpenMaterial,
    SaveArtifact,
    SaveMaterial,
    SaveCopy,
}

fn select(
    locale: Locale,
    purpose: FilePurpose,
) -> Result<Option<SelectedPath>, DesktopBackupError> {
    use FilePurpose::{OpenArtifact, OpenMaterial, SaveArtifact, SaveCopy, SaveMaterial};
    let (en, zh, extension, name) = match purpose {
        OpenArtifact => (
            "Open GoodDealer backup",
            "打开 GoodDealer 备份",
            "gdbk",
            None,
        ),
        OpenMaterial => (
            "Open separate recovery key",
            "打开单独保存的恢复密钥",
            "gdkey",
            None,
        ),
        SaveArtifact => (
            "Save encrypted GoodDealer backup",
            "保存 GoodDealer 加密备份",
            "gdbk",
            Some("GoodDealer.gdbk"),
        ),
        SaveMaterial => (
            "Save recovery key separately",
            "单独保存恢复密钥",
            "gdkey",
            Some("GoodDealer-recovery.gdkey"),
        ),
        SaveCopy => (
            "Export readable domain data as JSON",
            "导出可直接读取的域名 JSON",
            "json",
            Some("GoodDealer-domains.json"),
        ),
    };
    let title = match locale {
        Locale::En => en,
        Locale::Zh => zh,
    };
    let selection = super::dialog::choose(title, extension, name).map_err(file_error)?;
    selection
        .map(|path| SelectedPath::admit(&path).map_err(file_error))
        .transpose()
}

fn file_error(_: PortableArtifactRejected) -> DesktopBackupError {
    DesktopBackupError::ArtifactRejected
}

fn parse(wire: &[u8]) -> Result<Request, DesktopBackupError> {
    if wire.is_empty() || wire.len() > 1_024 {
        return Err(DesktopBackupError::OperationRejected);
    }
    let request: Request =
        serde_json::from_slice(wire).map_err(|_| DesktopBackupError::OperationRejected)?;
    if request.schema_version != 1 {
        return Err(DesktopBackupError::OperationRejected);
    }
    Ok(request)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(any(target_os = "linux", target_os = "macos"))]
    use crate::{BusinessDatabase, DomainAssetWrite, LocalDatabaseKey};

    #[test]
    fn ipc_rejects_paths_extra_fields_and_actions_outside_the_backup_workflow() {
        let host = DesktopLocalHost::production_unavailable();
        for wire in [
            r#"{"schemaVersion":2,"intent":{"action":"open","locale":"en-US"}}"#,
            r#"{"schemaVersion":1,"intent":{"action":"open","locale":"en-US","path":"arbitrary"}}"#,
            r#"{"schemaVersion":1,"intent":{"action":"open","locale":"en-US","recoveryKey":"arbitrary"}}"#,
            r#"{"schemaVersion":1,"intent":{"action":"import","locale":"en-US"}}"#,
            r#"{"schemaVersion":1,"intent":{"action":"preview_import","viewId":"portable-fixture","fillMissingFields":"true"}}"#,
        ] {
            assert_eq!(
                host.portable_backup(wire.as_bytes()),
                Err(DesktopBackupError::OperationRejected)
            );
        }
        assert_eq!(
            host.portable_backup(
                br#"{"schemaVersion":1,"intent":{"action":"create","locale":"en-US"}}"#
            ),
            Err(DesktopBackupError::AuthorityRejected)
        );
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one test verifies the file pair through source removal and offline close"
    )]
    fn full_host_creation_and_offline_export_after_source_removal() {
        let output = crate::test_tempdir::tempdir().unwrap();
        let select = |name| SelectedPath::admit(&output.path().join(name)).unwrap();
        let artifact = select("fixture.gdbk");
        let key = select("fixture.gdkey");
        {
            let original = crate::test_tempdir::tempdir().unwrap();
            let storage_key = LocalDatabaseKey::from_bytes([0x13; 32]);
            let mut db = BusinessDatabase::open(
                &original.path().join("workspace.db"),
                &storage_key,
                "workspace-local",
            )
            .unwrap();
            for name in ["second.example", "first.example"] {
                db.upsert_domain_asset(
                    name,
                    "2026-11-20T00:00:00Z",
                    &DomainAssetWrite {
                        entity_id: name.into(),
                        note: Some("offline owned content".into()),
                        portfolio_id: None,
                        tags: Vec::new(),
                        target_price: None,
                    },
                )
                .unwrap();
            }
            let host = DesktopLocalHost::development(
                db,
                original.path().join("native-v1"),
                "account-local",
                "workspace-local",
                "device-local",
            )
            .unwrap();
            let epoch = host.transition_requested_epoch.load(Ordering::Acquire);
            host.installation_context_gate
                .store(true, Ordering::Release);
            assert_eq!(
                host.write_portable_backup(epoch, &artifact, &key).err(),
                Some(DesktopBackupError::AuthorityRejected)
            );
            host.installation_context_gate
                .store(false, Ordering::Release);
            assert!(matches!(
                host.write_portable_backup(epoch, &artifact, &key),
                Ok(Response::BackupSaved)
            ));
            let partial_key = select("partial.gdkey");
            let saved_artifact = artifact.read_artifact().unwrap();
            assert!(matches!(
                host.write_portable_backup(epoch, &artifact, &partial_key),
                Ok(Response::MaterialSaved)
            ));
            assert_eq!(*artifact.read_artifact().unwrap(), *saved_artifact);
            let partial_material = partial_key.read_bounded(codec::MATERIAL_LENGTH).unwrap();
            assert!(RecoveryMaterial::parse(partial_material.as_slice()).is_ok());
            assert_eq!(
                host.write_portable_backup(
                    epoch + 1,
                    &select("stale.gdbk"),
                    &select("stale.gdkey")
                )
                .err(),
                Some(DesktopBackupError::AuthorityRejected)
            );
        }
        let host = DesktopLocalHost::production_unavailable();
        let id = {
            let mut selection = host.portable_backup_selection.lock().unwrap();
            let Response::Opened { view_id, rows, .. } =
                selection.open_files(&artifact, &key).unwrap()
            else {
                panic!("missing offline view");
            };
            assert_eq!(rows.len(), 2);
            for invalid_key in ["partial.gdkey", "missing.gdkey"] {
                assert!(matches!(
                    selection.open_files(&artifact, &select(invalid_key)),
                    Err(DesktopBackupError::ArtifactRejected)
                ));
            }
            let destination = select("domains.json");
            let offline = selection.get(&view_id).unwrap();
            assert_eq!(
                destination.publish_with(|out| offline.write_copy(out), || Ok(())),
                Ok(Publication::Durable)
            );
            let read = destination.read_bounded(10_000).unwrap();
            let document: Value = serde_json::from_slice(read.as_slice()).unwrap();
            assert_eq!(document["domains"][0]["entityId"], "first.example");
            assert_eq!(document["domains"][1]["note"], "offline owned content");
            assert!(document.get("workspaceId").is_none());
            assert!(document.get("recoveryKey").is_none());
            view_id
        };
        let wire = serde_json::to_vec(
            &serde_json::json!({"schemaVersion":1,"intent":{"action":"close","viewId":id}}),
        )
        .unwrap();
        assert_eq!(host.portable_backup(&wire).unwrap()["state"], "closed");
        assert_eq!(
            host.portable_backup(&wire),
            Err(DesktopBackupError::OperationRejected)
        );
    }

    #[cfg(any(target_os = "linux", target_os = "macos"))]
    #[test]
    #[expect(
        clippy::too_many_lines,
        reason = "one fixture verifies stale approval, atomic rollback, replay and SQLCipher reopen"
    )]
    fn import_preview_applies_approved_additions_and_fills_with_a_durable_receipt() {
        let files = crate::test_tempdir::tempdir().unwrap();
        let artifact = SelectedPath::admit(&files.path().join("restore.gdbk")).unwrap();
        let key_file = SelectedPath::admit(&files.path().join("restore.gdkey")).unwrap();
        let asset = |domain: &str, note: &str| DomainAssetWrite {
            entity_id: domain.to_owned(),
            note: Some(note.to_owned()),
            portfolio_id: None,
            tags: vec!["recovered".to_owned()],
            target_price: None,
        };
        let time = "2026-11-20T00:00:00Z";
        {
            let source = crate::test_tempdir::tempdir().unwrap();
            let key = LocalDatabaseKey::from_bytes([0x24; 32]);
            let mut database = BusinessDatabase::open(
                &source.path().join("workspace.db"),
                &key,
                "original-workspace",
            )
            .unwrap();
            for domain in [
                "archived.example",
                "conflict.example",
                "fill.example",
                "new.example",
                "second.example",
            ] {
                let mut row = asset(domain, "backup note");
                if domain == "fill.example" {
                    row.target_price = Some(crate::portfolio_projection::Money {
                        currency: "USD".into(),
                        amount: "3000".into(),
                    });
                }
                database.upsert_domain_asset(domain, time, &row).unwrap();
            }
            let host = DesktopLocalHost::development(
                database,
                source.path().join("native"),
                "old-account",
                "original-workspace",
                "old-device",
            )
            .unwrap();
            let epoch = host.transition_requested_epoch.load(Ordering::Acquire);
            assert!(matches!(
                host.write_portable_backup(epoch, &artifact, &key_file),
                Ok(Response::BackupSaved)
            ));
        }
        let open = |host: &DesktopLocalHost| {
            let mut selection = host.portable_backup_selection.lock().unwrap();
            let Response::Opened { view_id, .. } =
                selection.open_files(&artifact, &key_file).unwrap()
            else {
                panic!("missing offline view");
            };
            view_id
        };
        let call = |host: &DesktopLocalHost, intent: Value| {
            let wire = serde_json::to_vec(&serde_json::json!({"schemaVersion":1,"intent":intent}))
                .unwrap();
            host.portable_backup(&wire)
        };
        let offline = DesktopLocalHost::production_unavailable();
        let offline_id = open(&offline);
        assert_eq!(
            call(
                &offline,
                serde_json::json!({"action":"preview_import", "viewId":offline_id})
            ),
            Err(DesktopBackupError::AuthorityRejected)
        );

        let target_dir = crate::test_tempdir::tempdir().unwrap();
        let target_path = target_dir.path().join("workspace.db");
        let target_key = LocalDatabaseKey::from_bytes([0x48; 32]);
        {
            let mut target =
                BusinessDatabase::open(&target_path, &target_key, "current-workspace").unwrap();
            target
                .upsert_domain_asset("edited", time, &asset("conflict.example", "current note"))
                .unwrap();
            target
                .upsert_domain_asset(
                    "fill",
                    time,
                    &DomainAssetWrite {
                        note: None,
                        tags: vec!["current label".to_owned()],
                        ..asset("fill.example", "unused")
                    },
                )
                .unwrap();
            target
                .upsert_domain_asset("unrelated", time, &asset("untouched.example", "stay here"))
                .unwrap();
            let created = target
                .create_domain_asset_guarded(
                    "archive-add",
                    "new-device",
                    1,
                    time,
                    &asset("archived.example", "retired"),
                    true,
                    |_| Ok(()),
                    |(), _| Ok(()),
                )
                .unwrap();
            target
                .delete_domain_asset_guarded(
                    "archive-delete",
                    created.local_commit_sequence,
                    "new-device",
                    1,
                    time,
                    "archived.example",
                    true,
                    |_| Ok(()),
                    |(), _| Ok(()),
                )
                .unwrap();
            let host = DesktopLocalHost::development(
                target,
                target_dir.path().join("native"),
                "new-account",
                "current-workspace",
                "new-device",
            )
            .unwrap();
            let view_id = open(&host);
            let preview_intent = serde_json::json!({"action":"preview_import", "viewId":view_id});
            let preview = call(&host, preview_intent.clone()).unwrap();
            assert_eq!(preview["additions"], 2);
            assert!(preview.get("filled").is_none());
            assert_eq!(
                preview["rows"],
                serde_json::json!([
                    {"entityId":"archived.example", "disposition":"blocked_by_asset_history"},
                    {"entityId":"conflict.example", "disposition":"preserve_existing"},
                    {"entityId":"fill.example", "disposition":"preserve_existing"},
                    {"entityId":"new.example", "disposition":"add"},
                    {"entityId":"second.example", "disposition":"add"}
                ])
            );
            let old_id = preview["planId"].clone();
            let merge_intent = serde_json::json!({
                "action":"preview_import", "viewId":view_id, "fillMissingFields":true
            });
            let stale_plan = call(&host, merge_intent.clone()).unwrap()["planId"].clone();
            assert_eq!(
                call(
                    &host,
                    serde_json::json!({"action":"apply_import", "planId":old_id})
                ),
                Err(DesktopBackupError::OperationRejected)
            );
            let edit_fill_note = |mutation: &str, note: Option<String>| {
                host.with_authorized_business(true, |runtime, _, _, _| {
                    runtime.database_for_backup_mut().upsert_domain_asset(
                        mutation,
                        time,
                        &DomainAssetWrite {
                            note,
                            tags: vec!["current label".to_owned()],
                            ..asset("fill.example", "unused")
                        },
                    )
                })
                .unwrap();
            };
            edit_fill_note("fill-after-preview", Some("new current note".into()));
            assert_eq!(
                call(
                    &host,
                    serde_json::json!({"action":"apply_import", "planId":stale_plan})
                ),
                Err(DesktopBackupError::OperationRejected)
            );
            edit_fill_note("clear-for-new-preview", None);
            let preview = call(&host, merge_intent).unwrap();
            assert_eq!(preview["filled"], 1);
            assert_eq!(
                preview["rows"][2],
                serde_json::json!({
                    "entityId":"fill.example", "disposition":"fill_missing_fields",
                    "fill": {"entityId":"fill.example", "note":"backup note", "tags":[], "portfolioId":null,
                        "targetPrice":{"currency":"USD","amount":"3000"}}
                })
            );
            let plan = preview["planId"].clone();
            let apply = serde_json::json!({"action":"apply_import", "planId":plan});
            let writes = || {
                host.with_authorized_business(false, |runtime, _, _, _| {
                runtime.database_for_backup_mut().backup_connection_mut().query_row(
                    "SELECT (SELECT count(*) FROM domain_assets WHERE entity_id IN ('new.example','second.example')),
                        (SELECT count(*) FROM sync_outbox WHERE entity_id IN ('new.example','second.example','fill.example')),
                        (SELECT count(*) FROM domain_asset_desired_state WHERE entity_id='fill.example' AND note IS NOT NULL),
                        (SELECT count(*) FROM business_history_events WHERE event_kind='backup_restore_completed')",
                    [], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?, row.get::<_, i64>(2)?, row.get::<_, i64>(3)?)),
                ).map_err(|_| BusinessDatabaseError::StorageRejected)
            }).unwrap()
            };
            let baseline = writes();
            let epoch = host.transition_requested_epoch.load(Ordering::Acquire);
            host.business_commit_transition_epoch
                .store(epoch + 1, Ordering::Release);
            assert_eq!(
                call(&host, apply.clone()),
                Err(DesktopBackupError::AuthorityRejected)
            );
            host.transition_requested_epoch
                .store(epoch, Ordering::Release);
            assert_eq!(writes(), baseline);
            let applied = serde_json::json!({"state":"import_applied", "additions":2, "filled":1});
            assert_eq!(call(&host, apply.clone()).unwrap(), applied);
            assert_eq!(call(&host, apply).unwrap(), applied);
        }
        let mut target =
            BusinessDatabase::open(&target_path, &target_key, "current-workspace").unwrap();
        let connection = target.backup_connection_mut();
        let count: i64 = connection.query_row(
            "SELECT count(*) FROM sync_outbox o JOIN sync_outbox_local_creations c USING (workspace_id, mutation_id)
                WHERE o.entity_id IN ('new.example', 'second.example') AND o.workspace_id='current-workspace' AND o.source_device_id='new-device'",
            [], |row| row.get(0),
        ).unwrap();
        assert_eq!(count, 2);
        let read = |domain: &str| {
            connection.query_row(
            "SELECT note FROM domain_asset_desired_state d JOIN domain_assets a USING (workspace_id,entity_id)
              WHERE d.entity_id=?1 AND a.deleted_at IS NULL", [domain], |row| row.get::<_,String>(0),
        )
        };
        assert_eq!(read("new.example").unwrap(), "backup note");
        assert_eq!(read("second.example").unwrap(), "backup note");
        assert_eq!(read("conflict.example").unwrap(), "current note");
        assert_eq!(read("fill.example").unwrap(), "backup note");
        assert_eq!(read("untouched.example").unwrap(), "stay here");
        assert!(read("archived.example").is_err());
        let kept: (String, String, i64, i64) = connection.query_row(
            "SELECT p.tags_json,p.target_price_amount,a.entity_generation,
                    (SELECT count(*) FROM sync_outbox_local_creations c JOIN sync_outbox o USING(workspace_id,mutation_id)
                        WHERE o.entity_id='fill.example')
               FROM portfolio_domain_assets p JOIN domain_assets a USING(workspace_id,entity_id)
               WHERE p.entity_id='fill.example'",
            [], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        ).unwrap();
        assert_eq!(kept, (r#"["current label"]"#.into(), "3000".into(), 1, 0));
        let receipts: i64 = connection.query_row("SELECT count(*) FROM business_history_events WHERE event_kind='backup_restore_completed'", [], |row| row.get(0)).unwrap();
        assert_eq!(receipts, 1);
    }
}
