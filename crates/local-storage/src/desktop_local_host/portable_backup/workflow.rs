use std::{io::Write, sync::atomic::Ordering};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::{
    OfflineDataset, PortableArtifactRejected, RecoveryMaterial, Selection, codec,
    native_file::{Publication, SelectedPath},
};
use crate::desktop_local_host::{
    DesktopBackupError, DesktopLocalHost, RuntimeRestriction, WorkspaceAuthorityKind,
    WorkspaceAuthorityState, current_unix_seconds, format_timestamp, map_database_error,
    random_identifier, source::ALLOWLIST_VERSION,
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
    Create { locale: Locale },
    Open { locale: Locale },
    Page { view_id: String, after: String },
    Export { locale: Locale, view_id: String },
    Close { view_id: String },
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
            Action::Close { view_id } => {
                let _ = selection.get(&view_id)?;
                selection.opened = None;
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
        Ok(first)
    }

    fn get(&self, view_id: &str) -> Result<&OfflineDataset, DesktopBackupError> {
        match self.opened.as_ref() {
            Some((id, offline)) if id == view_id => Ok(offline),
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
}
