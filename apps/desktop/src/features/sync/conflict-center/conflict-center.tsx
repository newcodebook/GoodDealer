import type { ConflictCenterViewModel, ConflictResolutionChoice } from "@gooddealer/client-core";
import { getPresentationCopy, type Locale } from "@gooddealer/i18n";

export interface ConflictCenterProps {
  readonly value: ConflictCenterViewModel;
  readonly resolve: (candidateId: string, choice: ConflictResolutionChoice) => void;
  readonly locale?: Locale;
}

/** Hostile business values are inserted only as React text children. */
export function ConflictCenter({ value, resolve, locale = "en-US" }: ConflictCenterProps) {
  const copy = getPresentationCopy(locale, "conflictCenter") as {
    readonly title: string; readonly local: string; readonly remote: string;
    readonly keepLocal: string; readonly acceptRemote: string; readonly unavailable?: string;
  };
  return (
    <section aria-label={copy.title}>
      <h1>{copy.title}</h1>
      {value.conflicts.map((conflict) => (
        <article key={conflict.candidateId}>
          <h2>{conflict.entityDisplay}</h2>
          <p>{conflict.fieldDisplay}</p>
          <dl>
            <dt>{copy.local}</dt><dd>{conflict.localValue}</dd>
            <dt>{copy.remote}</dt><dd>{conflict.remoteValue}</dd>
          </dl>
          {conflict.resolutionAdmission.state === "available" ? (
            <div>
              {conflict.resolutionAdmission.choices.map((choice) => (
                <button type="button" key={choice} onClick={() => resolve(conflict.candidateId, choice)}>
                  {choice === "accept_remote" ? copy.acceptRemote : copy.keepLocal}
                </button>
              ))}
            </div>
          ) : <p>{copy.unavailable ?? "Review unavailable"}</p>}
        </article>
      ))}
    </section>
  );
}
