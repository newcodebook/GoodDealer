import type { PortableBackupIntent, PortableBackupPage as BackupPage } from "@gooddealer/client-core";
import { formatDate, getCapabilityCopy, type Locale } from "@gooddealer/i18n";
import { Button } from "@gooddealer/ui";
import { useRef, useState } from "react";

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
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const running = useRef(false);
  const work = async (intent: PortableBackupIntent) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setNotice("");
    try {
      const result = await runPortableBackup(intent);
      switch (result.state) {
        case "opened": setPage(result); break;
        case "closed": onBack(); break;
        case "cancelled": setNotice(copy.portableCancelled); break;
        case "backup_saved": setNotice(copy.portableSaved); break;
        case "material_saved": setNotice(copy.portableMaterialSaved); break;
        case "export_saved": setNotice(copy.portableCopySaved); break;
        case "publication_unknown": setNotice(copy.portableUnknown); break;
      }
    } catch {
      setNotice(copy.portableError);
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
              <div className="portable-backup-actions">
                <Button variant="secondary" disabled={busy} onClick={() => {
                  void work({ action: "export", viewId: page.viewId, locale });
                }}>{copy.portableExport}</Button>
                {page.next === null ? null : <Button variant="secondary" disabled={busy} onClick={() => {
                  if (page.next !== null) void work({ action: "page", viewId: page.viewId, after: page.next });
                }}>{copy.portableNext}</Button>}
              </div>
              <p className="gd-t-meta">{copy.portableExportHint}</p>
            </section>
          )}
        </main>
      </NativeWindow>
    </div>
  );
}
