import "@gooddealer/ui/tokens.css";
import { getAccountCopy, type Locale } from "@gooddealer/i18n";
import faviconUrl from "@gooddealer/ui/assets/logo/mark-16.svg";
import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";

import { AccountApp } from "./app/account-app";
import { AccountController } from "./app/account-controller";
import { environmentLabelKey, parseAccountWebEnvironment } from "./app/account-environment";
import { initialAccountLocale, rememberAccountLocale } from "./app/account-locale";

// Composition root: binds the controller to this browser and renders. Flow logic lives in
// AccountController; nothing here decides account or billing state.
const environment = parseAccountWebEnvironment(__GOODDEALER_ACCOUNT_WEB_ENVIRONMENT__);
const root = document.getElementById("root");
if (root === null) throw new Error("Account Web root element is missing");

const icon = document.createElement("link");
icon.rel = "icon";
icon.type = "image/svg+xml";
icon.href = faviconUrl;
document.head.append(icon);

const controller = new AccountController({
  fetch: (path, init) => fetch(path, init),
  storage: localStorage,
  location: {
    origin: location.origin,
    pathname: location.pathname,
    search: location.search,
    assign: (url) => location.assign(url),
    replace: (url) => location.replace(url),
  },
  now: () => Date.now(),
  randomId: () => crypto.randomUUID(),
  setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimeout: (handle) => window.clearTimeout(handle as number),
});
window.addEventListener("storage", (event) => {
  if (event.storageArea === localStorage) controller.handleStorage(event.key, event.newValue);
});

const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;

function Root() {
  const [locale, setLocale] = useState<Locale>(() => initialAccountLocale(localStorage, navigator.languages));
  const labelKey = environmentLabelKey(environment);
  return (
    <AccountApp
      controller={controller}
      locale={locale}
      onLocaleChange={(next) => { rememberAccountLocale(localStorage, next); setLocale(next); }}
      timeZone={timeZone}
      {...(labelKey === null ? {} : { environmentLabel: getAccountCopy(locale, "accountShell")[labelKey] })}
    />
  );
}

createRoot(root).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
void controller.start();
