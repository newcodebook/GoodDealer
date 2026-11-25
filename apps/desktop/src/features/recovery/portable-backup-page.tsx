import type { PortableBackupImportPreview, PortableBackupIntent, PortableBackupPage as BackupPage } from "@gooddealer/client-core";
import { formatDate, formatNumber, getCapabilityCopy, type Locale } from "@gooddealer/i18n";
import { Button, Checkbox } from "@gooddealer/ui";
import { useEffect, useRef, useState } from "react";

import { runPortableBackup } from "../../adapters/tauri/portable-backup";
import { NativeWindow, type ShellWindowFrame } from "../../app-shell";
import "./portable-backup-page.css";

type Props = {
  readonly locale: Locale;
  readonly windowFrame: ShellWindowFrame;
  readonly canCreate: boolean;
  readonly onBack: () => void;
};

export function PortableBackupPage({ locale, windowFrame, canCreate, onBack }: Props) {
  const copy = getCapabilityCopy(locale, "recovery");
  const [page, setPage] = useState<BackupPage | null>(null);
  const [importPreview, setImportPreview] = useState<PortableBackupImportPreview | null>(null);
  const [fillMissingFields, setFillMissingFields] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const previewHeading = useRef<HTMLHeadingElement>(null);
  const previewId = importPreview?.planId;
  useEffect(() => {
    if (canCreate && previewId !== undefined) previewHeading.current?.focus();
  }, [canCreate, previewId]);
  const work = async (intent: PortableBackupIntent) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await runPortableBackup(intent);
      switch (result.state) {
        case "opened":
          setPage(result);
          if (intent.action === "open") {
            setImportPreview(null);
            setFillMissingFields(false);
          }
          break;
        case "import_preview": setImportPreview(result); break;
        case "import_cancelled": setImportPreview(null); break;
        case "import_applied":
          setImportPreview(null);
          if (result.filled > 0) {
            setNotice(copy.portableImportFillResult
              .replace("{additions}", formatNumber(locale, result.additions))
              .replace("{filled}", formatNumber(locale, result.filled)));
          } else {
            setNotice(result.additions === 1 ? copy.portableImportOne :
              copy.portableImportResult.replace("{count}", formatNumber(locale, result.additions)));
          }
          break;
        case "closed": onBack(); break;
        case "cancelled": setNotice(copy.portableCancelled); break;
        case "backup_saved": setNotice(copy.portableSaved); break;
        case "material_saved": setNotice(copy.portableMaterialSaved); break;
        case "export_saved": setNotice(copy.portableCopySaved); break;
        case "publication_unknown": setNotice(copy.portableUnknown); break;
      }
    } catch {
      switch (intent.action) {
        case "preview_import":
        case "apply_import":
        case "import_page":
        case "cancel_import":
          setImportPreview(null);
          setNotice(copy.portableImportError);
          break;
        default:
          setNotice(copy.portableError);
      }
    } finally {
      running.current = false;
      setBusy(false);
    }
  };

  return (
    <div className="runtime-status-window">
      <NativeWindow locale={locale} windowFrame={windowFrame} context={copy.portableTitle}>
        <main className="portable-backup">
          <header>
            <h1>{copy.portableTitle}</h1>
            <p>{copy.portableIntro}</p>
          </header>
          <div className="portable-backup-actions">
            <Button variant="primary" disabled={busy} onClick={() => { void work({ action: "open", locale }); }}>
              {copy.portableOpen}
            </Button>
            {canCreate ? (
              <Button variant="secondary" disabled={busy} onClick={() => { void work({ action: "create", locale }); }}>
                {copy.portableCreate}
              </Button>
            ) : null}
            <Button variant="ghost" disabled={busy} onClick={() => {
              if (running.current) return;
              if (page === null) onBack();
              else void work({ action: "close", viewId: page.viewId });
            }}>{copy.portableBack}</Button>
          </div>
          {canCreate ? <p className="gd-t-meta">{copy.portableCreateHint}</p> : null}
          {busy ? <p>{copy.portableWorking}</p> : null}
          <p role="status">{notice}</p>
          {page === null ? null : (
            <section aria-label={copy.portableOpen}>
              <p>{copy.portableCreatedAt} <time dateTime={page.createdAt}>{formatDate(locale, Date.parse(page.createdAt), { dateStyle: "medium" })}</time></p>
              {page.rows.length === 0 ? <p>{copy.portableEmpty}</p> : (
                <table>
                  <caption>{copy.portableDomain}</caption>
                  <thead><tr>
                    <th scope="col">{copy.portableDomain}</th>
                    <th scope="col">{copy.portableNote}</th>
                    <th scope="col">{copy.portableTags}</th>
                    <th scope="col">{copy.portablePrice}</th>
                  </tr></thead>
                  <tbody>{page.rows.map((row) => (
                    <tr key={row.entityId}>
                      <th scope="row">{row.entityId}</th>
                      <td>{row.note ?? "—"}</td>
                      <td>{row.tags.join(", ") || "—"}</td>
                      <td>{row.targetPrice === null ? "—" : `${row.targetPrice.currency} ${row.targetPrice.amount}`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
              {canCreate && importPreview === null ? (
                <p><Checkbox
                  label={copy.portableImportFillOption}
                  checked={fillMissingFields}
                  disabled={busy}
                  onChange={(event) => { setFillMissingFields(event.currentTarget.checked); }}
                /></p>
              ) : null}
              <div className="portable-backup-actions">
                <Button variant="secondary" disabled={busy} onClick={() => {
                  void work({ action: "export", viewId: page.viewId, locale });
                }}>{copy.portableExport}</Button>
                {canCreate && importPreview === null ? <Button variant="secondary" disabled={busy} onClick={() => {
                  void work({ action: "preview_import", viewId: page.viewId, fillMissingFields });
                }}>{copy.portablePreviewImport}</Button> : null}
                {page.next === null ? null : <Button variant="secondary" disabled={busy} onClick={() => {
                  if (page.next !== null) void work({ action: "page", viewId: page.viewId, after: page.next });
                }}>{copy.portableNext}</Button>}
              </div>
              <p className="gd-t-meta">{copy.portableExportHint}</p>
            </section>
          )}
          {canCreate && importPreview !== null ? (
            <section>
              <h2 ref={previewHeading} tabIndex={-1}>{copy.portableImportTitle}</h2>
              <p>{copy.portableImportSummary
                .replace("{additions}", formatNumber(locale, importPreview.additions))
                .replace("{total}", formatNumber(locale, importPreview.total))}</p>
              {importPreview.filled > 0 ? <p>{copy.portableImportFillSummary
                .replace("{filled}", formatNumber(locale, importPreview.filled))}</p> : null}
              {importPreview.rows.length === 0 ? null : <table>
                <caption>{copy.portableImportStatus}</caption>
                <thead><tr><th scope="col">{copy.portableDomain}</th><th scope="col">{copy.portableImportStatus}</th></tr></thead>
                <tbody>{importPreview.rows.map((row) => (
                  <tr key={row.entityId}>
                    <th scope="row">{row.entityId}</th>
                    <td>{row.disposition === "fill_missing_fields" ? (
                      <>
                        {copy.portableImportFill}
                        <dl>
                          {row.fill.note !== null ? <><dt>{copy.portableNote}</dt><dd>{row.fill.note}</dd></> : null}
                          {row.fill.tags.length > 0 ? <><dt>{copy.portableTags}</dt><dd>{row.fill.tags.join(", ")}</dd></> : null}
                          {row.fill.targetPrice !== null ? <><dt>{copy.portablePrice}</dt><dd>{row.fill.targetPrice.currency} {row.fill.targetPrice.amount}</dd></> : null}
                          {row.fill.portfolioId !== null ? <><dt>{copy.portablePortfolio}</dt><dd>{row.fill.portfolioId}</dd></> : null}
                        </dl>
                      </>
                    ) : {
                      add: copy.portableImportAdd,
                      unchanged: copy.portableImportUnchanged,
                      preserve_existing: copy.portableImportPreserve,
                      blocked_by_asset_history: copy.portableImportHistory,
                      missing_portfolio: copy.portableImportMissingPortfolio,
                    }[row.disposition]}</td>
                  </tr>
                ))}</tbody>
              </table>}
              <div className="portable-backup-actions">
                {importPreview.next === null ? null : <Button variant="secondary" disabled={busy} onClick={() => {
                  if (importPreview.next !== null) void work({ action: "import_page", planId: importPreview.planId, after: importPreview.next });
                }}>{copy.portableNext}</Button>}
                <Button variant="secondary" disabled={busy} onClick={() => {
                  void work({ action: "cancel_import", planId: importPreview.planId });
                }}>{copy.portableImportCancel}</Button>
                <Button variant="primary" disabled={busy || importPreview.additions + importPreview.filled === 0} onClick={() => {
                  void work({ action: "apply_import", planId: importPreview.planId });
                }}>{copy.portableImportConfirm}</Button>
              </div>
            </section>
          ) : null}
        </main>
      </NativeWindow>
    </div>
  );
}
