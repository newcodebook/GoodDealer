import { getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  Badge,
  Button,
  CheckIcon,
  Panel,
  RefreshCwIcon,
  ShieldAlertIcon,
  StatusDot,
} from "@gooddealer/ui";
import markUrl from "@gooddealer/ui/assets/logo/mark.svg";
import type { ReactElement } from "react";

import "./activation-wizard.css";

export type ActivationPresentation =
  | { readonly state: "pending"; readonly submitted: boolean }
  | {
      readonly state: "accepted";
      readonly workspace: { readonly kind: "personal-default"; readonly label: string };
    }
  | {
      readonly state: "rejected";
      readonly code:
        | "unauthenticated"
        | "invalid-request"
        | "already-active"
        | "temporarily-unavailable";
      readonly retryable: boolean;
    };

export interface ActivationActions {
  readonly onRetry?: () => void;
  readonly onContinue?: () => void;
}

export interface ActivationWizardProps {
  readonly locale: Locale;
  readonly presentation: ActivationPresentation;
  readonly actions?: ActivationActions;
}

export function ActivationWizard({
  locale,
  presentation,
  actions = {},
}: ActivationWizardProps): ReactElement {
  const activationCopy = getPresentationCopy(locale, "activation");
  const signInCopy = getPresentationCopy(locale, "signIn");
  const shellCopy = getPresentationCopy(locale, "shell");
  const operationCopy = getPresentationCopy(locale, "batchOperation");

  let content: ReactElement;
  if (presentation.state === "pending") {
    content = (
      <div className="gd-activation-state" data-activation-state="pending" aria-live="polite">
        <span className="gd-activation-icon gd-activation-icon--pending"><RefreshCwIcon size={30} /></span>
        <Badge tone="sync" dot>{presentation.submitted ? activationCopy.activating : activationCopy.activationReady}</Badge>
        <h1>{presentation.submitted ? activationCopy.activationInProgress : activationCopy.welcome}</h1>
      </div>
    );
  } else if (presentation.state === "accepted") {
    content = (
      <div className="gd-activation-state" data-activation-state="accepted">
        <span className="gd-activation-icon gd-activation-icon--accepted"><CheckIcon size={30} /></span>
        <Badge tone="success" dot>{activationCopy.done}</Badge>
        <h1>{activationCopy.completionTitle}</h1>
        <Panel>
          <div className="gd-activation-workspace">
            <StatusDot kind="success" />
            <strong>{presentation.workspace.label}</strong>
          </div>
        </Panel>
        {actions.onContinue === undefined ? null : (
          <Button type="button" variant="primary" onClick={actions.onContinue}>
            {activationCopy.enterWorkspace}
          </Button>
        )}
      </div>
    );
  } else {
    const rejectionDescription = {
      unauthenticated: signInCopy.signInTitle,
      "invalid-request": signInCopy.codeError,
      "already-active": activationCopy.done,
      "temporarily-unavailable": shellCopy.cloudUnavailable,
    }[presentation.code];

    content = (
      <div className="gd-activation-state" data-activation-state="rejected">
        <span className="gd-activation-icon gd-activation-icon--rejected"><ShieldAlertIcon size={30} /></span>
        <Badge tone="danger" dot>{operationCopy.partiallyFailed}</Badge>
        <h1>{operationCopy.partiallyFailed}</h1>
        <p>{rejectionDescription}</p>
        {presentation.retryable && actions.onRetry !== undefined ? (
          <Button type="button" variant="primary" onClick={actions.onRetry}>
            <RefreshCwIcon size={14} />{operationCopy.retryable}
          </Button>
        ) : null}
      </div>
    );
  }

  return (
    <section className="gd-activation" aria-label={activationCopy.welcome}>
      <header className="gd-activation-brand">
        <img src={markUrl} width="36" height="36" alt="" />
        <strong>GoodDealer</strong>
      </header>
      {content}
    </section>
  );
}
