import type { DrainingViewModel } from "@gooddealer/client-core";
import { formatNumber, getCapabilityCopy, type Locale } from "@gooddealer/i18n";
import { Button, ProgressBar, RefreshCwIcon, ShieldAlertIcon } from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";
import keyholeUrl from "@gooddealer/ui/assets/icons/keyhole.svg";

import { NativeWindow, type ShellWindowFrame } from "../../../app-shell";
import "./runtime-status-page.css";

/** Every non-workspace state the Desktop can be in once the Host has spoken (or failed to). */
export type RuntimeStatusKind =
  | "opening"
  | "host_unavailable"
  | "security_locked"
  | "retryable_locked"
  | "device_capacity"
  | "activating"
  | "draining"
  | "startup_recovery"
  | "local_continuation";

export interface RuntimeStatusPageProps {
  readonly locale: Locale;
  readonly kind: RuntimeStatusKind;
  readonly windowFrame: ShellWindowFrame;
  /** Re-reads Host state (host unavailable) or retries the authorization refresh (retryable lock). */
  readonly onRetry?: () => void;
  /** Starts browser sign-in again after a security lock. */
  readonly onSignInAgain?: () => void;
  readonly draining?: DrainingViewModel;
}

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

/**
 * Route-free status page. None of these states admits business data or actions, so the page shows
 * only the state, why it holds, and the single recovery action the state allows.
 */
export function RuntimeStatusPage({ locale, kind, windowFrame, onRetry, onSignInAgain, draining }: RuntimeStatusPageProps) {
  const copy = getCapabilityCopy(locale, "runtimeMode");
  const busy = kind === "opening" || kind === "activating" || kind === "draining" || kind === "startup_recovery";
  const locked = kind === "security_locked" || kind === "retryable_locked" || kind === "host_unavailable" || kind === "device_capacity";

  const [title, description] = ((): readonly [string, string | null] => {
    switch (kind) {
      case "opening": return [copy.openingWorkspace, null];
      case "host_unavailable": return [copy.hostUnavailableTitle, copy.hostUnavailableDescription];
      case "security_locked": return [copy.lockedTitle, copy.securityLockedDescription];
      case "retryable_locked": return [copy.retryableLockedTitle, copy.retryableLockedDescription];
      case "device_capacity": return [copy.deviceCapacityTitle, copy.deviceCapacityDescription];
      case "activating": return [copy.activatingTitle, copy.activatingDescription];
      case "draining": return [copy.drainingTitle, copy.drainingDescription];
      case "startup_recovery": return [copy.startupRecoveryTitle, copy.startupRecoveryDescription];
      case "local_continuation": return [copy.localContinuationTitle, copy.localContinuationPlacement];
    }
  })();
  const remaining = draining?.streams.reduce((sum, stream) => sum + stream.pendingCount, 0) ?? null;
  const acknowledged = draining?.streams.reduce((sum, stream) => sum + stream.acknowledgedSequence, 0) ?? 0;

  return (
    <div className="runtime-status-window">
      <NativeWindow locale={locale} windowFrame={windowFrame} context={title}>
        <div className="runtime-status" data-runtime-status={kind}>
          <div className="runtime-status-card" aria-live="polite">
            {kind === "opening" ? <img src={markUrl} width="64" height="64" alt="GoodDealer" />
              : locked ? <span className="runtime-status-icon runtime-status-icon--locked"><ShieldAlertIcon size={22} /></span>
                : <img src={keyholeUrl} width="40" height="40" alt="" className="runtime-status-keyhole" />}
            <h1 className="runtime-status-title">
              {busy ? <RefreshCwIcon size={16} className="runtime-status-spin" /> : null}
              {title}
            </h1>
            {description === null ? null : <p className="gd-t-body-2">{description}</p>}
            {kind === "draining" && draining !== undefined && remaining !== null ? (
              <div className="runtime-status-progress">
                <ProgressBar segments={[{ value: acknowledged + remaining === 0 ? 100 : (acknowledged / (acknowledged + remaining)) * 100, tone: "sync" }]} height={6} label={copy.drainingTitle} />
                <span className="gd-t-meta">{fill(copy.drainRemaining, { count: formatNumber(locale, remaining) })}</span>
              </div>
            ) : null}
            {kind === "security_locked" || kind === "retryable_locked" ? <p className="gd-t-meta">{copy.preservationNotice}</p> : null}
            <div className="runtime-status-actions">
              {kind === "security_locked" && onSignInAgain !== undefined ? <Button variant="primary" onClick={onSignInAgain}>{copy.signInAgain}</Button> : null}
              {(kind === "retryable_locked" || kind === "host_unavailable") && onRetry !== undefined
                ? <Button variant="primary" icon={<RefreshCwIcon size={14} />} onClick={onRetry}>{copy.retry}</Button> : null}
            </div>
          </div>
        </div>
      </NativeWindow>
    </div>
  );
}
