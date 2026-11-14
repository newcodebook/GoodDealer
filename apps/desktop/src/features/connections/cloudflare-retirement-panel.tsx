import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Banner, Button, Dialog, Panel } from "@gooddealer/ui";
import { useEffect, useRef, useState } from "react";

import type { CloudflareRetirementCandidate } from "../../adapters/tauri";
import type { CloudflareConnectionPort } from "./cloudflare-notice";

type Read = {
  readonly candidates: readonly CloudflareRetirementCandidate[];
  readonly supported: boolean;
  readonly busy: boolean;
};

/**
 * First confirmation is separate from retries; every action target and its action come from the
 * Host. Retirement deletes the slot; a case 1/2 revoke retry rewrites the exact recorded baseline.
 */
export function CloudflareRetirementPanel({ locale, port, onChanged }: {
  readonly locale: Locale;
  readonly port: CloudflareConnectionPort;
  readonly onChanged: () => void;
}) {
  const copy = getPresentationCopy(locale, "settings");
  const [read, setRead] = useState<Read | null>(null);
  const [confirmation, setConfirmation] = useState<CloudflareRetirementCandidate | null>(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<"complete" | "failed" | "revoked" | "revoke_failed" | null>(null);
  const [attempt, setAttempt] = useState(0);
  const generation = useRef(0);
  const inFlight = useRef(false);

  useEffect(() => {
    const current = ++generation.current;
    setRead(null);
    Promise.all([port.retirementCandidates(), port.status()]).then(([candidates, status]) => {
      if (generation.current === current) setRead({ candidates, supported: status.capturable, busy: status.state === "busy" || status.state === "blocked" });
    }).catch(() => { if (generation.current === current) setResult("failed"); });
    return () => { generation.current += 1; };
  }, [port, attempt]);

  const run = async (candidate: CloudflareRetirementCandidate) => {
    if (inFlight.current || running || read === null || read.busy || !read.supported) return;
    inFlight.current = true;
    const current = generation.current;
    const active = () => generation.current === current;
    setRunning(true);
    setConfirmation(null);
    setResult(null);
    try {
      const revoke = candidate.action === "retry_revoke";
      if (revoke) await port.revoke(candidate.connectionRef);
      else await port.purge(candidate.connectionRef, candidate.action === "retry_retirement" ? "retry_pending" : "confirm_retirement");
      // Only reads are polled: deletion is never automatically re-submitted by the Renderer.
      for (let poll = 0; poll < 1200; poll += 1) {
        if (!active()) return;
        const status = await port.status();
        if (!active()) return;
        if (status.state !== "busy") {
          const candidates = await port.retirementCandidates();
          if (!active()) return;
          const complete = status.lastOperation?.kind === (revoke ? "revoke" : "purge") && status.lastOperation.outcome === "confirmed"
            && !candidates.some((item) => item.connectionRef === candidate.connectionRef);
          setRead({ candidates, supported: status.capturable, busy: status.state === "blocked" });
          setResult(complete ? (revoke ? "revoked" : "complete") : (revoke ? "revoke_failed" : "failed"));
          onChanged();
          return;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, 500));
      }
      if (active()) setResult(candidate.action === "retry_revoke" ? "revoke_failed" : "failed");
    } catch {
      if (active()) {
        setResult(candidate.action === "retry_revoke" ? "revoke_failed" : "failed");
        // Submission may have committed before its response was lost. Never infer absence of a
        // durable request from an error; refresh so the next action is the Host's retry action.
        setAttempt((value) => value + 1);
      }
    } finally {
      inFlight.current = false;
      if (active()) setRunning(false);
    }
  };

  if (read !== null && read.candidates.length === 0 && result === null) return null;
  return <Panel title={copy.cloudflareCleanupTitle}>
    {result === null ? null : <Banner tone={result === "complete" || result === "revoked" ? "success" : "warning"} title={{
      complete: copy.cloudflareCleanupComplete,
      failed: copy.cloudflareCleanupFailed,
      revoked: copy.cloudflareRevoked,
      revoke_failed: copy.cloudflareRevokeRetryFailed,
    }[result]} />}
    {read === null ? <p className="gd-t-meta">{copy.cloudflareCleanupLoading}</p> : <>
      {read.supported ? null : <p className="gd-t-meta">{copy.cloudflareCleanupUnsupported}</p>}
      {read.candidates.map((candidate) => <div className="settings-conn" key={candidate.connectionRef}>
        <strong>{candidate.displayLabel}</strong>
        <p className="gd-t-meta">{{
          retire: copy.cloudflareCleanupReason,
          retry_retirement: copy.cloudflareCleanupPending,
          retry_revoke: copy.cloudflareRevokeRetryReason,
        }[candidate.action]}</p>
        <Button size="sm" disabled={running || read.busy || !read.supported} onClick={() => {
          // Only the first, irreversible retirement needs confirmation; a revoke retry restates
          // a revocation the user already chose, and a pending retirement was already confirmed.
          if (candidate.action === "retire") setConfirmation(candidate);
          else void run(candidate);
        }}>{{
          retire: copy.cloudflareCleanupAction,
          retry_retirement: copy.cloudflareCleanupRetry,
          retry_revoke: copy.cloudflareRevokeRetry,
        }[candidate.action]}</Button>
      </div>)}
    </>}
    {running ? <p role="status">{copy.cloudflareCleanupRunning}</p> : <Button size="sm" onClick={() => setAttempt((value) => value + 1)}>{copy.retryRead}</Button>}
    <Dialog open={confirmation !== null} title={copy.cloudflareCleanupConfirmTitle} danger closeLabel={copy.cancel} onClose={() => setConfirmation(null)} footer={<>
      <Button onClick={() => setConfirmation(null)}>{copy.cancel}</Button>
      <Button variant="primary" onClick={() => { if (confirmation !== null) void run(confirmation); }}>{copy.cloudflareCleanupConfirmAction}</Button>
    </>}><p>{confirmation?.displayLabel}</p><p>{copy.cloudflareCleanupConfirm}</p></Dialog>
  </Panel>;
}
