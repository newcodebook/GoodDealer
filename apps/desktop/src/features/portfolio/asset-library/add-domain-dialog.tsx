import { canonicalizeDomainName, type CanonicalDomainName } from "@gooddealer/client-core";
import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import { Button, Dialog, Input } from "@gooddealer/ui";
import { useState } from "react";

/**
 * What the Host did with one add: the domain is the deduplication key, so a held one is `exists`,
 * and a deleted one is `deleted`: no path purges its tombstone yet, so it cannot be re-added.
 */
export type AddDomainOutcome = "added" | "exists" | "deleted" | "failed";

export interface AddDomainDialogProps {
  readonly locale: Locale;
  readonly open: boolean;
  readonly onClose: () => void;
  /** Receives only a canonical ASCII domain; anything else never leaves the dialog. */
  readonly onSubmit: (domain: CanonicalDomainName) => Promise<AddDomainOutcome>;
}

type Problem = Exclude<AddDomainOutcome, "added"> | "invalid" | null;

/**
 * Adds one domain by hand. The typed name is canonicalized here (IDNA ASCII, no path, port or IP
 * literal) and the Host checks it again; a domain the workspace already holds is reported, not
 * merged, so importing and adding by hand cannot produce two assets.
 */
export function AddDomainDialog({ locale, open, onClose, onSubmit }: AddDomainDialogProps) {
  const copy = getPresentationCopy(locale, "assetLibrary");
  const [value, setValue] = useState("");
  const [problem, setProblem] = useState<Problem>(null);
  const [busy, setBusy] = useState(false);
  const close = () => { setValue(""); setProblem(null); onClose(); };
  const submit = () => {
    let domain: CanonicalDomainName;
    try { domain = canonicalizeDomainName(value.trim()); }
    catch { setProblem("invalid"); return; }
    setBusy(true);
    void onSubmit(domain)
      .catch((): AddDomainOutcome => "failed")
      .then((outcome) => {
        setBusy(false);
        if (outcome === "added") close();
        else setProblem(outcome);
      });
  };
  const message = problem === null ? undefined : {
    invalid: copy.domainInvalid,
    exists: copy.domainExists,
    deleted: copy.domainDeleted,
    failed: copy.addDomainFailed,
  }[problem];

  return (
    <Dialog
      open={open}
      onClose={close}
      title={copy.addDomainTitle}
      width={420}
      footer={(
        <>
          <Button onClick={close}>{copy.cancel}</Button>
          <Button variant="primary" disabled={busy || value.trim() === ""} onClick={submit}>{copy.addDomainAction}</Button>
        </>
      )}
    >
      <Input
        label={copy.domainName}
        value={value}
        mono
        autoFocus
        placeholder="example.com"
        hint={copy.addDomainHint}
        {...(message === undefined ? {} : { error: message })}
        onChange={(event) => { setValue(event.currentTarget.value); setProblem(null); }}
        onKeyDown={(event) => { if (event.key === "Enter" && !busy && value.trim() !== "") submit(); }}
      />
    </Dialog>
  );
}
