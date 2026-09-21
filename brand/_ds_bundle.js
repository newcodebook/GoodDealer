/* @ds-bundle: {"format":5,"generator":"scripts/generate-brand-design-system-bundle.mjs","namespace":"GoodDealerDesignSystem_b5b0b6","components":[{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"IconButton","sourcePath":"components/buttons/IconButton.jsx"},{"name":"Checkbox","sourcePath":"components/inputs/Checkbox.jsx"},{"name":"Input","sourcePath":"components/inputs/Input.jsx"},{"name":"Select","sourcePath":"components/inputs/Select.jsx"},{"name":"Switch","sourcePath":"components/inputs/Switch.jsx"},{"name":"StatusBar","sourcePath":"components/navigation/StatusBar.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Dialog","sourcePath":"components/overlay/Dialog.jsx"},{"name":"Tooltip","sourcePath":"components/overlay/Tooltip.jsx"},{"name":"Badge","sourcePath":"components/status/Badge.jsx"},{"name":"DiffValue","sourcePath":"components/status/DiffValue.jsx"},{"name":"Money","sourcePath":"components/status/Money.jsx"},{"name":"ProgressBar","sourcePath":"components/status/ProgressBar.jsx"},{"name":"StatusDot","sourcePath":"components/status/StatusDot.jsx"},{"name":"Tag","sourcePath":"components/status/Tag.jsx"},{"name":"KpiStat","sourcePath":"components/surfaces/KpiStat.jsx"},{"name":"Panel","sourcePath":"components/surfaces/Panel.jsx"},{"name":"Toolbar","sourcePath":"components/surfaces/Toolbar.jsx"},{"name":"WindowChrome","sourcePath":"components/surfaces/WindowChrome.jsx"},{"name":"BatchBar","sourcePath":"components/table/BatchBar.jsx"},{"name":"Pagination","sourcePath":"components/table/Pagination.jsx"},{"name":"Table","sourcePath":"components/table/Table.jsx"}],"sourceHashes":{"components/buttons/Button.jsx":"06f13793a4c3","components/buttons/IconButton.jsx":"5073d2ee2468","components/inputs/Checkbox.jsx":"eab26333fdff","components/inputs/Input.jsx":"28bc9a3cfb1e","components/inputs/Select.jsx":"13bef0c63f99","components/inputs/Switch.jsx":"e2b8bc78d246","components/navigation/StatusBar.jsx":"6b8a50890fd0","components/navigation/Tabs.jsx":"292f9554a615","components/overlay/Dialog.jsx":"76f86cbedce4","components/overlay/Tooltip.jsx":"0dc6e2c56a61","components/status/Badge.jsx":"c0d923706bbc","components/status/DiffValue.jsx":"1cb3d1ff1b04","components/status/Money.jsx":"265b084b3d35","components/status/ProgressBar.jsx":"1a02180b9287","components/status/StatusDot.jsx":"3e7a02a85357","components/status/Tag.jsx":"88ba07570965","components/surfaces/KpiStat.jsx":"a3935e7c2da7","components/surfaces/Panel.jsx":"7af100184d7e","components/surfaces/Toolbar.jsx":"be0f9dfc2c9b","components/surfaces/WindowChrome.jsx":"49f93dd09b9a","components/table/BatchBar.jsx":"399466fcca69","components/table/Pagination.jsx":"8fd31f35c36a","components/table/Table.jsx":"7964646bfb44","ui_kits/account-web/AccountDashboard.jsx":"4e0abf59677c","ui_kits/account-web/AccountSettings.jsx":"4059e6c59bcf","ui_kits/account-web/AccountShell.jsx":"f5e3a1030316","ui_kits/account-web/Billing.jsx":"7cbd1a4b713c","ui_kits/account-web/CloudData.jsx":"94c4a81e043e","ui_kits/account-web/Devices.jsx":"6af7f3d85b6c","ui_kits/account-web/Download.jsx":"50ca4f3cce83","ui_kits/account-web/License.jsx":"f5b5113bc631","ui_kits/account-web/Security.jsx":"9f1a153c2612","ui_kits/account-web/controls.jsx":"dcc2609626ba","ui_kits/account-web/data.js":"224f3899625c","ui_kits/account-web/icons.jsx":"6457ba54991e","ui_kits/admin-web/AdminDashboard.jsx":"d38c91bec767","ui_kits/admin-web/AdminShell.jsx":"9856258bc87c","ui_kits/admin-web/Announcements.jsx":"50652c49f78e","ui_kits/admin-web/Audit.jsx":"f781388e5c56","ui_kits/admin-web/Config.jsx":"f4f7a909724b","ui_kits/admin-web/Customers.jsx":"9c4ecfd4ec1e","ui_kits/admin-web/Fleet.jsx":"14236042bdb1","ui_kits/admin-web/Licenses.jsx":"b3f99eead63b","ui_kits/admin-web/Revenue.jsx":"d60c88403e5e","ui_kits/admin-web/Support.jsx":"b765ea0a376c","ui_kits/admin-web/SyncInfra.jsx":"297304c7faf5","ui_kits/admin-web/controls.jsx":"dcc2609626ba","ui_kits/admin-web/data.js":"74021f68a1cb","ui_kits/admin-web/icons.jsx":"6457ba54991e","ui_kits/desktop/AssetLibrary.jsx":"0835b46ff655","ui_kits/desktop/BatchPreview.jsx":"f9080e120842","ui_kits/desktop/ConflictCenter.jsx":"0a733db80ba7","ui_kits/desktop/DnsVerify.jsx":"2f5b367690c0","ui_kits/desktop/DomainDetail.jsx":"341c32cc552e","ui_kits/desktop/HistoryLog.jsx":"e7b6f789fa65","ui_kits/desktop/Onboarding.jsx":"e9a5eab61bb6","ui_kits/desktop/RenewDesk.jsx":"01266ba2165a","ui_kits/desktop/SalesDesk.jsx":"39d28c2c4dee","ui_kits/desktop/SettingsPanel.jsx":"460596339be3","ui_kits/desktop/Shell.jsx":"c758843b23b7","ui_kits/desktop/SignIn.jsx":"4de44c94b53b","ui_kits/desktop/TaskInbox.jsx":"5bc32f07cd02","ui_kits/desktop/controls.jsx":"dcc2609626ba","ui_kits/desktop/data.js":"d24f606c3fc6","ui_kits/desktop/dialogs.jsx":"e2796821d7aa","ui_kits/desktop/icons.jsx":"c9a0fded6c44"},"inlinedExternals":[],"unexposedExports":[{"name":"ensureGdCss","sourcePath":"components/buttons/Button.jsx"}]} */

(() => {
const __ds_ns = (window.GoodDealerDesignSystem_b5b0b6 = window.GoodDealerDesignSystem_b5b0b6 || {});
const __ds_scope = {};
(__ds_ns.__errors = __ds_ns.__errors || []);

// components/buttons/Button.jsx
try { (() => {
const css = `
.gd-btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:var(--radius-sm);border:1px solid transparent;font-family:var(--font-sans);font-weight:500;cursor:pointer;white-space:nowrap;transition:background var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.gd-btn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.gd-btn[disabled]{opacity:.45;cursor:default;pointer-events:none}
.gd-btn--primary[disabled]{opacity:1;background:var(--gd-line);border-color:var(--gd-line-strong);color:var(--gd-text-faint)}
.gd-btn--danger[disabled]{opacity:1;background:rgba(201,80,60,0.20);border-color:rgba(201,80,60,0.40);color:rgba(229,115,95,0.72)}
.gd-btn--sm{height:var(--control-sm);padding:0 10px;font-size:12px}
.gd-btn--md{height:var(--control-md);padding:0 12px;font-size:13px}
.gd-btn--lg{height:var(--control-lg);padding:0 16px;font-size:14px}
.gd-btn--primary{background:var(--gd-blue);color:#fff}
.gd-btn--primary:hover{background:#6098FF}
.gd-btn--primary:active{background:var(--gd-blue-pressed)}
.gd-btn--secondary{background:var(--gd-panel-raised);border-color:var(--gd-line-strong);color:var(--gd-text)}
.gd-btn--secondary:hover{background:#1A1E28;border-color:#343B4E}
.gd-btn--secondary:active{background:var(--gd-panel)}
.gd-btn--ghost{background:transparent;color:var(--gd-text-muted)}
.gd-btn--ghost:hover{background:var(--gd-panel-raised);color:var(--gd-text)}
.gd-btn--ghost:active{background:var(--gd-panel)}
.gd-btn--danger{background:#C9503C;color:#fff}
.gd-btn--danger:hover{background:#D65A45}
.gd-btn--danger:active{background:#B04533}
.gd-btn--gold{background:transparent;border-color:rgba(212,164,55,0.5);color:var(--gd-gold)}
.gd-btn--gold:hover{background:var(--gd-gold-tint);border-color:var(--gd-gold)}
.gd-btn--gold:active{background:rgba(212,164,55,0.16)}
`;
function ensureGdCss(id, text) {
  if (typeof document !== "undefined" && !document.getElementById(id)) {
    const s = document.createElement("style");
    s.id = id;
    s.textContent = text;
    document.head.appendChild(s);
  }
}
ensureGdCss("gd-btn-css", css);
function Button({ variant = "secondary", size = "md", icon, children, block, ...rest }) {
  return /* @__PURE__ */ React.createElement("button", { className: `gd-btn gd-btn--${size} gd-btn--${variant}`, style: block ? { width: "100%" } : void 0, ...rest }, icon, children);
}
Object.assign(__ds_scope, { ensureGdCss, Button });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((error && error.message) || error) }); }

// components/buttons/IconButton.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-iconbtn{display:inline-flex;align-items:center;justify-content:center;border-radius:var(--radius-sm);border:1px solid transparent;background:transparent;color:var(--gd-text-muted);cursor:pointer;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.gd-iconbtn:hover{background:var(--gd-panel-raised);color:var(--gd-text)}
.gd-iconbtn:active{background:var(--gd-panel)}
.gd-iconbtn:focus-visible{outline:none;box-shadow:var(--focus-ring)}
.gd-iconbtn[disabled]{opacity:.45;pointer-events:none}
.gd-iconbtn--outline{border-color:var(--gd-line-strong);background:var(--gd-panel-raised)}
.gd-iconbtn--sm{width:var(--control-sm);height:var(--control-sm)}
.gd-iconbtn--md{width:var(--control-md);height:var(--control-md)}
`;
ensureGdCss("gd-iconbtn-css", css);
function IconButton({ variant = "ghost", size = "md", label, children, ...rest }) {
  return /* @__PURE__ */ React.createElement("button", { className: `gd-iconbtn gd-iconbtn--${size}${variant === "outline" ? " gd-iconbtn--outline" : ""}`, title: label, "aria-label": label, ...rest }, children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/buttons/IconButton.jsx", error: String((error && error.message) || error) }); }

// components/inputs/Checkbox.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-check{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--gd-text);user-select:none}
.gd-check input{position:absolute;opacity:0;width:0;height:0}
.gd-check-box{width:15px;height:15px;flex:none;border-radius:var(--radius-xs);border:1px solid var(--gd-line-strong);background:var(--gd-ink);display:inline-flex;align-items:center;justify-content:center;transition:background var(--dur-fast) var(--ease-out),border-color var(--dur-fast) var(--ease-out)}
.gd-check:hover .gd-check-box{border-color:#3A4256}
.gd-check input:focus-visible+.gd-check-box{box-shadow:var(--focus-ring)}
.gd-check input:checked+.gd-check-box,.gd-check-box--ind{background:var(--gd-blue);border-color:var(--gd-blue)}
.gd-check svg{display:none}
.gd-check input:checked+.gd-check-box svg.gd-check-tick{display:block}
.gd-check-box--ind svg.gd-check-dash{display:block}
.gd-check--disabled{opacity:.45;pointer-events:none}
`;
ensureGdCss("gd-check-css", css);
function Checkbox({ checked, indeterminate, onChange, label, disabled, stop }) {
  return /* @__PURE__ */ React.createElement("label", { className: `gd-check${disabled ? " gd-check--disabled" : ""}`, onClick: stop ? (e) => e.stopPropagation() : void 0 }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!checked, disabled, onChange: onChange || (() => {
  }) }), /* @__PURE__ */ React.createElement("span", { className: `gd-check-box${indeterminate && !checked ? " gd-check-box--ind" : ""}` }, /* @__PURE__ */ React.createElement("svg", { className: "gd-check-tick", width: "9", height: "9", viewBox: "0 0 10 10", fill: "none" }, /* @__PURE__ */ React.createElement("path", { d: "M1.5 5.5L4 8L8.5 2", stroke: "#fff", strokeWidth: "1.8", strokeLinecap: "round", strokeLinejoin: "round" })), /* @__PURE__ */ React.createElement("svg", { className: "gd-check-dash", width: "9", height: "9", viewBox: "0 0 10 10", fill: "none" }, /* @__PURE__ */ React.createElement("path", { d: "M2 5H8", stroke: "#fff", strokeWidth: "1.8", strokeLinecap: "round" }))), label && /* @__PURE__ */ React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/inputs/Checkbox.jsx", error: String((error && error.message) || error) }); }

// components/inputs/Input.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-field{display:flex;flex-direction:column;gap:5px;min-width:0}
.gd-field-label{font-size:11px;letter-spacing:var(--tracking-caps);text-transform:uppercase;font-weight:500;color:var(--gd-text-muted)}
.gd-input-wrap{display:flex;align-items:center;gap:7px;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);padding:0 9px;transition:border-color var(--dur-fast) var(--ease-out),box-shadow var(--dur-fast) var(--ease-out)}
.gd-input-wrap:focus-within{border-color:var(--gd-blue);box-shadow:var(--focus-ring)}
.gd-input-wrap--error{border-color:var(--gd-danger)}
.gd-input-wrap--sm{height:var(--control-sm)}.gd-input-wrap--md{height:var(--control-md)}.gd-input-wrap--lg{height:var(--control-lg)}
.gd-input{flex:1;min-width:0;background:none;border:none;outline:none;color:var(--gd-text);font-family:var(--font-sans);font-size:13px}
.gd-input--mono{font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.gd-input::placeholder{color:var(--gd-text-faint)}
.gd-input-affix{display:flex;align-items:center;color:var(--gd-text-faint);font-size:12px}
.gd-field-hint{font-size:11px;color:var(--gd-text-faint)}.gd-field-hint--error{color:var(--gd-danger)}
`;
ensureGdCss("gd-input-css", css);
function Input({ label, size = "md", mono, prefix, suffix, error, hint, style, ...rest }) {
  return /* @__PURE__ */ React.createElement("label", { className: "gd-field", style }, label && /* @__PURE__ */ React.createElement("span", { className: "gd-field-label" }, label), /* @__PURE__ */ React.createElement("span", { className: `gd-input-wrap gd-input-wrap--${size}${error ? " gd-input-wrap--error" : ""}` }, prefix && /* @__PURE__ */ React.createElement("span", { className: "gd-input-affix" }, prefix), /* @__PURE__ */ React.createElement("input", { className: `gd-input${mono ? " gd-input--mono" : ""}`, ...rest }), suffix && /* @__PURE__ */ React.createElement("span", { className: "gd-input-affix" }, suffix)), (error || hint) && /* @__PURE__ */ React.createElement("span", { className: `gd-field-hint${error ? " gd-field-hint--error" : ""}` }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/inputs/Input.jsx", error: String((error && error.message) || error) }); }

// components/inputs/Select.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-select{appearance:none;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);color:var(--gd-text);font-family:var(--font-sans);font-size:13px;padding:0 26px 0 9px;cursor:pointer;transition:border-color var(--dur-fast) var(--ease-out)}
.gd-select:focus-visible{outline:none;border-color:var(--gd-blue);box-shadow:0 0 0 2px rgba(77,141,255,0.25)}
.gd-select:hover{border-color:#343B4E}
.gd-select--sm{height:var(--control-sm)}.gd-select--md{height:var(--control-md)}.gd-select--lg{height:var(--control-lg)}
.gd-select-wrap{position:relative;display:inline-flex}
.gd-select-wrap:after{content:"";position:absolute;right:9px;top:50%;margin-top:-2px;width:7px;height:7px;border-right:1.5px solid var(--gd-text-muted);border-bottom:1.5px solid var(--gd-text-muted);transform:rotate(45deg) translateY(-50%);pointer-events:none}
`;
ensureGdCss("gd-select-css", css);
function Select({ label, size = "md", options = [], style, ...rest }) {
  const sel = /* @__PURE__ */ React.createElement("span", { className: "gd-select-wrap", style: label ? void 0 : style }, /* @__PURE__ */ React.createElement("select", { className: `gd-select gd-select--${size}`, ...rest }, options.map((o) => typeof o === "string" ? /* @__PURE__ */ React.createElement("option", { key: o, value: o }, o) : /* @__PURE__ */ React.createElement("option", { key: o.value, value: o.value }, o.label))));
  if (!label) return sel;
  return /* @__PURE__ */ React.createElement("label", { className: "gd-field", style }, /* @__PURE__ */ React.createElement("span", { className: "gd-field-label" }, label), sel);
}
Object.assign(__ds_scope, { Select });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/inputs/Select.jsx", error: String((error && error.message) || error) }); }

// components/inputs/Switch.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-switch{display:inline-flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:var(--gd-text);user-select:none}
.gd-switch input{position:absolute;opacity:0;width:0;height:0}
.gd-switch-track{width:30px;height:17px;flex:none;border-radius:999px;background:var(--gd-line-strong);position:relative;transition:background var(--dur-base) var(--ease-out)}
.gd-switch-track:after{content:"";position:absolute;left:2px;top:2px;width:13px;height:13px;border-radius:50%;background:var(--gd-text);transition:transform var(--dur-base) var(--ease-out)}
.gd-switch input:checked+.gd-switch-track{background:var(--gd-blue)}
.gd-switch input:checked+.gd-switch-track:after{transform:translateX(13px);background:#fff}
.gd-switch input:focus-visible+.gd-switch-track{box-shadow:var(--focus-ring)}
.gd-switch--disabled{opacity:.45;pointer-events:none}
`;
ensureGdCss("gd-switch-css", css);
function Switch({ checked, onChange, label, disabled }) {
  return /* @__PURE__ */ React.createElement("label", { className: `gd-switch${disabled ? " gd-switch--disabled" : ""}` }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: !!checked, disabled, onChange: onChange || (() => {
  }) }), /* @__PURE__ */ React.createElement("span", { className: "gd-switch-track" }), label && /* @__PURE__ */ React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/inputs/Switch.jsx", error: String((error && error.message) || error) }); }

// components/navigation/StatusBar.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-statusbar{height:var(--statusbar-h);flex:none;display:flex;align-items:center;padding:0 6px;background:var(--gd-chrome);border-top:1px solid var(--gd-line);font-family:var(--font-mono);font-size:11px;font-variant-numeric:tabular-nums;color:var(--text-2);user-select:none}
.gd-statusbar-seg{display:inline-flex;align-items:center;gap:6px;padding:0 10px;white-space:nowrap}
.gd-statusbar-div{width:1px;height:12px;background:var(--gd-line-strong);flex:none}
.gd-statusbar-spacer{flex:1}
`;
ensureGdCss("gd-statusbar-css", css);
function join(arr) {
  const out = [];
  arr.forEach((n, i) => {
    if (i) out.push(/* @__PURE__ */ React.createElement("span", { key: "d" + i, className: "gd-statusbar-div" }));
    out.push(/* @__PURE__ */ React.createElement("span", { key: i, className: "gd-statusbar-seg" }, n));
  });
  return out;
}
function StatusBar({ left = [], right = [], style }) {
  return /* @__PURE__ */ React.createElement("footer", { className: "gd-statusbar", style }, join(left), /* @__PURE__ */ React.createElement("span", { className: "gd-statusbar-spacer" }), join(right));
}
Object.assign(__ds_scope, { StatusBar });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/navigation/StatusBar.jsx", error: String((error && error.message) || error) }); }

// components/navigation/Tabs.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-tabs{display:flex;gap:2px;border-bottom:1px solid var(--gd-line);align-items:flex-end}
.gd-tab{background:none;border:none;cursor:pointer;font-family:var(--font-sans);font-size:13px;color:var(--gd-text-muted);padding:7px 10px 9px;position:relative;transition:color var(--dur-fast) var(--ease-out);display:inline-flex;align-items:center;gap:6px}
.gd-tab:hover{color:var(--gd-text)}
.gd-tab:focus-visible{outline:none;box-shadow:var(--focus-ring);border-radius:4px}
.gd-tab--active{color:var(--gd-text);font-weight:500}
.gd-tab--active:after{content:"";position:absolute;left:8px;right:8px;bottom:-1px;height:2px;background:var(--gd-gold)}
.gd-tab-count{font-family:var(--font-mono);font-size:10px;color:var(--gd-text-faint);background:var(--gd-panel-raised);border:1px solid var(--gd-line);border-radius:999px;padding:0 6px;line-height:15px}
.gd-tab--active .gd-tab-count{color:var(--gd-text-muted)}
`;
ensureGdCss("gd-tabs-css", css);
function Tabs({ items = [], active, onChange, style }) {
  return /* @__PURE__ */ React.createElement("div", { className: "gd-tabs", style, role: "tablist" }, items.map((it) => /* @__PURE__ */ React.createElement("button", { key: it.key, role: "tab", "aria-selected": active === it.key, className: `gd-tab${active === it.key ? " gd-tab--active" : ""}`, onClick: () => onChange && onChange(it.key) }, it.label, it.count != null && /* @__PURE__ */ React.createElement("span", { className: "gd-tab-count" }, it.count))));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((error && error.message) || error) }); }

// components/overlay/Dialog.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-dialog-scrim{position:fixed;inset:0;background:var(--surface-overlay);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:100;animation:gd-fade var(--dur-base) var(--ease-out)}
.gd-dialog{background:var(--gd-panel);border:1px solid var(--gd-line-strong);border-radius:var(--radius-lg);box-shadow:var(--shadow-overlay);display:flex;flex-direction:column;max-height:82vh;animation:gd-rise var(--dur-base) var(--ease-out)}
@keyframes gd-fade{from{opacity:0}to{opacity:1}}
@keyframes gd-rise{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
.gd-dialog-head{display:flex;align-items:center;gap:10px;padding:14px 16px;border-bottom:1px solid var(--gd-line)}
.gd-dialog-title{font-size:15px;font-weight:600;flex:1}
.gd-dialog-x{background:none;border:none;color:var(--gd-text-faint);cursor:pointer;font-size:16px;line-height:1;padding:4px;border-radius:4px;font-family:var(--font-sans)}
.gd-dialog-x:hover{color:var(--gd-text);background:var(--gd-panel-raised)}
.gd-dialog-body{padding:16px;overflow:auto;font-size:13px;color:var(--gd-text)}
.gd-dialog-foot{display:flex;justify-content:flex-end;gap:8px;padding:12px 16px;border-top:1px solid var(--gd-line)}
.gd-dialog--danger .gd-dialog-title{color:var(--gd-danger)}
`;
ensureGdCss("gd-dialog-css", css);
function Dialog({ open, onClose, title, children, footer, width = 440, danger }) {
  React.useEffect(() => {
    if (!open) return;
    const h = (e) => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "gd-dialog-scrim", onMouseDown: (e) => {
    if (e.target === e.currentTarget && onClose) onClose();
  } }, /* @__PURE__ */ React.createElement("div", { className: `gd-dialog${danger ? " gd-dialog--danger" : ""}`, style: { width }, role: "dialog", "aria-modal": "true" }, /* @__PURE__ */ React.createElement("div", { className: "gd-dialog-head" }, /* @__PURE__ */ React.createElement("span", { className: "gd-dialog-title" }, title), onClose && /* @__PURE__ */ React.createElement("button", { className: "gd-dialog-x", onClick: onClose, "aria-label": "关闭" }, "✕")), /* @__PURE__ */ React.createElement("div", { className: "gd-dialog-body" }, children), footer && /* @__PURE__ */ React.createElement("div", { className: "gd-dialog-foot" }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/overlay/Dialog.jsx", error: String((error && error.message) || error) }); }

// components/overlay/Tooltip.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-tip{position:relative;display:inline-flex}
.gd-tip-bubble{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%) translateY(2px);background:var(--gd-panel-raised);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);box-shadow:var(--shadow-raised);color:var(--gd-text);font-size:11px;line-height:1.4;padding:5px 8px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out);z-index:50}
.gd-tip:hover .gd-tip-bubble,.gd-tip:focus-within .gd-tip-bubble{opacity:1;transform:translateX(-50%) translateY(0)}
`;
ensureGdCss("gd-tip-css", css);
function Tooltip({ label, children, style }) {
  return /* @__PURE__ */ React.createElement("span", { className: "gd-tip", style }, children, /* @__PURE__ */ React.createElement("span", { className: "gd-tip-bubble", role: "tooltip" }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/overlay/Tooltip.jsx", error: String((error && error.message) || error) }); }

// components/status/Badge.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-badge{display:inline-flex;align-items:center;gap:5px;border-radius:var(--radius-full);padding:2px 8px;font-family:var(--font-mono);font-size:10px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap}
.gd-badge--sans{font-family:var(--font-sans);font-size:11px;letter-spacing:0;text-transform:none}
.gd-badge-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
`;
ensureGdCss("gd-badge-css", css);
const TONES = {
  sync: { color: "var(--gd-blue)", background: "var(--gd-blue-tint)" },
  gold: { color: "var(--gd-gold)", background: "var(--gd-gold-tint)" },
  success: { color: "var(--gd-success)", background: "var(--gd-success-tint)" },
  warning: { color: "var(--gd-warning)", background: "var(--gd-warning-tint)" },
  danger: { color: "var(--gd-danger)", background: "var(--gd-danger-tint)" },
  neutral: { color: "var(--gd-text-muted)", background: "rgba(141,147,163,0.12)" }
};
function Badge({ tone = "neutral", dot, mono = true, children, style }) {
  return /* @__PURE__ */ React.createElement("span", { className: `gd-badge${mono ? "" : " gd-badge--sans"}`, style: { ...TONES[tone] || TONES.neutral, ...style } }, dot && /* @__PURE__ */ React.createElement("span", { className: "gd-badge-dot" }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/status/Badge.jsx", error: String((error && error.message) || error) }); }

// components/status/DiffValue.jsx
try { (() => {
function DiffValue({ oldValue, newValue, mono = true, size = 12, style }) {
  const f = mono ? { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" } : {};
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: size, ...f, ...style } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", textDecoration: "line-through", textDecorationColor: "rgba(92,98,114,0.6)" } }, oldValue ?? "—"), /* @__PURE__ */ React.createElement("svg", { width: "11", height: "8", viewBox: "0 0 12 8", fill: "none", style: { flex: "none" } }, /* @__PURE__ */ React.createElement("path", { d: "M1 4H10M10 4L7 1M10 4L7 7", stroke: "var(--gd-text-muted)", strokeWidth: "1.2", strokeLinecap: "round", strokeLinejoin: "round" })), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text)" } }, newValue ?? "—"));
}
Object.assign(__ds_scope, { DiffValue });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/status/DiffValue.jsx", error: String((error && error.message) || error) }); }

// components/status/Money.jsx
try { (() => {
function Money({ amount, currency = "USD", size = 13, tone = "gold", showCurrency = false, sign = false, style }) {
  let text = amount;
  if (typeof amount === "number") {
    const abs = Math.abs(amount);
    text = abs.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (amount < 0) text = "−" + text;
    else if (sign && amount > 0) text = "+" + text;
  }
  const colors = { gold: "var(--gd-gold)", body: "var(--gd-text)", muted: "var(--gd-text-muted)", success: "var(--gd-success)", danger: "var(--gd-danger)" };
  if (amount == null || amount === "") return /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontFamily: "var(--font-mono)", fontSize: size, ...style } }, "—");
  return /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: size, color: colors[tone] || colors.gold, ...style } }, showCurrency && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: Math.max(10, size - 3), marginRight: 5 } }, currency), text);
}
Object.assign(__ds_scope, { Money });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/status/Money.jsx", error: String((error && error.message) || error) }); }

// components/status/ProgressBar.jsx
try { (() => {
function ProgressBar({ segments, value, max = 100, height = 6, showTrack = true, style }) {
  const segs = segments || [{ value: Math.min(100, value / max * 100), tone: "sync" }];
  const colors = { sync: "var(--gd-blue)", gold: "var(--gd-gold)", success: "var(--gd-success)", warning: "var(--gd-warning)", danger: "var(--gd-danger)", neutral: "var(--gd-viz-drawdown)" };
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height, borderRadius: height / 2, overflow: "hidden", background: showTrack ? "var(--gd-line)" : "transparent", width: "100%", ...style } }, segs.map((s, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { width: `${s.value}%`, background: colors[s.tone] || colors.sync, transition: "width var(--dur-slow) var(--ease-out)" } })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/status/ProgressBar.jsx", error: String((error && error.message) || error) }); }

// components/status/StatusDot.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-statusdot{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--gd-text-muted)}
.gd-statusdot-i{border-radius:50%;flex:none;box-sizing:border-box}
@keyframes gd-dot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.gd-statusdot--pulse .gd-statusdot-i{animation:gd-dot-pulse 1.6s var(--ease-out) infinite}
`;
ensureGdCss("gd-statusdot-css", css);
const KINDS = {
  active: { background: "var(--gd-gold)" },
  standby: { background: "transparent", border: "1.5px solid var(--gd-blue)" },
  sync: { background: "var(--gd-blue)" },
  success: { background: "var(--gd-success)" },
  warning: { background: "var(--gd-warning)" },
  danger: { background: "var(--gd-danger)" },
  neutral: { background: "var(--gd-viz-drawdown)" }
};
function StatusDot({ kind = "neutral", label, size = 8, pulse, style }) {
  return /* @__PURE__ */ React.createElement("span", { className: `gd-statusdot${pulse ? " gd-statusdot--pulse" : ""}`, style }, /* @__PURE__ */ React.createElement("span", { className: "gd-statusdot-i", style: { width: size, height: size, ...KINDS[kind] || KINDS.neutral } }), label && /* @__PURE__ */ React.createElement("span", null, label));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/status/StatusDot.jsx", error: String((error && error.message) || error) }); }

// components/status/Tag.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-tag{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--gd-line-strong);background:var(--gd-panel-raised);border-radius:var(--radius-xs);padding:1px 7px;font-size:11px;color:var(--gd-text-muted);white-space:nowrap}
.gd-tag-x{background:none;border:none;padding:0;margin-left:1px;cursor:pointer;color:var(--gd-text-faint);font-size:12px;line-height:1;font-family:var(--font-sans)}
.gd-tag-x:hover{color:var(--gd-text)}
`;
ensureGdCss("gd-tag-css", css);
function Tag({ color, children, onRemove, style }) {
  return /* @__PURE__ */ React.createElement("span", { className: "gd-tag", style }, color && /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: color, flex: "none" } }), children, onRemove && /* @__PURE__ */ React.createElement("button", { className: "gd-tag-x", onClick: onRemove, "aria-label": "移除" }, "×"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/status/Tag.jsx", error: String((error && error.message) || error) }); }

// components/surfaces/KpiStat.jsx
try { (() => {
const { Money } = __ds_scope;
function KpiStat({ label, value, currency, tone = "body", meta, style }) {
  const isNum = typeof value === "number";
  const toneColor = tone === "gold" ? "var(--gd-gold)" : tone === "danger" ? "var(--gd-danger)" : tone === "warning" ? "var(--gd-warning)" : "var(--text-1)";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4, ...style } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, label), isNum && currency ? /* @__PURE__ */ React.createElement(Money, { amount: value, currency, showCurrency: true, size: 28, tone: tone === "body" ? "gold" : tone }) : /* @__PURE__ */ React.createElement("span", { className: "gd-t-metric", style: { color: toneColor } }, isNum ? value.toLocaleString("en-US") : value), meta && /* @__PURE__ */ React.createElement("span", { className: "gd-t-meta" }, meta));
}
Object.assign(__ds_scope, { KpiStat });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/surfaces/KpiStat.jsx", error: String((error && error.message) || error) }); }

// components/surfaces/Panel.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-panel{background:var(--gd-panel);border:1px solid var(--gd-line);border-radius:var(--radius-md)}
.gd-panel--seamed{border-radius:0;border-left:none;border-right:none}
.gd-panel-head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--gd-line)}
.gd-panel-title{font-size:14px;font-weight:600;flex:1}
.gd-panel-body{padding:14px}
.gd-panel--flush .gd-panel-body{padding:0}
`;
ensureGdCss("gd-panel-css", css);
function Panel({ title, actions, flush, seamed, children, style }) {
  return /* @__PURE__ */ React.createElement("section", { className: `gd-panel${flush ? " gd-panel--flush" : ""}${seamed ? " gd-panel--seamed" : ""}`, style }, (title || actions) && /* @__PURE__ */ React.createElement("header", { className: "gd-panel-head" }, /* @__PURE__ */ React.createElement("span", { className: "gd-panel-title" }, title), actions), /* @__PURE__ */ React.createElement("div", { className: "gd-panel-body" }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/surfaces/Panel.jsx", error: String((error && error.message) || error) }); }

// components/surfaces/Toolbar.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-toolbar{height:var(--toolbar-h);flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--gd-ink);border-bottom:1px solid var(--gd-line)}
.gd-toolbar--region{background:var(--surface-region)}
.gd-toolbar-side{display:flex;align-items:center;gap:8px;min-width:0}
.gd-toolbar-spacer{flex:1}
`;
ensureGdCss("gd-toolbar-css", css);
function Toolbar({ left, right, region, style }) {
  return /* @__PURE__ */ React.createElement("div", { className: `gd-toolbar${region ? " gd-toolbar--region" : ""}`, style }, /* @__PURE__ */ React.createElement("div", { className: "gd-toolbar-side" }, left), /* @__PURE__ */ React.createElement("span", { className: "gd-toolbar-spacer" }), /* @__PURE__ */ React.createElement("div", { className: "gd-toolbar-side" }, right));
}
Object.assign(__ds_scope, { Toolbar });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/surfaces/Toolbar.jsx", error: String((error && error.message) || error) }); }

// components/surfaces/WindowChrome.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-window{display:flex;flex-direction:column;height:100%;min-height:0;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-lg);overflow:hidden;box-shadow:var(--shadow-overlay)}
.gd-titlebar{position:relative;height:var(--titlebar-h);flex:none;display:flex;align-items:center;gap:8px;padding:0 8px 0 12px;background:var(--gd-chrome);border-bottom:1px solid var(--gd-line);user-select:none}
.gd-tb-brand{display:flex;align-items:center;gap:8px;font-size:12px;font-weight:600;letter-spacing:-0.01em;color:var(--text-1)}
.gd-tb-context{position:absolute;left:50%;transform:translateX(-50%);font-size:11px;color:var(--text-3);white-space:nowrap;pointer-events:none}
.gd-tb-ctl{margin-left:auto;display:flex;gap:1px}
.gd-tb-ctl button{width:28px;height:22px;display:inline-flex;align-items:center;justify-content:center;background:none;border:none;border-radius:4px;color:var(--text-2);cursor:default;transition:background var(--dur-fast) var(--ease-out),color var(--dur-fast) var(--ease-out)}
.gd-tb-ctl button:hover{background:var(--gd-panel-raised);color:var(--text-1)}
.gd-tb-ctl button.gd-tb-close:hover{background:var(--gd-danger);color:#fff}
.gd-window-body{flex:1;min-height:0;display:flex}
`;
ensureGdCss("gd-window-css", css);
const G = (d) => /* @__PURE__ */ React.createElement("svg", { width: "10", height: "10", viewBox: "0 0 10 10", fill: "none", stroke: "currentColor", strokeWidth: "1.2", strokeLinecap: "round" }, d);
function WindowChrome({ appName = "GoodDealer", mark, context, footer, onClose, children, style }) {
  return /* @__PURE__ */ React.createElement("div", { className: "gd-window", style }, /* @__PURE__ */ React.createElement("div", { className: "gd-titlebar" }, /* @__PURE__ */ React.createElement("span", { className: "gd-tb-brand" }, mark, appName), context && /* @__PURE__ */ React.createElement("span", { className: "gd-tb-context" }, context), /* @__PURE__ */ React.createElement("span", { className: "gd-tb-ctl" }, /* @__PURE__ */ React.createElement("button", { tabIndex: -1, "aria-label": "最小化" }, G(/* @__PURE__ */ React.createElement("path", { d: "M1 5h8" }))), /* @__PURE__ */ React.createElement("button", { tabIndex: -1, "aria-label": "最大化" }, G(/* @__PURE__ */ React.createElement("rect", { x: "1.4", y: "1.4", width: "7.2", height: "7.2", rx: "1" }))), /* @__PURE__ */ React.createElement("button", { tabIndex: -1, className: "gd-tb-close", "aria-label": "关闭", onClick: onClose }, G(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M1.5 1.5l7 7" }), /* @__PURE__ */ React.createElement("path", { d: "M8.5 1.5l-7 7" })))))), /* @__PURE__ */ React.createElement("div", { className: "gd-window-body" }, children), footer);
}
Object.assign(__ds_scope, { WindowChrome });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/surfaces/WindowChrome.jsx", error: String((error && error.message) || error) }); }

// components/table/BatchBar.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const css = `
.gd-batchbar{display:flex;align-items:center;gap:8px;background:var(--gd-panel-raised);border:1px solid var(--gd-line-strong);border-radius:var(--radius-md);padding:7px 8px;box-shadow:var(--shadow-raised);font-size:13px}
.gd-batchbar-count{display:inline-flex;align-items:baseline;gap:5px;padding:5px 11px;background:var(--gd-ink);border:1px solid var(--gd-line);border-radius:var(--radius-sm);white-space:nowrap}
.gd-batchbar-count .lbl{font-size:11px;color:var(--gd-text-muted)}
.gd-batchbar-count b{font-family:var(--font-mono);font-weight:500;color:var(--gd-blue);font-size:14px;line-height:1}
.gd-batchbar-count .u{font-size:11px;color:var(--gd-text-faint)}
.gd-batchbar-actions{display:flex;align-items:center;gap:6px}
.gd-batchbar-sep{width:1px;height:20px;background:var(--gd-line);flex:none}
.gd-batchbar-clear{background:none;border:none;color:var(--gd-text-faint);font-size:12px;cursor:pointer;font-family:var(--font-sans);padding:5px 9px;border-radius:var(--radius-sm)}
.gd-batchbar-clear:hover{color:var(--gd-text);background:var(--gd-ink)}
`;
ensureGdCss("gd-batchbar-css", css);
function BatchBar({ count, unit = "域名", children, onClear, style }) {
  if (!count) return null;
  return /* @__PURE__ */ React.createElement("div", { className: "gd-batchbar", style }, /* @__PURE__ */ React.createElement("span", { className: "gd-batchbar-count" }, /* @__PURE__ */ React.createElement("span", { className: "lbl" }, "已选"), /* @__PURE__ */ React.createElement("b", null, count), /* @__PURE__ */ React.createElement("span", { className: "u" }, unit)), /* @__PURE__ */ React.createElement("span", { className: "gd-batchbar-sep" }), /* @__PURE__ */ React.createElement("div", { className: "gd-batchbar-actions" }, children), onClear && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { className: "gd-batchbar-sep" }), /* @__PURE__ */ React.createElement("button", { className: "gd-batchbar-clear", onClick: onClear }, "清除")));
}
Object.assign(__ds_scope, { BatchBar });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/table/BatchBar.jsx", error: String((error && error.message) || error) }); }

// components/table/Pagination.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const { Select } = __ds_scope;
const { IconButton } = __ds_scope;
const css = `
.gd-pager{display:flex;align-items:center;gap:12px;width:100%;font-size:12px;color:var(--gd-text-muted)}
.gd-pager-range{font-family:var(--font-mono);font-variant-numeric:tabular-nums;white-space:nowrap}
.gd-pager-range b{color:var(--text-1);font-weight:500}
.gd-pager-size{display:flex;align-items:center;gap:6px;white-space:nowrap}
.gd-pager-note{margin-left:auto;font-family:var(--font-mono);font-size:11px;white-space:nowrap}
.gd-pager-nav{display:flex;align-items:center;gap:3px}
.gd-pager-num{min-width:24px;height:24px;padding:0 6px;border-radius:5px;cursor:pointer;font-family:var(--font-mono);font-variant-numeric:tabular-nums;font-size:12px;border:1px solid transparent;background:transparent;color:var(--gd-text-muted);transition:background var(--dur-fast) var(--ease-out)}
.gd-pager-num:hover{background:var(--gd-panel-raised)}
.gd-pager-num--active{border-color:var(--gd-line-strong);background:var(--gd-panel-raised);color:var(--text-1)}
.gd-pager-gap{padding:0 2px;color:var(--gd-text-faint)}
`;
ensureGdCss("gd-pager-css", css);
const chevron = (d) => /* @__PURE__ */ React.createElement("svg", { width: "14", height: "14", viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d }));
function pageWindow(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const s = /* @__PURE__ */ new Set([1, 2, total - 1, total, cur - 1, cur, cur + 1]);
  const arr = [...s].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of arr) {
    if (n - prev > 1) out.push("g" + n);
    out.push(n);
    prev = n;
  }
  return out;
}
function Pagination({ page = 1, pageSize = 25, total = 0, onPageChange, onPageSizeChange, pageSizes = [10, 25, 50, 100], note, style }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  const go = (n) => onPageChange && onPageChange(n);
  return /* @__PURE__ */ React.createElement("div", { className: "gd-pager", style }, /* @__PURE__ */ React.createElement("span", { className: "gd-pager-range" }, /* @__PURE__ */ React.createElement("b", null, from.toLocaleString(), "–", to.toLocaleString()), " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "/ ", total.toLocaleString())), /* @__PURE__ */ React.createElement("span", { className: "gd-pager-size" }, "每页", /* @__PURE__ */ React.createElement(Select, { size: "sm", options: pageSizes.map(String), value: String(pageSize), onChange: (e) => onPageSizeChange && onPageSizeChange(+e.target.value) })), note && /* @__PURE__ */ React.createElement("span", { className: "gd-pager-note" }, note), /* @__PURE__ */ React.createElement("span", { className: "gd-pager-nav", style: { marginLeft: note ? 16 : "auto" } }, /* @__PURE__ */ React.createElement(IconButton, { size: "sm", label: "上一页", disabled: cur <= 1, onClick: () => go(cur - 1) }, chevron("m15 18-6-6 6-6")), pageWindow(cur, pages).map((n, i) => typeof n === "number" ? /* @__PURE__ */ React.createElement("button", { key: i, className: `gd-pager-num${n === cur ? " gd-pager-num--active" : ""}`, onClick: () => go(n) }, n) : /* @__PURE__ */ React.createElement("span", { key: i, className: "gd-pager-gap" }, "…")), /* @__PURE__ */ React.createElement(IconButton, { size: "sm", label: "下一页", disabled: cur >= pages, onClick: () => go(cur + 1) }, chevron("m9 18 6-6-6-6"))));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/table/Pagination.jsx", error: String((error && error.message) || error) }); }

// components/table/Table.jsx
try { (() => {
const { ensureGdCss } = __ds_scope;
const { Checkbox } = __ds_scope;
const css = `
.gd-table-shell{border:1px solid var(--gd-line);border-radius:var(--radius-md);background:var(--gd-panel);overflow:hidden;display:flex;flex-direction:column}
.gd-table-scroll{overflow:auto;flex:1;min-height:0}
.gd-table{width:100%;border-collapse:separate;border-spacing:0;font-size:13px;color:var(--gd-text)}
.gd-table th{position:sticky;top:0;z-index:2;background:var(--gd-panel);text-align:left;font-size:11px;font-weight:500;letter-spacing:var(--tracking-caps);text-transform:uppercase;color:var(--gd-text-muted);border-bottom:1px solid var(--gd-line-strong);padding:0 12px;height:34px;white-space:nowrap;user-select:none}
.gd-table td{border-bottom:1px solid var(--gd-line);padding:0 12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.gd-table tr:last-child td{border-bottom:none}
.gd-table--compact td{height:var(--row-compact);font-size:12px}
.gd-table--regular td{height:var(--row-regular)}
.gd-table--spacious td{height:var(--row-spacious)}
.gd-table tbody tr{transition:background var(--dur-fast) var(--ease-out)}
.gd-table--hover tbody tr:hover td{background:var(--gd-panel-raised)}
.gd-table tr.gd-row--selected td{background:rgba(77,141,255,0.07);border-bottom-color:rgba(77,141,255,0.14)}
.gd-table--hover tbody tr.gd-row--selected:hover td{background:rgba(77,141,255,0.11)}
.gd-table tr.gd-row--clickable{cursor:pointer}
.gd-table .gd-cell--num,.gd-table th.gd-cell--num{text-align:right;font-family:var(--font-mono);font-variant-numeric:tabular-nums}
.gd-table th.gd-cell--num{font-family:var(--font-sans)}
.gd-table .gd-cell--center{text-align:center}
.gd-table .gd-cell--muted{color:var(--gd-text-muted)}
.gd-table .gd-cell--check{width:36px;padding:0 0 0 14px}
.gd-th-sort{display:inline-flex;align-items:center;gap:4px;cursor:pointer;border-radius:3px}
.gd-th-sort:hover{color:var(--gd-text)}
.gd-th-sort svg{opacity:0;transition:opacity var(--dur-fast)}
.gd-th-sort--active{color:var(--gd-text)}
.gd-th-sort--active svg{opacity:1}
.gd-th-sort:hover svg{opacity:.6}
.gd-table-empty{padding:48px 16px;text-align:center;color:var(--gd-text-faint);font-size:12px}
.gd-table-foot{border-top:1px solid var(--gd-line-strong);background:var(--gd-panel);padding:8px 14px;font-size:12px;color:var(--gd-text-muted);display:flex;align-items:center;gap:12px}
`;
ensureGdCss("gd-table-css", css);
const SortGlyph = ({ dir }) => /* @__PURE__ */ React.createElement("svg", { width: "8", height: "10", viewBox: "0 0 8 10", fill: "none" }, /* @__PURE__ */ React.createElement("path", { d: dir === "desc" ? "M1 4L4 8L7 4" : "M1 6L4 2L7 6", stroke: "currentColor", strokeWidth: "1.4", strokeLinecap: "round", strokeLinejoin: "round" }));
function Table({ columns = [], rows = [], rowKey = "id", density = "regular", selectable = false, selected = [], onSelectionChange, sortKey, sortDir = "asc", onSort, onRowClick, hover = true, maxHeight, footer, emptyText = "没有匹配的项目", style }) {
  const sel = new Set(selected);
  const keyOf = (r, i) => typeof rowKey === "function" ? rowKey(r) : r[rowKey] !== void 0 ? r[rowKey] : i;
  const allKeys = rows.map(keyOf);
  const allSel = rows.length > 0 && allKeys.every((k) => sel.has(k));
  const someSel = allKeys.some((k) => sel.has(k));
  const toggleAll = () => onSelectionChange && onSelectionChange(allSel ? [] : allKeys);
  const toggleOne = (k) => {
    const n = new Set(sel);
    n.has(k) ? n.delete(k) : n.add(k);
    onSelectionChange && onSelectionChange([...n]);
  };
  const cellCls = (c) => `${c.numeric ? " gd-cell--num" : ""}${c.align === "right" && !c.numeric ? " gd-cell--num" : ""}${c.align === "center" ? " gd-cell--center" : ""}${c.muted ? " gd-cell--muted" : ""}`;
  return /* @__PURE__ */ React.createElement("div", { className: "gd-table-shell", style }, /* @__PURE__ */ React.createElement("div", { className: "gd-table-scroll", style: maxHeight ? { maxHeight } : void 0 }, /* @__PURE__ */ React.createElement("table", { className: `gd-table gd-table--${density}${hover ? " gd-table--hover" : ""}` }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, selectable && /* @__PURE__ */ React.createElement("th", { className: "gd-cell--check" }, /* @__PURE__ */ React.createElement(Checkbox, { checked: allSel, indeterminate: someSel && !allSel, onChange: toggleAll })), columns.map((c) => /* @__PURE__ */ React.createElement("th", { key: c.key, className: cellCls(c), style: c.width ? { width: c.width } : void 0 }, c.sortable ? /* @__PURE__ */ React.createElement("span", { className: `gd-th-sort${sortKey === c.key ? " gd-th-sort--active" : ""}`, onClick: () => onSort && onSort(c.key, sortKey === c.key && sortDir === "asc" ? "desc" : "asc") }, c.label, /* @__PURE__ */ React.createElement(SortGlyph, { dir: sortKey === c.key ? sortDir : "asc" })) : c.label)))), /* @__PURE__ */ React.createElement("tbody", null, rows.map((r, i) => {
    const k = keyOf(r, i);
    const isSel = sel.has(k);
    return /* @__PURE__ */ React.createElement("tr", { key: k, className: `${isSel ? "gd-row--selected" : ""}${onRowClick ? " gd-row--clickable" : ""}`, onClick: onRowClick ? () => onRowClick(r) : void 0 }, selectable && /* @__PURE__ */ React.createElement("td", { className: "gd-cell--check" }, /* @__PURE__ */ React.createElement(Checkbox, { stop: true, checked: isSel, onChange: () => toggleOne(k) })), columns.map((c) => /* @__PURE__ */ React.createElement("td", { key: c.key, className: cellCls(c), style: c.width ? { width: c.width } : void 0 }, c.render ? c.render(r, i) : r[c.key])));
  }))), rows.length === 0 && /* @__PURE__ */ React.createElement("div", { className: "gd-table-empty" }, emptyText)), footer && /* @__PURE__ */ React.createElement("div", { className: "gd-table-foot" }, footer));
}
Object.assign(__ds_scope, { Table });
})(); } catch (error) { __ds_ns.__errors.push({ path: "components/table/Table.jsx", error: String((error && error.message) || error) }); }

__ds_ns.Button = __ds_scope.Button;
__ds_ns.IconButton = __ds_scope.IconButton;
__ds_ns.Checkbox = __ds_scope.Checkbox;
__ds_ns.Input = __ds_scope.Input;
__ds_ns.Select = __ds_scope.Select;
__ds_ns.Switch = __ds_scope.Switch;
__ds_ns.StatusBar = __ds_scope.StatusBar;
__ds_ns.Tabs = __ds_scope.Tabs;
__ds_ns.Dialog = __ds_scope.Dialog;
__ds_ns.Tooltip = __ds_scope.Tooltip;
__ds_ns.Badge = __ds_scope.Badge;
__ds_ns.DiffValue = __ds_scope.DiffValue;
__ds_ns.Money = __ds_scope.Money;
__ds_ns.ProgressBar = __ds_scope.ProgressBar;
__ds_ns.StatusDot = __ds_scope.StatusDot;
__ds_ns.Tag = __ds_scope.Tag;
__ds_ns.KpiStat = __ds_scope.KpiStat;
__ds_ns.Panel = __ds_scope.Panel;
__ds_ns.Toolbar = __ds_scope.Toolbar;
__ds_ns.WindowChrome = __ds_scope.WindowChrome;
__ds_ns.BatchBar = __ds_scope.BatchBar;
__ds_ns.Pagination = __ds_scope.Pagination;
__ds_ns.Table = __ds_scope.Table;

// ui_kits/account-web/AccountDashboard.jsx
try { (() => {
const { Panel, Badge, Button, Money, StatusDot, ProgressBar, Switch } = window.GoodDealerDesignSystem_b5b0b6;
function ActivityRow({ a }) {
  const I = window.GDI;
  const map = { sync: ["RefreshCw", "blue"], sale: ["Coins", "gold"], device: ["Monitor", "text-muted"], billing: ["Receipt", "text-muted"], security: ["ShieldCheck", a.flag ? "warning" : "success"] };
  const [ic, tone] = map[a.kind] || ["CircleAlert", "text-muted"];
  const Ic = I[ic];
  const col = tone.startsWith("text") ? `var(--${tone})` : `var(--gd-${tone})`;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 26, height: 26, flex: "none", borderRadius: 6, background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line)", display: "flex", alignItems: "center", justifyContent: "center", color: col } }, /* @__PURE__ */ React.createElement(Ic, { size: 14 })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, a.text), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, a.meta)), a.value != null && /* @__PURE__ */ React.createElement(Money, { amount: a.value, size: 12 }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", flex: "none", width: 44, textAlign: "right" } }, a.time));
}
function DeviceMini({ d, onManage }) {
  const I = window.GDI;
  const m = { active: { dot: "active", badge: /* @__PURE__ */ React.createElement(Badge, { tone: "gold" }, "ACTIVE"), note: "持有执行权" }, standby: { dot: "standby", badge: /* @__PURE__ */ React.createElement(Badge, { mono: false }, "Standby"), note: "待命" }, sunset: { dot: "neutral", badge: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 5px", lineHeight: "16px" } }, "RETAINED"), note: "本地只读延续" } }[d.state];
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 11, padding: "10px 0", borderBottom: "1px solid var(--gd-line)", opacity: d.state === "sunset" ? 0.6 : 1 } }, /* @__PURE__ */ React.createElement(I.Monitor, { size: 16, style: { color: d.state === "active" ? "var(--gd-gold)" : "var(--gd-text-muted)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { minWidth: 0, flex: 1, display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 6 } }, d.name, d.self && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9.5, color: "var(--text-3)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 4px", lineHeight: "14px" } }, "本机")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, d.os)), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement(StatusDot, { kind: m.dot }), m.badge, d.state === "active" && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "Epoch ", d.epoch)));
}
function Dashboard({ go }) {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const P = D.portfolio.slice(0, 6);
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "概览", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "组合估值", value: "$284,120.00", tone: "gold", meta: "较上月 +2.1% · 云端截至 14:02" },
    { label: "域名总数", value: "1,024", meta: "Spaceship 812 · 其他 212" },
    { label: "已绑定设备", value: "2 / 2", meta: "MacBook Pro Active · iPhone Standby" },
    { label: "License 剩余", value: "136 天", tone: "warning", meta: "年付 · 至 2026-12-31", onClick: () => go("license") },
    { label: "云端同步", value: "SYNCED", tone: "success", meta: "rev 8,241 · 无未同步项" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(Panel, { title: "订阅与许可", actions: /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => go("license") }, "管理订阅") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 14 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "34", height: "34", alt: "", style: { flex: "none", marginTop: 2, opacity: 0.92 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16, fontWeight: 600, color: "var(--text-1)" } }, "年付 License"), /* @__PURE__ */ React.createElement(Badge, { tone: "gold" }, "单一功能档位"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" } }, "自动续费 ", /* @__PURE__ */ React.createElement(Switch, { checked: true, onChange: () => {
  } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginBottom: 6, fontFamily: "var(--font-mono)" } }, /* @__PURE__ */ React.createElement("span", null, "2025-12-31"), /* @__PURE__ */ React.createElement("span", null, "本期已用 63% · 剩余 136 天"), /* @__PURE__ */ React.createElement("span", null, "2026-12-31")), /* @__PURE__ */ React.createElement(ProgressBar, { value: 63, height: 6 }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: "12px 24px", marginTop: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 3, whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "年费"), /* @__PURE__ */ React.createElement(Money, { amount: 98, size: 15 })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 3, whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "下次扣款"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--text-1)" } }, "2026-12-31")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 3, whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "支付方式"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-1)" } }, "Stripe 托管付款")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 3, whiteSpace: "nowrap" } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "设备额度"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-1)" } }, "2 台 · 单活动")))))), /* @__PURE__ */ React.createElement(Panel, { flush: true, title: "设备与执行权", actions: /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => go("devices") }, "管理设备") }, /* @__PURE__ */ React.createElement("div", { style: { padding: "2px 16px 4px" } }, D.devices.map((d) => /* @__PURE__ */ React.createElement(DeviceMini, { key: d.id, d }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9, padding: "11px 16px", background: "var(--gd-panel)", borderTop: "1px solid var(--gd-line)", fontSize: 11.5, color: "var(--text-2)", lineHeight: 1.55 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/active-lease.svg", width: "18", height: "18", alt: "", style: { flex: "none", marginTop: 1 } }), /* @__PURE__ */ React.createElement("span", null, "同一时刻只有一台设备持有执行权（", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-gold)", fontWeight: 500 } }, "金实心 = Active"), "，蓝空心 = Standby）。移交在桌面客户端完成，Epoch 递增。")))), /* @__PURE__ */ React.createElement(Panel, { flush: true, title: "近期动态", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "数据来自 GoodDealer Cloud") }, /* @__PURE__ */ React.createElement("div", { style: { padding: "2px 16px 6px" } }, D.activity.map((a, i) => /* @__PURE__ */ React.createElement(ActivityRow, { key: i, a }))), /* @__PURE__ */ React.createElement("button", { onClick: () => go("cloud"), style: { width: "100%", padding: "11px 16px", background: "transparent", border: "none", borderTop: "1px solid var(--gd-line)", color: "var(--gd-blue)", fontSize: 12, cursor: "pointer", fontFamily: "var(--font-sans)", textAlign: "left", display: "flex", alignItems: "center", gap: 6 } }, "查看云端操作账本 ", /* @__PURE__ */ React.createElement(I.ArrowRight, { size: 13 })))), /* @__PURE__ */ React.createElement(Panel, { flush: true, title: "云端数据快照", actions: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", marginRight: 10 } }, "只读镜像 · 截至 14:02"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: () => go("cloud") }, "全部 1,024 →")) }, /* @__PURE__ */ React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", { style: { textAlign: "left" } }, ["域名", "注册商", "状态", "估值 BIN", "到期"].map((h, i) => /* @__PURE__ */ React.createElement("th", { key: h, style: { padding: "9px 16px", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 500, borderBottom: "1px solid var(--gd-line)", textAlign: i > 2 ? "right" : "left" } }, h)))), /* @__PURE__ */ React.createElement("tbody", null, P.map((r, i) => /* @__PURE__ */ React.createElement("tr", { key: r.domain, style: { borderBottom: i < P.length - 1 ? "1px solid var(--gd-line)" : "none" } }, /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px", fontFamily: "var(--font-mono)", color: "var(--text-1)" } }, r.domain), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px", color: "var(--text-2)" } }, r.registrar), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px" } }, r.status === "sold" ? /* @__PURE__ */ React.createElement(Badge, { tone: "gold" }, "SOLD") : r.status === "conflict" ? /* @__PURE__ */ React.createElement(Badge, { tone: "danger", mono: false }, "冲突") : r.status === "pending" ? /* @__PURE__ */ React.createElement(Badge, { tone: "warning", mono: false }, "等待平台") : /* @__PURE__ */ React.createElement(Badge, { tone: "sync" }, "SYNCED")), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px", textAlign: "right" } }, /* @__PURE__ */ React.createElement(Money, { amount: r.bin, size: 12 })), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px", textAlign: "right", fontFamily: "var(--font-mono)", color: r.expiry < "2026-10-01" ? "var(--gd-warning)" : "var(--text-2)" } }, r.expiry))))))));
}
window.GDDashboard = Dashboard;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/AccountDashboard.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/AccountSettings.jsx
try { (() => {
const { Panel: APanel, Badge: ABadge, Button: ABtn, Switch: ASwitch, Select: ASel, Input: AInput, Dialog: ADlg } = window.GoodDealerDesignSystem_b5b0b6;
function Row({ label, hint, children }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, padding: "11px 0", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 150, flex: "none" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, label), hint && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 2 } }, hint)), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", justifyContent: "flex-end" } }, children));
}
function AccountSettings() {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const [notif, setNotif] = React.useState({ sale: true, expiry: true, security: true, billing: true, product: false });
  const [dlg, setDlg] = React.useState(null);
  const [confirm, setConfirm] = React.useState("");
  const tog = (k) => setNotif((n) => ({ ...n, [k]: !n[k] }));
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "账户设置", style: { padding: 18, maxWidth: 820, display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(APanel, { title: "个人资料", actions: /* @__PURE__ */ React.createElement(ABtn, { size: "sm", variant: "primary" }, "保存更改") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 16, marginBottom: 14, paddingBottom: 14, borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 52, height: 52, flex: "none", borderRadius: "50%", background: "linear-gradient(135deg,var(--gd-panel-raised),var(--gd-line))", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--gd-gold)" } }, "CL"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 600, color: "var(--text-1)" } }, "陈立行"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, "会员自 2024-03-11")), /* @__PURE__ */ React.createElement(ABtn, { size: "sm", variant: "ghost", style: { marginLeft: "auto" } }, "更换头像")), /* @__PURE__ */ React.createElement(Row, { label: "姓名" }, /* @__PURE__ */ React.createElement(AInput, { value: "陈立行", onChange: () => {
  }, style: { width: 260 } })), /* @__PURE__ */ React.createElement(Row, { label: "邮箱", hint: "用于登录与发票" }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(AInput, { value: "li@quanta.trade", onChange: () => {
  }, mono: true, style: { width: 260 } }), /* @__PURE__ */ React.createElement(ABadge, { tone: "success", dot: true }, "已验证"))), /* @__PURE__ */ React.createElement(Row, { label: "Workspace 名称" }, /* @__PURE__ */ React.createElement(AInput, { value: "个人 Workspace", onChange: () => {
  }, style: { width: 260 } }))), /* @__PURE__ */ React.createElement(APanel, { title: "偏好" }, /* @__PURE__ */ React.createElement(Row, { label: "语言 / Locale" }, /* @__PURE__ */ React.createElement(ASel, { size: "sm", options: ["中文（zh-CN）", "English (en-US)"], value: "中文（zh-CN）", onChange: () => {
  } })), /* @__PURE__ */ React.createElement(Row, { label: "时区" }, /* @__PURE__ */ React.createElement(ASel, { size: "sm", options: ["Asia/Shanghai (UTC+8)", "UTC", "America/New_York (UTC-5)", "Europe/London (UTC+0)"], value: "Asia/Shanghai (UTC+8)", onChange: () => {
  } })), /* @__PURE__ */ React.createElement(Row, { label: "货币显示", hint: "估值与金额" }, /* @__PURE__ */ React.createElement(ASel, { size: "sm", options: ["USD ($)", "CNY (¥)", "EUR (€)"], value: "USD ($)", onChange: () => {
  } })), /* @__PURE__ */ React.createElement(Row, { label: "外观", hint: "GoodDealer 为深色终端界面" }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-3)" } }, "深色 · Ink（固定）"))), /* @__PURE__ */ React.createElement(APanel, { title: "通知", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "发送至 li@quanta.trade") }, [["sale", "成交与放款", "域名售出、托管交割状态变化"], ["expiry", "到期提醒", "域名续费到期前 60 / 30 / 7 天"], ["security", "安全提醒", "新设备登录、异常位置、改密"], ["billing", "账单", "扣款成功、发票、续费"], ["product", "产品更新", "新版本与功能公告"]].map(([k, t, h]) => /* @__PURE__ */ React.createElement(Row, { key: k, label: t, hint: h }, /* @__PURE__ */ React.createElement(ASwitch, { checked: notif[k], onChange: () => tog(k) })))), /* @__PURE__ */ React.createElement(APanel, { title: "账户数据与注销" }, /* @__PURE__ */ React.createElement(Row, { label: "导出账户数据", hint: "资产快照、发票、操作账本 (CSV / JSON)" }, /* @__PURE__ */ React.createElement(ABtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 13 }) }, "请求导出")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, padding: "13px 0 4px" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 150, flex: "none" } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--gd-danger)" } }, "删除账户"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 2 } }, "永久删除云端账户与数据")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(ABtn, { size: "sm", variant: "danger", icon: /* @__PURE__ */ React.createElement(I.Trash2, { size: 13 }), onClick: () => setDlg("del") }, "删除账户")))), /* @__PURE__ */ React.createElement(
    ADlg,
    {
      open: dlg === "del",
      onClose: () => {
        setDlg(null);
        setConfirm("");
      },
      title: "删除账户",
      width: 460,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(ABtn, { onClick: () => {
        setDlg(null);
        setConfirm("");
      } }, "取消"), /* @__PURE__ */ React.createElement(ABtn, { variant: "danger", disabled: confirm !== "DELETE", onClick: () => {
        setDlg(null);
        setConfirm("");
      } }, "永久删除账户"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "后果"), "：云端账户、订阅、发票记录与资产快照将被永久删除，无法恢复。"), /* @__PURE__ */ React.createElement("span", null, "已绑定设备将被全部解绑；本地缓存数据保留只读，需重新注册才能继续同步。"), /* @__PURE__ */ React.createElement("span", null, "如仅想停止续费，请改用", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "取消续订"), "（保留至到期）。")), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--text-2)", marginBottom: 6 } }, "输入 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-danger)" } }, "DELETE"), " 以确认"), /* @__PURE__ */ React.createElement(AInput, { value: confirm, onChange: (e) => setConfirm(e.target.value), mono: true, placeholder: "DELETE" })))
  ));
}
window.GDAccountSettings = AccountSettings;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/AccountSettings.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/AccountShell.jsx
try { (() => {
const { StatusBar, IconButton, Badge } = window.GoodDealerDesignSystem_b5b0b6;
const Dot = ({ tone, hollow, size = 7 }) => /* @__PURE__ */ React.createElement("span", { style: { width: size, height: size, borderRadius: "50%", flex: "none", display: "inline-block", background: hollow ? "transparent" : `var(--gd-${tone})`, border: hollow ? `1.5px solid var(--gd-${tone})` : "none" } });
const NAV = [
  { sec: "账户", items: [
    { k: "dashboard", label: "概览", icon: "LayoutDashboard" },
    { k: "license", label: "订阅与许可", icon: "KeyRound" },
    { k: "devices", label: "设备", icon: "Monitor" },
    { k: "billing", label: "账单与发票", icon: "Receipt" }
  ] },
  { sec: "安全与数据", items: [
    { k: "security", label: "安全", icon: "ShieldCheck" },
    { k: "cloud", label: "云端数据", icon: "Database" }
  ] }
];
const FOOT = [
  { k: "settings", label: "账户设置", icon: "Settings" },
  { k: "download", label: "下载客户端", icon: "Download" }
];
const sx = {
  side: { width: 220, flex: "none", background: "var(--gd-panel)", borderRight: "1px solid var(--gd-line)", display: "flex", flexDirection: "column", minHeight: 0 },
  brand: { display: "flex", alignItems: "center", gap: 10, padding: "15px 16px 14px", borderBottom: "1px solid var(--gd-line)" },
  navSec: { padding: "14px 16px 5px", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 500 },
  item: (on) => ({ display: "flex", alignItems: "center", gap: 10, margin: "1px 8px", padding: "0 9px", height: 30, borderRadius: 5, cursor: "pointer", fontSize: 13, color: on ? "var(--text-1)" : "var(--text-2)", background: on ? "var(--gd-panel-raised)" : "transparent", border: "none", width: "calc(100% - 16px)", fontFamily: "var(--font-sans)", textAlign: "left", transition: "background 120ms,color 120ms", fontWeight: on ? 500 : 400, position: "relative" }),
  bar: { position: "absolute", left: 0, top: 6, bottom: 6, width: 2, borderRadius: 1, background: "var(--gd-gold)" },
  topbar: { height: 52, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: "1px solid var(--gd-line)", background: "var(--gd-chrome)" },
  cmd: { display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px 0 11px", width: 280, background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, color: "var(--text-3)", fontSize: 12, cursor: "text" },
  kbd: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 4px", lineHeight: "15px" }
};
function NavItem({ item, active, onGo }) {
  const on = active === item.k;
  const Ic = window.GDI[item.icon];
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      style: sx.item(on),
      onClick: () => onGo(item.k),
      onMouseEnter: (e) => {
        if (!on) e.currentTarget.style.background = "var(--gd-panel-raised)";
      },
      onMouseLeave: (e) => {
        if (!on) e.currentTarget.style.background = "transparent";
      }
    },
    on && /* @__PURE__ */ React.createElement("span", { style: sx.bar }),
    /* @__PURE__ */ React.createElement(Ic, { size: 16, style: { flex: "none", opacity: on ? 1 : 0.72, color: on ? "var(--text-1)" : void 0 } }),
    item.label
  );
}
function Shell({ active, onGo, title, crumb, children, syncing, onSync, unsynced = 0 }) {
  const I = window.GDI;
  const footer = /* @__PURE__ */ React.createElement(
    StatusBar,
    {
      left: [
        /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Dot, { tone: "blue" }), syncing ? "SYNCING" : "SYNCED"),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "云端数据截至 ", syncing ? "…" : "14:02"),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "rev 8,241")
      ],
      right: [
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "4 平台 · 3 账户"),
        /* @__PURE__ */ React.createElement(React.Fragment, null, "MacBook Pro ", /* @__PURE__ */ React.createElement(Dot, { tone: "gold" }), " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "Active")),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "Epoch 41"),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "年付 License · 至 2026-12-31")
      ]
    }
  );
  return /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: "100%", display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } }, /* @__PURE__ */ React.createElement("aside", { style: sx.side }, /* @__PURE__ */ React.createElement("div", { style: sx.brand }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark-flat.svg", width: "22", height: "22", alt: "" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" } }, "GoodDealer"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" } }, "云端账户 · Account"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflow: "auto", minHeight: 0 } }, NAV.map((g) => /* @__PURE__ */ React.createElement("div", { key: g.sec }, /* @__PURE__ */ React.createElement("div", { style: sx.navSec }, g.sec), g.items.map((it) => /* @__PURE__ */ React.createElement(NavItem, { key: it.k, item: it, active, onGo }))))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--gd-line)", paddingTop: 6 } }, FOOT.map((it) => /* @__PURE__ */ React.createElement(NavItem, { key: it.k, item: it, active, onGo })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "11px 14px 12px", margin: "6px 0 0", borderTop: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 28, height: 28, flex: "none", borderRadius: "50%", background: "linear-gradient(135deg,var(--gd-panel-raised),var(--gd-line))", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "CL"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0, flex: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "陈立行"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "li@quanta.trade")), /* @__PURE__ */ React.createElement(IconButton, { size: "sm", label: "退出登录" }, /* @__PURE__ */ React.createElement(I.LogOut, { size: 14 }))))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: sx.topbar }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 600, color: "var(--text-1)" } }, title), crumb && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-3)" } }, crumb), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: sx.cmd }, /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), /* @__PURE__ */ React.createElement("span", null, "搜索域名、发票或命令"), /* @__PURE__ */ React.createElement("span", { style: sx.kbd }, "⌘K")), /* @__PURE__ */ React.createElement(IconButton, { size: "sm", label: "通知" }, /* @__PURE__ */ React.createElement("span", { style: { position: "relative", display: "inline-flex" } }, /* @__PURE__ */ React.createElement(I.Bell, { size: 15 }), /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: -1, right: -1, width: 5, height: 5, borderRadius: "50%", background: "var(--gd-gold)" } }))), /* @__PURE__ */ React.createElement(IconButton, { size: "sm", label: "刷新云端数据", onClick: onSync }, /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 14, style: syncing ? { animation: "gd-spinner 1s linear infinite" } : void 0 })))), /* @__PURE__ */ React.createElement("main", { style: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" } }, children))), footer);
}
window.GDShell = Shell;
window.GDDot = Dot;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/AccountShell.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/Billing.jsx
try { (() => {
const { Panel: BPanel, Badge: BBadge, Button: BBtn, Money: BMoney, Table: BTable, Dialog: BDlg, IconButton: BIcon } = window.GoodDealerDesignSystem_b5b0b6;
function Billing() {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [dlg, setDlg] = React.useState(null);
  const [inv, setInv] = React.useState(null);
  const total = D.invoices.reduce((s, i) => s + i.amount, 0);
  const thisYear = D.invoices.filter((i) => i.date >= "2025-12-01").reduce((s, i) => s + i.amount, 0);
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "账单与发票", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "本账期支出", value: "$" + thisYear.toFixed(2), tone: "gold", meta: "2026 年付 License" },
    { label: "累计支出", value: "$" + total.toFixed(2), tone: "gold", meta: D.invoices.length + " 张发票" },
    { label: "下次扣款", value: "2026-12-31", mono: true, meta: "$98.00 · 自动续费" },
    { label: "付款渠道", value: "Stripe", meta: "Provider 托管" },
    { label: "账单状态", value: "正常", tone: "success", meta: "无欠费" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } }, /* @__PURE__ */ React.createElement(BPanel, { title: "付款渠道", actions: /* @__PURE__ */ React.createElement(BBtn, { size: "sm", onClick: () => setDlg("provider") }, "管理") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { width: 56, height: 36, flex: "none", borderRadius: 6, background: "linear-gradient(135deg,var(--gd-panel-raised),var(--gd-ink))", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(I.CreditCard, { size: 20, style: { color: "var(--gd-gold)" } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, color: "var(--text-1)" } }, "Stripe 托管付款方式"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "付款资料只在 Stripe 托管页面中管理")), /* @__PURE__ */ React.createElement(BBadge, { tone: "success", dot: true }, "默认"))), /* @__PURE__ */ React.createElement(BPanel, { title: "账单信息", actions: /* @__PURE__ */ React.createElement(BBtn, { size: "sm", variant: "ghost" }, "编辑") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, [["账单主体", "陈立行 · 个人"], ["国家 / 地区", "中国"], ["税号 / VAT", "—"], ["发票邮箱", "li@quanta.trade"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", padding: "7px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 12.5 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 96, flex: "none", color: "var(--text-3)" } }, k), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-1)" } }, v)))))), /* @__PURE__ */ React.createElement(BPanel, { flush: true, title: "发票", actions: /* @__PURE__ */ React.createElement(BBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 13 }) }, "导出全部") }, /* @__PURE__ */ React.createElement(
    BTable,
    {
      density: "regular",
      rowKey: "id",
      onRowClick: (r) => {
        setInv(r);
        setDlg("invoice");
      },
      style: { border: "none", borderRadius: 0 },
      columns: [
        { key: "id", label: "发票号", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.id) },
        { key: "date", label: "日期", numeric: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" } }, r.date) },
        { key: "desc", label: "说明", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-1)" } }, r.desc) },
        { key: "method", label: "支付方式", muted: true },
        { key: "amount", label: "金额", numeric: true, render: (r) => r.amount === 0 ? /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--text-3)" } }, "$0.00") : /* @__PURE__ */ React.createElement(BMoney, { amount: r.amount, size: 12 }) },
        { key: "status", label: "状态", render: () => /* @__PURE__ */ React.createElement(BBadge, { tone: "success" }, "PAID") },
        { key: "act", label: "", align: "right", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", gap: 4 }, onClick: (e) => e.stopPropagation() }, /* @__PURE__ */ React.createElement(BIcon, { size: "sm", label: "下载 PDF" }, /* @__PURE__ */ React.createElement(I.Download, { size: 14 })), /* @__PURE__ */ React.createElement(BIcon, { size: "sm", label: "查看" }, /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 14 }))) }
      ],
      rows: D.invoices
    }
  ))), /* @__PURE__ */ React.createElement(
    BDlg,
    {
      open: dlg === "provider",
      onClose: () => setDlg(null),
      title: "管理付款渠道",
      width: 440,
      footer: /* @__PURE__ */ React.createElement(BBtn, { onClick: () => setDlg(null) }, "关闭")
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "12px 14px", border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel-raised)", fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 } }, "GoodDealer 不采集卡号、安全码或付款账户资料。选择渠道后会离开本页，在 Provider 托管页面完成管理。"), /* @__PURE__ */ React.createElement(BBtn, { variant: "primary", icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "前往 Stripe"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "首发付款由 Stripe 托管；同一账号一次只能占用一个付款 Provider。"))
  ), /* @__PURE__ */ React.createElement(
    BDlg,
    {
      open: dlg === "invoice",
      onClose: () => setDlg(null),
      title: inv ? inv.id : "",
      width: 480,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(BBtn, { onClick: () => setDlg(null) }, "关闭"), /* @__PURE__ */ React.createElement(BBtn, { variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 13 }), onClick: () => setDlg(null) }, "下载 PDF"))
    },
    inv && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark-flat.svg", width: "24", height: "24", alt: "" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--text-1)" } }, "GoodDealer"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "收据 · Receipt")), /* @__PURE__ */ React.createElement(BBadge, { tone: "success", style: { marginLeft: "auto" } }, "PAID")), [["发票号", inv.id], ["开票日期", inv.date], ["说明", inv.desc], ["支付方式", inv.method || "—"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", fontSize: 12.5 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 88, flex: "none", color: "var(--text-3)" } }, k), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-1)", fontFamily: k === "发票号" || k === "开票日期" ? "var(--font-mono)" : void 0 } }, v))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 6, paddingTop: 12, borderTop: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-2)" } }, "合计"), /* @__PURE__ */ React.createElement(BMoney, { amount: inv.amount, size: 18 })))
  ));
}
window.GDBilling = Billing;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/Billing.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/CloudData.jsx
try { (() => {
const { Panel: CPanel, Badge: CBadge, Money: CMoney, Tabs: CTabs, Input: CInput, Select: CSel, Table: CTable, StatusDot: CDot, Button: CBtn } = window.GoodDealerDesignSystem_b5b0b6;
function CloudData() {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const Pagination = window.GDPagination;
  const [tab, setTab] = React.useState("assets");
  const [q, setQ] = React.useState("");
  const [reg, setReg] = React.useState("全部");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  React.useEffect(() => {
    setPage(1);
  }, [q, reg, pageSize, tab]);
  const STB = { synced: /* @__PURE__ */ React.createElement(CBadge, { tone: "sync" }, "SYNCED"), sold: /* @__PURE__ */ React.createElement(CBadge, { tone: "gold" }, "SOLD"), pending: /* @__PURE__ */ React.createElement(CBadge, { tone: "warning", mono: false }, "等待平台"), conflict: /* @__PURE__ */ React.createElement(CBadge, { tone: "danger", mono: false }, "冲突") };
  let rows = D.portfolio.filter((r) => (reg === "全部" || r.registrar === reg) && (q === "" || r.domain.includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "云端数据", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "组合估值", value: "$284,120.00", tone: "gold", meta: "云端快照 · 截至 14:02" },
    { label: "域名总数", value: "1,024", meta: "只读镜像" },
    { label: "当前 Revision", value: "rev 8,241", mono: true, meta: "追加不可篡改" },
    { label: "待裁决冲突", value: "1", tone: "danger", meta: "在桌面客户端裁决" },
    { label: "最后同步", value: "14:02", mono: true, meta: "MacBook Pro · Active" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: "1px solid var(--gd-line)", background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement(CTabs, { items: [{ key: "assets", label: "资产快照", count: 1024 }, { key: "ledger", label: "操作账本" }], active: tab, onChange: setTab }), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--gd-blue)" } }, /* @__PURE__ */ React.createElement(I.Cloud, { size: 13 }), "数据来自 GoodDealer Cloud · 只读")), tab === "assets" ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9, padding: "10px 18px", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement(CInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "筛选域名…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 220 } }), /* @__PURE__ */ React.createElement(CSel, { size: "sm", options: ["全部", "Spaceship", "Namecheap", "Dynadot"], value: reg, onChange: (e) => setReg(e.target.value) }), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--text-3)" } }, "编辑与执行请在桌面客户端进行")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    CTable,
    {
      density: "regular",
      rowKey: "domain",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.domain) },
        { key: "registrar", label: "注册商", muted: true },
        { key: "status", label: "状态", render: (r) => STB[r.status] },
        { key: "bin", label: "估值 BIN", numeric: true, render: (r) => /* @__PURE__ */ React.createElement(CMoney, { amount: r.bin, size: 12 }) },
        { key: "expiry", label: "到期", numeric: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: r.expiry < "2026-10-01" ? "var(--gd-warning)" : "var(--text-2)" } }, r.expiry) }
      ],
      rows: pageRows,
      footer: /* @__PURE__ */ React.createElement(Pagination, { page: cur, pageSize, total: rows.length, onPage: setPage, onPageSize: setPageSize, note: /* @__PURE__ */ React.createElement(React.Fragment, null, "组合估值 ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "$284,120.00")) })
    }
  ))) : /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    CTable,
    {
      density: "regular",
      rowKey: "rev",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "rev", label: "Revision", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-gold)" } }, "rev ", r.rev) },
        { key: "op", label: "操作", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 7, color: "var(--text-1)" } }, r.risk && /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 13, style: { color: "var(--gd-danger)" } }), r.op) },
        { key: "platform", label: "平台", muted: true },
        { key: "source", label: "来源设备", muted: true },
        { key: "items", label: "条目", numeric: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.items.toLocaleString()) },
        { key: "status", label: "状态", render: (r) => r.status === "rolledback" ? /* @__PURE__ */ React.createElement(CBadge, { tone: "neutral", mono: false }, "已回滚") : /* @__PURE__ */ React.createElement(CBadge, { tone: "success" }, "已应用") },
        { key: "time", label: "时间", numeric: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-3)" } }, r.time) }
      ],
      rows: D.ledger,
      footer: /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", width: "100%", fontSize: 11, color: "var(--text-3)" } }, /* @__PURE__ */ React.createElement("span", null, "账本追加不可篡改 · 回滚会生成新的反向 Revision"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)" } }, "基线 rev 8,241"))
    }
  )));
}
window.GDCloudData = CloudData;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/CloudData.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/Devices.jsx
try { (() => {
const { Panel: DPanel, Badge: DBadge, Button: DBtn, StatusDot: DDot, Dialog: DDlg, Checkbox: DCheck, IconButton: DIcon } = window.GoodDealerDesignSystem_b5b0b6;
function DeviceRow({ d, onDeauth, onRemove, onRename }) {
  const I = window.GDI;
  const m = {
    active: { dot: "active", badge: /* @__PURE__ */ React.createElement(DBadge, { tone: "gold" }, "ACTIVE"), meta: "持有 ActiveDeviceLease · 执行权在此设备" },
    standby: { dot: "standby", badge: /* @__PURE__ */ React.createElement(DBadge, { mono: false }, "Standby"), meta: "待命 · 可在桌面客户端申请移交执行权" },
    sunset: { dot: "neutral", badge: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "1px 6px" } }, "RETAINED"), meta: "Sunset · LocalContinuation 本地只读延续 · 无执行权" }
  }[d.state];
  const dim = d.state === "sunset";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 13, padding: "14px 16px", borderBottom: "1px solid var(--gd-line)", opacity: dim ? 0.6 : 1, background: d.state === "active" ? "linear-gradient(90deg,rgba(212,164,55,0.05),transparent 42%)" : "transparent" } }, /* @__PURE__ */ React.createElement(I.Monitor, { size: 19, style: { color: d.state === "active" ? "var(--gd-gold)" : "var(--gd-text-muted)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { width: 190, flex: "none", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" } }, d.name, d.self && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 5px", lineHeight: "15px", flex: "none" } }, "本机 · 网页")), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement(DDot, { kind: m.dot }), m.badge, d.state === "active" && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "Epoch ", d.epoch))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.meta), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, d.os, " · ", d.location, " · 绑定于 ", d.added)), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)", width: 64, flex: "none", textAlign: "right" } }, d.last), /* @__PURE__ */ React.createElement("span", { style: { width: 150, flex: "none", display: "flex", justifyContent: "flex-end", gap: 7 } }, /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => onRename(d) }, "重命名"), d.state === "active" && /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", disabled: true, title: "需在桌面客户端先移交执行权" }, "解绑"), d.state === "standby" && /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => onDeauth(d) }, "远程解绑"), d.state === "sunset" && /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => onRemove(d) }, "移除")));
}
function Devices() {
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [devices, setDevices] = React.useState(() => window.GD_ACCOUNT.devices.map((d) => ({ ...d })));
  const [deauth, setDeauth] = React.useState(null);
  const [ack, setAck] = React.useState(false);
  const bound = devices.filter((d) => d.state === "active" || d.state === "standby").length;
  const active = devices.find((d) => d.state === "active");
  const runDeauth = () => {
    const t = deauth;
    setDeauth(null);
    setAck(false);
    setDevices((ds) => ds.filter((d) => d.id !== t.id));
  };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "设备管理", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "已绑定设备", value: bound + " / 2", meta: "单活动执行权" },
    { label: "活动设备 Active", value: active ? active.name : "—", tone: "gold", meta: active ? "持有执行权" : "无" },
    { label: "当前 Epoch", value: active ? "Epoch " + active.epoch : "—", tone: "gold", mono: true, meta: "每次移交 +1" },
    { label: "待命 Standby", value: devices.some((d) => d.state === "standby") ? "1 台" : "0 台", meta: "蓝空心 · 无执行权" },
    { label: "License 额度", value: "2 台", meta: "所有付费期限" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "flex", flexDirection: "column", gap: 14, maxWidth: 1040 } }, /* @__PURE__ */ React.createElement(DPanel, { flush: true, title: "设备与执行权（ActiveDeviceLease）", actions: active && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "Epoch ", active.epoch) }, devices.map((d) => /* @__PURE__ */ React.createElement(DeviceRow, { key: d.id, d, onDeauth: setDeauth, onRemove: (rd) => setDevices((ds) => ds.filter((x) => x.id !== rd.id)), onRename: () => {
  } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 13, padding: "14px 16px", border: "1px solid var(--gd-line)", borderRadius: 7, background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/active-lease.svg", width: "30", height: "30", alt: "", style: { flex: "none", marginTop: 1 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 } }, "同一时刻只有一台设备持有执行权（", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-gold)", fontWeight: 500 } }, "金实心 = Active"), "，蓝空心 = Standby）。", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "移交执行权在桌面客户端完成"), "——旧设备排空未同步项后释放，新设备安全激活并由服务端签发新 Lease，Epoch 递增。网页可查看状态、重命名、以及远程解绑丢失的设备。")), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 16px", border: "1px dashed var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-ink)", display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 500, color: "var(--text-1)" } }, /* @__PURE__ */ React.createElement(I.Smartphone, { size: 15 }), "绑定新设备"), bound >= 2 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-warning)" } }, "设备额度已满（", bound, "/2）。绑定新设备前，请先远程解绑一台 Standby 设备。"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", lineHeight: 1.5 } }, "解绑不会删除该设备的本地数据；重新绑定需在设备上完成门禁校验。")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-2)" } }, "在新设备的桌面客户端选择「绑定到此账户」，输入下方配对码："), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--gd-panel)", border: "1px solid var(--gd-line-strong)", borderRadius: 5 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 16, letterSpacing: "0.18em", color: "var(--gd-gold)" } }, "7F2A-C91D"), /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.Copy, { size: 13 }), style: { marginLeft: "auto" } }, "复制"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, "04:58 后失效")))))), /* @__PURE__ */ React.createElement(
    DDlg,
    {
      open: !!deauth,
      onClose: () => {
        setDeauth(null);
        setAck(false);
      },
      title: "远程解绑设备",
      width: 480,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DBtn, { onClick: () => {
        setDeauth(null);
        setAck(false);
      } }, "取消"), /* @__PURE__ */ React.createElement(DBtn, { variant: "danger", disabled: !ack, onClick: runDeauth }, "远程解绑 ", deauth && deauth.name))
    },
    deauth && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "将 ", /* @__PURE__ */ React.createElement("b", null, deauth.name), " 从账户中移除。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "后果"), "：该设备将失去云端同步与执行权，下次联网时被强制登出；本地已缓存数据保留为只读。"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "额度"), "：解绑后释放一个设备名额（", bound, "/2 → ", bound - 1, "/2），可绑定新设备。"), /* @__PURE__ */ React.createElement("span", null, "此操作不影响当前 Active 设备的执行权与 Epoch。")), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--gd-line)", paddingTop: 10 } }, /* @__PURE__ */ React.createElement(DCheck, { checked: ack, onChange: () => setAck((a) => !a), label: `我确认远程解绑 ${deauth.name}` })))
  ));
}
window.GDDevices = Devices;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/Devices.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/Download.jsx
try { (() => {
const { Panel: DlPanel, Badge: DlBadge, Button: DlBtn } = window.GoodDealerDesignSystem_b5b0b6;
function ReleaseCard({ r }) {
  const I = window.GDI;
  const Ic = I[r.icon];
  const rec = r.note.indexOf("推荐") >= 0;
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "18px 18px 16px", border: rec ? "1px solid rgba(212,164,55,0.4)" : "1px solid var(--gd-line)", borderRadius: 8, background: "var(--gd-panel)", display: "flex", flexDirection: "column", gap: 12, position: "relative" } }, rec && /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: 14, right: 14 } }, /* @__PURE__ */ React.createElement(DlBadge, { tone: "gold" }, "推荐")), /* @__PURE__ */ React.createElement(Ic, { size: 26, style: { color: rec ? "var(--gd-gold)" : "var(--text-2)" } }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--text-1)" } }, r.os), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 3 } }, r.variant)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)", marginTop: "auto" } }, /* @__PURE__ */ React.createElement("span", null, "v", r.ver), /* @__PURE__ */ React.createElement("span", null, r.size)), /* @__PURE__ */ React.createElement(DlBtn, { size: "sm", variant: rec ? "primary" : "secondary", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 13 }), block: true }, "下载 ", r.os, " 版"));
}
function StepRow({ n, t, s }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 11 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 22, height: 22, flex: "none", borderRadius: "50%", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, n), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, t), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 2 } }, s)));
}
function Download() {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const steps = [["1", "打开客户端，选择「绑定到此账户」并登录", "本机将作为一个绑定设备（最多 2 台）"], ["2", "完成设备门禁校验", "本机生成设备密钥，Cloud 签发 ActiveDeviceLease"], ["3", "连接注册商 / DNS / 交易平台", "账号身份与凭据加密保存在本地，永不上云"], ["4", "首次导入本地业务库", "数据先写本地 SQLCipher，允许字段随后异步复制"]];
  const reqs = [["macOS", "13 Ventura 及以上 · Apple Silicon / Intel"], ["Windows", "10 / 11 · 64-bit"], ["Linux", "Ubuntu 22.04+ / Fedora 38+ · AppImage · .deb"], ["网络", "首次登录授权需联网；授权离线窗口内可继续本地业务"]];
  const changes = ["议价交割闭环：报价 → 平台费 → 净收入确认门", "冲突中心三方裁决与逐项覆盖", "批量执行差异预览新增高风险承认门", "设备门禁 Sunset · LocalContinuation 保留态"];
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "下载客户端", style: { padding: 18, maxWidth: 900, display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 20, padding: "22px 24px", border: "1px solid var(--gd-line)", borderRadius: 9, background: "linear-gradient(105deg,rgba(212,164,55,0.06),transparent 55%),var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/app-icon-tile.svg", width: "60", height: "60", alt: "", style: { flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginBottom: 6 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 19, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" } }, "GoodDealer 桌面客户端"), /* @__PURE__ */ React.createElement(DlBadge, { tone: "gold" }, "v0.9.0")), /* @__PURE__ */ React.createElement("p", { style: { fontSize: 13, color: "var(--text-2)", lineHeight: 1.6, margin: 0, maxWidth: 520 } }, "本地执行、云端同步的域名资产管理终端。批量执行、差异预览、议价交割、冲突裁决与设备门禁都在客户端完成——平台凭据经本地密钥加密，永不上云。")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-end", flex: "none" } }, /* @__PURE__ */ React.createElement(DlBtn, { size: "lg", variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Apple, { size: 16 }) }, "下载 macOS 版"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, "检测到你的系统 · Apple Silicon"))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14 } }, D.releases.map((r) => /* @__PURE__ */ React.createElement(ReleaseCard, { key: r.os, r }))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } }, /* @__PURE__ */ React.createElement(DlPanel, { title: "安装后：绑定到此账户" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } }, steps.map((s) => /* @__PURE__ */ React.createElement(StepRow, { key: s[0], n: s[0], t: s[1], s: s[2] })))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(DlPanel, { title: "系统要求" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, reqs.map((x) => /* @__PURE__ */ React.createElement("div", { key: x[0], style: { display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 70, flex: "none", color: "var(--text-3)" } }, x[0]), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-2)", flex: 1 } }, x[1]))))), /* @__PURE__ */ React.createElement(DlPanel, { title: "更新日志 · 0.9.0", actions: /* @__PURE__ */ React.createElement(DlBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "全部") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 7, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 } }, changes.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)", flex: "none" } }, "·"), c)))))));
}
window.GDDownload = Download;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/Download.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/License.jsx
try { (() => {
const { Panel: LPanel, Badge: LBadge, Button: LBtn, Money: LMoney, ProgressBar: LProg, Switch: LSwitch, Dialog: LDlg, Input: LInput, StatusDot: LDot } = window.GoodDealerDesignSystem_b5b0b6;
const TERMS = [
  { k: "月付", price: 9.8, unit: "/月", domains: "完整功能", devices: "2 台设备 · 单活动", feats: ["按月续费", "随时取消"] },
  { k: "年付", price: 98, unit: "/年", domains: "完整功能", devices: "2 台设备 · 单活动", feats: ["按年续费", "约省 17%"] },
  { k: "10 年固定期", price: 498, unit: "/10 年", domains: "完整功能", devices: "2 台设备 · 单活动", feats: ["一次预付 10 年", "不自动续费 · 非永久"] }
];
function Feat({ on, children }) {
  const I = window.GDI;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: on ? "var(--text-2)" : "var(--text-3)" } }, /* @__PURE__ */ React.createElement(I.Check, { size: 13, style: { color: on ? "var(--gd-success)" : "var(--text-3)", flex: "none" } }), children);
}
function License() {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [autoRenew, setAutoRenew] = React.useState(D.license.autoRenew);
  const [dlg, setDlg] = React.useState(null);
  const [target, setTarget] = React.useState(null);
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "订阅与许可", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "当前期限", value: "年付", tone: "gold", meta: "单一功能档位" },
    { label: "年费", value: "$98.00", tone: "gold", meta: "下次扣款 2026-12-31" },
    { label: "本期剩余", value: "136 天", tone: "warning", meta: "已用 63%" },
    { label: "所有权验证", value: "已验证", tone: "success", meta: "本地密钥签发" },
    { label: "设备额度", value: "2 台", meta: "单活动执行权" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "grid", gridTemplateColumns: "1fr 320px", gap: 14, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(LPanel, { title: "当前付费期限", actions: /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-2)" } }, "自动续费 ", /* @__PURE__ */ React.createElement(LSwitch, { checked: autoRenew, onChange: () => setAutoRenew((v) => !v) })) }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, marginBottom: 14 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 20, fontWeight: 600, color: "var(--text-1)" } }, "年付 License"), /* @__PURE__ */ React.createElement(LBadge, { tone: "gold" }, "ANNUAL"), /* @__PURE__ */ React.createElement(LMoney, { amount: 98, size: 15 }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-3)" } }, "/ 年")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-3)", marginBottom: 6, fontFamily: "var(--font-mono)" } }, /* @__PURE__ */ React.createElement("span", null, "2025-12-31 开始"), /* @__PURE__ */ React.createElement("span", null, "剩余 136 天"), /* @__PURE__ */ React.createElement("span", null, "2026-12-31 续费")), /* @__PURE__ */ React.createElement(LProg, { value: 63, height: 6 }), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 14, margin: "16px 0 4px" } }, [["无限域名", "已管理 1,024"], ["2 台设备", "单活动执行权"], ["全部平台连接", "Atom · Afternic · SellerHub"], ["批量执行", "差异预览 · 回滚"], ["冲突中心", "三方裁决"], ["议价交割", "托管交易闭环"]].map(([t, s]) => /* @__PURE__ */ React.createElement("div", { key: t, style: { display: "flex", flexDirection: "column", gap: 3, padding: "10px 12px", background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line)", borderRadius: 7 } }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--text-1)" } }, /* @__PURE__ */ React.createElement(I.Check, { size: 13, style: { color: "var(--gd-success)" } }), t), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", paddingLeft: 19 } }, s)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9, marginTop: 14, paddingTop: 14, borderTop: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "primary", onClick: () => {
    setTarget(TERMS[0]);
    setDlg("upgrade");
  } }, "切换计费周期"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", onClick: () => setDlg("pay") }, "管理支付方式"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost", onClick: () => setDlg("cancel"), icon: /* @__PURE__ */ React.createElement(I.Ban, { size: 13 }) }, "取消续订"))), /* @__PURE__ */ React.createElement(LPanel, { title: "所有权与许可证书", actions: /* @__PURE__ */ React.createElement(LBadge, { tone: "success", dot: true }, "已验证") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 14, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/graphics/seal.svg", width: "44", height: "44", alt: "", style: { flex: "none", marginTop: 2 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, margin: "0 0 12px" } }, "License 由本地密钥签发并绑定 Workspace 所有权，凭据永不上云。证书用于设备门禁与离线校验。"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "9px 12px", background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, fontFamily: "var(--font-mono)", fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "License Key"), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)", letterSpacing: "0.02em" } }, "GD-LIC-8F2A-C91D-··· ·-4E7B"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.Copy, { size: 13 }), style: { marginLeft: "auto" } }, "复制")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9, marginTop: 12 } }, /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 13 }) }, "下载证书"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 13 }) }, "轮换密钥")))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(LPanel, { flush: true, title: "付费期限对比" }, TERMS.map((t) => {
    const cur = t.k === "年付";
    return /* @__PURE__ */ React.createElement("div", { key: t.k, style: { padding: "13px 16px", borderBottom: "1px solid var(--gd-line)", background: cur ? "linear-gradient(90deg,rgba(212,164,55,0.05),transparent 60%)" : "transparent" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 600, color: "var(--text-1)" } }, t.k), cur && /* @__PURE__ */ React.createElement(LBadge, { tone: "gold" }, "当前"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", alignItems: "baseline", gap: 3 } }, /* @__PURE__ */ React.createElement(LMoney, { amount: t.price, size: 13, tone: cur ? "gold" : "body" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)" } }, t.unit))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement(Feat, { on: true }, t.domains), /* @__PURE__ */ React.createElement(Feat, { on: true }, t.devices), t.feats.slice(0, 2).map((f) => /* @__PURE__ */ React.createElement(Feat, { key: f, on: true }, f))), !cur && /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: t.k === "10 年固定期" ? "primary" : "ghost", style: { width: "100%", marginTop: 10 }, onClick: () => {
      setTarget(t);
      setDlg("upgrade");
    } }, "选择 ", t.k));
  })), /* @__PURE__ */ React.createElement(LPanel, { title: "本月用量" }, [["域名", D.usage.domains.toLocaleString(), "无限"], ["绑定设备", "2", "2 台"], ["平台连接", "4", ""], ["云端存储", "38 MB", ""]].map(([k, v, cap]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 12.5 } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, color: "var(--text-2)" } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--text-1)" } }, v), cap && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)", marginLeft: 6 } }, "/ ", cap)))))), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: dlg === "pay",
      onClose: () => setDlg(null),
      title: "Stripe 托管付款",
      width: 440,
      footer: /* @__PURE__ */ React.createElement(LBtn, { onClick: () => setDlg(null) }, "关闭")
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement(LBtn, { variant: "primary", icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "Stripe 托管结账"), /* @__PURE__ */ React.createElement(LInput, { label: "优惠码（可选）", mono: true, placeholder: "LAUNCH" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", lineHeight: 1.55 } }, "首发付款由 Stripe 托管；税费由托管结账显示。GoodDealer 不采集卡号或付款账户资料。无免费试用；每账号首次付费购买可在付款后 14 天内全额退款，续费不重置窗口。"))
  ), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: dlg === "upgrade",
      onClose: () => setDlg(null),
      title: target ? `切换到 ${target.k}` : "",
      width: 460,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { onClick: () => setDlg(null) }, "取消"), /* @__PURE__ */ React.createElement(LBtn, { variant: "primary", onClick: () => setDlg(null) }, "选择 ", target && target.k, " · $", target && target.price, target && target.unit))
    },
    target && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "从 ", /* @__PURE__ */ React.createElement("b", null, "年付 · $98/年"), " 切换到 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-gold)" } }, target.k, " · $", target.price, target.unit), "。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 7, fontSize: 12, color: "var(--text-2)" } }, target.feats.map((f) => /* @__PURE__ */ React.createElement(Feat, { key: f, on: true }, f))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "当前期限先取消续费并使用到已付周期结束，之后才能通过新的付款渠道或期限购买。"))
  ), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: dlg === "cancel",
      onClose: () => setDlg(null),
      title: "取消续订",
      width: 440,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { onClick: () => setDlg(null) }, "保留订阅"), /* @__PURE__ */ React.createElement(LBtn, { variant: "danger", onClick: () => {
        setAutoRenew(false);
        setDlg(null);
      } }, "取消续订 · 至 2026-12-31 到期"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 } }, /* @__PURE__ */ React.createElement("span", null, "取消后 License 仍有效至 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontFamily: "var(--font-mono)" } }, "2026-12-31"), "，届时不再自动续费。"), /* @__PURE__ */ React.createElement("span", null, "到期后进入 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)" } }, "Sunset · LocalContinuation"), "：本地数据保留只读，云端同步与执行权停止。随时可恢复续订。"))
  ));
}
window.GDLicense = License;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/License.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/Security.jsx
try { (() => {
const { Panel: SPanel, Badge: SBadge, Button: SBtn, Switch: SSwitch, Dialog: SDlg, Input: SInput, StatusDot: SDot, IconButton: SIcon } = window.GoodDealerDesignSystem_b5b0b6;
function SessionRow({ s, onRevoke }) {
  const I = window.GDI;
  const Ic = { desktop: I.Monitor, web: I.Globe, mobile: I.Smartphone }[s.kind] || I.Globe;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--gd-line)", background: s.flag ? "var(--gd-warning-tint)" : "transparent" } }, /* @__PURE__ */ React.createElement(Ic, { size: 17, style: { color: s.flag ? "var(--gd-warning)" : "var(--gd-text-muted)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 8 } }, s.device, s.current && /* @__PURE__ */ React.createElement(SBadge, { tone: "success" }, "本次会话"), s.flag && /* @__PURE__ */ React.createElement(SBadge, { tone: "warning", mono: false }, "异常位置")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, s.location, " · ", s.ip)), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)", flex: "none" } }, s.last), /* @__PURE__ */ React.createElement("span", { style: { width: 64, flex: "none", display: "flex", justifyContent: "flex-end" } }, s.current ? /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "当前") : /* @__PURE__ */ React.createElement(SBtn, { size: "sm", variant: "ghost", onClick: () => onRevoke(s) }, "终止")));
}
function Security() {
  const D = window.GD_ACCOUNT;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [sessions, setSessions] = React.useState(() => D.sessions.map((s) => ({ ...s })));
  const [totp, setTotp] = React.useState(true);
  const [sms, setSms] = React.useState(false);
  const [dlg, setDlg] = React.useState(null);
  const flagged = sessions.filter((s) => s.flag).length;
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "安全", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "双重验证", value: totp ? "已启用" : "未启用", tone: totp ? "success" : "danger", meta: "Authenticator app" },
    { label: "活跃会话", value: sessions.length + " 个", meta: "1 桌面 · 1 移动 · 网页" },
    { label: "异常登录", value: flagged + " 处", tone: flagged ? "warning" : "success", meta: flagged ? "东京 · 建议核实" : "无" },
    { label: "恢复码", value: "8 个", meta: "剩余可用" },
    { label: "上次改密", value: "92 天前", mono: true, meta: "2026-05-17" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(SPanel, { flush: true, title: "活跃会话", actions: /* @__PURE__ */ React.createElement(SBtn, { size: "sm", variant: "ghost", onClick: () => setDlg("revokeAll") }, "终止其它全部会话") }, sessions.map((s) => /* @__PURE__ */ React.createElement(SessionRow, { key: s.id, s, onRevoke: (rs) => setSessions((ss) => ss.filter((x) => x.id !== rs.id)) }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, padding: "13px 15px", border: "1px solid var(--gd-line)", borderRadius: 7, background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "26", height: "26", alt: "", style: { flex: "none", marginTop: 1, opacity: 0.9 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-2)", lineHeight: 1.6 } }, "注册商、DNS、交易平台的 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "平台凭据经本地密钥加密保存，永不上云"), "，因此不会出现在本页面或任何云端。此处仅管理 GoodDealer 账户本身的登录与验证。"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(SPanel, { title: "双重验证 2FA" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement(I.Lock, { size: 16, style: { color: totp ? "var(--gd-success)" : "var(--text-3)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, "Authenticator App"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)" } }, "TOTP · 每 30 秒")), /* @__PURE__ */ React.createElement(SSwitch, { checked: totp, onChange: () => setTotp((v) => !v) })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement(I.Smartphone, { size: 16, style: { color: sms ? "var(--gd-success)" : "var(--text-3)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, "短信验证码"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)" } }, "+86 ··· ··· 8821")), /* @__PURE__ */ React.createElement(SSwitch, { checked: sms, onChange: () => setSms((v) => !v) })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 0" } }, /* @__PURE__ */ React.createElement(I.ShieldCheck, { size: 16, style: { color: "var(--text-3)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, "硬件安全密钥"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)" } }, "WebAuthn · 未添加")), /* @__PURE__ */ React.createElement(SBtn, { size: "sm", variant: "ghost" }, "添加")))), /* @__PURE__ */ React.createElement(SPanel, { title: "恢复码", actions: /* @__PURE__ */ React.createElement(SBadge, { tone: "success" }, "8 剩余") }, /* @__PURE__ */ React.createElement("p", { style: { fontSize: 12, color: "var(--text-2)", lineHeight: 1.6, margin: "0 0 10px" } }, "丢失验证设备时用于登录。请离线保存，每个仅可使用一次。"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 9 } }, /* @__PURE__ */ React.createElement(SBtn, { size: "sm", onClick: () => setDlg("codes") }, "查看恢复码"), /* @__PURE__ */ React.createElement(SBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 13 }), onClick: () => setDlg("codes") }, "重新生成"))), /* @__PURE__ */ React.createElement(SPanel, { title: "密码" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-2)", letterSpacing: "0.1em" } }, "············"), /* @__PURE__ */ React.createElement(SBtn, { size: "sm", style: { marginLeft: "auto" }, onClick: () => setDlg("pw") }, "更改密码"))))), /* @__PURE__ */ React.createElement(
    SDlg,
    {
      open: dlg === "pw",
      onClose: () => setDlg(null),
      title: "更改密码",
      width: 420,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(SBtn, { onClick: () => setDlg(null) }, "取消"), /* @__PURE__ */ React.createElement(SBtn, { variant: "primary", onClick: () => setDlg(null) }, "更新密码"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement(SInput, { label: "当前密码", placeholder: "••••••••" }), /* @__PURE__ */ React.createElement(SInput, { label: "新密码", placeholder: "至少 12 位" }), /* @__PURE__ */ React.createElement(SInput, { label: "确认新密码", placeholder: "再次输入" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "更改密码会终止其它全部会话。"))
  ), /* @__PURE__ */ React.createElement(
    SDlg,
    {
      open: dlg === "codes",
      onClose: () => setDlg(null),
      title: "恢复码",
      width: 420,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(SBtn, { onClick: () => setDlg(null) }, "关闭"), /* @__PURE__ */ React.createElement(SBtn, { variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 13 }), onClick: () => setDlg(null) }, "下载 .txt"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 } }, ["8F2A-C91D", "4E7B-2AD0", "91C3-7FE1", "B0D4-3A88", "6C2E-91FA", "D74B-0C15", "3E9A-B72D", "F10C-8E44"].map((c) => /* @__PURE__ */ React.createElement("span", { key: c, style: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--gd-gold)", padding: "7px 10px", background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, textAlign: "center", letterSpacing: "0.04em" } }, c))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "每个恢复码仅可使用一次。重新生成会使旧码全部失效。"))
  ), /* @__PURE__ */ React.createElement(
    SDlg,
    {
      open: dlg === "revokeAll",
      onClose: () => setDlg(null),
      title: "终止其它全部会话",
      width: 420,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(SBtn, { onClick: () => setDlg(null) }, "取消"), /* @__PURE__ */ React.createElement(SBtn, { variant: "danger", onClick: () => {
        setSessions((ss) => ss.filter((s) => s.current));
        setDlg(null);
      } }, "终止 ", sessions.filter((s) => !s.current).length, " 个会话"))
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 } }, "将登出除本次会话外的全部设备与网页会话（含桌面客户端）。桌面客户端需重新登录，但不影响已绑定设备的执行权与本地数据。")
  ));
}
window.GDSecurity = Security;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/Security.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/controls.jsx
try { (() => {
const { Select: GDSelect, IconButton: GDIconButton } = window.GoodDealerDesignSystem_b5b0b6;
function pageWindow(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const s = /* @__PURE__ */ new Set([1, 2, total - 1, total, cur - 1, cur, cur + 1]);
  const arr = [...s].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of arr) {
    if (n - prev > 1) out.push("gap" + n);
    out.push(n);
    prev = n;
  }
  return out;
}
function PageNum({ n, active, onClick }) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick,
      onMouseEnter: (e) => {
        if (!active) e.currentTarget.style.background = "var(--gd-panel-raised)";
      },
      onMouseLeave: (e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      },
      style: {
        minWidth: 24,
        height: 24,
        padding: "0 6px",
        borderRadius: 5,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        border: active ? "1px solid var(--gd-line-strong)" : "1px solid transparent",
        background: active ? "var(--gd-panel-raised)" : "transparent",
        color: active ? "var(--text-1)" : "var(--text-2)"
      }
    },
    n
  );
}
function Pagination({ page, pageSize, total, onPage, onPageSize, pageSizes = [10, 25, 50], note }) {
  const I = window.GDI;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, width: "100%", fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" } }, from.toLocaleString(), "–", to.toLocaleString(), " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "/ ", total.toLocaleString())), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, "每页", /* @__PURE__ */ React.createElement(GDSelect, { size: "sm", options: pageSizes.map(String), value: String(pageSize), onChange: (e) => onPageSize(+e.target.value) })), note && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11 } }, note), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: note ? 16 : "auto", display: "flex", alignItems: "center", gap: 3 } }, /* @__PURE__ */ React.createElement(GDIconButton, { size: "sm", label: "上一页", disabled: cur <= 1, onClick: () => onPage(cur - 1) }, /* @__PURE__ */ React.createElement(I.ChevronLeft, { size: 14 })), pageWindow(cur, pages).map((n, i) => typeof n === "number" ? /* @__PURE__ */ React.createElement(PageNum, { key: i, n, active: n === cur, onClick: () => onPage(n) }) : /* @__PURE__ */ React.createElement("span", { key: i, style: { padding: "0 2px", color: "var(--gd-text-faint)" } }, "…")), /* @__PURE__ */ React.createElement(GDIconButton, { size: "sm", label: "下一页", disabled: cur >= pages, onClick: () => onPage(cur + 1) }, /* @__PURE__ */ React.createElement(I.ChevronRight, { size: 14 }))));
}
window.GDPagination = Pagination;
function EditableCell({ value, display, onCommit, width = 94, prefix }) {
  const [editing, setEditing] = React.useState(false);
  const ref = React.useRef(null);
  const doneRef = React.useRef(false);
  React.useEffect(() => {
    if (editing && ref.current) {
      ref.current.value = value == null ? "" : String(value);
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);
  const start = () => {
    doneRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const raw = ref.current ? ref.current.value : "";
    setEditing(false);
    const clean = String(raw).trim();
    if (clean !== "" && clean !== String(value)) onCommit(clean);
  };
  const cancel = () => {
    doneRef.current = true;
    setEditing(false);
  };
  if (editing) {
    return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }, onClick: (e) => e.stopPropagation() }, prefix && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" } }, prefix), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref,
        inputMode: "decimal",
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") cancel();
        },
        onBlur: commit,
        style: { width, height: 24, background: "var(--gd-ink)", border: "1px solid var(--gd-blue)", boxShadow: "0 0 0 2px rgba(77,141,255,0.25)", borderRadius: 5, color: "var(--gd-text)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 12, textAlign: "right", padding: "0 7px", outline: "none" }
      }
    ));
  }
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      onDoubleClick: (e) => {
        e.stopPropagation();
        start();
      },
      onClick: (e) => e.stopPropagation(),
      title: "双击编辑 · 回车确认",
      style: { cursor: "text", display: "inline-block", borderBottom: "1px dashed transparent", paddingBottom: 1, transition: "border-color 120ms" },
      onMouseEnter: (e) => e.currentTarget.style.borderBottomColor = "var(--gd-line-strong)",
      onMouseLeave: (e) => e.currentTarget.style.borderBottomColor = "transparent"
    },
    display != null ? display : value
  );
}
window.GDEditableCell = EditableCell;
function MetricStrip({ metrics = [] }) {
  const tone = (t) => ({ gold: "var(--gd-gold)", danger: "var(--gd-danger)", warning: "var(--gd-warning)", blue: "var(--gd-blue)", success: "var(--gd-success)", muted: "var(--text-3)" })[t] || "var(--text-1)";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: 72, flex: "none", background: "var(--surface-region)", borderBottom: "1px solid var(--gd-line)" } }, metrics.map((m, i) => {
    const click = m.onClick;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: i,
        onClick: click || void 0,
        onMouseEnter: click ? (e) => {
          e.currentTarget.style.background = "var(--gd-panel-raised)";
        } : void 0,
        onMouseLeave: click ? (e) => {
          e.currentTarget.style.background = "transparent";
        } : void 0,
        style: {
          flex: 1,
          minWidth: 0,
          padding: "0 16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 3,
          transition: "background 120ms",
          borderRight: i < metrics.length - 1 ? "1px solid var(--gd-line)" : "none",
          cursor: click ? "pointer" : "default"
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-label", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.label),
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-metric-sm", style: { color: m.tone === "muted" ? "var(--text-3)" : tone(m.tone), fontFamily: m.mono ? "var(--font-mono)" : void 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.value),
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-meta", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: 14 } }, m.meta != null ? m.meta : " ")
    );
  }));
}
window.GDMetricStrip = MetricStrip;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/controls.jsx", error: String((error && error.message) || error) }); }

// ui_kits/account-web/data.js
try { (() => {
window.GD_ACCOUNT = {
  profile: { name: "陈立行", email: "li@quanta.trade", workspace: "个人 Workspace", memberSince: "2024-03-11", locale: "中文（zh-CN）", timezone: "Asia/Shanghai (UTC+8)" },
  license: { term: "年付", price: 98, cycle: "年", renews: "2026-12-31", started: "2025-12-31", autoRenew: true, domainsIncluded: "无限", devicesIncluded: 2, method: "Stripe 托管付款" },
  usage: { domains: 1024, valuation: 284120, platforms: 4, accounts: 3, devicesBound: 2, storageMB: 38 },
  devices: [
    { id: "mac", name: "MacBook Pro", os: "macOS 15.2 · Apple Silicon", self: true, state: "active", epoch: 41, last: "现在", location: "上海", added: "2024-12-31" },
    { id: "iph", name: "iPhone 17 Pro", os: "iOS 19.1", self: false, state: "standby", last: "今日 08:30", location: "上海", added: "2025-06-02" },
    { id: "air", name: "MacBook Air (2019)", os: "macOS 13 · Intel", self: false, state: "sunset", last: "06-12", location: "—", added: "2024-03-11" }
  ],
  invoices: [
    { id: "INV-2026-0012", date: "2025-12-31", desc: "年付 License · 2026", amount: 98, status: "paid", method: "Stripe 托管付款" },
    { id: "INV-2025-0009", date: "2024-12-31", desc: "年付 License · 2025", amount: 98, status: "paid", method: "Stripe 托管付款" },
    { id: "INV-2025-0021", date: "2025-06-02", desc: "追加绑定设备额度", amount: 0, status: "paid", method: "—" },
    { id: "INV-2024-0004", date: "2024-03-11", desc: "月付 License", amount: 9.8, status: "paid", method: "Stripe 托管付款" }
  ],
  sessions: [
    { id: 1, device: "MacBook Pro · 桌面客户端", kind: "desktop", ip: "116.226.xx.xx", location: "上海 · 中国", last: "现在", current: true },
    { id: 2, device: "Chrome 129 · macOS", kind: "web", ip: "116.226.xx.xx", location: "上海 · 中国", last: "12 分钟前", current: false },
    { id: 3, device: "iPhone 17 Pro · 桌面客户端", kind: "mobile", ip: "223.104.xx.xx", location: "上海 · 中国", last: "今日 08:30", current: false },
    { id: 4, device: "Safari · macOS", kind: "web", ip: "45.32.xx.xx", location: "东京 · 日本", last: "07-28", current: false, flag: true }
  ],
  ledger: [
    { rev: 8241, op: "批量改价 BIN −8%", platform: "Atom / Afternic", source: "MacBook Pro", items: 823, status: "applied", time: "14:02" },
    { rev: 8240, op: "新增 TXT 验证记录", platform: "Cloudflare", source: "MacBook Pro", items: 17, status: "applied", time: "13:44" },
    { rev: 8239, op: "变更 Nameserver → Cloudflare", platform: "注册商", source: "MacBook Pro", items: 3, status: "applied", time: "13:31", risk: true },
    { rev: 8238, op: "成交与交割 vault.io", platform: "Atom", source: "MacBook Pro", items: 1, status: "applied", time: "11:20", value: 12800 },
    { rev: 8237, op: "批量改价 BIN −12%", platform: "Atom", source: "MacBook Air", items: 240, status: "rolledback", time: "昨日 09:12" }
  ],
  portfolio: [
    { domain: "kanban.ai", registrar: "Namecheap", status: "synced", bin: 45e3, expiry: "2027-01-28" },
    { domain: "marble.finance", registrar: "Spaceship", status: "synced", bin: 15e3, expiry: "2027-02-17" },
    { domain: "vault.io", registrar: "Spaceship", status: "sold", bin: 12800, expiry: "2027-03-14" },
    { domain: "crest.capital", registrar: "Spaceship", status: "synced", bin: 9800, expiry: "2027-11-30" },
    { domain: "north.capital", registrar: "Spaceship", status: "synced", bin: 8200, expiry: "2028-05-01" },
    { domain: "quanta.trade", registrar: "Spaceship", status: "synced", bin: 6600, expiry: "2027-06-11" },
    { domain: "oxide.dev", registrar: "Namecheap", status: "pending", bin: 5200, expiry: "2026-10-05" },
    { domain: "lantern.app", registrar: "Spaceship", status: "synced", bin: 3900, expiry: "2027-07-22" },
    { domain: "goldrail.com", registrar: "Spaceship", status: "synced", bin: 3500, expiry: "2026-11-02" },
    { domain: "driftline.com", registrar: "Spaceship", status: "pending", bin: 2400, expiry: "2026-12-24" },
    { domain: "helio.systems", registrar: "Dynadot", status: "synced", bin: 1750, expiry: "2027-09-08" },
    { domain: "lumen.dev", registrar: "Dynadot", status: "conflict", bin: 980, expiry: "2026-09-19" }
  ],
  activity: [
    { kind: "sync", text: "云端已接收 823 项修改", meta: "MacBook Pro · rev 8,241", time: "14:02" },
    { kind: "sale", text: "vault.io 已成交并放款", meta: "Atom · 净收入入账", time: "11:20", value: 12800 },
    { kind: "device", text: "iPhone 17 Pro 申请待命", meta: "Standby · 未持有执行权", time: "08:30" },
    { kind: "billing", text: "发票 INV-2026-0012 已支付", meta: "Stripe 托管付款", time: "昨日" },
    { kind: "security", text: "新的网页登录 · 东京", meta: "Safari · 45.32.xx.xx", time: "07-28", flag: true }
  ],
  releases: [
    { os: "macOS", icon: "Apple", variant: "Apple Silicon · Intel 通用", size: "92 MB", ver: "0.9.0", note: "推荐 · 本机版本" },
    { os: "Windows", icon: "Monitor", variant: "Windows 10/11 · x64", size: "104 MB", ver: "0.9.0", note: "" },
    { os: "Linux", icon: "HardDrive", variant: "AppImage · .deb", size: "98 MB", ver: "0.9.0", note: "" }
  ]
};
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/data.js", error: String((error && error.message) || error) }); }

// ui_kits/account-web/icons.jsx
try { (() => {
const mkIcon = (children) => ({ size = 15, style, ...p }) => /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", style, ...p }, children);
const GDI = {
  LayoutDashboard: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "7", height: "9", x: "3", y: "3", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { width: "7", height: "5", x: "14", y: "3", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { width: "7", height: "9", x: "14", y: "12", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { width: "7", height: "5", x: "3", y: "16", rx: "1" }))),
  Globe: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "M2 12h20" }), /* @__PURE__ */ React.createElement("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }))),
  Coins: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "6" }), /* @__PURE__ */ React.createElement("path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }), /* @__PURE__ */ React.createElement("path", { d: "M7 6h1v4" }), /* @__PURE__ */ React.createElement("path", { d: "m16.71 13.88.7.71-2.82 2.82" }))),
  Users: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "7", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }), /* @__PURE__ */ React.createElement("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }))),
  User: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "7", r: "4" }))),
  CreditCard: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "20", height: "14", x: "2", y: "5", rx: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "2", x2: "22", y1: "10", y2: "10" }))),
  Receipt: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }), /* @__PURE__ */ React.createElement("path", { d: "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" }), /* @__PURE__ */ React.createElement("path", { d: "M12 17.5v-11" }))),
  KeyRound: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M2 18v3c0 .5.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" }), /* @__PURE__ */ React.createElement("circle", { cx: "16.5", cy: "7.5", r: ".7", fill: "currentColor" }))),
  Key: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "7.5", cy: "15.5", r: "5.5" }), /* @__PURE__ */ React.createElement("path", { d: "m21 2-9.6 9.6" }), /* @__PURE__ */ React.createElement("path", { d: "m15.5 7.5 3 3L22 7l-3-3" }))),
  ShieldCheck: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }), /* @__PURE__ */ React.createElement("path", { d: "m9 12 2 2 4-4" }))),
  Shield: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" })),
  Lock: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }))),
  Smartphone: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M12 18h.01" }))),
  Monitor: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "2", y: "3", width: "20", height: "14", rx: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "21", x2: "16", y2: "21" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "17", x2: "12", y2: "21" }))),
  Database: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }), /* @__PURE__ */ React.createElement("path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }), /* @__PURE__ */ React.createElement("path", { d: "M3 12A9 3 0 0 0 21 12" }))),
  Cloud: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" })),
  Server: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("rect", { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "6", x2: "6.01", y1: "6", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "6", x2: "6.01", y1: "18", y2: "18" }))),
  Activity: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" })),
  LifeBuoy: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "m4.93 4.93 4.24 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "m14.83 9.17 4.24-4.24" }), /* @__PURE__ */ React.createElement("path", { d: "m14.83 14.83 4.24 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "m9.17 14.83-4.24 4.24" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "4" }))),
  ScrollText: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 12h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M15 8h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M19 17V5a2 2 0 0 0-2-2H4" }), /* @__PURE__ */ React.createElement("path", { d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" }))),
  SlidersHorizontal: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "14", y1: "4", y2: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "10", x2: "3", y1: "4", y2: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "12", y1: "12", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "8", x2: "3", y1: "12", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "16", y1: "20", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "3", y1: "20", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "14", x2: "14", y1: "2", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", x2: "8", y1: "10", y2: "14" }), /* @__PURE__ */ React.createElement("line", { x1: "16", x2: "16", y1: "18", y2: "22" }))),
  Megaphone: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m3 11 18-5v12L3 14v-3z" }), /* @__PURE__ */ React.createElement("path", { d: "M11.6 16.8a3 3 0 1 1-5.8-1.6" }))),
  Bell: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }), /* @__PURE__ */ React.createElement("path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }))),
  LogOut: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 17 21 12 16 7" }), /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "9", y1: "12", y2: "12" }))),
  Settings: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }))),
  Search: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "7" }), /* @__PURE__ */ React.createElement("path", { d: "m20 20-3.5-3.5" }))),
  RefreshCw: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 12a9 9 0 0 1 15.6-6.2L21 8" }), /* @__PURE__ */ React.createElement("path", { d: "M21 3v5h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M21 12a9 9 0 0 1-15.6 6.2L3 16" }), /* @__PURE__ */ React.createElement("path", { d: "M3 21v-5h5" }))),
  Download: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "7 10 12 15 17 10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "15", x2: "12", y2: "3" }))),
  Upload: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "17 8 12 3 7 8" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "3", x2: "12", y2: "15" }))),
  X: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M18 6 6 18" }), /* @__PURE__ */ React.createElement("path", { d: "m6 6 12 12" }))),
  Plus: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M5 12h14" }), /* @__PURE__ */ React.createElement("path", { d: "M12 5v14" }))),
  Minus: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M5 12h14" })),
  Check: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M20 6 9 17l-5-5" })),
  ChevronRight: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m9 18 6-6-6-6" })),
  ChevronLeft: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m15 18-6-6 6-6" })),
  ChevronDown: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m6 9 6 6 6-6" })),
  ExternalLink: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 3h6v6" }), /* @__PURE__ */ React.createElement("path", { d: "M10 14 21 3" }), /* @__PURE__ */ React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }))),
  ArrowRight: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M5 12h14" }), /* @__PURE__ */ React.createElement("path", { d: "m12 5 7 7-7 7" }))),
  ArrowUpRight: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M7 7h10v10" }), /* @__PURE__ */ React.createElement("path", { d: "M7 17 17 7" }))),
  MoreHorizontal: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "19", cy: "12", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "5", cy: "12", r: "1" }))),
  Filter: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" })),
  Calendar: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", x2: "16", y1: "2", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", x2: "8", y1: "2", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", x2: "21", y1: "10", y2: "10" }))),
  Clock: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("polyline", { points: "12 6 12 12 16 14" }))),
  TrendingUp: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("polyline", { points: "22 7 13.5 15.5 8.5 10.5 2 17" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 7 22 7 22 13" }))),
  TrendingDown: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("polyline", { points: "22 17 13.5 8.5 8.5 13.5 2 7" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 17 22 17 22 11" }))),
  Zap: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })),
  Ban: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "m4.9 4.9 14.2 14.2" }))),
  Copy: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }))),
  Eye: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }))),
  EyeOff: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M9.88 9.88a3 3 0 1 0 4.24 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" }), /* @__PURE__ */ React.createElement("path", { d: "M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" }), /* @__PURE__ */ React.createElement("line", { x1: "2", x2: "22", y1: "2", y2: "22" }))),
  Mail: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }))),
  DollarSign: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "12", y1: "2", y2: "22" }), /* @__PURE__ */ React.createElement("path", { d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" }))),
  Wallet: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" }), /* @__PURE__ */ React.createElement("path", { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" }), /* @__PURE__ */ React.createElement("path", { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" }))),
  Building2: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" }), /* @__PURE__ */ React.createElement("path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" }), /* @__PURE__ */ React.createElement("path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" }), /* @__PURE__ */ React.createElement("path", { d: "M10 6h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 10h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 14h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 18h4" }))),
  Cpu: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "16", height: "16", x: "4", y: "4", rx: "2" }), /* @__PURE__ */ React.createElement("rect", { width: "6", height: "6", x: "9", y: "9", rx: "1" }), /* @__PURE__ */ React.createElement("path", { d: "M15 2v2" }), /* @__PURE__ */ React.createElement("path", { d: "M15 20v2" }), /* @__PURE__ */ React.createElement("path", { d: "M2 15h2" }), /* @__PURE__ */ React.createElement("path", { d: "M2 9h2" }), /* @__PURE__ */ React.createElement("path", { d: "M20 15h2" }), /* @__PURE__ */ React.createElement("path", { d: "M20 9h2" }), /* @__PURE__ */ React.createElement("path", { d: "M9 2v2" }), /* @__PURE__ */ React.createElement("path", { d: "M9 20v2" }))),
  HardDrive: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("line", { x1: "22", x2: "2", y1: "12", y2: "12" }), /* @__PURE__ */ React.createElement("path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }), /* @__PURE__ */ React.createElement("line", { x1: "6", x2: "6.01", y1: "16", y2: "16" }), /* @__PURE__ */ React.createElement("line", { x1: "10", x2: "10.01", y1: "16", y2: "16" }))),
  Wifi: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12 20h.01" }), /* @__PURE__ */ React.createElement("path", { d: "M2 8.82a15 15 0 0 1 20 0" }), /* @__PURE__ */ React.createElement("path", { d: "M5 12.86a10 10 0 0 1 14 0" }), /* @__PURE__ */ React.createElement("path", { d: "M8.5 16.43a5 5 0 0 1 7 0" }))),
  BarChart3: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 3v18h18" }), /* @__PURE__ */ React.createElement("path", { d: "M18 17V9" }), /* @__PURE__ */ React.createElement("path", { d: "M13 17V5" }), /* @__PURE__ */ React.createElement("path", { d: "M8 17v-3" }))),
  Gauge: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m12 14 4-4" }), /* @__PURE__ */ React.createElement("path", { d: "M3.34 19a10 10 0 1 1 17.32 0" }))),
  CircleCheck: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "m9 12 2 2 4-4" }))),
  CircleAlert: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "12", y1: "8", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "12.01", y1: "16", y2: "16" }))),
  AlertTriangle: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }), /* @__PURE__ */ React.createElement("path", { d: "M12 9v4" }), /* @__PURE__ */ React.createElement("path", { d: "M12 17h.01" }))),
  Trash2: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 6h18" }), /* @__PURE__ */ React.createElement("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }), /* @__PURE__ */ React.createElement("line", { x1: "10", x2: "10", y1: "11", y2: "17" }), /* @__PURE__ */ React.createElement("line", { x1: "14", x2: "14", y1: "11", y2: "17" }))),
  FileText: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }), /* @__PURE__ */ React.createElement("path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 9H8" }), /* @__PURE__ */ React.createElement("path", { d: "M16 13H8" }), /* @__PURE__ */ React.createElement("path", { d: "M16 17H8" }))),
  Pause: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "14", y: "4", width: "4", height: "16", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { x: "6", y: "4", width: "4", height: "16", rx: "1" }))),
  Play: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "6 3 20 12 6 21 6 3" })),
  Apple: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" }), /* @__PURE__ */ React.createElement("path", { d: "M10 2c1 .5 2 2 2 5" }))),
  Command: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" }))
};
window.GDI = GDI;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/account-web/icons.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/AdminDashboard.jsx
try { (() => {
const { Panel: DPanel, Badge: DBadge, Button: DBtn, Money: DMoney, StatusDot: DDot } = window.GoodDealerDesignSystem_b5b0b6;
function Bars({ series }) {
  const max = Math.max(...series), min = Math.min(...series);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-end", gap: 5, height: 96, marginTop: 4 } }, series.map((v, i) => {
    const h = 8 + (v - min) / (max - min || 1) * 82;
    const last = i === series.length - 1;
    return /* @__PURE__ */ React.createElement("div", { key: i, title: "$" + v + "k", style: { flex: 1, display: "flex", flexDirection: "column", justifyContent: "flex-end", alignItems: "stretch", gap: 5 } }, /* @__PURE__ */ React.createElement("div", { style: { height: h, borderRadius: "2px 2px 0 0", background: last ? "var(--gd-gold)" : "rgba(212,164,55,0.32)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "var(--text-3)", textAlign: "center", fontFamily: "var(--font-mono)" } }, i + 1));
  }));
}
function AttnRow({ icon, tone, text, meta, cta, onGo }) {
  const I = window.GDI;
  const Ic = I[icon];
  const col = `var(--gd-${tone})`;
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 11, padding: "11px 0", borderBottom: "1px solid var(--gd-line)", alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 26, height: 26, flex: "none", borderRadius: 6, background: `var(--gd-${tone}-tint)`, display: "flex", alignItems: "center", justifyContent: "center", color: col } }, /* @__PURE__ */ React.createElement(Ic, { size: 14 })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, text), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 2 } }, meta)), /* @__PURE__ */ React.createElement("button", { onClick: onGo, style: { flex: "none", background: "none", border: "none", color: "var(--gd-blue)", fontSize: 11.5, cursor: "pointer", fontFamily: "var(--font-sans)", whiteSpace: "nowrap", padding: "2px 0" } }, cta));
}
function AdminDashboard({ go }) {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const K = D.kpis;
  const MetricStrip = window.GDMetricStrip;
  const totalMrr = D.termMix.reduce((s, p) => s + p.mrr, 0);
  const fleetStates = [["active", "Active", 1842, "gold"], ["standby", "Standby", 1903, "blue"], ["activating", "激活中", 41, "blue"], ["draining", "排空中", 18, "warning"], ["sunset", "Sunset 保留", 302, "neutral"]];
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "运营概览", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "活跃客户", value: K.activeCustomers.toLocaleString(), meta: "首次购买退款期内 " + K.refundEligible + " · 流失率 " + K.churnRate + "%" },
    { label: "月经常性收入 MRR", value: "$19,927", tone: "gold", meta: "ARR $239,124 · 固定期收入另计" },
    { label: "在线设备", value: K.devicesOnline.toLocaleString(), meta: "绑定 " + K.devicesBound.toLocaleString() + " · 单活动" },
    { label: "同步健康", value: K.syncHealth + "%", tone: "success", meta: "队列 128 · p95 42ms" },
    { label: "待处理工单", value: K.openTickets, tone: "warning", meta: "2 高优先级", onClick: () => go("support") },
    { label: "高风险告警", value: K.alerts, tone: "danger", meta: "1 服务降级", onClick: () => go("infra") }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(DPanel, { title: "月经常性收入 · 近 12 个月", actions: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--gd-gold)" } }, "$", (totalMrr / 1e3).toFixed(1), "k"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", marginLeft: 8 } }, "不含 10 年固定期")) }, /* @__PURE__ */ React.createElement(Bars, { series: D.revenueSeries }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 18, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--gd-line)" } }, D.termMix.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.term, style: { display: "flex", flexDirection: "column", gap: 4, flex: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-2)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: p.color, flex: "none" } }), p.term), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 14, color: "var(--text-1)" } }, p.count.toLocaleString()), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, p.mrr ? "$" + (p.mrr / 1e3).toFixed(1) + "k MRR" : "固定期收入"))))), /* @__PURE__ */ React.createElement(DPanel, { flush: true, title: "近期交易", actions: /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => go("revenue") }, "全部 →") }, /* @__PURE__ */ React.createElement("table", { style: { width: "100%", borderCollapse: "collapse", fontSize: 12.5 } }, /* @__PURE__ */ React.createElement("tbody", null, D.transactions.slice(0, 5).map((t, i) => /* @__PURE__ */ React.createElement("tr", { key: t.id, style: { borderBottom: i < 4 ? "1px solid var(--gd-line)" : "none" } }, /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, t.id), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 8px", color: "var(--text-1)" } }, t.customer), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 8px" } }, t.type === "refund" ? /* @__PURE__ */ React.createElement(DBadge, { tone: "neutral", mono: false }, "退款") : t.status === "failed" ? /* @__PURE__ */ React.createElement(DBadge, { tone: "danger", mono: false }, "失败") : /* @__PURE__ */ React.createElement(DBadge, { tone: "success" }, "成功")), /* @__PURE__ */ React.createElement("td", { style: { padding: "9px 16px", textAlign: "right" } }, /* @__PURE__ */ React.createElement(DMoney, { amount: t.amount, size: 12, tone: t.type === "refund" ? "danger" : "gold", sign: t.type === "refund" })))))))), /* @__PURE__ */ React.createElement(DPanel, { flush: true, title: "需要关注", actions: /* @__PURE__ */ React.createElement(DBadge, { tone: "danger" }, 2 + 2 + 2, " 项") }, /* @__PURE__ */ React.createElement("div", { style: { padding: "2px 16px 4px" } }, /* @__PURE__ */ React.createElement(AttnRow, { icon: "Activity", tone: "warning", text: "Webhooks 服务降级", meta: "Afternic 回调延迟 340ms · INC-241", cta: "查看", onGo: () => go("infra") }), /* @__PURE__ */ React.createElement(AttnRow, { icon: "CreditCard", tone: "danger", text: "2 笔扣款失败", meta: "Sana Qureshi · Halcyon Group · past_due", cta: "处理", onGo: () => go("revenue") }), /* @__PURE__ */ React.createElement(AttnRow, { icon: "LifeBuoy", tone: "warning", text: "2 个高优先级工单", meta: "设备门禁 · 批量改价未生效", cta: "收件箱", onGo: () => go("support") }), /* @__PURE__ */ React.createElement(AttnRow, { icon: "Cpu", tone: "warning", text: "1 台设备激活滞留", meta: "Sana Qureshi · D-9111 · 排空 2 天", cta: "舰队", onGo: () => go("fleet") }), /* @__PURE__ */ React.createElement(AttnRow, { icon: "Users", tone: "neutral", text: "92 笔首次购买仍在退款期内", meta: "14 天全额退款窗口 · 续费不重置", cta: "客户", onGo: () => go("customers") })))), /* @__PURE__ */ React.createElement(DPanel, { title: "设备舰队健康", actions: /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => go("fleet") }, "舰队详情 →") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 0 } }, fleetStates.map(([k, label, n, tone], i) => /* @__PURE__ */ React.createElement("div", { key: k, style: { flex: 1, display: "flex", flexDirection: "column", gap: 6, padding: "4px 16px", borderRight: i < fleetStates.length - 1 ? "1px solid var(--gd-line)" : "none" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "var(--text-2)" } }, /* @__PURE__ */ React.createElement(DDot, { kind: k === "active" ? "active" : k === "standby" ? "standby" : tone === "warning" ? "warning" : "neutral" }), label), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 20, color: tone === "gold" ? "var(--gd-gold)" : tone === "warning" ? "var(--gd-warning)" : "var(--text-1)" } }, n.toLocaleString())))))));
}
window.GDAdminDashboard = AdminDashboard;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/AdminDashboard.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/AdminShell.jsx
try { (() => {
const { StatusBar: AStatusBar, IconButton: AIconButton, Badge: ABadge2 } = window.GoodDealerDesignSystem_b5b0b6;
const ADot = ({ tone, hollow, size = 7 }) => /* @__PURE__ */ React.createElement("span", { style: { width: size, height: size, borderRadius: "50%", flex: "none", display: "inline-block", background: hollow ? "transparent" : `var(--gd-${tone})`, border: hollow ? `1.5px solid var(--gd-${tone})` : "none" } });
const ANAV = [
  { sec: "运营", items: [
    { k: "dashboard", label: "概览", icon: "LayoutDashboard" },
    { k: "customers", label: "客户", icon: "Users" },
    { k: "licenses", label: "许可与订阅", icon: "KeyRound" },
    { k: "revenue", label: "计费与营收", icon: "DollarSign" }
  ] },
  { sec: "系统", items: [
    { k: "fleet", label: "设备舰队", icon: "Cpu" },
    { k: "infra", label: "同步与基础设施", icon: "Activity" },
    { k: "audit", label: "审计日志", icon: "ScrollText" }
  ] },
  { sec: "支持", items: [
    { k: "support", label: "支持工单", icon: "LifeBuoy", count: 23, tone: "warning" },
    { k: "announcements", label: "公告", icon: "Megaphone" }
  ] }
];
const AFOOT = [{ k: "config", label: "系统配置", icon: "SlidersHorizontal" }];
const asx = {
  side: { width: 224, flex: "none", background: "var(--gd-panel)", borderRight: "1px solid var(--gd-line)", display: "flex", flexDirection: "column", minHeight: 0 },
  brand: { display: "flex", alignItems: "center", gap: 10, padding: "15px 16px 14px", borderBottom: "1px solid var(--gd-line)" },
  navSec: { padding: "14px 16px 5px", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 500 },
  item: (on) => ({ display: "flex", alignItems: "center", gap: 10, margin: "1px 8px", padding: "0 9px", height: 30, borderRadius: 5, cursor: "pointer", fontSize: 13, color: on ? "var(--text-1)" : "var(--text-2)", background: on ? "var(--gd-panel-raised)" : "transparent", border: "none", width: "calc(100% - 16px)", fontFamily: "var(--font-sans)", textAlign: "left", transition: "background 120ms,color 120ms", fontWeight: on ? 500 : 400, position: "relative" }),
  bar: { position: "absolute", left: 0, top: 6, bottom: 6, width: 2, borderRadius: 1, background: "var(--gd-gold)" },
  count: (tone) => ({ marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: tone ? `var(--gd-${tone})` : "var(--text-3)", lineHeight: "15px" }),
  topbar: { height: 52, flex: "none", display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: "1px solid var(--gd-line)", background: "var(--gd-chrome)" },
  cmd: { display: "flex", alignItems: "center", gap: 8, height: 30, padding: "0 8px 0 11px", width: 300, background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, color: "var(--text-3)", fontSize: 12, cursor: "text" },
  kbd: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 4px", lineHeight: "15px" },
  env: { display: "flex", alignItems: "center", gap: 6, height: 24, padding: "0 9px", borderRadius: 999, border: "1px solid rgba(92,174,125,0.35)", background: "var(--gd-success-tint)", color: "var(--gd-success)", fontSize: 11, fontFamily: "var(--font-mono)", whiteSpace: "nowrap" }
};
function ANavItem({ item, active, onGo }) {
  const on = active === item.k;
  const Ic = window.GDI[item.icon];
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      style: asx.item(on),
      onClick: () => onGo(item.k),
      onMouseEnter: (e) => {
        if (!on) e.currentTarget.style.background = "var(--gd-panel-raised)";
      },
      onMouseLeave: (e) => {
        if (!on) e.currentTarget.style.background = "transparent";
      }
    },
    on && /* @__PURE__ */ React.createElement("span", { style: asx.bar }),
    /* @__PURE__ */ React.createElement(Ic, { size: 16, style: { flex: "none", opacity: on ? 1 : 0.72, color: on ? "var(--text-1)" : void 0 } }),
    item.label,
    item.count != null && /* @__PURE__ */ React.createElement("span", { style: asx.count(item.tone) }, item.count)
  );
}
function AdminShell({ active, onGo, title, crumb, children, syncing, onSync }) {
  const I = window.GDI;
  const footer = /* @__PURE__ */ React.createElement(
    AStatusBar,
    {
      left: [
        /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(ADot, { tone: "success" }), "系统正常"),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "同步队列 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text)" } }, "128")),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "API p95 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text)" } }, "42ms")),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "12 region")
      ],
      right: [
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "在线设备 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text)" } }, "1,842"), " / 4,106"),
        /* @__PURE__ */ React.createElement(React.Fragment, null, "MRR ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-gold)" } }, "$48.2k"), " ", /* @__PURE__ */ React.createElement(ADot, { tone: "gold" })),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "ops@gooddealer.com"),
        /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "admin v0.9.0")
      ]
    }
  );
  return /* @__PURE__ */ React.createElement("div", { style: { height: "100%", width: "100%", display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", minHeight: 0 } }, /* @__PURE__ */ React.createElement("aside", { style: asx.side }, /* @__PURE__ */ React.createElement("div", { style: asx.brand }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark-flat.svg", width: "22", height: "22", alt: "" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.01em" } }, "GoodDealer"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em" } }, "运营控制台 · Admin"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, overflow: "auto", minHeight: 0 } }, ANAV.map((g) => /* @__PURE__ */ React.createElement("div", { key: g.sec }, /* @__PURE__ */ React.createElement("div", { style: asx.navSec }, g.sec), g.items.map((it) => /* @__PURE__ */ React.createElement(ANavItem, { key: it.k, item: it, active, onGo }))))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--gd-line)", paddingTop: 6 } }, AFOOT.map((it) => /* @__PURE__ */ React.createElement(ANavItem, { key: it.k, item: it, active, onGo })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, padding: "11px 14px 12px", margin: "6px 0 0", borderTop: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 28, height: 28, flex: "none", borderRadius: "50%", background: "linear-gradient(135deg,var(--gd-panel-raised),var(--gd-line))", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "王"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2, minWidth: 0, flex: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", display: "flex", alignItems: "center", gap: 6 } }, "王运维 ", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 9, color: "var(--gd-gold)", border: "1px solid rgba(212,164,55,0.4)", borderRadius: 3, padding: "0 4px", lineHeight: "13px", fontFamily: "var(--font-mono)" } }, "ADMIN")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, "运营管理员")), /* @__PURE__ */ React.createElement(AIconButton, { size: "sm", label: "退出登录" }, /* @__PURE__ */ React.createElement(I.LogOut, { size: 14 }))))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: asx.topbar }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 600, color: "var(--text-1)" } }, title), crumb && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-3)" } }, crumb), /* @__PURE__ */ React.createElement("div", { style: { marginLeft: "auto", display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: asx.env }, /* @__PURE__ */ React.createElement(ADot, { tone: "success", size: 6 }), "Production"), /* @__PURE__ */ React.createElement("div", { style: asx.cmd }, /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), /* @__PURE__ */ React.createElement("span", null, "搜索客户、设备、发票…"), /* @__PURE__ */ React.createElement("span", { style: asx.kbd }, "⌘K")), /* @__PURE__ */ React.createElement(AIconButton, { size: "sm", label: "告警" }, /* @__PURE__ */ React.createElement("span", { style: { position: "relative", display: "inline-flex" } }, /* @__PURE__ */ React.createElement(I.Bell, { size: 15 }), /* @__PURE__ */ React.createElement("span", { style: { position: "absolute", top: -1, right: -1, width: 5, height: 5, borderRadius: "50%", background: "var(--gd-danger)" } }))), /* @__PURE__ */ React.createElement(AIconButton, { size: "sm", label: "刷新", onClick: onSync }, /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 14, style: syncing ? { animation: "gd-spinner 1s linear infinite" } : void 0 })))), /* @__PURE__ */ React.createElement("main", { style: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" } }, children))), footer);
}
window.GDAdminShell = AdminShell;
window.GDADot = ADot;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/AdminShell.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Announcements.jsx
try { (() => {
const { Panel: AnPanel, Badge: AnBadge, Button: AnBtn, Select: AnSel, Input: AnInput, Dialog: AnDlg, Toolbar: AnToolbar } = window.GoodDealerDesignSystem_b5b0b6;
const AN_STAT = { published: /* @__PURE__ */ React.createElement(AnBadge, { tone: "success" }, "已发布"), scheduled: /* @__PURE__ */ React.createElement(AnBadge, { tone: "sync", mono: false }, "已排期"), draft: /* @__PURE__ */ React.createElement(AnBadge, { tone: "neutral", mono: false }, "草稿") };
function Announcements() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [items, setItems] = React.useState(() => D.announcements.map((a) => ({ ...a })));
  const [compose, setCompose] = React.useState(false);
  const counts = { published: items.filter((a) => a.status === "published").length, scheduled: items.filter((a) => a.status === "scheduled").length, draft: items.filter((a) => a.status === "draft").length };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "公告", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "已发布", value: counts.published, tone: "success", meta: "当前生效" },
    { label: "已排期", value: counts.scheduled, tone: "body", meta: "待自动发布" },
    { label: "草稿", value: counts.draft, meta: "未发布" },
    { label: "本月触达", value: "2,847", meta: "全部客户" },
    { label: "平均阅读率", value: "68%", tone: "gold", meta: "应用内公告" }
  ] }), /* @__PURE__ */ React.createElement(
    AnToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--text-1)" } }, "全部公告"),
      right: /* @__PURE__ */ React.createElement(AnBtn, { size: "sm", variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Plus, { size: 14 }), onClick: () => setCompose(true) }, "撰写公告")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "flex", flexDirection: "column", gap: 10, maxWidth: 960 } }, items.map((a) => /* @__PURE__ */ React.createElement("div", { key: a.id, style: { display: "flex", alignItems: "center", gap: 14, padding: "14px 16px", border: "1px solid var(--gd-line)", borderRadius: 8, background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 34, height: 34, flex: "none", borderRadius: 7, background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line)", display: "flex", alignItems: "center", justifyContent: "center", color: a.status === "published" ? "var(--gd-gold)" : "var(--text-3)" } }, /* @__PURE__ */ React.createElement(I.Megaphone, { size: 16 })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 9 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13.5, color: "var(--text-1)", fontWeight: 500 } }, a.title), AN_STAT[a.status]), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 3, fontFamily: "var(--font-mono)" } }, a.id, " · 受众 ", a.audience, " · ", a.author)), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: a.status === "scheduled" ? "var(--gd-blue)" : "var(--text-3)", flex: "none" } }, a.date), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 6, flex: "none" } }, a.status === "draft" && /* @__PURE__ */ React.createElement(AnBtn, { size: "sm", variant: "primary" }, "发布"), a.status === "scheduled" && /* @__PURE__ */ React.createElement(AnBtn, { size: "sm", variant: "ghost" }, "改期"), /* @__PURE__ */ React.createElement(AnBtn, { size: "sm", variant: "ghost" }, a.status === "published" ? "查看" : "编辑"))))), /* @__PURE__ */ React.createElement(
    AnDlg,
    {
      open: compose,
      onClose: () => setCompose(false),
      title: "撰写公告",
      width: 560,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(AnBtn, { onClick: () => setCompose(false) }, "存草稿"), /* @__PURE__ */ React.createElement(AnBtn, { variant: "primary", onClick: () => setCompose(false) }, "发布 · 全部客户"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement(AnInput, { label: "标题", placeholder: "如：0.9.1 发布说明" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement(AnSel, { label: "受众", size: "md", options: ["全部客户", "全部有效许可", "月付客户", "年付客户", "10 年固定期客户", "按区域"], value: "全部客户", onChange: () => {
    } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement(AnSel, { label: "发布", size: "md", options: ["立即发布", "定时发布"], value: "立即发布", onChange: () => {
    } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "正文"), /* @__PURE__ */ React.createElement("textarea", { placeholder: "支持 Markdown。语气克制、陈述事实——与产品文案一致。", style: { width: "100%", minHeight: 120, resize: "vertical", background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, color: "var(--gd-text)", fontFamily: "var(--font-sans)", fontSize: 13, lineHeight: 1.6, padding: "10px 12px", outline: "none", boxSizing: "border-box" } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 11, color: "var(--text-3)" } }, /* @__PURE__ */ React.createElement(I.Users, { size: 13 }), "预计触达 2,847 位客户 · 同时显示于应用内与邮件"))
  ));
}
window.GDAnnouncements = Announcements;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Announcements.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Audit.jsx
try { (() => {
const { Table: AuTable, Badge: AuBadge, Button: AuBtn, Select: AuSel, Input: AuInput, Toolbar: AuToolbar } = window.GoodDealerDesignSystem_b5b0b6;
const SENSITIVE = ["强制解绑设备", "手动退款", "重置客户 2FA", "切换功能开关"];
function Audit() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [actor, setActor] = React.useState("全部操作者");
  const [q, setQ] = React.useState("");
  const actors = ["全部操作者", ...Array.from(new Set(D.audit.map((a) => a.actor)))];
  let rows = D.audit.filter((a) => (actor === "全部操作者" || a.actor === actor) && (q === "" || a.action.includes(q) || a.target.includes(q)));
  const isSensitive = (a) => SENSITIVE.some((s) => a.action.startsWith(s));
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "审计日志", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "今日操作", value: "342", meta: "运营 + 系统" },
    { label: "运营者操作", value: "38", meta: "人工" },
    { label: "系统操作", value: "304", meta: "自动" },
    { label: "高敏感操作", value: "6", tone: "warning", meta: "解绑 · 退款 · 2FA · 开关" },
    { label: "操作者", value: "5", meta: "运营团队" },
    { label: "保留期", value: "365 天", mono: true, meta: "追加不可篡改" }
  ] }), /* @__PURE__ */ React.createElement(
    AuToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(AuInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索操作、对象…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 240 } }), /* @__PURE__ */ React.createElement(AuSel, { size: "sm", options: actors, value: actor, onChange: (e) => setActor(e.target.value) }), /* @__PURE__ */ React.createElement(AuSel, { size: "sm", options: ["全部类型", "客户", "计费", "设备", "配置", "公告"], value: "全部类型", onChange: () => {
      } })),
      right: /* @__PURE__ */ React.createElement(AuBtn, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 14 }) }, "导出日志")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    AuTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "time", label: "时间", render: (a) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-2)" } }, a.time) },
        { key: "actor", label: "操作者", render: (a) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 20, height: 20, flex: "none", borderRadius: "50%", background: a.actor === "系统" ? "var(--gd-panel-raised)" : "var(--gd-blue-tint)", border: "1px solid var(--gd-line-strong)", fontSize: 9, display: "flex", alignItems: "center", justifyContent: "center", color: a.actor === "系统" ? "var(--text-3)" : "var(--gd-blue)", fontFamily: "var(--font-mono)" } }, a.actor === "系统" ? "S" : a.actor[0]), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: a.actor === "系统" ? "var(--text-3)" : "var(--text-1)" } }, a.actor)) },
        { key: "action", label: "操作", render: (a) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: "var(--text-1)" } }, isSensitive(a) && /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: "var(--gd-warning)", flex: "none" } }), a.action, isSensitive(a) && /* @__PURE__ */ React.createElement(AuBadge, { tone: "warning", mono: false }, "敏感")) },
        { key: "target", label: "对象", render: (a) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-2)" } }, a.target) },
        { key: "ip", label: "来源 IP", numeric: true, render: (a) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, a.ip) }
      ],
      rows,
      footer: /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", width: "100%", fontSize: 11, color: "var(--text-3)" } }, /* @__PURE__ */ React.createElement("span", null, rows.length, " 条 · 追加不可篡改 · 与 SIEM 实时投递"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)" } }, "保留 365 天"))
    }
  )));
}
window.GDAudit = Audit;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Audit.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Config.jsx
try { (() => {
const { Panel: CoPanel, Badge: CoBadge, Button: CoBtn, Switch: CoSwitch } = window.GoodDealerDesignSystem_b5b0b6;
function FlagRow({ f, onToggle }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)", whiteSpace: "nowrap" } }, f.name), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 5px", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 } }, f.key)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 3, lineHeight: 1.5 } }, f.desc)), /* @__PURE__ */ React.createElement("div", { style: { width: 96, flex: "none", display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", fontSize: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "灰度"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: f.rollout === 100 ? "var(--gd-success)" : f.enabled ? "var(--gd-gold)" : "var(--text-3)" } }, f.rollout, "%")), /* @__PURE__ */ React.createElement("div", { style: { height: 4, borderRadius: 2, background: "var(--gd-line)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { width: f.rollout + "%", height: "100%", background: f.enabled ? f.rollout === 100 ? "var(--gd-success)" : "var(--gd-gold)" : "var(--gd-line-strong)" } }))), /* @__PURE__ */ React.createElement(CoSwitch, { checked: f.enabled, onChange: () => onToggle(f.key) }));
}
function Config() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const [flags, setFlags] = React.useState(() => D.flags.map((f) => ({ ...f })));
  const [maint, setMaint] = React.useState(false);
  const [dlg, setDlg] = React.useState(false);
  const toggle = (key) => setFlags((fs) => fs.map((f) => f.key === key ? { ...f, enabled: !f.enabled, rollout: !f.enabled && f.rollout === 0 ? 100 : f.enabled ? f.rollout : f.rollout } : f));
  const sections = Array.from(new Set(flags.map((f) => f.section)));
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "系统配置", style: { padding: 18, display: "grid", gridTemplateColumns: "1fr 340px", gap: 14, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, sections.map((sec) => /* @__PURE__ */ React.createElement(CoPanel, { key: sec, flush: true, title: "功能开关 · " + sec, actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, flags.filter((f) => f.section === sec && f.enabled).length, "/", flags.filter((f) => f.section === sec).length, " 启用") }, flags.filter((f) => f.section === sec).map((f) => /* @__PURE__ */ React.createElement(FlagRow, { key: f.key, f, onToggle: toggle }))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(CoPanel, { title: "商业政策", actions: /* @__PURE__ */ React.createElement(CoBadge, { tone: "neutral", mono: false }, "固定") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, [["功能档位", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-1)" } }, "单一档位")], ["可售期限", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)", textAlign: "right" } }, "月付 $9.80 · 年付 $98", /* @__PURE__ */ React.createElement("br", null), "10 年固定期 $498")], ["首次购买退款窗口", /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-1)" } }, "14 天全额退款 · 续费不重置")], ["设备额度上限", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, "2")]].map(([k, ctrl], i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontSize: 12.5, color: "var(--text-2)" } }, k), ctrl))), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", lineHeight: 1.6, marginTop: 10 } }, "不提供免费试用；10 年固定期不会自动续费，也不代表永久许可。价格与退款政策只能通过已接受的商业决策变更。")), /* @__PURE__ */ React.createElement(CoPanel, { title: "维护模式" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 12 } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 18, style: { color: maint ? "var(--gd-danger)" : "var(--text-3)", flex: "none", marginTop: 1 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, "Cloud 维护模式"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", marginTop: 3, lineHeight: 1.5 } }, "暂停 Cloud 控制面写入与同步接收；已授权客户端继续提交本地业务并排队等待恢复。用于计划维护窗口。")), /* @__PURE__ */ React.createElement(CoSwitch, { checked: maint, onChange: () => setMaint((v) => !v) })), maint && /* @__PURE__ */ React.createElement("div", { style: { marginTop: 12, padding: "9px 12px", background: "var(--gd-danger-tint)", border: "1px solid rgba(229,115,95,0.35)", borderRadius: 6, fontSize: 11.5, color: "var(--gd-danger)" } }, "维护模式已启用 · 同步暂缓，本地提交不受 Cloud 传输阻塞")), /* @__PURE__ */ React.createElement(CoPanel, { title: "环境" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, [["环境", "Production"], ["区域", "12 · 全球"], ["构建", "admin 0.9.0 · 2026-08-12"], ["Sync API", "v3.2.1"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 70, flex: "none", color: "var(--text-3)" } }, k), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-1)", fontFamily: "var(--font-mono)", fontSize: 11.5 } }, v)))))));
}
window.GDConfig = Config;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Config.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Customers.jsx
try { (() => {
const { Panel: CPanel, Table: CTable, Badge: CBadge, Button: CBtn, Money: CMoney, Input: CInput, Select: CSel, Toolbar: CToolbar, Dialog: CDlg, StatusDot: CDot, IconButton: CIcon } = window.GoodDealerDesignSystem_b5b0b6;
const CSTAT = { active: { b: /* @__PURE__ */ React.createElement(CBadge, { tone: "success" }, "活跃") }, past_due: { b: /* @__PURE__ */ React.createElement(CBadge, { tone: "warning", mono: false }, "逾期") }, churned: { b: /* @__PURE__ */ React.createElement(CBadge, { tone: "neutral", mono: false }, "已流失") } };
const TERM_COL = { "月付": "var(--gd-gold)", "年付": "var(--gd-blue)", "10 年固定期": "var(--gd-text-muted)" };
function Customers() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const Pagination = window.GDPagination;
  const [q, setQ] = React.useState("");
  const [term, setTerm] = React.useState("全部期限");
  const [status, setStatus] = React.useState("全部状态");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [sel, setSel] = React.useState(null);
  React.useEffect(() => {
    setPage(1);
  }, [q, term, status, pageSize]);
  const SMAP = { "全部状态": null, "活跃": "active", "逾期": "past_due", "已流失": "churned" };
  let rows = D.customers.filter((c) => (term === "全部期限" || c.term === term) && (status === "退款期内" ? !!c.refundUntil : SMAP[status] == null || c.status === SMAP[status]) && (q === "" || c.name.toLowerCase().includes(q.toLowerCase()) || c.email.includes(q.toLowerCase()) || c.id.toLowerCase().includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "客户管理", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "总客户", value: "2,847", meta: "含活跃与已流失" },
    { label: "活跃许可", value: "2,413", tone: "success", meta: "同一功能档位" },
    { label: "首次购买退款期内", value: "92", tone: "body", meta: "14 天全额退款" },
    { label: "逾期 past_due", value: "48", tone: "warning", meta: "扣款失败重试中" },
    { label: "本月新增", value: "+124", tone: "success", meta: "净增 +71" },
    { label: "本月流失", value: "53", tone: "danger", meta: "流失率 1.8%" }
  ] }), /* @__PURE__ */ React.createElement(
    CToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(CInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索姓名、邮箱、客户 ID…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 240 } }), /* @__PURE__ */ React.createElement(CSel, { size: "sm", options: ["全部期限", "月付", "年付", "10 年固定期"], value: term, onChange: (e) => setTerm(e.target.value) }), /* @__PURE__ */ React.createElement(CSel, { size: "sm", options: ["全部状态", "活跃", "退款期内", "逾期", "已流失"], value: status, onChange: (e) => setStatus(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(CBtn, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 14 }) }, "导出 CSV"), /* @__PURE__ */ React.createElement(CBtn, { size: "sm", variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Plus, { size: 14 }) }, "新建客户"))
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    CTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      onRowClick: setSel,
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "name", label: "客户", render: (c) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 26, height: 26, flex: "none", borderRadius: "50%", background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-2)" } }, c.country), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, c.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, c.email))) },
        { key: "id", label: "ID", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, c.id) },
        { key: "term", label: "付费期限", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-1)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: 2, background: TERM_COL[c.term], flex: "none" } }), c.term) },
        { key: "status", label: "状态", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, CSTAT[c.status].b, c.refundUntil && /* @__PURE__ */ React.createElement(CBadge, { tone: "sync", mono: false }, "退款期内")) },
        { key: "devices", label: "设备", numeric: true, render: (c) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: c.devices ? "var(--text-1)" : "var(--text-3)" } }, c.devices) },
        { key: "domains", label: "域名", numeric: true, render: (c) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-2)" } }, c.domains.toLocaleString()) },
        { key: "mrr", label: "MRR", numeric: true, render: (c) => c.mrr ? /* @__PURE__ */ React.createElement(CMoney, { amount: c.mrr, size: 12 }) : /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--text-3)" } }, "—") },
        { key: "lastSeen", label: "最后活跃", numeric: true, render: (c) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, c.lastSeen) }
      ],
      rows: pageRows,
      footer: /* @__PURE__ */ React.createElement(Pagination, { page: cur, pageSize, total: rows.length, onPage: setPage, onPageSize: setPageSize, note: /* @__PURE__ */ React.createElement(React.Fragment, null, D.customers.length, " 位客户 · MRR ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "$19.9k"), " · 固定期收入另计") })
    }
  )), /* @__PURE__ */ React.createElement(
    CDlg,
    {
      open: !!sel,
      onClose: () => setSel(null),
      title: sel ? sel.name : "",
      width: 520,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(CBtn, { onClick: () => setSel(null) }, "关闭"), /* @__PURE__ */ React.createElement(CBtn, { icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "以客户身份查看"), /* @__PURE__ */ React.createElement(CBtn, { variant: "primary" }, "查看 Provider 记录"))
    },
    sel && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, paddingBottom: 12, borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 40, height: 40, flex: "none", borderRadius: "50%", background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line-strong)", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-gold)" } }, sel.country), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, fontWeight: 600, color: "var(--text-1)" } }, sel.name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, sel.email, " · ", sel.id)), CSTAT[sel.status].b), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 } }, [["付费期限", sel.term], ["MRR", sel.mrr ? "$" + sel.mrr : "—"], ["设备", sel.devices + " / 2"], ["域名", sel.domains.toLocaleString()]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { padding: "9px 11px", background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line)", borderRadius: 6 } }, /* @__PURE__ */ React.createElement("div", { className: "gd-t-label" }, k), /* @__PURE__ */ React.createElement("div", { style: { fontFamily: "var(--font-mono)", fontSize: 14, color: k === "MRR" ? "var(--gd-gold)" : "var(--text-1)", marginTop: 3 } }, v)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, [["注册日期", sel.since], ["最后活跃", sel.lastSeen], ["支付渠道", sel.provider + " 托管"], ["首次购买退款", sel.refundUntil ? "可全额退款至 " + sel.refundUntil : "窗口已结束；续费不重置"], ["支付状态", sel.status === "past_due" ? "Provider 扣款失败 · 重试中" : "正常"]].map(([k, v]) => /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", padding: "8px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 12.5 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 100, flex: "none", color: "var(--text-3)" } }, k), /* @__PURE__ */ React.createElement("span", { style: { color: v.includes("失败") ? "var(--gd-warning)" : "var(--text-1)", fontFamily: k === "注册日期" ? "var(--font-mono)" : void 0 } }, v)))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(CBtn, { size: "sm", variant: "ghost" }, "重置 2FA"), /* @__PURE__ */ React.createElement(CBtn, { size: "sm", variant: "ghost" }, "发送重置邮件"), sel.status === "churned" ? /* @__PURE__ */ React.createElement(CBtn, { size: "sm", variant: "ghost" }, "恢复账户") : /* @__PURE__ */ React.createElement(CBtn, { size: "sm", variant: "ghost" }, "暂停账户")))
  ));
}
window.GDCustomers = Customers;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Customers.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Fleet.jsx
try { (() => {
const { Panel: FPanel, Table: FTable, Badge: FBadge, Button: FBtn, Select: FSel, Input: FInput, Toolbar: FToolbar, Dialog: FDlg, Checkbox: FCheck, StatusDot: FDot } = window.GoodDealerDesignSystem_b5b0b6;
const FSTATE = {
  active: { dot: "active", badge: /* @__PURE__ */ React.createElement(FBadge, { tone: "gold" }, "ACTIVE") },
  standby: { dot: "standby", badge: /* @__PURE__ */ React.createElement(FBadge, { mono: false }, "Standby") },
  activating: { dot: "sync", badge: /* @__PURE__ */ React.createElement(FBadge, { tone: "sync", mono: false }, "激活中"), pulse: true },
  draining: { dot: "warning", badge: /* @__PURE__ */ React.createElement(FBadge, { tone: "warning", mono: false }, "排空中"), pulse: true },
  sunset: { dot: "neutral", badge: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "1px 6px" } }, "RETAINED") }
};
const FHEALTH = { ok: /* @__PURE__ */ React.createElement(FBadge, { tone: "success" }, "正常"), warn: /* @__PURE__ */ React.createElement(FBadge, { tone: "warning", mono: false }, "告警"), stale: /* @__PURE__ */ React.createElement(FBadge, { tone: "danger", mono: false }, "失联") };
function Fleet() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const Pagination = window.GDPagination;
  const [devices, setDevices] = React.useState(() => D.fleet.map((d) => ({ ...d })));
  const [state, setState] = React.useState("全部状态");
  const [region, setRegion] = React.useState("全部区域");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [deauth, setDeauth] = React.useState(null);
  const [ack, setAck] = React.useState(false);
  React.useEffect(() => {
    setPage(1);
  }, [state, region, q, pageSize]);
  const SMAP = { "全部状态": null, "Active": "active", "Standby": "standby", "激活中": "activating", "排空中": "draining", "Sunset": "sunset" };
  const regions = ["全部区域", ...Array.from(new Set(D.fleet.map((d) => d.region)))];
  let rows = devices.filter((d) => (SMAP[state] == null || d.state === SMAP[state]) && (region === "全部区域" || d.region === region) && (q === "" || d.customer.toLowerCase().includes(q.toLowerCase()) || d.id.toLowerCase().includes(q.toLowerCase()) || d.name.toLowerCase().includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const runDeauth = () => {
    const t = deauth;
    setDeauth(null);
    setAck(false);
    setDevices((ds) => ds.map((d) => d.id === t.id ? { ...d, state: "sunset", health: "stale" } : d));
  };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "设备舰队", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "绑定设备", value: "4,106", meta: "跨 2,413 客户" },
    { label: "在线", value: "1,842", tone: "success", meta: "持权 Active 1,842" },
    { label: "待命 Standby", value: "1,903", meta: "蓝空心 · 无执行权" },
    { label: "激活 / 排空中", value: "59", tone: "body", meta: "迁移执行权中" },
    { label: "失联 / 告警", value: "37", tone: "danger", meta: "Lease 心跳超时" },
    { label: "区域", value: "12", meta: "就近同步" }
  ] }), /* @__PURE__ */ React.createElement(
    FToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(FInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索客户、设备 ID…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 220 } }), /* @__PURE__ */ React.createElement(FSel, { size: "sm", options: ["全部状态", "Active", "Standby", "激活中", "排空中", "Sunset"], value: state, onChange: (e) => setState(e.target.value) }), /* @__PURE__ */ React.createElement(FSel, { size: "sm", options: regions, value: region, onChange: (e) => setRegion(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(FBtn, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 14 }) }, "导出")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    FTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "id", label: "设备 ID", render: (d) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, d.id) },
        { key: "customer", label: "客户", render: (d) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, d.customer) },
        { key: "name", label: "设备", render: (d) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, d.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, d.os)) },
        { key: "state", label: "执行权状态", render: (d) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement(FDot, { kind: FSTATE[d.state].dot, pulse: FSTATE[d.state].pulse }), FSTATE[d.state].badge) },
        { key: "epoch", label: "Epoch", numeric: true, render: (d) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: d.state === "active" ? "var(--gd-gold)" : "var(--text-3)" } }, d.epoch) },
        { key: "region", label: "区域", render: (d) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-2)" } }, d.region) },
        { key: "health", label: "Lease 健康", render: (d) => FHEALTH[d.health] },
        { key: "lastSeen", label: "心跳", numeric: true, render: (d) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: d.health === "stale" ? "var(--gd-danger)" : "var(--text-3)" } }, d.lastSeen) },
        { key: "act", label: "", align: "right", render: (d) => d.state !== "sunset" ? /* @__PURE__ */ React.createElement(FBtn, { size: "sm", variant: "ghost", onClick: () => setDeauth(d) }, "强制解绑") : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "已退役") }
      ],
      rows: pageRows,
      footer: /* @__PURE__ */ React.createElement(Pagination, { page: cur, pageSize, total: rows.length, onPage: setPage, onPageSize: setPageSize, note: /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, "单活动执行权 · Epoch 单调递增") })
    }
  )), /* @__PURE__ */ React.createElement(
    FDlg,
    {
      open: !!deauth,
      onClose: () => {
        setDeauth(null);
        setAck(false);
      },
      title: "强制解绑设备（运营操作）",
      width: 500,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(FBtn, { onClick: () => {
        setDeauth(null);
        setAck(false);
      } }, "取消"), /* @__PURE__ */ React.createElement(FBtn, { variant: "danger", disabled: !ack, onClick: runDeauth }, "强制解绑 ", deauth && deauth.id))
    },
    deauth && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "对 ", /* @__PURE__ */ React.createElement("b", null, deauth.customer), " 的设备 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, deauth.id, " · ", deauth.name), " 执行强制解绑。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--text-2)", lineHeight: 1.55 } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "后果"), "：该设备的 ActiveDeviceLease 立即吊销，下次联网被强制登出并转入 Sunset 保留态（本地只读）。"), deauth.state === "active" && /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-danger)", fontWeight: 500 } }, "该设备当前持有执行权"), "：解绑后客户在另一台设备安全激活前将无法执行写操作。"), /* @__PURE__ */ React.createElement("span", null, "操作以运营身份记入", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)", fontWeight: 500 } }, "审计日志"), "，客户会收到安全通知。仅用于设备丢失或滥用。")), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--gd-line)", paddingTop: 10 } }, /* @__PURE__ */ React.createElement(FCheck, { checked: ack, onChange: () => setAck((a) => !a), label: "我确认此为不可逆的运营强制操作，且已核实必要性" })))
  ));
}
window.GDFleet = Fleet;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Fleet.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Licenses.jsx
try { (() => {
const { Panel: LPanel, Table: LTable, Badge: LBadge, Button: LBtn, Money: LMoney, Select: LSel, Input: LInput, Toolbar: LToolbar, Dialog: LDlg } = window.GoodDealerDesignSystem_b5b0b6;
const LTERM_COL = { "月付": "var(--gd-gold)", "年付": "var(--gd-blue)", "10 年固定期": "var(--gd-viz-drawdown)" };
function deadline(date) {
  const days = Math.round((new Date(date) - /* @__PURE__ */ new Date("2026-08-17")) / 864e5);
  return { date, days };
}
function Licenses() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const Pagination = window.GDPagination;
  const [term, setTerm] = React.useState("全部期限");
  const [q, setQ] = React.useState("");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [issue, setIssue] = React.useState(false);
  React.useEffect(() => {
    setPage(1);
  }, [term, q, pageSize]);
  const totalMrr = D.termMix.reduce((s, p) => s + p.mrr, 0);
  let rows = D.customers.filter((c) => c.status !== "churned" && (term === "全部期限" || c.term === term) && (q === "" || c.name.toLowerCase().includes(q.toLowerCase()) || c.id.toLowerCase().includes(q.toLowerCase())));
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "许可与订阅", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "活跃许可", value: "2,413", meta: "同一功能档位" },
    { label: "月经常性收入", value: "$19,927", tone: "gold", meta: "固定期收入另计" },
    { label: "首次购买退款期内", value: "92", tone: "body", meta: "14 天全额退款" },
    { label: "本月续费", value: "312", meta: "自动 297 · 手动 15" },
    { label: "逾期订阅", value: "48", tone: "warning", meta: "扣款失败" },
    { label: "固定期 90 天内到期", value: "7", tone: "warning", meta: "不会自动续费" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 18px 0" } }, /* @__PURE__ */ React.createElement(LPanel, { title: "付费期限分布", actions: /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--gd-gold)" } }, "$", (totalMrr / 1e3).toFixed(1), "k MRR") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: 10, borderRadius: 3, overflow: "hidden", marginBottom: 14 } }, D.termMix.filter((p) => p.mrr > 0).map((p) => /* @__PURE__ */ React.createElement("div", { key: p.term, title: p.term, style: { width: p.mrr / totalMrr * 100 + "%", background: p.color } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 0 } }, D.termMix.map((p, i) => /* @__PURE__ */ React.createElement("div", { key: p.term, style: { flex: 1, display: "flex", flexDirection: "column", gap: 4, padding: "0 16px", borderRight: i < 2 ? "1px solid var(--gd-line)" : "none" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--text-1)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: p.color, flex: "none" } }), p.term), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "baseline", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 18, color: "var(--text-1)" } }, p.count.toLocaleString()), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "许可")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, p.mrr ? "$" + (p.mrr / 1e3).toFixed(1) + "k MRR" : "$498 · 非经常性")))))), /* @__PURE__ */ React.createElement(
    LToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索客户、许可…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 220 } }), /* @__PURE__ */ React.createElement(LSel, { size: "sm", options: ["全部期限", "月付", "年付", "10 年固定期"], value: term, onChange: (e) => setTerm(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Plus, { size: 14 }), onClick: () => setIssue(true) }, "创建托管结账")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    LTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "name", label: "客户", render: (c) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, c.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, c.id)) },
        { key: "term", label: "付费期限", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--text-1)" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: 2, background: LTERM_COL[c.term], flex: "none" } }), c.term) },
        { key: "provider", label: "付款渠道", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-2)" } }, c.provider, " 托管") },
        { key: "seats", label: "设备额度", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, c.devices, " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "/ 2")) },
        { key: "mrr", label: "MRR", numeric: true, render: (c) => c.mrr ? /* @__PURE__ */ React.createElement(LMoney, { amount: c.mrr, size: 12 }) : /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--text-3)" } }, "—") },
        { key: "renew", label: "续费 / 到期", numeric: true, render: (c) => {
          const fixed = c.term === "10 年固定期";
          const r = deadline(fixed ? c.termEnds : c.nextBillingDate);
          const soon = r.days <= 30;
          return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", flexDirection: "column", alignItems: "flex-end", gap: 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: c.status === "past_due" ? "var(--gd-warning)" : "var(--text-2)" } }, r.date), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: soon ? "var(--gd-warning)" : "var(--text-3)" } }, fixed ? "固定期到期 · 不自动续费" : r.days + " 天后续费"));
        } },
        { key: "status", label: "状态", render: (c) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6 } }, c.status === "past_due" ? /* @__PURE__ */ React.createElement(LBadge, { tone: "warning", mono: false }, "逾期") : /* @__PURE__ */ React.createElement(LBadge, { tone: "success" }, "活跃"), c.refundUntil && /* @__PURE__ */ React.createElement(LBadge, { tone: "sync", mono: false }, "退款期内")) },
        { key: "act", label: "", align: "right", render: (c) => /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost" }, "管理") }
      ],
      rows: pageRows,
      footer: /* @__PURE__ */ React.createElement(Pagination, { page: cur, pageSize, total: rows.length, onPage: setPage, onPageSize: setPageSize, note: /* @__PURE__ */ React.createElement(React.Fragment, null, "活跃许可 · MRR ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "$", (totalMrr / 1e3).toFixed(1), "k"), " · 固定期收入另计") })
    }
  )), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: issue,
      onClose: () => setIssue(false),
      title: "创建 Provider 托管结账",
      width: 480,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { onClick: () => setIssue(false) }, "取消"), /* @__PURE__ */ React.createElement(LBtn, { variant: "primary", onClick: () => setIssue(false) }, "创建安全结账链接"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement(LInput, { label: "客户邮箱", mono: true, placeholder: "name@company.com" }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement(LSel, { label: "付费期限", size: "md", options: ["月付 · USD 9.80", "年付 · USD 98", "10 年固定期 · USD 498"], value: "年付 · USD 98", onChange: () => {
    } })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement(LSel, { label: "Provider", size: "md", options: ["Stripe"], value: "Stripe", onChange: () => {
    } }))), /* @__PURE__ */ React.createElement(LInput, { label: "优惠码（可选）", mono: true, placeholder: "PROMO2026" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", lineHeight: 1.6 } }, "三种期限共享同一功能档位与 2 台设备额度。无免费体验；10 年固定期不自动续费且并非永久许可。首发付款由 Stripe 托管，首次购买享 14 天全额退款，续费不会重置该窗口。"))
  ));
}
window.GDLicenses = Licenses;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Licenses.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Revenue.jsx
try { (() => {
const { Panel: RPanel, Table: RTable, Badge: RBadge, Button: RBtn, Money: RMoney, Select: RSel, Toolbar: RToolbar, Dialog: RDlg } = window.GoodDealerDesignSystem_b5b0b6;
function Revenue() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [type, setType] = React.useState("全部类型");
  const [status, setStatus] = React.useState("全部状态");
  const [refund, setRefund] = React.useState(null);
  const totalMrr = D.termMix.reduce((s, p) => s + p.mrr, 0);
  const TMAP = { "全部类型": null, "扣款": "charge", "退款": "refund" };
  const SMAP = { "全部状态": null, "成功": "succeeded", "失败": "failed" };
  let tx = D.transactions.filter((t) => (TMAP[type] == null || t.type === TMAP[type]) && (SMAP[status] == null || t.status === SMAP[status]));
  const pastDue = [{ customer: "Sana Qureshi", id: "C-11733", amount: 9.8, method: "Stripe 托管付款", tries: 2, next: "今日 20:00" }, { customer: "Halcyon Group", id: "C-11988", amount: 98, method: "Stripe 托管付款", tries: 1, next: "明日 09:00" }];
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "计费与营收", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "MRR", value: "$19,927", tone: "gold", meta: "仅月付与年付" },
    { label: "ARR", value: "$239,124", tone: "gold", meta: "经常性收入年化" },
    { label: "本月净新增", value: "+$1,840", tone: "success", meta: "扩张 -流失" },
    { label: "本月首次购买退款", value: "$9.80", tone: "danger", meta: "1 笔 · 14 天窗口" },
    { label: "逾期待收", value: "$4,120", tone: "warning", meta: "48 笔重试中" },
    { label: "扣款回收率", value: "92%", tone: "success", meta: "失败重试成功" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: "14px 18px 0", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 } }, /* @__PURE__ */ React.createElement(RPanel, { title: "MRR 构成", actions: /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 13, color: "var(--gd-gold)" } }, "$", (totalMrr / 1e3).toFixed(1), "k") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: 10, borderRadius: 3, overflow: "hidden", marginBottom: 12 } }, D.termMix.filter((p) => p.mrr > 0).map((p) => /* @__PURE__ */ React.createElement("div", { key: p.term, style: { width: p.mrr / totalMrr * 100 + "%", background: p.color } }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, D.termMix.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.term, style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 8, height: 8, borderRadius: 2, background: p.color, flex: "none" } }), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-1)", flex: 1, whiteSpace: "nowrap" } }, p.term), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)", fontFamily: "var(--font-mono)", fontSize: 11, whiteSpace: "nowrap" } }, p.count.toLocaleString(), " 许可"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: p.mrr ? "var(--gd-gold)" : "var(--text-3)", width: 86, textAlign: "right" } }, p.mrr ? "$" + (p.mrr / 1e3).toFixed(1) + "k" : "收入另计"))))), /* @__PURE__ */ React.createElement(RPanel, { flush: true, title: "逾期待收", actions: /* @__PURE__ */ React.createElement(RBadge, { tone: "warning" }, pastDue.length, " 需处理") }, pastDue.map((p) => /* @__PURE__ */ React.createElement("div", { key: p.id, style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement(I.CircleAlert, { size: 17, style: { color: "var(--gd-warning)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, p.customer), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, p.method, " · 重试 ", p.tries, " 次 · 下次 ", p.next)), /* @__PURE__ */ React.createElement(RMoney, { amount: p.amount, size: 13, tone: "gold" }), /* @__PURE__ */ React.createElement(RBtn, { size: "sm", variant: "ghost", onClick: () => setRefund(null) }, "重试扣款"))))), /* @__PURE__ */ React.createElement(
    RToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--text-1)" } }, "交易流水"), /* @__PURE__ */ React.createElement(RSel, { size: "sm", options: ["全部类型", "扣款", "退款"], value: type, onChange: (e) => setType(e.target.value) }), /* @__PURE__ */ React.createElement(RSel, { size: "sm", options: ["全部状态", "成功", "失败"], value: status, onChange: (e) => setStatus(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(RBtn, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Download, { size: 14 }) }, "导出对账单")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    RTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "id", label: "交易号", render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, t.id) },
        { key: "customer", label: "客户", render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, t.customer) },
        { key: "type", label: "类型", render: (t) => t.type === "refund" ? /* @__PURE__ */ React.createElement(RBadge, { tone: "neutral", mono: false }, "退款") : /* @__PURE__ */ React.createElement(RBadge, { tone: "sync", mono: false }, "扣款") },
        { key: "method", label: "支付方式", muted: true, render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11.5, color: "var(--text-2)" } }, t.method) },
        { key: "amount", label: "金额", numeric: true, render: (t) => /* @__PURE__ */ React.createElement(RMoney, { amount: t.amount, size: 12, tone: t.type === "refund" ? "danger" : "gold", sign: t.type === "refund" }) },
        { key: "status", label: "状态", render: (t) => t.status === "failed" ? /* @__PURE__ */ React.createElement(RBadge, { tone: "danger", mono: false }, "失败") : /* @__PURE__ */ React.createElement(RBadge, { tone: "success" }, "成功") },
        { key: "date", label: "时间", numeric: true, render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, t.date) },
        { key: "act", label: "", align: "right", render: (t) => t.type === "charge" && t.status === "succeeded" && t.refundEligible ? /* @__PURE__ */ React.createElement(RBtn, { size: "sm", variant: "ghost", onClick: () => setRefund(t) }, "全额退款") : t.status === "failed" ? /* @__PURE__ */ React.createElement(RBtn, { size: "sm", variant: "ghost" }, "重试") : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "窗口已结束") }
      ],
      rows: tx,
      footer: /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", width: "100%", fontSize: 11, color: "var(--text-3)" } }, /* @__PURE__ */ React.createElement("span", null, tx.length, " 笔交易 · Stripe 托管付款"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)" } }, "今日净额 ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "+$694.00")))
    }
  )), /* @__PURE__ */ React.createElement(
    RDlg,
    {
      open: !!refund,
      onClose: () => setRefund(null),
      title: "退款",
      width: 440,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(RBtn, { onClick: () => setRefund(null) }, "取消"), /* @__PURE__ */ React.createElement(RBtn, { variant: "danger", onClick: () => setRefund(null) }, "退款 ", refund && "$" + refund.amount.toFixed(2)))
    },
    refund && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, fontSize: 13, color: "var(--text-2)", lineHeight: 1.6 } }, /* @__PURE__ */ React.createElement("span", null, "向 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--text-1)" } }, refund.customer), " 退款 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-gold)", fontFamily: "var(--font-mono)" } }, "$", refund.amount.toFixed(2)), "（", refund.id, "）。"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "仅首次付费购买在购买后 14 天内享全额退款；续费不会重置该窗口。款项由原 Provider 托管路径返还并记入审计。退款不会自动取消月付或年付的后续续费，订阅状态需另行明确处理。"))
  ));
}
window.GDRevenue = Revenue;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Revenue.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/Support.jsx
try { (() => {
const { Panel: TPanel, Table: TTable, Badge: TBadge, Button: TBtn, Tabs: TTabs, Input: TInput, Select: TSel, Toolbar: TToolbar, Dialog: TDlg } = window.GoodDealerDesignSystem_b5b0b6;
const PRIO = { high: /* @__PURE__ */ React.createElement(TBadge, { tone: "danger", mono: false }, "高"), normal: /* @__PURE__ */ React.createElement(TBadge, { tone: "sync", mono: false }, "普通"), low: /* @__PURE__ */ React.createElement(TBadge, { tone: "neutral", mono: false }, "低") };
const CHAN = { email: "邮件", "in-app": "应用内", billing: "账单" };
function Support() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [tickets, setTickets] = React.useState(() => D.tickets.map((t) => ({ ...t })));
  const [tab, setTab] = React.useState("open");
  const [q, setQ] = React.useState("");
  const [sel, setSel] = React.useState(null);
  const counts = { open: tickets.filter((t) => t.status === "open").length, pending: tickets.filter((t) => t.status === "pending").length, resolved: tickets.filter((t) => t.status === "resolved").length };
  let rows = tickets.filter((t) => (tab === "all" || t.status === tab) && (q === "" || t.subject.includes(q) || t.customer.includes(q) || t.id.toLowerCase().includes(q.toLowerCase())));
  const resolve = (t) => {
    setTickets((ts) => ts.map((x) => x.id === t.id ? { ...x, status: "resolved" } : x));
    setSel(null);
  };
  const assign = (t) => {
    setTickets((ts) => ts.map((x) => x.id === t.id ? { ...x, assignee: "王运维", status: x.status === "open" ? "pending" : x.status } : x));
    setSel((s) => s && s.id === t.id ? { ...s, assignee: "王运维" } : s);
  };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "支持工单", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "待处理", value: counts.open + counts.pending, tone: "warning", meta: "open + pending" },
    { label: "高优先级", value: tickets.filter((t) => t.priority === "high" && t.status !== "resolved").length, tone: "danger", meta: "需优先响应" },
    { label: "平均首响", value: "1.8h", tone: "success", meta: "SLA 4h" },
    { label: "今日解决", value: "14", tone: "success", meta: "解决率 91%" },
    { label: "未分配", value: tickets.filter((t) => t.assignee === "—" && t.status !== "resolved").length, tone: "warning", meta: "待认领" },
    { label: "CSAT 满意度", value: "4.7", tone: "gold", meta: "近 30 天 · 5 分制" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "0 18px", borderBottom: "1px solid var(--gd-line)", background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement(TTabs, { items: [{ key: "open", label: "待认领", count: counts.open }, { key: "pending", label: "处理中", count: counts.pending }, { key: "resolved", label: "已解决", count: counts.resolved }, { key: "all", label: "全部" }], active: tab, onChange: setTab })), /* @__PURE__ */ React.createElement(
    TToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(TInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索主题、客户、工单号…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 260 } }),
      right: /* @__PURE__ */ React.createElement(TBtn, { size: "sm", variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Plus, { size: 14 }) }, "新建工单")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    TTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      onRowClick: setSel,
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "id", label: "工单", render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, t.id) },
        { key: "subject", label: "主题", render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)" } }, t.subject) },
        { key: "customer", label: "客户", muted: true },
        { key: "priority", label: "优先级", render: (t) => PRIO[t.priority] },
        { key: "channel", label: "渠道", render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-2)" } }, CHAN[t.channel]) },
        { key: "assignee", label: "处理人", render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: t.assignee === "—" ? "var(--text-3)" : "var(--text-1)" } }, t.assignee === "—" ? "未分配" : t.assignee) },
        { key: "status", label: "状态", render: (t) => t.status === "resolved" ? /* @__PURE__ */ React.createElement(TBadge, { tone: "success" }, "已解决") : t.status === "pending" ? /* @__PURE__ */ React.createElement(TBadge, { tone: "sync", mono: false }, "处理中") : /* @__PURE__ */ React.createElement(TBadge, { tone: "warning", mono: false }, "待认领") },
        { key: "updated", label: "更新", numeric: true, render: (t) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-3)" } }, t.updated) }
      ],
      rows,
      emptyText: "此分类下暂无工单"
    }
  )), /* @__PURE__ */ React.createElement(
    TDlg,
    {
      open: !!sel,
      onClose: () => setSel(null),
      title: sel ? sel.id : "",
      width: 560,
      footer: sel && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(TBtn, { onClick: () => setSel(null) }, "关闭"), sel.assignee === "—" && /* @__PURE__ */ React.createElement(TBtn, { onClick: () => assign(sel) }, "认领"), sel.status !== "resolved" && /* @__PURE__ */ React.createElement(TBtn, { variant: "primary", onClick: () => resolve(sel) }, "标记已解决"))
    },
    sel && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 13 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 6 } }, PRIO[sel.priority], sel.status === "resolved" ? /* @__PURE__ */ React.createElement(TBadge, { tone: "success" }, "已解决") : sel.status === "pending" ? /* @__PURE__ */ React.createElement(TBadge, { tone: "sync", mono: false }, "处理中") : /* @__PURE__ */ React.createElement(TBadge, { tone: "warning", mono: false }, "待认领"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", marginLeft: "auto" } }, CHAN[sel.channel], " · ", sel.updated)), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, fontWeight: 600, color: "var(--text-1)" } }, sel.subject), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--text-3)", marginTop: 3 } }, sel.customer, " · 处理人 ", sel.assignee === "—" ? "未分配" : sel.assignee)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10, padding: "13px 14px", background: "var(--gd-panel)", border: "1px solid var(--gd-line)", borderRadius: 7 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 24, height: 24, flex: "none", borderRadius: "50%", background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line-strong)", fontSize: 10, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-2)" } }, "客"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-2)", lineHeight: 1.6 } }, "移交执行权后新设备一直停留在「正在安全激活」，超过一天仍未完成，旧设备已排空。请协助排查。"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "回复"), /* @__PURE__ */ React.createElement("textarea", { placeholder: "输入回复…", style: { width: "100%", minHeight: 70, resize: "vertical", background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, color: "var(--gd-text)", fontFamily: "var(--font-sans)", fontSize: 13, padding: "9px 11px", outline: "none", boxSizing: "border-box" } })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement(TSel, { size: "sm", options: ["未分配", "王运维", "李工", "张工"], value: sel.assignee === "—" ? "未分配" : sel.assignee, onChange: () => {
    } }), /* @__PURE__ */ React.createElement(TSel, { size: "sm", options: ["高", "普通", "低"], value: sel.priority === "high" ? "高" : sel.priority === "low" ? "低" : "普通", onChange: () => {
    } }), /* @__PURE__ */ React.createElement(TBtn, { size: "sm", variant: "primary", style: { marginLeft: "auto" } }, "发送回复")))
  ));
}
window.GDSupport = Support;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/Support.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/SyncInfra.jsx
try { (() => {
const { Panel: IPanel, Badge: IBadge, Button: IBtn, StatusDot: IDot } = window.GoodDealerDesignSystem_b5b0b6;
const SVC_TONE = { ok: "success", degraded: "warning", warn: "warning", down: "danger" };
const SVC_LABEL = { ok: "正常", degraded: "降级", warn: "告警", down: "故障" };
function ServiceCard({ s }) {
  const tone = SVC_TONE[s.status];
  return /* @__PURE__ */ React.createElement("div", { style: { padding: "13px 14px", border: "1px solid var(--gd-line)", borderRadius: 7, background: "var(--gd-panel)", display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(IDot, { kind: tone === "success" ? "success" : tone === "warning" ? "warning" : "danger", pulse: s.status !== "ok" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)", fontWeight: 500 } }, s.name), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto" } }, /* @__PURE__ */ React.createElement(IBadge, { tone, mono: false }, SVC_LABEL[s.status]))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "延迟 p95"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 13, color: s.latency > 200 ? "var(--gd-warning)" : "var(--text-1)" } }, s.latency ? s.latency + "ms" : "—")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "可用性 30d"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 13, color: s.uptime < 99.5 ? "var(--gd-warning)" : "var(--text-1)" } }, s.uptime, "%"))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, s.note));
}
function SyncInfra() {
  const D = window.GD_ADMIN;
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const queues = [["us-east-1", 52, 40, "ok"], ["eu-west-2", 31, 55, "ok"], ["ap-east-1", 28, 48, "ok"], ["me-south-1", 17, 210, "warn"], ["ap-northeast-1", 12, 62, "ok"]];
  const maxQ = Math.max(...queues.map((q) => q[1]));
  const connectors = [["Atom", "ok", "API · 511k Listing 同步"], ["Afternic", "warn", "回调延迟 340ms · CSV 人工"], ["Cloudflare", "ok", "DNS · 601k 区域"], ["Spaceship", "warn", "会话过期率 8%"], ["Dynadot", "ok", "注册商 API"], ["SellerHub", "ok", "已启用"]];
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "同步与基础设施", style: { display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "系统可用性", value: "99.2%", tone: "success", meta: "30 天滚动" },
    { label: "同步队列", value: "128", meta: "跨 12 区域" },
    { label: "API 延迟 p95", value: "42ms", tone: "success", meta: "Sync API" },
    { label: "错误率", value: "0.06%", tone: "success", meta: "近 1 小时" },
    { label: "活跃事件", value: "1", tone: "warning", meta: "1 服务降级" },
    { label: "连接器健康", value: "98.1%", tone: "warning", meta: "3 平台会话过期偏高" }
  ] }), /* @__PURE__ */ React.createElement("div", { style: { padding: 18, display: "grid", gridTemplateColumns: "1fr 360px", gap: 14, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(IPanel, { title: "服务健康", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "自动探针 · 60s") }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 } }, D.services.map((s) => /* @__PURE__ */ React.createElement(ServiceCard, { key: s.name, s })))), /* @__PURE__ */ React.createElement(IPanel, { flush: true, title: "活跃与近期事件" }, D.incidents.map((inc, i) => /* @__PURE__ */ React.createElement("div", { key: inc.id, style: { display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderBottom: i < D.incidents.length - 1 ? "1px solid var(--gd-line)" : "none" } }, /* @__PURE__ */ React.createElement(IDot, { kind: inc.sev === "minor" ? "warning" : inc.sev === "major" ? "danger" : "neutral" }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12.5, color: "var(--text-1)" } }, inc.title), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, inc.id, " · ", inc.svc, " · 始于 ", inc.started)), /* @__PURE__ */ React.createElement(IBadge, { tone: inc.status === "监控中" ? "warning" : inc.status === "已缓解" ? "sync" : "neutral", mono: false }, inc.status))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(IPanel, { title: "同步队列 · 按区域" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 11 } }, queues.map(([r, q, lag, st]) => /* @__PURE__ */ React.createElement("div", { key: r, style: { display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", fontSize: 11.5 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--text-2)", flex: 1 } }, r), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: st === "warn" ? "var(--gd-warning)" : "var(--text-3)" } }, q, " 项 · ", lag, "ms")), /* @__PURE__ */ React.createElement("div", { style: { height: 5, borderRadius: 3, background: "var(--gd-line)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement("div", { style: { width: q / maxQ * 100 + "%", height: "100%", background: st === "warn" ? "var(--gd-warning)" : "var(--gd-blue)" } })))))), /* @__PURE__ */ React.createElement(IPanel, { flush: true, title: "连接器健康", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)" } }, "平台侧") }, connectors.map((c, i) => /* @__PURE__ */ React.createElement("div", { key: c[0], style: { display: "flex", alignItems: "center", gap: 10, padding: "10px 16px", borderBottom: i < connectors.length - 1 ? "1px solid var(--gd-line)" : "none" } }, /* @__PURE__ */ React.createElement(IDot, { kind: c[1] === "ok" ? "success" : "warning" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12.5, color: "var(--text-1)", width: 78, flex: "none" } }, c[0]), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", flex: 1, minWidth: 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, c[2])))))));
}
window.GDSyncInfra = SyncInfra;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/SyncInfra.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/controls.jsx
try { (() => {
const { Select: GDSelect, IconButton: GDIconButton } = window.GoodDealerDesignSystem_b5b0b6;
function pageWindow(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const s = /* @__PURE__ */ new Set([1, 2, total - 1, total, cur - 1, cur, cur + 1]);
  const arr = [...s].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of arr) {
    if (n - prev > 1) out.push("gap" + n);
    out.push(n);
    prev = n;
  }
  return out;
}
function PageNum({ n, active, onClick }) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick,
      onMouseEnter: (e) => {
        if (!active) e.currentTarget.style.background = "var(--gd-panel-raised)";
      },
      onMouseLeave: (e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      },
      style: {
        minWidth: 24,
        height: 24,
        padding: "0 6px",
        borderRadius: 5,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        border: active ? "1px solid var(--gd-line-strong)" : "1px solid transparent",
        background: active ? "var(--gd-panel-raised)" : "transparent",
        color: active ? "var(--text-1)" : "var(--text-2)"
      }
    },
    n
  );
}
function Pagination({ page, pageSize, total, onPage, onPageSize, pageSizes = [10, 25, 50], note }) {
  const I = window.GDI;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, width: "100%", fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" } }, from.toLocaleString(), "–", to.toLocaleString(), " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "/ ", total.toLocaleString())), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, "每页", /* @__PURE__ */ React.createElement(GDSelect, { size: "sm", options: pageSizes.map(String), value: String(pageSize), onChange: (e) => onPageSize(+e.target.value) })), note && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11 } }, note), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: note ? 16 : "auto", display: "flex", alignItems: "center", gap: 3 } }, /* @__PURE__ */ React.createElement(GDIconButton, { size: "sm", label: "上一页", disabled: cur <= 1, onClick: () => onPage(cur - 1) }, /* @__PURE__ */ React.createElement(I.ChevronLeft, { size: 14 })), pageWindow(cur, pages).map((n, i) => typeof n === "number" ? /* @__PURE__ */ React.createElement(PageNum, { key: i, n, active: n === cur, onClick: () => onPage(n) }) : /* @__PURE__ */ React.createElement("span", { key: i, style: { padding: "0 2px", color: "var(--gd-text-faint)" } }, "…")), /* @__PURE__ */ React.createElement(GDIconButton, { size: "sm", label: "下一页", disabled: cur >= pages, onClick: () => onPage(cur + 1) }, /* @__PURE__ */ React.createElement(I.ChevronRight, { size: 14 }))));
}
window.GDPagination = Pagination;
function EditableCell({ value, display, onCommit, width = 94, prefix }) {
  const [editing, setEditing] = React.useState(false);
  const ref = React.useRef(null);
  const doneRef = React.useRef(false);
  React.useEffect(() => {
    if (editing && ref.current) {
      ref.current.value = value == null ? "" : String(value);
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);
  const start = () => {
    doneRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const raw = ref.current ? ref.current.value : "";
    setEditing(false);
    const clean = String(raw).trim();
    if (clean !== "" && clean !== String(value)) onCommit(clean);
  };
  const cancel = () => {
    doneRef.current = true;
    setEditing(false);
  };
  if (editing) {
    return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }, onClick: (e) => e.stopPropagation() }, prefix && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" } }, prefix), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref,
        inputMode: "decimal",
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") cancel();
        },
        onBlur: commit,
        style: { width, height: 24, background: "var(--gd-ink)", border: "1px solid var(--gd-blue)", boxShadow: "0 0 0 2px rgba(77,141,255,0.25)", borderRadius: 5, color: "var(--gd-text)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 12, textAlign: "right", padding: "0 7px", outline: "none" }
      }
    ));
  }
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      onDoubleClick: (e) => {
        e.stopPropagation();
        start();
      },
      onClick: (e) => e.stopPropagation(),
      title: "双击编辑 · 回车确认",
      style: { cursor: "text", display: "inline-block", borderBottom: "1px dashed transparent", paddingBottom: 1, transition: "border-color 120ms" },
      onMouseEnter: (e) => e.currentTarget.style.borderBottomColor = "var(--gd-line-strong)",
      onMouseLeave: (e) => e.currentTarget.style.borderBottomColor = "transparent"
    },
    display != null ? display : value
  );
}
window.GDEditableCell = EditableCell;
function MetricStrip({ metrics = [] }) {
  const tone = (t) => ({ gold: "var(--gd-gold)", danger: "var(--gd-danger)", warning: "var(--gd-warning)", blue: "var(--gd-blue)", success: "var(--gd-success)", muted: "var(--text-3)" })[t] || "var(--text-1)";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: 72, flex: "none", background: "var(--surface-region)", borderBottom: "1px solid var(--gd-line)" } }, metrics.map((m, i) => {
    const click = m.onClick;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: i,
        onClick: click || void 0,
        onMouseEnter: click ? (e) => {
          e.currentTarget.style.background = "var(--gd-panel-raised)";
        } : void 0,
        onMouseLeave: click ? (e) => {
          e.currentTarget.style.background = "transparent";
        } : void 0,
        style: {
          flex: 1,
          minWidth: 0,
          padding: "0 16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 3,
          transition: "background 120ms",
          borderRight: i < metrics.length - 1 ? "1px solid var(--gd-line)" : "none",
          cursor: click ? "pointer" : "default"
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-label", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.label),
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-metric-sm", style: { color: m.tone === "muted" ? "var(--text-3)" : tone(m.tone), fontFamily: m.mono ? "var(--font-mono)" : void 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.value),
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-meta", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: 14 } }, m.meta != null ? m.meta : " ")
    );
  }));
}
window.GDMetricStrip = MetricStrip;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/controls.jsx", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/data.js
try { (() => {
window.GD_ADMIN = {
  operator: { name: "王运维", email: "ops@gooddealer.com", role: "运营管理员" },
  kpis: { customers: 2847, activeCustomers: 2413, refundEligible: 92, mrr: 19927, arr: 239124, devicesOnline: 1842, devicesBound: 4106, syncHealth: 99.2, openTickets: 23, alerts: 3, churnRate: 1.8 },
  revenueSeries: [15.8, 16.2, 16.7, 17.1, 17.5, 18, 18.4, 18.8, 19.1, 19.4, 19.7, 19.9],
  // Recurring MRR $k; fixed-term purchases are recognized separately.
  termMix: [{ term: "月付", count: 1200, mrr: 11760, color: "var(--gd-gold)" }, { term: "年付", count: 1e3, mrr: 8167, color: "var(--gd-blue)" }, { term: "10 年固定期", count: 213, mrr: 0, color: "var(--gd-viz-drawdown)" }],
  customers: [
    { id: "C-10428", name: "陈立行", email: "li@quanta.trade", term: "年付", status: "active", devices: 2, domains: 1024, mrr: 8.17, since: "2024-03-11", nextBillingDate: "2027-03-11", lastSeen: "14:02", country: "CN", provider: "Stripe" },
    { id: "C-10091", name: "Meridian Holdings", email: "ops@meridian.co", term: "10 年固定期", status: "active", devices: 2, domains: 8420, mrr: 0, since: "2023-11-02", termEnds: "2033-11-02", lastSeen: "13:58", country: "US", provider: "Stripe" },
    { id: "C-11733", name: "Sana Qureshi", email: "sana@qrsh.io", term: "月付", status: "past_due", devices: 2, domains: 612, mrr: 9.8, since: "2024-08-19", nextBillingDate: "2026-08-19", lastSeen: "2 天前", country: "AE", provider: "Stripe" },
    { id: "C-12055", name: "北岛数字", email: "admin@beidao.cn", term: "年付", status: "active", devices: 2, domains: 5109, mrr: 8.17, since: "2024-01-27", nextBillingDate: "2027-01-27", lastSeen: "12:31", country: "CN", provider: "Stripe" },
    { id: "C-12890", name: "Diego Marín", email: "d@marin.dev", term: "月付", status: "active", devices: 1, domains: 88, mrr: 9.8, since: "2026-08-14", nextBillingDate: "2026-09-14", refundUntil: "2026-08-28", lastSeen: "09:14", country: "MX", provider: "Stripe" },
    { id: "C-11402", name: "Kestrel Capital", email: "it@kestrel.fund", term: "10 年固定期", status: "active", devices: 2, domains: 12040, mrr: 0, since: "2023-06-14", termEnds: "2033-06-14", lastSeen: "14:01", country: "GB", provider: "Stripe" },
    { id: "C-13001", name: "Yuki Tanaka", email: "yuki@tnk.jp", term: "年付", status: "active", devices: 2, domains: 430, mrr: 8.17, since: "2025-02-08", nextBillingDate: "2027-02-08", lastSeen: "昨日", country: "JP", provider: "Stripe" },
    { id: "C-09980", name: "Orbit Domains", email: "team@orbit.io", term: "月付", status: "churned", devices: 0, domains: 0, mrr: 0, since: "2023-09-30", lastSeen: "06-28", country: "US", provider: "Stripe" },
    { id: "C-12610", name: "Amara Okafor", email: "amara@okf.ng", term: "月付", status: "active", devices: 1, domains: 142, mrr: 9.8, since: "2025-11-15", nextBillingDate: "2026-09-15", lastSeen: "11:47", country: "NG", provider: "Stripe" },
    { id: "C-13120", name: "Lindqvist AB", email: "drift@lindqvist.se", term: "年付", status: "active", devices: 1, domains: 203, mrr: 8.17, since: "2026-08-10", nextBillingDate: "2027-08-10", refundUntil: "2026-08-24", lastSeen: "10:22", country: "SE", provider: "Stripe" },
    { id: "C-10777", name: "Zheng Wei", email: "zw@zheng.co", term: "月付", status: "active", devices: 2, domains: 756, mrr: 9.8, since: "2024-05-21", nextBillingDate: "2026-09-21", lastSeen: "13:40", country: "CN", provider: "Stripe" },
    { id: "C-11988", name: "Halcyon Group", email: "ops@halcyon.gg", term: "年付", status: "past_due", devices: 2, domains: 3301, mrr: 8.17, since: "2024-04-03", nextBillingDate: "2026-08-18", lastSeen: "3 天前", country: "SG", provider: "Stripe" }
  ],
  fleet: [
    { id: "D-8841", customer: "陈立行", name: "MacBook Pro", os: "macOS 15.2", state: "active", epoch: 41, lastSeen: "现在", region: "ap-east-1", health: "ok" },
    { id: "D-8842", customer: "陈立行", name: "iPhone 17 Pro", os: "iOS 19.1", state: "standby", epoch: 41, lastSeen: "08:30", region: "ap-east-1", health: "ok" },
    { id: "D-6320", customer: "Meridian Holdings", name: "Mac Studio", os: "macOS 15.1", state: "active", epoch: 127, lastSeen: "现在", region: "us-east-1", health: "ok" },
    { id: "D-6321", customer: "Meridian Holdings", name: "ThinkPad X1", os: "Windows 11", state: "standby", epoch: 127, lastSeen: "1 小时前", region: "us-east-1", health: "ok" },
    { id: "D-7702", customer: "Kestrel Capital", name: "Precision 5680", os: "Windows 11", state: "active", epoch: 88, lastSeen: "现在", region: "eu-west-2", health: "ok" },
    { id: "D-9110", customer: "Sana Qureshi", name: "MacBook Air", os: "macOS 14.6", state: "draining", epoch: 53, lastSeen: "2 天前", region: "me-south-1", health: "stale" },
    { id: "D-9111", customer: "Sana Qureshi", name: "iPad Pro", os: "iPadOS 19", state: "activating", epoch: 54, lastSeen: "2 天前", region: "me-south-1", health: "warn" },
    { id: "D-5540", customer: "北岛数字", name: "iMac", os: "macOS 15.2", state: "active", epoch: 64, lastSeen: "12:31", region: "ap-east-1", health: "ok" },
    { id: "D-4102", customer: "Halcyon Group", name: "Legion Tower", os: "Windows 10", state: "sunset", epoch: 31, lastSeen: "3 天前", region: "ap-southeast-1", health: "stale" },
    { id: "D-8003", customer: "Yuki Tanaka", name: "MacBook Pro", os: "macOS 15.0", state: "active", epoch: 22, lastSeen: "昨日", region: "ap-northeast-1", health: "ok" }
  ],
  transactions: [
    { id: "TX-88214", customer: "Diego Marín", amount: 9.8, type: "charge", date: "14:02", method: "Stripe 托管付款", status: "succeeded", refundEligible: true },
    { id: "TX-88213", customer: "陈立行", amount: 98, type: "charge", date: "13:44", method: "Stripe 托管付款", status: "succeeded", refundEligible: false },
    { id: "TX-88212", customer: "Sana Qureshi", amount: 9.8, type: "charge", date: "11:20", method: "Stripe 托管付款", status: "failed" },
    { id: "TX-88210", customer: "Orbit Domains", amount: 9.8, type: "refund", date: "昨日", method: "Stripe 托管退款", status: "succeeded" },
    { id: "TX-88208", customer: "Kestrel Capital", amount: 498, type: "charge", date: "昨日", method: "Stripe 托管付款", status: "succeeded" },
    { id: "TX-88205", customer: "北岛数字", amount: 98, type: "charge", date: "08-15", method: "Stripe 托管付款", status: "succeeded" }
  ],
  services: [
    { name: "Sync API", status: "ok", latency: 42, uptime: 99.98, note: "p95 · 12 region" },
    { name: "Auth / License", status: "ok", latency: 28, uptime: 99.99, note: "设备门禁签发" },
    { name: "Cloud Store", status: "ok", latency: 61, uptime: 99.97, note: "Revision 账本" },
    { name: "Webhooks", status: "degraded", latency: 340, uptime: 99.4, note: "Afternic 回调延迟" },
    { name: "Billing Provider", status: "ok", latency: 88, uptime: 99.95, note: "Stripe 托管" },
    { name: "Connector Health", status: "warn", latency: 0, uptime: 98.1, note: "3 平台会话过期率偏高" }
  ],
  incidents: [
    { id: "INC-241", title: "Afternic Webhook 回调延迟升高", sev: "minor", status: "监控中", started: "13:10", svc: "Webhooks" },
    { id: "INC-240", title: "me-south-1 同步队列积压", sev: "minor", status: "已缓解", started: "11:02", svc: "Sync API" },
    { id: "INC-238", title: "Stripe 计划性维护窗口", sev: "info", status: "已完成", started: "08-14", svc: "Billing" }
  ],
  tickets: [
    { id: "T-4821", subject: "设备门禁：移交后无法激活 Standby", customer: "Sana Qureshi", priority: "high", status: "open", assignee: "—", updated: "12 分钟前", channel: "email" },
    { id: "T-4818", subject: "批量改价对 Afternic 未生效", customer: "Meridian Holdings", priority: "high", status: "pending", assignee: "李工", updated: "1 小时前", channel: "in-app" },
    { id: "T-4815", subject: "发票抬头修改申请", customer: "北岛数字", priority: "low", status: "open", assignee: "—", updated: "2 小时前", channel: "email" },
    { id: "T-4809", subject: "10 年固定期到期日咨询", customer: "Kestrel Capital", priority: "normal", status: "pending", assignee: "王运维", updated: "昨日", channel: "in-app" },
    { id: "T-4802", subject: "Provider 托管扣款失败", customer: "Sana Qureshi", priority: "normal", status: "open", assignee: "—", updated: "昨日", channel: "billing" },
    { id: "T-4790", subject: "导出账户数据请求 (GDPR)", customer: "Yuki Tanaka", priority: "normal", status: "resolved", assignee: "李工", updated: "08-15", channel: "email" }
  ],
  audit: [
    { id: 1, actor: "王运维", action: "强制解绑设备", target: "D-4102 · Halcyon Group", time: "13:55", ip: "10.0.4.21" },
    { id: 2, actor: "系统", action: "扣款失败 · 自动重试", target: "C-11733 · Sana Qureshi", time: "11:21", ip: "—" },
    { id: 3, actor: "李工", action: "首次购买全额退款 $9.80", target: "C-09980 · Orbit Domains", time: "昨日 17:40", ip: "10.0.4.9" },
    { id: 4, actor: "王运维", action: "切换功能开关 batch_v2", target: "全局 · 12% rollout", time: "昨日 15:02", ip: "10.0.4.21" },
    { id: 5, actor: "王运维", action: "发布公告", target: "ANN-0042 · 全部客户", time: "昨日 10:30", ip: "10.0.4.21" },
    { id: 6, actor: "系统", action: "签发 ActiveDeviceLease", target: "D-8003 · Yuki Tanaka · Epoch 22", time: "08-15 09:12", ip: "—" },
    { id: 7, actor: "李工", action: "重置客户 2FA", target: "C-12055 · 北岛数字", time: "08-15 08:47", ip: "10.0.4.9" }
  ],
  flags: [
    { key: "batch_v2", name: "批量执行引擎 v2", desc: "新的差异预览与分组执行管线", enabled: true, rollout: 12, section: "执行" },
    { key: "conflict_auto_merge", name: "冲突自动合并建议", desc: "对非价格字段给出合并建议（仍需人工确认）", enabled: false, rollout: 0, section: "执行" },
    { key: "sellerhub_connector", name: "SellerHub 连接器", desc: "启用 SellerHub 平台集成", enabled: true, rollout: 100, section: "连接器" },
    { key: "afternic_api_write", name: "Afternic 价格写入 API", desc: "绕过 CSV 人工上传（灰度）", enabled: false, rollout: 5, section: "连接器" },
    { key: "web_execution", name: "网页端执行（实验）", desc: "允许在 account-web 提交低风险修改", enabled: false, rollout: 0, section: "实验" }
  ],
  announcements: [
    { id: "ANN-0043", title: "0.9.0 发布：议价交割闭环", audience: "全部客户", status: "published", date: "昨日 10:30", author: "王运维" },
    { id: "ANN-0044", title: "me-south-1 区域维护窗口 · 08-20 02:00 UTC", audience: "中东区客户", status: "scheduled", date: "08-20 02:00", author: "王运维" },
    { id: "ANN-0045", title: "新增 SellerHub 连接器指南", audience: "全部有效许可", status: "draft", date: "—", author: "李工" },
    { id: "ANN-0042", title: "安全提示：为账户启用 2FA", audience: "全部客户", status: "published", date: "08-12 09:00", author: "王运维" }
  ]
};
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/data.js", error: String((error && error.message) || error) }); }

// ui_kits/admin-web/icons.jsx
try { (() => {
const mkIcon = (children) => ({ size = 15, style, ...p }) => /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", style, ...p }, children);
const GDI = {
  LayoutDashboard: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "7", height: "9", x: "3", y: "3", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { width: "7", height: "5", x: "14", y: "3", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { width: "7", height: "9", x: "14", y: "12", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { width: "7", height: "5", x: "3", y: "16", rx: "1" }))),
  Globe: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "M2 12h20" }), /* @__PURE__ */ React.createElement("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }))),
  Coins: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "6" }), /* @__PURE__ */ React.createElement("path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }), /* @__PURE__ */ React.createElement("path", { d: "M7 6h1v4" }), /* @__PURE__ */ React.createElement("path", { d: "m16.71 13.88.7.71-2.82 2.82" }))),
  Users: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" }), /* @__PURE__ */ React.createElement("circle", { cx: "9", cy: "7", r: "4" }), /* @__PURE__ */ React.createElement("path", { d: "M22 21v-2a4 4 0 0 0-3-3.87" }), /* @__PURE__ */ React.createElement("path", { d: "M16 3.13a4 4 0 0 1 0 7.75" }))),
  User: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "7", r: "4" }))),
  CreditCard: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "20", height: "14", x: "2", y: "5", rx: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "2", x2: "22", y1: "10", y2: "10" }))),
  Receipt: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z" }), /* @__PURE__ */ React.createElement("path", { d: "M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8" }), /* @__PURE__ */ React.createElement("path", { d: "M12 17.5v-11" }))),
  KeyRound: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M2 18v3c0 .5.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" }), /* @__PURE__ */ React.createElement("circle", { cx: "16.5", cy: "7.5", r: ".7", fill: "currentColor" }))),
  Key: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "7.5", cy: "15.5", r: "5.5" }), /* @__PURE__ */ React.createElement("path", { d: "m21 2-9.6 9.6" }), /* @__PURE__ */ React.createElement("path", { d: "m15.5 7.5 3 3L22 7l-3-3" }))),
  ShieldCheck: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }), /* @__PURE__ */ React.createElement("path", { d: "m9 12 2 2 4-4" }))),
  Shield: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" })),
  Lock: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "18", height: "11", x: "3", y: "11", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M7 11V7a5 5 0 0 1 10 0v4" }))),
  Smartphone: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "14", height: "20", x: "5", y: "2", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M12 18h.01" }))),
  Monitor: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "2", y: "3", width: "20", height: "14", rx: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "21", x2: "16", y2: "21" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "17", x2: "12", y2: "21" }))),
  Database: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("ellipse", { cx: "12", cy: "5", rx: "9", ry: "3" }), /* @__PURE__ */ React.createElement("path", { d: "M3 5V19A9 3 0 0 0 21 19V5" }), /* @__PURE__ */ React.createElement("path", { d: "M3 12A9 3 0 0 0 21 12" }))),
  Cloud: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z" })),
  Server: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "20", height: "8", x: "2", y: "2", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("rect", { width: "20", height: "8", x: "2", y: "14", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "6", x2: "6.01", y1: "6", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "6", x2: "6.01", y1: "18", y2: "18" }))),
  Activity: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M22 12h-4l-3 9L9 3l-3 9H2" })),
  LifeBuoy: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "m4.93 4.93 4.24 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "m14.83 9.17 4.24-4.24" }), /* @__PURE__ */ React.createElement("path", { d: "m14.83 14.83 4.24 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "m9.17 14.83-4.24 4.24" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "4" }))),
  ScrollText: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 12h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M15 8h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M19 17V5a2 2 0 0 0-2-2H4" }), /* @__PURE__ */ React.createElement("path", { d: "M8 21h12a2 2 0 0 0 2-2v-1a1 1 0 0 0-1-1H11a1 1 0 0 0-1 1v1a2 2 0 1 1-4 0V5a2 2 0 1 0-4 0v2a1 1 0 0 0 1 1h3" }))),
  SlidersHorizontal: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "14", y1: "4", y2: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "10", x2: "3", y1: "4", y2: "4" }), /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "12", y1: "12", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "8", x2: "3", y1: "12", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "16", y1: "20", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "3", y1: "20", y2: "20" }), /* @__PURE__ */ React.createElement("line", { x1: "14", x2: "14", y1: "2", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", x2: "8", y1: "10", y2: "14" }), /* @__PURE__ */ React.createElement("line", { x1: "16", x2: "16", y1: "18", y2: "22" }))),
  Megaphone: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m3 11 18-5v12L3 14v-3z" }), /* @__PURE__ */ React.createElement("path", { d: "M11.6 16.8a3 3 0 1 1-5.8-1.6" }))),
  Bell: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" }), /* @__PURE__ */ React.createElement("path", { d: "M10.3 21a1.94 1.94 0 0 0 3.4 0" }))),
  LogOut: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 17 21 12 16 7" }), /* @__PURE__ */ React.createElement("line", { x1: "21", x2: "9", y1: "12", y2: "12" }))),
  Settings: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }))),
  Search: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "7" }), /* @__PURE__ */ React.createElement("path", { d: "m20 20-3.5-3.5" }))),
  RefreshCw: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 12a9 9 0 0 1 15.6-6.2L21 8" }), /* @__PURE__ */ React.createElement("path", { d: "M21 3v5h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M21 12a9 9 0 0 1-15.6 6.2L3 16" }), /* @__PURE__ */ React.createElement("path", { d: "M3 21v-5h5" }))),
  Download: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "7 10 12 15 17 10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "15", x2: "12", y2: "3" }))),
  Upload: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "17 8 12 3 7 8" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "3", x2: "12", y2: "15" }))),
  X: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M18 6 6 18" }), /* @__PURE__ */ React.createElement("path", { d: "m6 6 12 12" }))),
  Plus: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M5 12h14" }), /* @__PURE__ */ React.createElement("path", { d: "M12 5v14" }))),
  Minus: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M5 12h14" })),
  Check: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M20 6 9 17l-5-5" })),
  ChevronRight: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m9 18 6-6-6-6" })),
  ChevronLeft: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m15 18-6-6 6-6" })),
  ChevronDown: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m6 9 6 6 6-6" })),
  ExternalLink: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 3h6v6" }), /* @__PURE__ */ React.createElement("path", { d: "M10 14 21 3" }), /* @__PURE__ */ React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }))),
  ArrowRight: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M5 12h14" }), /* @__PURE__ */ React.createElement("path", { d: "m12 5 7 7-7 7" }))),
  ArrowUpRight: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M7 7h10v10" }), /* @__PURE__ */ React.createElement("path", { d: "M7 17 17 7" }))),
  MoreHorizontal: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "19", cy: "12", r: "1" }), /* @__PURE__ */ React.createElement("circle", { cx: "5", cy: "12", r: "1" }))),
  Filter: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" })),
  Calendar: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "18", height: "18", x: "3", y: "4", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "16", x2: "16", y1: "2", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "8", x2: "8", y1: "2", y2: "6" }), /* @__PURE__ */ React.createElement("line", { x1: "3", x2: "21", y1: "10", y2: "10" }))),
  Clock: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("polyline", { points: "12 6 12 12 16 14" }))),
  TrendingUp: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("polyline", { points: "22 7 13.5 15.5 8.5 10.5 2 17" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 7 22 7 22 13" }))),
  TrendingDown: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("polyline", { points: "22 17 13.5 8.5 8.5 13.5 2 7" }), /* @__PURE__ */ React.createElement("polyline", { points: "16 17 22 17 22 11" }))),
  Zap: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })),
  Ban: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "m4.9 4.9 14.2 14.2" }))),
  Copy: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "14", height: "14", x: "8", y: "8", rx: "2", ry: "2" }), /* @__PURE__ */ React.createElement("path", { d: "M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" }))),
  Eye: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }))),
  EyeOff: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M9.88 9.88a3 3 0 1 0 4.24 4.24" }), /* @__PURE__ */ React.createElement("path", { d: "M10.73 5.08A10.4 10.4 0 0 1 12 5c7 0 10 7 10 7a13.2 13.2 0 0 1-1.67 2.68" }), /* @__PURE__ */ React.createElement("path", { d: "M6.61 6.61A13.5 13.5 0 0 0 2 12s3 7 10 7a9.7 9.7 0 0 0 5.39-1.61" }), /* @__PURE__ */ React.createElement("line", { x1: "2", x2: "22", y1: "2", y2: "22" }))),
  Mail: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "20", height: "16", x: "2", y: "4", rx: "2" }), /* @__PURE__ */ React.createElement("path", { d: "m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" }))),
  DollarSign: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "12", y1: "2", y2: "22" }), /* @__PURE__ */ React.createElement("path", { d: "M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" }))),
  Wallet: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 12V7H5a2 2 0 0 1 0-4h14v4" }), /* @__PURE__ */ React.createElement("path", { d: "M3 5v14a2 2 0 0 0 2 2h16v-5" }), /* @__PURE__ */ React.createElement("path", { d: "M18 12a2 2 0 0 0 0 4h4v-4Z" }))),
  Building2: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z" }), /* @__PURE__ */ React.createElement("path", { d: "M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2" }), /* @__PURE__ */ React.createElement("path", { d: "M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2" }), /* @__PURE__ */ React.createElement("path", { d: "M10 6h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 10h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 14h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 18h4" }))),
  Cpu: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { width: "16", height: "16", x: "4", y: "4", rx: "2" }), /* @__PURE__ */ React.createElement("rect", { width: "6", height: "6", x: "9", y: "9", rx: "1" }), /* @__PURE__ */ React.createElement("path", { d: "M15 2v2" }), /* @__PURE__ */ React.createElement("path", { d: "M15 20v2" }), /* @__PURE__ */ React.createElement("path", { d: "M2 15h2" }), /* @__PURE__ */ React.createElement("path", { d: "M2 9h2" }), /* @__PURE__ */ React.createElement("path", { d: "M20 15h2" }), /* @__PURE__ */ React.createElement("path", { d: "M20 9h2" }), /* @__PURE__ */ React.createElement("path", { d: "M9 2v2" }), /* @__PURE__ */ React.createElement("path", { d: "M9 20v2" }))),
  HardDrive: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("line", { x1: "22", x2: "2", y1: "12", y2: "12" }), /* @__PURE__ */ React.createElement("path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }), /* @__PURE__ */ React.createElement("line", { x1: "6", x2: "6.01", y1: "16", y2: "16" }), /* @__PURE__ */ React.createElement("line", { x1: "10", x2: "10.01", y1: "16", y2: "16" }))),
  Wifi: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12 20h.01" }), /* @__PURE__ */ React.createElement("path", { d: "M2 8.82a15 15 0 0 1 20 0" }), /* @__PURE__ */ React.createElement("path", { d: "M5 12.86a10 10 0 0 1 14 0" }), /* @__PURE__ */ React.createElement("path", { d: "M8.5 16.43a5 5 0 0 1 7 0" }))),
  BarChart3: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 3v18h18" }), /* @__PURE__ */ React.createElement("path", { d: "M18 17V9" }), /* @__PURE__ */ React.createElement("path", { d: "M13 17V5" }), /* @__PURE__ */ React.createElement("path", { d: "M8 17v-3" }))),
  Gauge: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m12 14 4-4" }), /* @__PURE__ */ React.createElement("path", { d: "M3.34 19a10 10 0 1 1 17.32 0" }))),
  CircleCheck: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "m9 12 2 2 4-4" }))),
  CircleAlert: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "12", y1: "8", y2: "12" }), /* @__PURE__ */ React.createElement("line", { x1: "12", x2: "12.01", y1: "16", y2: "16" }))),
  AlertTriangle: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }), /* @__PURE__ */ React.createElement("path", { d: "M12 9v4" }), /* @__PURE__ */ React.createElement("path", { d: "M12 17h.01" }))),
  Trash2: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 6h18" }), /* @__PURE__ */ React.createElement("path", { d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }), /* @__PURE__ */ React.createElement("line", { x1: "10", x2: "10", y1: "11", y2: "17" }), /* @__PURE__ */ React.createElement("line", { x1: "14", x2: "14", y1: "11", y2: "17" }))),
  FileText: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }), /* @__PURE__ */ React.createElement("path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 9H8" }), /* @__PURE__ */ React.createElement("path", { d: "M16 13H8" }), /* @__PURE__ */ React.createElement("path", { d: "M16 17H8" }))),
  Pause: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "14", y: "4", width: "4", height: "16", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { x: "6", y: "4", width: "4", height: "16", rx: "1" }))),
  Play: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "6 3 20 12 6 21 6 3" })),
  Apple: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12 20.94c1.5 0 2.75 1.06 4 1.06 3 0 6-8 6-12.22A4.91 4.91 0 0 0 17 5c-2.22 0-4 1.44-5 2-1-.56-2.78-2-5-2a4.9 4.9 0 0 0-5 4.78C2 14 5 22 8 22c1.25 0 2.5-1.06 4-1.06Z" }), /* @__PURE__ */ React.createElement("path", { d: "M10 2c1 .5 2 2 2 5" }))),
  Command: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M15 6v12a3 3 0 1 0 3-3H6a3 3 0 1 0 3 3V6a3 3 0 1 0-3 3h12a3 3 0 1 0-3-3" }))
};
window.GDI = GDI;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/admin-web/icons.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/AssetLibrary.jsx
try { (() => {
const { Table, BatchBar, Badge, Money, Tag, Button, IconButton, Input, Select, KpiStat, Toolbar, Dialog } = window.GoodDealerDesignSystem_b5b0b6;
const afmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const anum = (v) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
const nsProvider = (a) => /Cloudflare/.test(a) ? "Cloudflare" : /销售平台/.test(a) ? "销售平台" : /注册商/.test(a) ? "注册商" : "自定义 NS";
function Ribbon({ onRenew }) {
  const MetricStrip = window.GDMetricStrip;
  return /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "域名总数", value: "1,024", meta: "Spaceship 812 · 其他 212" },
    { label: "组合估值", value: "$284,120.00", tone: "gold", meta: "较上月 +2.1%" },
    { label: "60 天内到期", value: "18", tone: "warning", meta: "续费预算 $312.00 · 去续费 →", onClick: onRenew },
    { label: "活跃 Listing", value: "692", meta: "Atom 511 · Afternic 601" },
    { label: "待裁决冲突", value: "6", tone: "danger", meta: "同字段被远端修改" }
  ] });
}
const STATUS_MAP = { "全部状态": null, "已同步": "synced", "等待平台": "pending", "冲突": "conflict", "未上架": "unlisted", "已售": "sold" };
function AssetLibrary({ domains, updateDomains, addUnsynced, onPlan, onOpenDomain, onRenew }) {
  const I = window.GDI;
  const EditableCell = window.GDEditableCell, Pagination = window.GDPagination;
  const { BatchPriceDialog, BatchNsDialog, BatchRecordsDialog, ListDialog } = window.GDDialogs;
  const STATUS_BADGE = {
    synced: /* @__PURE__ */ React.createElement(Badge, { tone: "sync" }, "SYNCED"),
    pending: /* @__PURE__ */ React.createElement(Badge, { tone: "warning", mono: false }, "等待平台"),
    conflict: /* @__PURE__ */ React.createElement(Badge, { tone: "danger", mono: false }, "冲突"),
    unlisted: /* @__PURE__ */ React.createElement(Badge, { mono: false }, "未上架"),
    sold: /* @__PURE__ */ React.createElement(Badge, { tone: "gold" }, "SOLD")
  };
  const [sel, setSel] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [reg, setReg] = React.useState("全部");
  const [statusF, setStatusF] = React.useState("全部状态");
  const [sortKey, setSortKey] = React.useState("bin");
  const [sortDir, setSortDir] = React.useState("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [dlg, setDlg] = React.useState(null);
  const [pending, setPending] = React.useState(null);
  React.useEffect(() => {
    setPage(1);
  }, [q, reg, statusF, pageSize]);
  const sfKey = STATUS_MAP[statusF];
  let rows = domains.filter((r) => (reg === "全部" || r.registrar === reg) && (sfKey == null || r.status === sfKey) && (q === "" || r.domain.includes(q.toLowerCase()) || r.tags.some((t) => t.includes(q))));
  rows = [...rows].sort((a, b) => {
    const m = sortDir === "asc" ? 1 : -1;
    const va = a[sortKey], vb = b[sortKey];
    if (va == null) return 1;
    if (vb == null) return -1;
    return va > vb ? m : -m;
  });
  const viewSum = rows.reduce((s, r) => s + (r.bin || 0), 0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const selDomains = domains.filter((d) => sel.includes(d.id)).map((d) => ({ id: d.id, domain: d.domain, bin: d.bin }));
  const patchSel = (patch) => {
    updateDomains((ds) => ds.map((d) => sel.includes(d.id) ? { ...d, ...patch } : d));
    addUnsynced(sel.length);
    setSel([]);
    setDlg(null);
  };
  const queueSel = () => {
    addUnsynced(sel.length);
    setSel([]);
    setDlg(null);
  };
  const savePending = () => {
    updateDomains((ds) => ds.map((d) => d.id === pending.row.id ? { ...d, bin: pending.newVal } : d));
    addUnsynced(1);
    setPending(null);
  };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "资产库", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(Ribbon, { onRenew }), /* @__PURE__ */ React.createElement(
    Toolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Input, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "筛选域名、标签…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 210 } }), /* @__PURE__ */ React.createElement(Select, { size: "sm", options: ["全部", "Spaceship", "Namecheap", "Dynadot"], value: reg, onChange: (e) => setReg(e.target.value) }), /* @__PURE__ */ React.createElement(Select, { size: "sm", options: Object.keys(STATUS_MAP), value: statusF, onChange: (e) => setStatusF(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Upload, { size: 14 }) }, "导入 CSV"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "primary", disabled: sel.length === 0, onClick: () => setDlg("price") }, "生成批量计划", sel.length > 0 ? ` · ${sel.length}` : ""))
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, position: "relative", display: "flex" } }, /* @__PURE__ */ React.createElement(
    Table,
    {
      density: "regular",
      selectable: true,
      selected: sel,
      onSelectionChange: setSel,
      onRowClick: (r) => onOpenDomain(r.id),
      sortKey,
      sortDir,
      onSort: (k, d) => {
        setSortKey(k);
        setSortDir(d);
      },
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", sortable: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.domain) },
        { key: "tags", label: "标签", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", gap: 4 } }, r.tags.map((t) => /* @__PURE__ */ React.createElement(Tag, { key: t, color: t.startsWith("portfolio") ? "var(--gd-blue)" : void 0 }, t))) },
        { key: "registrar", label: "注册商", muted: true },
        { key: "dns", label: "DNS", muted: true },
        { key: "platforms", label: "平台", muted: true },
        { key: "status", label: "状态", render: (r) => STATUS_BADGE[r.status] },
        { key: "bin", label: "BIN", numeric: true, sortable: true, render: (r) => /* @__PURE__ */ React.createElement(EditableCell, { value: r.bin, prefix: "$", display: /* @__PURE__ */ React.createElement(Money, { amount: r.bin }), onCommit: (v) => setPending({ row: r, newVal: anum(v) }) }) },
        { key: "expiry", label: "到期", numeric: true, muted: true, sortable: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: r.expiry < "2026-10-01" ? "var(--gd-warning)" : void 0 } }, r.expiry) }
      ],
      rows: pageRows,
      footer: /* @__PURE__ */ React.createElement(
        Pagination,
        {
          page: cur,
          pageSize,
          total: rows.length,
          onPage: setPage,
          onPageSize: setPageSize,
          note: /* @__PURE__ */ React.createElement(React.Fragment, null, "视图估值 ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "$", afmt(viewSum)))
        }
      )
    }
  ), sel.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 5 } }, /* @__PURE__ */ React.createElement(BatchBar, { count: sel.length, onClear: () => setSel([]), style: { pointerEvents: "auto" } }, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "primary", onClick: () => setDlg("price") }, "批量改价"), /* @__PURE__ */ React.createElement("span", { className: "gd-batchbar-sep" }), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => setDlg("ns") }, "变更 NS"), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => setDlg("records") }, "DNS 记录"), /* @__PURE__ */ React.createElement("span", { className: "gd-batchbar-sep" }), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => setDlg("list") }, "上架"), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => setDlg("delist") }, "下架")))), dlg === "price" && /* @__PURE__ */ React.createElement(BatchPriceDialog, { open: true, domains: selDomains, onClose: () => setDlg(null), onSubmit: (c) => {
    setDlg(null);
    onPlan(c);
  } }), dlg === "ns" && /* @__PURE__ */ React.createElement(BatchNsDialog, { open: true, domains: selDomains, onClose: () => setDlg(null), onApply: ({ applied }) => patchSel({ dns: nsProvider(applied) }) }), dlg === "records" && /* @__PURE__ */ React.createElement(BatchRecordsDialog, { open: true, domains: selDomains, onClose: () => setDlg(null), onApply: () => queueSel() }), dlg === "list" && /* @__PURE__ */ React.createElement(ListDialog, { open: true, domains: selDomains, onClose: () => setDlg(null), onApply: ({ platforms, price }) => patchSel(price != null ? { status: "synced", platforms: platforms.join(" · "), bin: price } : { status: "synced", platforms: platforms.join(" · ") }) }), /* @__PURE__ */ React.createElement(
    Dialog,
    {
      open: dlg === "delist",
      onClose: () => setDlg(null),
      title: `下架 · ${sel.length} 个域名`,
      width: 440,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, { onClick: () => setDlg(null) }, "取消"), /* @__PURE__ */ React.createElement(Button, { variant: "danger", onClick: () => patchSel({ status: "unlisted", platforms: "—" }) }, "下架 · ", sel.length, " 项"))
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "将 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, sel.length), " 个域名从当前销售平台下架。可安全重试；结果以平台 Listing 状态为准，写入未同步修改。")
  ), /* @__PURE__ */ React.createElement(
    Dialog,
    {
      open: !!pending,
      onClose: () => setPending(null),
      title: "保存并同步",
      width: 420,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, { onClick: () => setPending(null) }, "放弃"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: savePending }, "保存并同步"))
    },
    pending && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, pending.row.domain), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "BIN"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-faint)" } }, "$", afmt(pending.row.bin)), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "→"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-gold)" } }, "$", afmt(pending.newVal))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "保存写入未同步修改，将在下次同步时提交到销售平台；放弃则不改动。"))
  ));
}
window.GDAssetLibrary = AssetLibrary;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/AssetLibrary.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/BatchPreview.jsx
try { (() => {
const { Table, Badge, DiffValue, Button, KpiStat, Panel, Tabs, Dialog, ProgressBar, IconButton, Checkbox, Input, Select, Toolbar } = window.GoodDealerDesignSystem_b5b0b6;
const JOB_STATUS = { draft: { label: "计划中", tone: "warning" }, running: { label: "执行中", tone: "sync" }, done: { label: "已完成", tone: "success" }, partial: { label: "部分失败", tone: "danger" }, rolledback: { label: "已回滚", tone: null }, canceled: { label: "已取消", tone: null } };
const jobBadge = (s) => {
  const m = JOB_STATUS[s] || JOB_STATUS.draft;
  return /* @__PURE__ */ React.createElement(Badge, { tone: m.tone || void 0, mono: false }, m.label);
};
const riskBadge = (r) => r === "high" ? /* @__PURE__ */ React.createElement(Badge, { tone: "danger", mono: false }, "高风险") : r === "mid" ? /* @__PURE__ */ React.createElement(Badge, { tone: "warning", mono: false }, "中风险") : null;
function ResultChips({ res }) {
  if (!res) return /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 12 } }, "—");
  const items = [res.ok != null && ["success", res.ok], res.manual && ["warning", res.manual], res.retry && ["danger", res.retry], res.conflict && ["danger", res.conflict]].filter(Boolean);
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", gap: 12, alignItems: "center", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 12 } }, items.map(([tone, n], i) => /* @__PURE__ */ React.createElement("span", { key: i, style: { display: "inline-flex", alignItems: "center", gap: 5 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 6, height: 6, borderRadius: "50%", background: `var(--gd-${tone})` } }), n.toLocaleString())));
}
function ProgCell({ job }) {
  if (job.status === "draft") return /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-warning)" } }, "待确认");
  if (job.status === "rolledback") return /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-faint)" } }, "已回滚");
  const tone = job.status === "running" ? "sync" : job.status === "partial" ? "danger" : "success";
  const col = job.status === "running" ? "var(--gd-blue)" : "var(--gd-text-faint)";
  return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 8, width: "100%" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 60 } }, /* @__PURE__ */ React.createElement(ProgressBar, { segments: [{ value: job.progress, tone }], height: 5 })), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: col } }, job.progress, "%"));
}
function BatchList({ jobs, onOpen, onGoAssets }) {
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [q, setQ] = React.useState("");
  const [sf, setSf] = React.useState("全部状态");
  const SF = { "全部状态": null, "计划中": "draft", "执行中": "running", "已完成": "done", "部分失败": "partial", "已回滚": "rolledback" };
  const c = (s) => jobs.filter((j) => j.status === s).length;
  const key = SF[sf];
  const rows = jobs.filter((j) => (key == null || j.status === key) && (q === "" || j.name.includes(q) || j.rule.includes(q)));
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "批量任务", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: [
    { label: "执行中", value: c("running"), tone: c("running") ? "blue" : "muted", meta: c("running") ? "实时进度" : null },
    { label: "计划待确认", value: c("draft"), tone: c("draft") ? "warning" : "muted", meta: c("draft") ? "待确认执行" : null },
    { label: "今日完成", value: c("done"), tone: c("done") ? "success" : "muted" },
    { label: "部分失败", value: c("partial"), tone: c("partial") ? "danger" : "muted", meta: c("partial") ? "有失败项待处理" : null },
    { label: "已回滚", value: c("rolledback"), tone: "muted" }
  ] }), /* @__PURE__ */ React.createElement(
    Toolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Input, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索批次 / 规则…", value: q, onChange: (e) => setQ(e.target.value), style: { width: 220 } }), /* @__PURE__ */ React.createElement(Select, { size: "sm", options: Object.keys(SF), value: sf, onChange: (e) => setSf(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "primary", onClick: onGoAssets }, "去资产库新建")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement(
    Table,
    {
      density: "regular",
      rowKey: "id",
      onRowClick: (r) => onOpen(r.id),
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "name", label: "批次", render: (r) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-1)", fontWeight: 500 } }, r.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, r.rule)) },
        { key: "target", label: "目标", numeric: true, width: 76, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12 } }, r.target.toLocaleString()) },
        { key: "where", label: "平台 · 账户", render: (r) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12 } }, r.platform), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, r.account)) },
        { key: "created", label: "创建", width: 92, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, r.created) },
        { key: "status", label: "状态", width: 92, render: (r) => jobBadge(r.status) },
        { key: "progress", label: "进度", width: 150, render: (r) => /* @__PURE__ */ React.createElement(ProgCell, { job: r }) },
        { key: "result", label: "结果", render: (r) => r.status === "draft" ? /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-faint)" } }, "自动 ", r.auto, " · 人工 ", r.manual, " · 冲突 ", r.conflict) : /* @__PURE__ */ React.createElement(ResultChips, { res: r.result }) },
        { key: "risk", label: "风险", width: 72, render: (r) => riskBadge(r.risk) || /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 12 } }, "—") },
        { key: "act", label: "", width: 40, align: "right", render: () => /* @__PURE__ */ React.createElement(I.ChevronRight, { size: 14, style: { color: "var(--gd-text-faint)" } }) }
      ],
      rows,
      emptyText: "没有匹配的批量任务",
      footer: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "共 ", rows.length, " 个批次 · 点击行查看详情与执行 · 执行结果记入「操作历史」")
    }
  )));
}
function BatchDetail({ job, onBack, onGoInbox, onGoConflicts, onGoHistory }) {
  const I = window.GDI;
  const D = window.GD_DATA;
  const isDraft = job.status === "draft";
  const [tab, setTab] = React.useState("all");
  const [excluded, setExcluded] = React.useState([]);
  const [confirm, setConfirm] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [phase, setPhase] = React.useState(job.status === "draft" ? "plan" : job.status === "running" ? "run" : "done");
  const [prog, setProg] = React.useState(job.status === "running" ? job.progress : job.status === "draft" ? 0 : 100);
  const diffs = D.diffs.map((d) => excluded.includes(d.id) ? { ...d, state: "excluded" } : d);
  const counts = { all: diffs.length, auto: diffs.filter((d) => d.state === "auto").length, manual: diffs.filter((d) => d.state === "manual").length, conflict: diffs.filter((d) => d.state === "conflict").length, excluded: diffs.filter((d) => d.state === "excluded").length };
  const submitCount = (job.auto != null ? job.auto : 811) - excluded.length;
  const highRiskRows = diffs.filter((d) => String(d.risk).startsWith("高") && d.state !== "excluded");
  const highRiskCount = highRiskRows.length;
  const rows = tab === "all" ? diffs : diffs.filter((d) => d.state === tab);
  React.useEffect(() => {
    if (phase !== "run") return;
    const t = setInterval(() => setProg((p) => {
      if (p >= 100) {
        clearInterval(t);
        setPhase("done");
        return 100;
      }
      return p + 4;
    }), 120);
    return () => clearInterval(t);
  }, [phase]);
  const stateBadge = (s) => s === "auto" ? /* @__PURE__ */ React.createElement(Badge, { tone: "sync", mono: false }, "自动") : s === "manual" ? /* @__PURE__ */ React.createElement(Badge, { tone: "warning", mono: false }, "人工") : s === "conflict" ? /* @__PURE__ */ React.createElement(Badge, { tone: "danger", mono: false }, "冲突") : /* @__PURE__ */ React.createElement(Badge, { mono: false }, "已排除");
  const res = isDraft ? { ok: 789, waiting: 5, retry: 3, unknown: 2, manual: 12, failed: 0 } : job.result || { ok: 0 };
  const isRolled = job.status === "rolledback";
  const header = /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--gd-line)", flex: "none" } }, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.ChevronLeft, { size: 15 }), onClick: onBack }, "批量任务"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 15, fontWeight: 600 } }, job.name), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-faint)" } }, job.rule, " · ", job.target.toLocaleString(), " 个域名"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } }, riskBadge(job.risk), jobBadge(phase === "run" ? "running" : phase === "done" && isDraft ? res.retry || res.unknown ? "partial" : "done" : job.status)));
  const planBody = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Panel, null, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 } }, /* @__PURE__ */ React.createElement(KpiStat, { label: "目标域名", value: job.target, meta: "2 平台 · 3 账户" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "可自动执行", value: job.auto }), /* @__PURE__ */ React.createElement(KpiStat, { label: "需人工", value: job.manual, tone: "warning" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "高风险", value: highRiskCount, tone: "danger", meta: "Nameserver 变更" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "冲突", value: job.conflict, tone: "danger", meta: "同字段被远端修改" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "预计时长", value: "6 分", meta: "最大价格变化 −$3,000" }))), /* @__PURE__ */ React.createElement(Panel, { flush: true, title: "分组" }, /* @__PURE__ */ React.createElement("div", null, D.groups.map((g) => /* @__PURE__ */ React.createElement(
    "div",
    {
      key: g.id,
      style: { display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderBottom: "1px solid var(--gd-line)", fontSize: 13, cursor: "pointer" },
      onMouseEnter: (e) => e.currentTarget.style.background = "var(--gd-panel-raised)",
      onMouseLeave: (e) => e.currentTarget.style.background = "transparent"
    },
    /* @__PURE__ */ React.createElement("span", { style: { width: 110, fontWeight: 500, color: g.platform === "冲突" ? "var(--gd-danger)" : void 0 } }, g.platform),
    /* @__PURE__ */ React.createElement("span", { style: { width: 90, color: "var(--gd-text-muted)" } }, g.account),
    /* @__PURE__ */ React.createElement("span", { style: { flex: 1, display: "flex", alignItems: "center", gap: 8 } }, g.action, g.risk === "high" && /* @__PURE__ */ React.createElement(Badge, { tone: "danger", mono: false }, "高风险")),
    /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 12 } }, g.method),
    /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", width: 56, textAlign: "right" } }, g.count.toLocaleString()),
    /* @__PURE__ */ React.createElement(I.ChevronRight, { size: 13, style: { color: "var(--gd-text-faint)" } })
  )))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement(Tabs, { active: tab, onChange: setTab, items: [{ key: "all", label: "全部", count: counts.all }, { key: "auto", label: "可自动执行", count: counts.auto }, { key: "manual", label: "需人工", count: counts.manual }, { key: "conflict", label: "冲突", count: counts.conflict }, { key: "excluded", label: "已排除", count: counts.excluded }] }), /* @__PURE__ */ React.createElement(
    Table,
    {
      density: "compact",
      rowKey: "id",
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12 } }, r.domain) },
        { key: "field", label: "字段", muted: true, width: 92 },
        { key: "diff", label: "旧值 → 新值", render: (r) => /* @__PURE__ */ React.createElement(DiffValue, { oldValue: r.oldV, newValue: r.newV }) },
        { key: "src", label: "来源", muted: true },
        { key: "risk", label: "风险", render: (r) => String(r.risk).startsWith("高") ? /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-danger)", fontSize: 12, display: "inline-flex", alignItems: "center", gap: 4 } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 12 }), r.risk) : String(r.risk).startsWith("中") ? /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-warning)", fontSize: 12 } }, r.risk) : /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 12 } }, r.risk) },
        { key: "method", label: "执行", muted: true, width: 70 },
        { key: "state", label: "状态", render: (r) => stateBadge(r.state), width: 86 },
        { key: "act", label: "", width: 60, align: "right", render: (r) => r.state !== "excluded" ? /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: () => setExcluded((x) => [...x, r.id]) }, "排除") : /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: () => setExcluded((x) => x.filter((i) => i !== r.id)) }, "恢复") }
      ],
      rows,
      emptyText: "此分类下没有项目",
      footer: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "预览 ", rows.length, " / ", job.target, " 行 · 冲突项不会提交")
    }
  )), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, background: "var(--gd-panel-raised)", border: "1px solid var(--gd-line-strong)", borderRadius: 7, padding: "10px 14px", boxShadow: "var(--shadow-raised)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "将提交 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-blue)" } }, submitCount), " 项", highRiskCount > 0 && /* @__PURE__ */ React.createElement(React.Fragment, null, " · 含 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-danger)" } }, highRiskCount), " 项高风险"), " · 冲突 ", job.conflict, " 项已排除 · 人工 ", job.manual, " 项转收件箱"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(Button, { onClick: onBack }, "取消"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: () => setConfirm(true) }, "确认并开始执行"))));
  const runView = () => {
    const pct = Math.min(prog, 100), okN = Math.round(pct / 100 * 789), csvN = Math.round(pct / 100 * 12);
    return /* @__PURE__ */ React.createElement(Panel, { title: "正在执行", actions: /* @__PURE__ */ React.createElement(Badge, { tone: "sync" }, "RUNNING") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(ProgressBar, { segments: [{ value: pct, tone: "sync" }], height: 8 }), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 } }, /* @__PURE__ */ React.createElement(KpiStat, { label: "成功", value: okN, tone: "body" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "等待确认", value: 0, meta: "远端已接受" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "可安全重试", value: 0, tone: "danger" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "结果未知", value: 0, tone: "warning" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "人工处理", value: csvN }), /* @__PURE__ */ React.createElement(KpiStat, { label: "最终失败", value: 0 })), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, job.platform, " · API 限速 2 req/s · 预计剩余 ", Math.max(0, Math.round((100 - pct) * 2.4 / 10)), " 秒 · 可随时暂停")));
  };
  const doneView = () => {
    if (isRolled) return /* @__PURE__ */ React.createElement(Panel, { title: "批次已回滚", actions: /* @__PURE__ */ React.createElement(Badge, { mono: false }, "已回滚") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", background: "var(--gd-panel-raised)", borderRadius: 7, padding: "11px 13px", fontSize: 12, color: "var(--gd-text)", lineHeight: 1.5 } }, "此批次的 ", job.target, " 项修改已整体回滚至 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, "Revision ", job.rolledTo), "。回滚生成了新的 Revision，原修改在账本中保留可追溯。"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "primary", onClick: onGoHistory }, "在操作历史查看"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: onBack }, "返回批量任务"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-faint)", fontFamily: "var(--font-mono)" } }, job.op))));
    const T = job.target || 1, hasFail = (res.retry || 0) > 0 || (res.unknown || 0) > 0;
    return /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Panel, { title: "批次完成", actions: /* @__PURE__ */ React.createElement(Badge, { tone: hasFail ? "warning" : "success", mono: false }, hasFail ? "部分失败" : "已完成") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(ProgressBar, { segments: [{ value: (res.ok || 0) / T * 100, tone: "success" }, { value: (res.retry || 0) / T * 100, tone: "danger" }, { value: (res.manual || 0) / T * 100, tone: "warning" }], height: 8 }), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(6,1fr)", gap: 10 } }, /* @__PURE__ */ React.createElement(KpiStat, { label: "成功", value: res.ok || 0, tone: "body" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "等待确认", value: res.waiting || 0, meta: "远端已接受" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "可安全重试", value: res.retry || 0, tone: "danger" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "结果未知", value: res.unknown || 0, tone: "warning", meta: "只能确认" }), /* @__PURE__ */ React.createElement(KpiStat, { label: "人工处理", value: res.manual || 0 }), /* @__PURE__ */ React.createElement(KpiStat, { label: "最终失败", value: res.failed || 0 })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" } }, hasFail && /* @__PURE__ */ React.createElement(Button, { variant: "primary", size: "sm" }, "重试失败项 · ", res.retry || 0), (res.unknown || 0) > 0 && /* @__PURE__ */ React.createElement(Button, { size: "sm" }, "检查平台状态 · ", res.unknown), (res.manual || 0) > 0 && /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: onGoInbox }, "去人工任务 · ", res.manual), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: onBack }, "返回批量任务"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-faint)", fontFamily: "var(--font-mono)" } }, "审计已记录 · ", job.op || "OP-2026-0804-11")))), (res.manual || 0) > 0 && /* @__PURE__ */ React.createElement(Panel, { title: "人工任务已创建", actions: /* @__PURE__ */ React.createElement(Badge, { tone: "warning", mono: false }, res.manual, " 项") }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "CSV / 后台操作类修改已转「人工任务收件箱」等待处理。失败重试只选择 failed_retryable，不会重提成功项和结果未知项。")));
  };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "批量任务详情", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, header, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, overflow: "auto" } }, phase === "plan" ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 1080, margin: "0 auto", padding: 16, width: "100%" } }, planBody) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, maxWidth: 760, margin: "0 auto", padding: "24px 16px", width: "100%" } }, phase === "run" ? runView() : doneView())), /* @__PURE__ */ React.createElement(
    Dialog,
    {
      open: confirm,
      onClose: () => {
        setConfirm(false);
        setAck(false);
      },
      title: "最终确认 · 批量改价",
      width: highRiskCount > 0 ? 544 : 480,
      danger: highRiskCount > 0,
      footer: highRiskCount > 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, { onClick: () => {
        setConfirm(false);
        setAck(false);
      } }, "返回修改"), /* @__PURE__ */ React.createElement(Button, { onClick: () => {
        setConfirm(false);
        setAck(false);
        setPhase("run");
        setProg(0);
      } }, "仅提交常规 · ", submitCount - highRiskCount, " 项"), /* @__PURE__ */ React.createElement(Button, { variant: "danger", disabled: !ack, onClick: () => {
        setConfirm(false);
        setAck(false);
        setPhase("run");
        setProg(0);
      } }, "提交全部 · ", submitCount, " 项")) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, { onClick: () => setConfirm(false) }, "返回修改"), /* @__PURE__ */ React.createElement(Button, { variant: "primary", onClick: () => {
        setConfirm(false);
        setPhase("run");
        setProg(0);
      } }, "提交 ", submitCount, " 项修改"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", null, "向 ", /* @__PURE__ */ React.createElement("b", null, "Atom · 主账户"), " 提交 ", submitCount - 12, " 项 API 修改；为 ", /* @__PURE__ */ React.createElement("b", null, "Afternic"), " 生成 CSV 并创建 12 项人工任务。"), highRiskCount > 0 && /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-danger)", background: "var(--gd-danger-tint)", borderRadius: 7, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 15, style: { color: "var(--gd-danger)", flex: "none" } }), /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-danger)", fontSize: 13 } }, "高风险 · Nameserver 变更 · ", highRiskCount, " 个域名"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-muted)" } }, "可回滚")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text)", lineHeight: 1.5 } }, "变更后指向旧 DNS 的解析与邮件在传播完成前可能中断（约 5–30 分钟）。回滚到当前 Nameserver 同样需要传播时间。"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexWrap: "wrap", gap: 6 } }, highRiskRows.map((r) => /* @__PURE__ */ React.createElement("span", { key: r.id, style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-text)", background: "var(--gd-ink)", border: "1px solid var(--gd-line)", borderRadius: 4, padding: "2px 7px" } }, r.domain))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(229,115,95,0.24)", paddingTop: 9 } }, /* @__PURE__ */ React.createElement(Checkbox, { checked: ack, onChange: () => setAck((a) => !a), label: `我已理解后果，确认对这 ${highRiskCount} 个域名执行 Nameserver 变更` }))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "最大价格变化 −$3,000.00 · 预计执行 6 分钟 · 全程可暂停并接管"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "执行前基线 Revision 8,241 · 写入审计日志 · Afternic CSV 需人工上传"))
  ));
}
function BatchPreview({ focus, onConsumeFocus, onBack, onGoAssets, onGoInbox, onGoConflicts, onGoHistory }) {
  const jobs = window.GD_DATA.batchJobs;
  const [selId, setSelId] = React.useState(null);
  React.useEffect(() => {
    if (focus) {
      setSelId(focus === "draft" ? "b-draft" : focus);
      onConsumeFocus && onConsumeFocus();
    }
  }, [focus]);
  const job = selId ? jobs.find((j) => j.id === selId) : null;
  if (job) return /* @__PURE__ */ React.createElement(BatchDetail, { job, onBack: () => setSelId(null), onGoInbox, onGoConflicts, onGoHistory });
  return /* @__PURE__ */ React.createElement(BatchList, { jobs, onOpen: setSelId, onGoAssets });
}
window.GDBatchPreview = BatchPreview;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/BatchPreview.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/ConflictCenter.jsx
try { (() => {
const { Badge, Button, Panel, Tabs } = window.GoodDealerDesignSystem_b5b0b6;
function TriValue({ label, value, tone, chosen, onPick, pickable }) {
  return /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: 5, background: "var(--gd-ink)", border: `1px solid ${chosen ? "var(--gd-blue)" : "var(--gd-line)"}`, borderRadius: 5, padding: "8px 10px", cursor: pickable ? "pointer" : "default", transition: "border-color 120ms" }, onClick: pickable ? onPick : void 0 }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: tone || "var(--gd-text-faint)", fontWeight: 500 } }, label), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 13, color: "var(--gd-text)" } }, value));
}
function ConflictCenter() {
  const [tab, setTab] = React.useState("全部");
  const [resolved, setResolved] = React.useState({});
  const all = window.GD_DATA.conflicts;
  const tabs = ["全部", "价格", "DNS", "销售状态"];
  const list = all.filter((c) => tab === "全部" || c.group === tab);
  const openCount = all.filter((c) => !resolved[c.id]).length;
  const resolve = (id, how) => setResolved((r) => ({ ...r, [id]: how }));
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "冲突中心", style: { maxWidth: 920, margin: "0 auto", padding: 16, width: "100%", display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16, fontWeight: 600 } }, "冲突中心"), /* @__PURE__ */ React.createElement(Badge, { tone: openCount > 0 ? "danger" : "success", mono: false }, openCount > 0 ? `${openCount} 项待裁决` : "全部已裁决"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-faint)" } }, "DNS、Nameserver 和 Sold 状态不提供无预览的批量覆盖")), /* @__PURE__ */ React.createElement(Tabs, { active: tab, onChange: setTab, items: tabs.map((t) => ({ key: t, label: t, count: all.filter((c) => (t === "全部" || c.group === t) && !resolved[c.id]).length })) }), tab === "价格" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", null, "对同类冲突批量应用："), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => all.filter((c) => c.group === "价格").forEach((c) => resolve(c.id, "local")) }, "全部保留本地"), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => all.filter((c) => c.group === "价格").forEach((c) => resolve(c.id, "remote")) }, "全部接受平台")), list.map((c) => {
    const done = resolved[c.id];
    return /* @__PURE__ */ React.createElement(Panel, { key: c.id }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 10, opacity: done ? 0.55 : 1 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 13 } }, c.domain), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, c.field), /* @__PURE__ */ React.createElement(Badge, { mono: false }, c.group), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-faint)" } }, c.note)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(TriValue, { label: "编辑基线 Base", value: c.base }), /* @__PURE__ */ React.createElement(TriValue, { label: "本地目标 Local", value: c.local, tone: "var(--gd-blue)", chosen: done === "local", pickable: !done, onPick: () => resolve(c.id, "local") }), /* @__PURE__ */ React.createElement(TriValue, { label: "平台当前 Remote", value: c.remote, tone: "var(--gd-warning)", chosen: done === "remote", pickable: !done, onPick: () => resolve(c.id, "remote") })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center" } }, !done && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "primary", onClick: () => resolve(c.id, "local") }, "保留本地"), /* @__PURE__ */ React.createElement(Button, { size: "sm", onClick: () => resolve(c.id, "remote") }, "接受平台"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost" }, "编辑新值")), done && /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Badge, { tone: "success", mono: false }, done === "local" ? "已保留本地" : "已接受平台"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "ghost", onClick: () => setResolved((r) => {
      const n = { ...r };
      delete n[c.id];
      return n;
    }) }, "撤销")), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-faint)", fontFamily: "var(--font-mono)" } }, "Base rev 8,203"))));
  }));
}
window.GDConflictCenter = ConflictCenter;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/ConflictCenter.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/DnsVerify.jsx
try { (() => {
const { Table: VTable, Badge: VBadge, Button: VBtn, StatusDot: VDot, Select: VSel, Input: VInput, Toolbar: VToolbar, Tag: VTag, Dialog: VDlg } = window.GoodDealerDesignSystem_b5b0b6;
function vseed() {
  const t = (d) => "_atomverify=" + d.replace(/\W/g, "").slice(0, 4) + Math.floor(Math.random() * 90 + 10);
  const r = (id, domain, owner, ns, nsOk, records, provider, status, last) => ({ id, domain, owner, ns, nsOk, records, provider, status, last, token: t(domain) });
  return [
    r(1, "vault.io", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "14:02"),
    r(2, "kanban.ai", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "14:01"),
    r(3, "goldrail.com", "pending", "Cloudflare", true, "warn", "Cloudflare", "propagating", "13:40"),
    r(4, "quanta.trade", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "12:20"),
    r(5, "helio.systems", "failed", "ns.dynadot.com", false, "missing", "Dynadot", "warn", "07-30"),
    r(6, "crest.capital", "verified", "Cloudflare", true, "warn", "Cloudflare", "warn", "11:05"),
    r(7, "north.capital", "pending", "ns.spaceship.com", false, "ok", "Spaceship", "warn", "09-12"),
    r(8, "mint.money", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "14:00"),
    r(9, "forge.dev", "pending", "未知 NS", false, "missing", "—", "warn", "—"),
    r(10, "spark.trade", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "13:58")
  ];
}
const OWNER = { verified: { tone: "gold", label: "已验证" }, pending: { tone: "warning", label: "待验证" }, failed: { tone: "danger", label: "失效" } };
const REC = { ok: { tone: "success", label: "正常" }, warn: { tone: "warning", label: "告警" }, missing: { tone: "danger", label: "缺失" } };
const STAT = { ok: { dot: "success", label: "正常" }, propagating: { dot: "sync", label: "传播中" }, warn: { dot: "warning", label: "告警" } };
function DnsVerify({ addUnsynced }) {
  const I = window.GDI;
  const { BatchNsDialog, BatchRecordsDialog } = window.GDDialogs;
  const [rows, setRows] = React.useState(vseed);
  const [q, setQ] = React.useState("");
  const [ownerF, setOwnerF] = React.useState("全部");
  const [verifying, setVerifying] = React.useState({});
  const [dlg, setDlg] = React.useState(null);
  const [tokenFor, setTokenFor] = React.useState(null);
  const OWNERF = { 全部: null, 已验证: "verified", 待验证: "pending", 失效: "failed" };
  const view = rows.filter((r) => (OWNERF[ownerF] == null || r.owner === OWNERF[ownerF]) && (q === "" || r.domain.includes(q) || r.provider.includes(q)));
  const verified = rows.filter((r) => r.owner === "verified").length;
  const pending = rows.filter((r) => r.owner !== "verified").length;
  const nsBad = rows.filter((r) => !r.nsOk).length;
  const recBad = rows.filter((r) => r.records !== "ok").length;
  const propagating = rows.filter((r) => r.status === "propagating").length;
  const kpis = [["已验证所有权", String(verified), "gold"], ["待验证 / 失效", String(pending), "warning"], ["NS 指向异常", String(nsBad), "danger"], ["记录告警 / 缺失", String(recBad), "warning"], ["传播中", String(propagating), "blue"]];
  const kcolor = (t) => t === "gold" ? "var(--gd-gold)" : t === "warning" ? "var(--gd-warning)" : t === "danger" ? "var(--gd-danger)" : t === "blue" ? "var(--gd-blue)" : "var(--text-1)";
  const reverify = (r) => {
    setVerifying((v) => ({ ...v, [r.id]: true }));
    setTimeout(() => {
      setVerifying((v) => ({ ...v, [r.id]: false }));
      setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, owner: "verified", last: "现在" } : x));
    }, 1200);
  };
  const applyNs = (r) => {
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, ns: "Cloudflare", nsOk: true, provider: "Cloudflare", status: "propagating", last: "现在" } : x));
    addUnsynced && addUnsynced(1);
    setDlg(null);
  };
  const applyRec = (r) => {
    setRows((rs) => rs.map((x) => x.id === r.id ? { ...x, records: "ok", status: "propagating", last: "现在" } : x));
    addUnsynced && addUnsynced(1);
    setDlg(null);
  };
  const pendingCount = rows.filter((r) => r.owner === "pending").length;
  const reverifyAll = () => {
    const ids = rows.filter((r) => r.owner === "pending").map((r) => r.id);
    setVerifying((v) => {
      const n = { ...v };
      ids.forEach((i) => n[i] = true);
      return n;
    });
    setTimeout(() => {
      setVerifying({});
      setRows((rs) => rs.map((x) => ids.includes(x.id) ? { ...x, owner: "verified", last: "现在" } : x));
    }, 1400);
  };
  const actionCell = (r) => {
    if (verifying[r.id]) return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, color: "var(--gd-blue)", fontSize: 12, justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 12, style: { animation: "gd-spinner 1s linear infinite" } }), "验证中");
    if (r.owner !== "verified") return /* @__PURE__ */ React.createElement(VBtn, { size: "sm", onClick: () => reverify(r) }, "重新验证");
    if (!r.nsOk) return /* @__PURE__ */ React.createElement(VBtn, { size: "sm", onClick: () => setDlg({ type: "ns", row: r }) }, "改 NS");
    if (r.records !== "ok") return /* @__PURE__ */ React.createElement(VBtn, { size: "sm", onClick: () => setDlg({ type: "records", row: r }) }, "改记录");
    return /* @__PURE__ */ React.createElement(VBtn, { size: "sm", variant: "ghost", onClick: () => setTokenFor(r) }, "验证 TXT");
  };
  const MetricStrip = window.GDMetricStrip;
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "DNS 与验证", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: kpis.map((k) => ({ label: k[0], value: k[1], tone: k[2] })) }), /* @__PURE__ */ React.createElement(
    VToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(VInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索域名 / 提供商", value: q, onChange: (e) => setQ(e.target.value), style: { width: 210 } }), /* @__PURE__ */ React.createElement(VSel, { size: "sm", options: Object.keys(OWNERF), value: ownerF, onChange: (e) => setOwnerF(e.target.value) })),
      right: /* @__PURE__ */ React.createElement(VBtn, { size: "sm", variant: "primary", disabled: pendingCount === 0, onClick: reverifyAll, icon: /* @__PURE__ */ React.createElement(I.Shield, { size: 14 }) }, "重新验证待验证项", pendingCount ? ` · ${pendingCount}` : "")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 16px", borderBottom: "1px solid var(--gd-line)", background: "var(--gd-panel)", display: "flex", alignItems: "center", gap: 8, flex: "none", fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement(I.Shield, { size: 13, style: { color: "var(--gd-text-faint)", flex: "none" } }), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "Nameserver"), " 由注册商委派、", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "DNS 记录"), " 由 DNS 提供商下发；", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "所有权"), "经 DNS TXT ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text)" } }, "_atomverify"), " 校验。修复分别走对应处理平台。")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0 } }, /* @__PURE__ */ React.createElement(
    VTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.domain) },
        { key: "owner", label: "所有权", width: 96, render: (r) => /* @__PURE__ */ React.createElement(VBadge, { tone: OWNER[r.owner].tone, mono: false }, OWNER[r.owner].label) },
        { key: "ns", label: "Nameserver", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontFamily: "var(--font-mono)", fontSize: 12, color: r.nsOk ? "var(--gd-text-muted)" : "var(--gd-danger)" } }, !r.nsOk && /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 12 }), r.ns) },
        { key: "records", label: "记录", width: 84, render: (r) => /* @__PURE__ */ React.createElement(VBadge, { tone: REC[r.records].tone, mono: false }, REC[r.records].label) },
        { key: "provider", label: "DNS 提供商", muted: true, width: 112 },
        { key: "status", label: "状态", width: 100, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12 } }, /* @__PURE__ */ React.createElement(VDot, { kind: STAT[r.status].dot, pulse: r.status === "propagating" }), STAT[r.status].label) },
        { key: "last", label: "最后校验", numeric: true, muted: true, width: 92 },
        { key: "act", label: "", width: 118, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "flex", justifyContent: "flex-end" } }, actionCell(r)) }
      ],
      rows: view
    }
  )), dlg && dlg.type === "ns" && /* @__PURE__ */ React.createElement(BatchNsDialog, { open: true, domains: [{ id: dlg.row.id, domain: dlg.row.domain }], onClose: () => setDlg(null), onApply: () => applyNs(dlg.row) }), dlg && dlg.type === "records" && /* @__PURE__ */ React.createElement(BatchRecordsDialog, { open: true, domains: [{ id: dlg.row.id, domain: dlg.row.domain }], onClose: () => setDlg(null), onApply: () => applyRec(dlg.row) }), /* @__PURE__ */ React.createElement(
    VDlg,
    {
      open: !!tokenFor,
      onClose: () => setTokenFor(null),
      title: "所有权验证 · DNS TXT",
      width: 460,
      footer: /* @__PURE__ */ React.createElement(VBtn, { variant: "primary", onClick: () => setTokenFor(null) }, "完成")
    },
    tokenFor && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(VBadge, { tone: "gold" }, "OWNER VERIFIED"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, tokenFor.domain, " · 最后校验 ", tokenFor.last)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, "验证记录（DNS 提供商 · ", tokenFor.provider, "）"), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "64px 1fr", gap: 8, fontFamily: "var(--font-mono)", fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "类型"), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-blue)" } }, "TXT"), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "主机"), /* @__PURE__ */ React.createElement("span", null, "_atomverify"), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "值"), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text)", wordBreak: "break-all" } }, tokenFor.token))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "该 TXT 记录用于向平台证明域名所有权；本地密钥签发，删除会导致验证失效。"))
  ));
}
window.GDDnsVerify = DnsVerify;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/DnsVerify.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/DomainDetail.jsx
try { (() => {
const { Panel: DPanel, Badge: DBadge, Money: DMoney, Tag: DTag, Button: DBtn, Switch: DSwitch, StatusDot: DDot, Table: DTable, Dialog: DDlg } = window.GoodDealerDesignSystem_b5b0b6;
const dfmt = (n) => n == null ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dnum = (v) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
const nsProv = (a) => /Cloudflare/.test(a) ? "Cloudflare" : /销售平台/.test(a) ? "销售平台" : /注册商/.test(a) ? "注册商" : "自定义 NS";
function synth(d) {
  const yr = +d.expiry.slice(0, 4);
  const created = yr - 2 + d.expiry.slice(4);
  const nsMap = { "Cloudflare": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"], "注册商": ["ns1." + d.registrar.toLowerCase() + ".com", "ns2." + d.registrar.toLowerCase() + ".com"] };
  const ns = nsMap[d.dns] || ["ns1." + d.dns.toLowerCase() + ".com", "ns2." + d.dns.toLowerCase() + ".com"];
  const records = [
    { type: "A", host: "@", value: "185.199.108.153", ttl: "Auto" },
    { type: "CNAME", host: "www", value: d.domain, ttl: "Auto" },
    { type: "TXT", host: "_atomverify", value: "atom-verify=8f2a…", ttl: "3600" },
    { type: "MX", host: "@", value: "10 mail." + d.domain, ttl: "3600" }
  ];
  const plats = d.platforms === "—" ? [] : d.platforms.split(" · ");
  const listings = plats.map((p, i) => ({ platform: p, status: d.status === "sold" && i === 0 ? "sold" : d.status === "pending" ? "pending" : "active", price: d.bin, updated: i === 0 ? "14:02" : "07-28" }));
  const history = [
    { rev: "8,241", when: "今日 14:02", who: "批量改价 −8%", field: "BIN" },
    { rev: "8,180", when: "07-30 09:11", who: "同步 · Atom", field: "Listing" },
    { rev: "7,905", when: "07-14 16:40", who: "手动编辑", field: "标签" }
  ];
  return { created, ns, records, listings, history };
}
function KV({ k, children }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "8px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 96, flex: "none", color: "var(--gd-text-faint)", fontSize: 12 } }, k), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, display: "flex", alignItems: "center", gap: 8, justifyContent: "flex-end", textAlign: "right" } }, children));
}
function DomainDetail({ domain, onBack, updateDomains, addUnsynced }) {
  const I = window.GDI;
  const s = React.useMemo(() => synth(domain), [domain.id]);
  const [autoRenew, setAutoRenew] = React.useState(true);
  const [lock, setLock] = React.useState(true);
  const [dlg, setDlg] = React.useState(null);
  const [priceVal, setPriceVal] = React.useState("");
  const { BatchNsDialog, BatchRecordsDialog, ListDialog } = window.GDDialogs;
  const one = [{ id: domain.id, domain: domain.domain, bin: domain.bin }];
  const set = (patch) => {
    updateDomains((ds) => ds.map((x) => x.id === domain.id ? { ...x, ...patch } : x));
    addUnsynced(1);
  };
  const STATUS = { synced: /* @__PURE__ */ React.createElement(DBadge, { tone: "sync" }, "SYNCED"), pending: /* @__PURE__ */ React.createElement(DBadge, { tone: "warning", mono: false }, "等待平台"), conflict: /* @__PURE__ */ React.createElement(DBadge, { tone: "danger", mono: false }, "冲突"), unlisted: /* @__PURE__ */ React.createElement(DBadge, { mono: false }, "未上架"), sold: /* @__PURE__ */ React.createElement(DBadge, { tone: "gold" }, "SOLD") };
  const listed = domain.status !== "unlisted" && domain.status !== "sold";
  const soon = domain.expiry < "2026-10-01";
  const ribbon = [
    { l: "BIN 估值", v: /* @__PURE__ */ React.createElement(DMoney, { amount: domain.bin, size: 26 }) },
    { l: "当前状态", v: /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex" } }, STATUS[domain.status]) },
    { l: "到期", v: /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 16, color: soon ? "var(--gd-warning)" : "var(--text-1)" } }, domain.expiry) },
    { l: "活跃 Listing", v: /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 18 } }, s.listings.filter((x) => x.status === "active").length) }
  ];
  const lstBadge = (st) => st === "sold" ? /* @__PURE__ */ React.createElement(DBadge, { tone: "gold" }, "SOLD") : st === "pending" ? /* @__PURE__ */ React.createElement(DBadge, { tone: "warning", mono: false }, "等待") : /* @__PURE__ */ React.createElement(DBadge, { tone: "success", mono: false }, "在售");
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "域名详情", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0, overflow: "auto" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "14px 18px", borderBottom: "1px solid var(--gd-line)", flex: "none" } }, /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.ChevronLeft, { size: 15 }), onClick: onBack }, "资产库"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 20, color: "var(--text-1)" } }, domain.domain), STATUS[domain.status], /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", gap: 5 } }, domain.tags.map((t) => /* @__PURE__ */ React.createElement(DTag, { key: t, color: t.startsWith("portfolio") ? "var(--gd-blue)" : void 0 }, t))), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(DBtn, { size: "sm", onClick: () => {
    setPriceVal(domain.bin != null ? String(domain.bin) : "");
    setDlg("price");
  } }, "编辑价格"), listed ? /* @__PURE__ */ React.createElement(DBtn, { size: "sm", onClick: () => setDlg("delist") }, "下架") : /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "primary", onClick: () => setDlg("list") }, "上架"), /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "打开注册商"))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", background: "var(--surface-region)", borderBottom: "1px solid var(--gd-line)", flex: "none" } }, ribbon.map((r, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { flex: 1, padding: "12px 18px", borderRight: i < ribbon.length - 1 ? "1px solid var(--gd-line)" : "none", display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, r.l), r.v))), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)", gap: 14, padding: 16, alignItems: "start" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(DPanel, { title: "注册信息" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement(KV, { k: "注册商" }, domain.registrar), /* @__PURE__ */ React.createElement(KV, { k: "注册日期" }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-muted)" } }, s.created)), /* @__PURE__ */ React.createElement(KV, { k: "到期" }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: soon ? "var(--gd-warning)" : void 0 } }, domain.expiry)), /* @__PURE__ */ React.createElement(KV, { k: "自动续费" }, /* @__PURE__ */ React.createElement(DSwitch, { checked: autoRenew, onChange: () => {
    setAutoRenew((v) => !v);
    addUnsynced(1);
  } })), /* @__PURE__ */ React.createElement(KV, { k: "转移锁" }, /* @__PURE__ */ React.createElement(DSwitch, { checked: lock, onChange: () => {
    setLock((v) => !v);
    addUnsynced(1);
  } })), /* @__PURE__ */ React.createElement(KV, { k: "DNS 提供商" }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-muted)" } }, domain.dns)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "8px 0", fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 96, flex: "none", color: "var(--gd-text-faint)", fontSize: 12 } }, "Nameserver"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-muted)" } }, s.ns[0]), /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => setDlg("ns") }, "变更"))), /* @__PURE__ */ React.createElement("div", { style: { padding: "6px 0 0", fontSize: 11, color: "var(--gd-text-faint)" } }, "Nameserver 由注册商管理 · DNS 记录由 DNS 提供商下发"))), /* @__PURE__ */ React.createElement(DPanel, { title: "所有权验证", actions: /* @__PURE__ */ React.createElement(DBadge, { tone: "success", mono: false }, "已验证") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, alignItems: "flex-start" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "30", height: "30", alt: "", style: { opacity: 0.9, flex: "none", marginTop: 2 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, fontSize: 12, color: "var(--gd-text-muted)", lineHeight: 1.6 } }, "通过 DNS TXT ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text)" } }, "_atomverify"), " 验证所有权 · 最后验证 07-30 09:11。", /* @__PURE__ */ React.createElement("br", null), "本地密钥签发 License，凭据永不上云。")))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, minWidth: 0 } }, /* @__PURE__ */ React.createElement(DPanel, { flush: true, title: "销售 Listing", actions: listed ? /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => setDlg("price") }, "改价") : null }, s.listings.length > 0 ? /* @__PURE__ */ React.createElement(
    DTable,
    {
      density: "compact",
      rowKey: "platform",
      columns: [
        { key: "platform", label: "平台" },
        { key: "status", label: "状态", render: (r) => lstBadge(r.status) },
        { key: "price", label: "价格", numeric: true, render: (r) => /* @__PURE__ */ React.createElement(DMoney, { amount: r.price }) },
        { key: "updated", label: "更新", numeric: true, muted: true }
      ],
      rows: s.listings,
      style: { border: "none", borderRadius: 0 }
    }
  ) : /* @__PURE__ */ React.createElement("div", { style: { padding: "20px 14px", fontSize: 12, color: "var(--gd-text-faint)", display: "flex", alignItems: "center", gap: 10 } }, "未在任何平台上架 · ", /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "primary", onClick: () => setDlg("list") }, "上架"))), /* @__PURE__ */ React.createElement(DPanel, { flush: true, title: "DNS 记录", actions: /* @__PURE__ */ React.createElement(DBtn, { size: "sm", variant: "ghost", onClick: () => setDlg("records") }, "修改记录") }, /* @__PURE__ */ React.createElement(
    DTable,
    {
      density: "compact",
      rowKey: "host",
      columns: [
        { key: "type", label: "类型", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-blue)" } }, r.type), width: 64 },
        { key: "host", label: "主机", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12 } }, r.host) },
        { key: "value", label: "值", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-muted)" } }, r.value) },
        { key: "ttl", label: "TTL", numeric: true, muted: true, width: 64 }
      ],
      rows: s.records,
      style: { border: "none", borderRadius: 0 }
    }
  )), /* @__PURE__ */ React.createElement(DPanel, { flush: true, title: "操作历史" }, /* @__PURE__ */ React.createElement("div", null, s.history.map((h, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", alignItems: "center", gap: 12, padding: "9px 14px", borderBottom: i < s.history.length - 1 ? "1px solid var(--gd-line)" : "none", fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-faint)", width: 52 } }, "rev ", h.rev), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }, h.who), /* @__PURE__ */ React.createElement(DTag, null, h.field), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-faint)", width: 90, textAlign: "right" } }, h.when))))))), dlg === "ns" && /* @__PURE__ */ React.createElement(BatchNsDialog, { open: true, domains: one, onClose: () => setDlg(null), onApply: ({ applied }) => {
    set({ dns: nsProv(applied) });
    setDlg(null);
  } }), dlg === "records" && /* @__PURE__ */ React.createElement(BatchRecordsDialog, { open: true, domains: one, onClose: () => setDlg(null), onApply: () => {
    addUnsynced(1);
    setDlg(null);
  } }), dlg === "list" && /* @__PURE__ */ React.createElement(ListDialog, { open: true, domains: one, onClose: () => setDlg(null), onApply: ({ platforms, price }) => {
    set({ status: "synced", platforms: platforms.join(" · "), bin: price != null ? price : domain.bin });
    setDlg(null);
  } }), /* @__PURE__ */ React.createElement(
    DDlg,
    {
      open: dlg === "price",
      onClose: () => setDlg(null),
      title: `编辑价格 · ${domain.domain}`,
      width: 420,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DBtn, { onClick: () => setDlg(null) }, "取消"), /* @__PURE__ */ React.createElement(DBtn, { variant: "primary", onClick: () => {
        set({ bin: dnum(priceVal) });
        setDlg(null);
      } }, "保存并同步"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "当前 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-faint)" } }, "$", dfmt(domain.bin))), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "→"), /* @__PURE__ */ React.createElement(
      "input",
      {
        autoFocus: true,
        value: priceVal,
        onChange: (e) => setPriceVal(e.target.value),
        inputMode: "decimal",
        style: { width: 150, height: 30, background: "var(--gd-ink)", border: "1px solid var(--gd-blue)", boxShadow: "0 0 0 2px rgba(77,141,255,0.25)", borderRadius: 5, color: "var(--gd-text)", fontFamily: "var(--font-mono)", fontSize: 14, textAlign: "right", padding: "0 9px", outline: "none" }
      }
    )), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "保存后写入未同步修改，将在下次同步时提交到销售平台。"))
  ), /* @__PURE__ */ React.createElement(
    DDlg,
    {
      open: dlg === "delist",
      onClose: () => setDlg(null),
      title: `下架 · ${domain.domain}`,
      width: 420,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(DBtn, { onClick: () => setDlg(null) }, "取消"), /* @__PURE__ */ React.createElement(DBtn, { variant: "danger", onClick: () => {
        set({ status: "unlisted", platforms: "—" });
        setDlg(null);
      } }, "下架并从平台移除"))
    },
    /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "将 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, domain.domain), " 从当前销售平台下架。可安全重试；结果以平台 Listing 状态为准。")
  ));
}
window.GDDomainDetail = DomainDetail;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/DomainDetail.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/HistoryLog.jsx
try { (() => {
const { Table: HTable, Badge: HBadge, Button: HBtn, DiffValue: HDiff, Tag: HTag, Dialog: HDlg, Checkbox: HCheck, Select: HSel, Input: HInput, Panel: HPanel, Toolbar: HToolbar } = window.GoodDealerDesignSystem_b5b0b6;
const H_STATE = { applied: { tone: null, label: "本地" }, synced: { tone: "success", label: "已同步" }, rolled_back: { tone: "warning", label: "已回滚" }, pull: { tone: "sync", label: "云端拉取" }, device: { tone: "gold", label: "设备" } };
function hseed() {
  const d = (rev, ts, actor, scope, action, platform, count, state, risk, diffs) => ({ rev, ts, actor, scope, action, platform, count, state, risk, diffs });
  return [
    d("8,241", "今日 14:02", "MacBook Pro", "批量", "批量改价 −8%", "交易平台 · Atom", 799, "synced", false, [["vault.io", "BIN", "3,000.00", "2,760.00"], ["oxide.dev", "BIN", "5,800.00", "5,336.00"], ["arc.exchange", "BIN", "12,000.00", "11,040.00"]]),
    d("8,240", "今日 14:02", "MacBook Pro", "批量", "变更 Nameserver", "注册商 · Spaceship·Dynadot", 3, "synced", true, [["goldrail.com", "NS", "ns.spaceship.com", "cloudflare.com"], ["quanta.trade", "NS", "ns.dynadot.com", "cloudflare.com"]]),
    d("8,239", "今日 14:01", "MacBook Pro", "批量", "新增 TXT 记录", "DNS 提供商 · Cloudflare", 17, "synced", false, [["crest.capital", "TXT", "—", "_atom=8f2a…"], ["mint.money", "TXT", "—", "_atom=1c90…"]]),
    d("8,238", "今日 13:58", "MacBook Pro", "批量", "上架 · Atom", "交易平台 · Atom", 12, "synced", false, [["north.capital", "Listing", "未上架", "Atom · $8,900"]]),
    d("8,237", "昨日 18:22", "MacBook Pro", "单域", "手动改价", "交易平台 · Atom", 1, "applied", false, [["kanban.ai", "BIN", "45,000.00", "99,999.00"]]),
    d("8,231", "07-30 09:11", "云端同步", "同步", "拉取远端变更", "GoodDealer Cloud", 41, "pull", false, []),
    d("8,220", "07-28 11:03", "MacBook Pro", "批量", "下架", "交易平台 · Afternic", 6, "synced", false, [["legacy.io", "Listing", "Afternic", "已下架"]]),
    d("8,180", "07-14 16:40", "MacBook Pro", "单域", "编辑标签", "本地", 1, "applied", false, [["vault.io", "标签", "三字母", "三字母 · portfolio-a"]]),
    d("8,150", "07-02 08:15", "系统", "设备", "移交执行权 · Epoch 40→41", "设备门禁", 1, "device", false, []),
    d("8,102", "06-20 10:30", "MacBook Pro", "批量", "回滚 → rev 8,098", "交易平台 · Atom", 23, "rolled_back", false, [["misfire.co", "BIN", "900.00", "1,200.00"]])
  ];
}
function DetailPane({ e, onRollback }) {
  const I = window.GDI;
  if (!e) return /* @__PURE__ */ React.createElement("div", { style: { flex: "none", width: 344, borderLeft: "1px solid var(--gd-line)", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--gd-text-faint)", fontSize: 12 } }, "选择一条 Revision 查看明细");
  const st = H_STATE[e.state];
  const rollbackable = !["pull", "device", "rolled_back"].includes(e.state);
  const M = ({ k, children }) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, k), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: k === "Revision" || k === "Epoch" ? "var(--font-mono)" : void 0, color: "var(--gd-text-muted)", textAlign: "right" } }, children));
  return /* @__PURE__ */ React.createElement("div", { style: { flex: "none", width: 344, borderLeft: "1px solid var(--gd-line)", display: "flex", flexDirection: "column", minHeight: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { padding: "13px 15px", borderBottom: "1px solid var(--gd-line)", display: "flex", flexDirection: "column", gap: 8, flex: "none" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 15, color: "var(--text-1)" } }, "rev ", e.rev), /* @__PURE__ */ React.createElement(HBadge, { tone: st.tone, mono: false }, st.label), e.risk && /* @__PURE__ */ React.createElement(HBadge, { tone: "danger", mono: false }, "高风险")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-1)" } }, e.action)), /* @__PURE__ */ React.createElement("div", { style: { padding: "4px 15px", flex: "none" } }, /* @__PURE__ */ React.createElement(M, { k: "Revision" }, e.rev), /* @__PURE__ */ React.createElement(M, { k: "时间" }, e.ts), /* @__PURE__ */ React.createElement(M, { k: "来源" }, e.actor), /* @__PURE__ */ React.createElement(M, { k: "处理平台" }, e.platform), /* @__PURE__ */ React.createElement(M, { k: "影响条目" }, e.count, " 项")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, overflow: "auto", padding: "6px 15px" } }, e.diffs.length > 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "gd-t-label", style: { margin: "4px 0 8px" } }, "字段变更 · 示例 ", e.diffs.length, " / ", e.count), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, e.diffs.map((df, i) => /* @__PURE__ */ React.createElement("div", { key: i, style: { display: "flex", flexDirection: "column", gap: 3, paddingBottom: 9, borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, df[0], " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "· ", df[1])), /* @__PURE__ */ React.createElement(HDiff, { oldValue: df[2], newValue: df[3], size: 11 }))))) : /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-text-faint)", padding: "12px 0" } }, e.state === "pull" ? "同步拉取，无本地字段变更明细。" : e.state === "device" ? "设备门禁事件，见设置 · 设备与运行态。" : "无字段变更。")), /* @__PURE__ */ React.createElement("div", { style: { padding: "11px 15px", borderTop: "1px solid var(--gd-line)", display: "flex", gap: 8, flex: "none" } }, /* @__PURE__ */ React.createElement(HBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.FileText, { size: 13 }) }, "导出"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), rollbackable ? /* @__PURE__ */ React.createElement(HBtn, { size: "sm", variant: e.risk ? "danger" : "primary", onClick: () => onRollback(e), icon: /* @__PURE__ */ React.createElement(I.History, { size: 13 }) }, "回滚此 Revision") : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)", alignSelf: "center" } }, e.state === "rolled_back" ? "已回滚" : "不可回滚")));
}
function HistoryLog({ addUnsynced }) {
  const I = window.GDI;
  const [entries, setEntries] = React.useState(hseed);
  const [selRev, setSelRev] = React.useState("8,241");
  const [q, setQ] = React.useState("");
  const [typeF, setTypeF] = React.useState("全部类型");
  const [rb, setRb] = React.useState(null);
  const [ack, setAck] = React.useState(false);
  const TYPES = { 全部类型: null, 改价: "改价", DNS: "记录", NS: "Nameserver", 上架下架: "架", 同步: "拉取", 回滚: "回滚" };
  const rows = entries.filter((e) => (TYPES[typeF] == null || e.action.includes(TYPES[typeF])) && (q === "" || e.action.includes(q) || e.rev.includes(q) || e.platform.includes(q)));
  const sel = entries.find((e) => e.rev === selRev) || rows[0];
  const nextRev = () => {
    const top = parseInt(entries[0].rev.replace(/,/g, ""), 10) + 1;
    return top.toLocaleString("en-US");
  };
  const doRollback = () => {
    const t = rb;
    const nr = nextRev();
    setRb(null);
    setAck(false);
    setEntries((es) => [
      { rev: nr, ts: "现在", actor: "MacBook Pro", scope: t.scope, action: `回滚 → rev ${t.rev}`, platform: t.platform, count: t.count, state: "applied", risk: t.risk, diffs: t.diffs.map((d) => [d[0], d[1], d[3], d[2]]) },
      ...es.map((e) => e.rev === t.rev ? { ...e, state: "rolled_back" } : e)
    ]);
    setSelRev(nr);
    addUnsynced && addUnsynced(Math.min(t.count, 12));
  };
  const kpis = [["总 Revision", "8,241", null], ["今日变更", "4 批 · 831 项", null], ["待同步 Revision", "2", "blue"], ["已回滚", "1", "warning"]];
  const kcolor = (t) => t === "blue" ? "var(--gd-blue)" : t === "warning" ? "var(--gd-warning)" : "var(--text-1)";
  const MetricStrip = window.GDMetricStrip;
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "操作历史", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: kpis.map((k, i) => ({ label: k[0], value: k[1], tone: k[2], mono: k[0].includes("Revision") && i === 0 })) }), /* @__PURE__ */ React.createElement(
    HToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(HInput, { size: "sm", prefix: /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), placeholder: "搜索 Revision / 操作 / 平台", value: q, onChange: (e) => setQ(e.target.value), style: { width: 230 } }), /* @__PURE__ */ React.createElement(HSel, { size: "sm", options: Object.keys(TYPES), value: typeF, onChange: (e) => setTypeF(e.target.value) })),
      right: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-faint)", whiteSpace: "nowrap" } }, "只读账本 · 追加不可篡改 · 回滚生成新 Revision")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, display: "flex" } }, /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement(
    HTable,
    {
      density: "regular",
      rowKey: "rev",
      maxHeight: "100%",
      onRowClick: (r) => setSelRev(r.rev),
      style: { border: "none", borderRadius: 0 },
      columns: [
        { key: "rev", label: "Revision", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: r.rev === (sel && sel.rev) ? "var(--gd-blue)" : "var(--text-1)" } }, "rev ", r.rev), width: 96 },
        { key: "action", label: "操作", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 7 } }, r.action, r.risk && /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 12, style: { color: "var(--gd-danger)" } })) },
        { key: "platform", label: "处理平台", muted: true },
        { key: "actor", label: "来源", muted: true, width: 104 },
        { key: "count", label: "条目", numeric: true, width: 64, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, r.count) },
        { key: "state", label: "状态", width: 96, render: (r) => /* @__PURE__ */ React.createElement(HBadge, { tone: H_STATE[r.state].tone, mono: false }, H_STATE[r.state].label) },
        { key: "ts", label: "时间", numeric: true, muted: true, width: 104 }
      ],
      rows
    }
  )), /* @__PURE__ */ React.createElement(DetailPane, { e: sel, onRollback: (e) => {
    setRb(e);
    setAck(false);
  } })), /* @__PURE__ */ React.createElement(
    HDlg,
    {
      open: !!rb,
      onClose: () => {
        setRb(null);
        setAck(false);
      },
      title: `回滚 Revision ${rb && rb.rev}`,
      width: rb && rb.risk ? 528 : 460,
      danger: rb && rb.risk,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(HBtn, { onClick: () => {
        setRb(null);
        setAck(false);
      } }, "取消"), /* @__PURE__ */ React.createElement(HBtn, { variant: rb && rb.risk ? "danger" : "primary", disabled: rb && rb.risk && !ack, onClick: doRollback }, "生成回滚 Revision · ", rb && rb.count, " 项"))
    },
    rb && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "回滚 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, "rev ", rb.rev), "（", rb.action, "）。将生成新 Revision ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, nextRev()), " 反向应用其 ", rb.count, " 项变更并自动同步云端——", /* @__PURE__ */ React.createElement("b", null, "历史不会被删除"), "，原 Revision 标记为已回滚。"), rb.risk && /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-danger)", background: "var(--gd-danger-tint)", borderRadius: 7, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 15, style: { color: "var(--gd-danger)", flex: "none" } }), /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-danger)", fontSize: 13 } }, "高风险 · 含 Nameserver 变更"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-muted)" } }, "可回滚")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text)", lineHeight: 1.5 } }, "回滚会将 Nameserver 改回原值，解析与邮件在传播完成前可能中断（约 5–30 分钟）。"), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(229,115,95,0.24)", paddingTop: 9 } }, /* @__PURE__ */ React.createElement(HCheck, { checked: ack, onChange: () => setAck((a) => !a), label: `我已理解后果，确认回滚这 ${rb.count} 项` }))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "回滚生成的新 Revision 将自动同步至云端。"))
  ));
}
window.GDHistoryLog = HistoryLog;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/HistoryLog.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/Onboarding.jsx
try { (() => {
const { Button: OBtn, Input: OInput, Badge: OBadge, ProgressBar: OProg, StatusDot: ODot } = window.GoodDealerDesignSystem_b5b0b6;
const STEPS = [["welcome", "欢迎"], ["device", "设备门禁"], ["connect", "连接账户"], ["import", "首次导入"], ["done", "完成"]];
function Stepper({ idx }) {
  return /* @__PURE__ */ React.createElement("div", { style: { width: 180, flex: "none", borderRight: "1px solid var(--gd-line)", background: "var(--gd-panel)", padding: "20px 16px", display: "flex", flexDirection: "column", gap: 3 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, marginBottom: 18, padding: "0 4px" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark-16.svg", width: "18", height: "18", alt: "" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 600, letterSpacing: "-0.01em", color: "var(--text-1)" } }, "GoodDealer")), STEPS.map(([k, l], i) => {
    const st = i < idx ? "done" : i === idx ? "cur" : "up";
    return /* @__PURE__ */ React.createElement("div", { key: k, style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 4px", fontSize: 13, color: st === "up" ? "var(--text-3)" : "var(--text-1)" } }, /* @__PURE__ */ React.createElement("span", { style: {
      width: 20,
      height: 20,
      flex: "none",
      borderRadius: "50%",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      border: st === "cur" ? "1px solid var(--gd-gold)" : "1px solid var(--gd-line-strong)",
      background: st === "done" ? "var(--gd-gold)" : "transparent",
      color: st === "done" ? "#0A0B0F" : st === "cur" ? "var(--gd-gold)" : "var(--text-3)"
    } }, st === "done" ? /* @__PURE__ */ React.createElement(window.GDI.Check, { size: 12 }) : i + 1), l);
  }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", fontSize: 10, color: "var(--gd-text-faint)", lineHeight: 1.6, padding: "0 4px" } }, "本地执行 · 云端同步", /* @__PURE__ */ React.createElement("br", null), "凭据经本地密钥加密，永不上云"));
}
const Field = ({ label, children }) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, label), children);
function ConnCard({ name, meta, connected, onToggle }) {
  return /* @__PURE__ */ React.createElement("button", { onClick: onToggle, style: {
    textAlign: "left",
    display: "flex",
    alignItems: "center",
    gap: 11,
    padding: "11px 13px",
    borderRadius: 7,
    cursor: "pointer",
    width: "100%",
    border: `1px solid ${connected ? "var(--gd-success)" : "var(--gd-line-strong)"}`,
    background: connected ? "rgba(92,174,125,0.08)" : "var(--gd-panel)",
    transition: "all 120ms"
  } }, /* @__PURE__ */ React.createElement(ODot, { kind: connected ? "success" : "neutral" }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--text-1)" } }, name), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--gd-text-faint)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, meta)), connected ? /* @__PURE__ */ React.createElement(OBadge, { tone: "success", mono: false }, "已连接") : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-blue)" } }, "连接"));
}
function Onboarding({ onFinish, onSkip, startIdx = 0 }) {
  const I = window.GDI;
  const [idx, setIdx] = React.useState(startIdx);
  const [dev, setDev] = React.useState("MacBook Pro");
  const [activating, setActivating] = React.useState(false);
  const [activated, setActivated] = React.useState(false);
  const [conns, setConns] = React.useState({});
  const [importing, setImporting] = React.useState(false);
  const [pct, setPct] = React.useState(0);
  const [imported, setImported] = React.useState(false);
  const toggle = (k) => setConns((c) => ({ ...c, [k]: !c[k] }));
  const connectedCount = Object.values(conns).filter(Boolean).length;
  const activate = () => {
    setActivating(true);
    setTimeout(() => {
      setActivating(false);
      setActivated(true);
    }, 1300);
  };
  const runImport = () => {
    setImporting(true);
    setPct(0);
    const t = setInterval(() => setPct((p) => {
      if (p >= 100) {
        clearInterval(t);
        setImporting(false);
        setImported(true);
        return 100;
      }
      return p + 4;
    }), 40);
  };
  const PROVIDERS = {
    registrar: [["Spaceship", "主注册商 · OAuth"], ["Namecheap", "OAuth"], ["Dynadot", "API Key"]],
    dns: [["Cloudflare", "API Token"]],
    platform: [["Atom", "OAuth · API"], ["Afternic", "CSV · 人工"]]
  };
  const foot = (back, next, nextLabel, nextDisabled, nextVariant) => /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", display: "flex", alignItems: "center", gap: 10, paddingTop: 16 } }, back != null ? /* @__PURE__ */ React.createElement(OBtn, { variant: "ghost", onClick: back }, "返回") : /* @__PURE__ */ React.createElement(OBtn, { variant: "ghost", onClick: onSkip }, "跳过接入"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-text-faint)" } }, idx + 1, " / ", STEPS.length), /* @__PURE__ */ React.createElement(OBtn, { variant: nextVariant || "primary", disabled: nextDisabled, onClick: next }, nextLabel));
  const panes = [
    // 0 welcome
    /* @__PURE__ */ React.createElement("div", { key: "w", style: { display: "flex", flexDirection: "column", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 16, margin: "auto 0", textAlign: "center", paddingTop: 12 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark.svg", width: "76", height: "76", alt: "" }), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 22, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-1)" } }, "GoodDealer"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 14, color: "var(--gd-text-muted)", marginTop: 6 } }, "本地执行 · 云端同步的域名资产终端")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, marginTop: 8 } }, [["私人银行级掌控", "批量差异预览 · 精确到项的确认"], ["硬件钱包式门禁", "执行权绑定单台 Active 设备"], ["可回滚审计", "每次变更皆为 Revision"]].map((v) => /* @__PURE__ */ React.createElement("div", { key: v[0], style: { width: 150, padding: "12px 13px", border: "1px solid var(--gd-line)", borderRadius: 8, background: "var(--gd-panel)", display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, fontWeight: 500, color: "var(--text-1)" } }, v[0]), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)", lineHeight: 1.5 } }, v[1]))))), foot(null, () => setIdx(1), "开始接入", false)),
    // 1 device
    /* @__PURE__ */ React.createElement("div", { key: "d", style: { display: "flex", flexDirection: "column", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 17, fontWeight: 600, color: "var(--text-1)" } }, "设备门禁"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-text-muted)", marginTop: 4 } }, "将此设备设为", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-gold)", fontWeight: 500 } }, "执行设备（Active）"), "。本机生成设备密钥，Cloud 校验后签发 ActiveDeviceLease；同一时刻仅一台设备可执行写操作。")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 14, alignItems: "flex-start", padding: "16px", border: "1px solid var(--gd-line)", borderRadius: 9, background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "40", height: "40", alt: "", style: { flex: "none", opacity: activated ? 1 : 0.8 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement(Field, { label: "设备名称" }, /* @__PURE__ */ React.createElement(OInput, { size: "md", value: dev, onChange: (e) => setDev(e.target.value), disabled: activating || activated, style: { maxWidth: 280 } })), !activated ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(OBtn, { variant: "primary", disabled: activating || !dev, onClick: activate, icon: activating ? /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 14, style: { animation: "gd-spinner 1s linear infinite" } }) : /* @__PURE__ */ React.createElement(I.Shield, { size: 14 }) }, activating ? "正在安全激活…" : "生成本地密钥并激活"), activating && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-blue)" } }, "校验设备指纹 · 等待 Cloud 签发 Lease")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(ODot, { kind: "active" }), /* @__PURE__ */ React.createElement(OBadge, { tone: "gold" }, "ACTIVE"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "Cloud 已签发 ActiveDeviceLease · ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-gold)" } }, "Epoch 1"))))), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)", lineHeight: 1.6 } }, "密钥仅存于本设备安全区，永不上云。日后可在设置 · 设备与运行态中移交执行权到其它设备。")), foot(() => setIdx(0), () => setIdx(2), "继续", !activated)),
    // 2 connect
    /* @__PURE__ */ React.createElement("div", { key: "c", style: { display: "flex", flexDirection: "column", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 17, fontWeight: 600, color: "var(--text-1)" } }, "连接账户"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-text-muted)", marginTop: 4 } }, "连接注册商、DNS 与交易平台，至少一项。凭据经本地密钥加密保存。")), [["注册商 · Nameserver 处理平台", "registrar"], ["DNS 提供商 · 记录处理平台", "dns"], ["交易平台 · 改价上下架处理平台", "platform"]].map(([t, g]) => /* @__PURE__ */ React.createElement("div", { key: g, style: { display: "flex", flexDirection: "column", gap: 7 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, t), /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 8 } }, PROVIDERS[g].map(([n, m]) => /* @__PURE__ */ React.createElement(ConnCard, { key: n, name: n, meta: m, connected: !!conns[g + ":" + n], onToggle: () => toggle(g + ":" + n) })))))), foot(() => setIdx(1), () => setIdx(3), connectedCount > 0 ? `继续 · 已连接 ${connectedCount}` : "继续", connectedCount === 0)),
    // 3 import
    /* @__PURE__ */ React.createElement("div", { key: "i", style: { display: "flex", flexDirection: "column", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16, marginTop: 6 } }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 17, fontWeight: 600, color: "var(--text-1)" } }, "首次导入"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-text-muted)", marginTop: 4 } }, "从已连接的 ", connectedCount, " 个账户拉取域名、Listing 与 DNS 状态，建立本地基线 Revision。")), !imported ? /* @__PURE__ */ React.createElement("div", { style: { padding: "18px", border: "1px solid var(--gd-line)", borderRadius: 9, background: "var(--gd-panel)", display: "flex", flexDirection: "column", gap: 14 } }, importing || pct > 0 ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(OProg, { segments: [{ value: pct, tone: "sync" }], height: 8 }), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-muted)" } }, pct, "% · 正在拉取域名与 Listing…")) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 16, style: { color: "var(--gd-text-muted)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--gd-text-muted)" } }, "准备导入 · 预计 823 域名"), /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement(OBtn, { variant: "primary", onClick: runImport }, "开始导入"))) : /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "repeat(4,1fr)", gap: 10 } }, [["域名", "823", null], ["Listing", "692", null], ["冲突", "6", "danger"], ["基线", "rev 1", "gold"]].map((k) => /* @__PURE__ */ React.createElement("div", { key: k[0], style: { padding: "14px", border: "1px solid var(--gd-line)", borderRadius: 8, background: "var(--gd-panel)", display: "flex", flexDirection: "column", gap: 5 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label" }, k[0]), /* @__PURE__ */ React.createElement("span", { className: "gd-t-metric-sm", style: { color: k[2] === "danger" ? "var(--gd-danger)" : k[2] === "gold" ? "var(--gd-gold)" : "var(--text-1)", fontFamily: k[0] === "基线" ? "var(--font-mono)" : void 0 } }, k[1])))), imported && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "导入完成 · 6 项字段冲突已标记，可在冲突中心人工裁决。")), foot(() => setIdx(2), () => setIdx(4), "继续", !imported)),
    // 4 done
    /* @__PURE__ */ React.createElement("div", { key: "f", style: { display: "flex", flexDirection: "column", height: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, margin: "auto 0", textAlign: "center" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 60, height: 60, borderRadius: "50%", background: "rgba(92,174,125,0.14)", border: "1px solid var(--gd-success)", display: "inline-flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(I.Check, { size: 30, style: { color: "var(--gd-success)" } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 19, fontWeight: 600, color: "var(--text-1)" } }, "接入完成"), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--gd-text-muted)", marginTop: 6 } }, dev, " 已激活为执行设备 · 823 域名已导入 · 基线 rev 1")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, alignItems: "center", fontSize: 12, color: "var(--gd-text-faint)" } }, /* @__PURE__ */ React.createElement(ODot, { kind: "active" }), "Active · Epoch 1", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-line-strong)" } }, "·"), /* @__PURE__ */ React.createElement(ODot, { kind: "sync" }), "云端同步就绪")), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", display: "flex", paddingTop: 16 } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1 } }), /* @__PURE__ */ React.createElement(OBtn, { variant: "primary", onClick: () => onFinish ? onFinish() : setIdx(0) }, "进入 GoodDealer")))
  ];
  return /* @__PURE__ */ React.createElement("div", { style: { width: "100%", height: "100%", display: "flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 860, height: 560, maxWidth: "100%", maxHeight: "100%", display: "flex", background: "var(--surface-app)", border: "1px solid var(--gd-line-strong)", borderRadius: "var(--radius-lg)", boxShadow: "var(--shadow-overlay)", overflow: "hidden" } }, /* @__PURE__ */ React.createElement(Stepper, { idx }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, padding: "22px 26px", display: "flex", flexDirection: "column" } }, panes[idx])));
}
window.GDOnboarding = Onboarding;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/Onboarding.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/RenewDesk.jsx
try { (() => {
const { Table: RTable, Badge: RBadge, Button: RBtn, Select: RSel, Money: RMoney, Switch: RSwitch, Toolbar: RToolbar, Dialog: RDlg, BatchBar: RBatch } = window.GoodDealerDesignSystem_b5b0b6;
const TLD = { io: 32, com: 11, ai: 75, dev: 14, money: 33, trade: 28, systems: 30, capital: 30, finance: 35, exchange: 42, co: 28, net: 13 };
const priceOf = (d) => {
  const t = d.split(".").pop();
  return TLD[t] || 20;
};
const BUDGET = 312;
const TODAY = /* @__PURE__ */ new Date("2026-08-03");
const daysTo = (s) => Math.round((new Date(s) - TODAY) / 864e5);
const rmoney = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function rseed() {
  const r = (id, domain, registrar, expiry, auto) => ({ id, domain, registrar, expiry, auto });
  return [
    r(1, "vault.io", "Spaceship", "2026-08-10", false),
    r(2, "arc.exchange", "Spaceship", "2026-08-14", false),
    r(3, "kanban.ai", "Namecheap", "2026-08-19", false),
    r(4, "quanta.trade", "Dynadot", "2026-08-25", true),
    r(5, "helio.systems", "Dynadot", "2026-09-01", false),
    r(6, "crest.capital", "Spaceship", "2026-09-05", false),
    r(7, "mint.money", "Spaceship", "2026-09-12", true),
    r(8, "north.capital", "Spaceship", "2026-09-18", false),
    r(9, "forge.dev", "Namecheap", "2026-09-22", false),
    r(10, "spark.trade", "Dynadot", "2026-09-28", false),
    r(11, "oxide.dev", "Namecheap", "2026-09-30", true),
    r(12, "goldrail.com", "Spaceship", "2026-10-01", false)
  ];
}
function RenewDesk({ onBack, addUnsynced }) {
  const I = window.GDI;
  const [rows, setRows] = React.useState(rseed);
  const [sel, setSel] = React.useState([]);
  const [term, setTerm] = React.useState({});
  const [uniform, setUniform] = React.useState("1");
  const [confirm, setConfirm] = React.useState(false);
  const yearsOf = (id) => +(term[id] || uniform);
  const active = rows.filter((r) => !r.renewed);
  const selRows = active.filter((r) => sel.includes(r.id));
  const lineCost = (r) => priceOf(r.domain) * yearsOf(r.id);
  const selTotal = selRows.reduce((s, r) => s + lineCost(r), 0);
  const autoCovered = active.filter((r) => r.auto).length;
  const over = selTotal > BUDGET;
  const setAuto = (id, v) => setRows((rs) => rs.map((x) => x.id === id ? { ...x, auto: v } : x));
  const doRenew = () => {
    const ids = [...sel];
    setConfirm(false);
    setRows((rs) => rs.map((x) => ids.includes(x.id) ? { ...x, renewed: true } : x));
    setSel([]);
    addUnsynced && addUnsynced(ids.length);
  };
  const applyUniform = () => {
    setTerm((t) => {
      const n = { ...t };
      sel.forEach((id) => n[id] = uniform);
      return n;
    });
  };
  const expColor = (d) => {
    const dd = daysTo(d);
    return dd < 14 ? "var(--gd-danger)" : dd < 30 ? "var(--gd-warning)" : "var(--text-1)";
  };
  const kpis = [["到期域名", String(active.length), null], ["续费预算", "$" + rmoney(BUDGET), "gold"], ["已选续费额", "$" + rmoney(selTotal), over ? "danger" : "gold"], ["预算余量", "$" + rmoney(BUDGET - selTotal), over ? "danger" : null], ["自动续费覆盖", `${autoCovered} / ${active.length}`, "blue"]];
  const kcolor = (t) => t === "gold" ? "var(--gd-gold)" : t === "danger" ? "var(--gd-danger)" : t === "blue" ? "var(--gd-blue)" : "var(--text-1)";
  const MetricStrip = window.GDMetricStrip;
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "续费", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: kpis.map((k) => ({ label: k[0], value: k[1], tone: k[2] })) }), /* @__PURE__ */ React.createElement(
    RToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(RBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.ChevronLeft, { size: 15 }), onClick: onBack }, "资产库"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)", whiteSpace: "nowrap" } }, "60 天内到期 · 按到期升序 · 续费为注册商操作")),
      right: /* @__PURE__ */ React.createElement(RBtn, { size: "sm", variant: "primary", disabled: sel.length === 0, onClick: () => setConfirm(true) }, "续费所选", sel.length ? ` · ${sel.length}` : "")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, position: "relative", display: "flex" } }, /* @__PURE__ */ React.createElement(
    RTable,
    {
      density: "regular",
      selectable: true,
      selected: sel,
      onSelectionChange: setSel,
      rowKey: "id",
      maxHeight: "100%",
      style: { flex: 1, minHeight: 0, border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: r.renewed ? "var(--gd-text-faint)" : "var(--text-1)" } }, r.domain) },
        { key: "expiry", label: "到期", numeric: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: r.renewed ? "var(--gd-text-faint)" : expColor(r.expiry) } }, r.expiry), width: 108 },
        { key: "days", label: "剩余", numeric: true, width: 64, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-muted)" } }, daysTo(r.expiry), "d") },
        { key: "registrar", label: "注册商", muted: true, width: 104 },
        { key: "auto", label: "自动续费", width: 88, render: (r) => r.renewed ? /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 12 } }, "—") : /* @__PURE__ */ React.createElement(RSwitch, { checked: r.auto, onChange: () => setAuto(r.id, !r.auto) }) },
        { key: "term", label: "续费年限", width: 112, render: (r) => r.renewed ? /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 12 } }, "—") : /* @__PURE__ */ React.createElement(RSel, { size: "sm", options: ["1", "2", "3"], value: String(yearsOf(r.id)), onChange: (e) => setTerm((t) => ({ ...t, [r.id]: e.target.value })) }) },
        { key: "price", label: "单价/年", numeric: true, width: 90, render: (r) => /* @__PURE__ */ React.createElement(RMoney, { amount: priceOf(r.domain), tone: "body" }) },
        { key: "subtotal", label: "小计", numeric: true, width: 104, render: (r) => r.renewed ? /* @__PURE__ */ React.createElement(RBadge, { tone: "success", mono: false }, "已续费") : /* @__PURE__ */ React.createElement(RMoney, { amount: lineCost(r) }) }
      ],
      rows
    }
  ), sel.length > 0 && /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", bottom: 14, left: 0, right: 0, display: "flex", justifyContent: "center", pointerEvents: "none", zIndex: 5 } }, /* @__PURE__ */ React.createElement(RBatch, { count: sel.length, onClear: () => setSel([]), style: { pointerEvents: "auto" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, color: "var(--gd-text-muted)" } }, "统一年限", /* @__PURE__ */ React.createElement(RSel, { size: "sm", options: ["1", "2", "3"], value: uniform, onChange: (e) => setUniform(e.target.value) })), /* @__PURE__ */ React.createElement(RBtn, { size: "sm", onClick: applyUniform }, "应用到所选"), /* @__PURE__ */ React.createElement("span", { className: "gd-batchbar-sep" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, whiteSpace: "nowrap" } }, "合计 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)", color: over ? "var(--gd-danger)" : "var(--gd-gold)" } }, "$", rmoney(selTotal))), /* @__PURE__ */ React.createElement(RBtn, { size: "sm", variant: "primary", onClick: () => setConfirm(true) }, "续费")))), /* @__PURE__ */ React.createElement(
    RDlg,
    {
      open: confirm,
      onClose: () => setConfirm(false),
      title: `续费 · ${sel.length} 个域名`,
      width: 470,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(RBtn, { onClick: () => setConfirm(false) }, "取消"), /* @__PURE__ */ React.createElement(RBtn, { variant: "primary", onClick: doRenew }, "确认续费 · $", rmoney(selTotal)))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "向各注册商提交 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, sel.length), " 个域名的续费，按所选年限扣费。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7, fontSize: 13 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-muted)" } }, "续费总额"), /* @__PURE__ */ React.createElement(RMoney, { amount: selTotal, size: 15 })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-muted)" } }, "续费预算"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-muted)" } }, "$", rmoney(BUDGET))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--gd-line)", paddingTop: 7 } }, /* @__PURE__ */ React.createElement("span", null, "预算余量"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: over ? "var(--gd-danger)" : "var(--gd-success)" } }, over ? "−" : "", "$", rmoney(Math.abs(BUDGET - selTotal))))), over && /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-warning)", background: "var(--gd-warning-tint)", borderRadius: 7, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gd-text)" } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 14, style: { color: "var(--gd-warning)", flex: "none" } }), "超出续费预算 $", rmoney(selTotal - BUDGET), "，仍可继续。"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "续费为可安全重试操作，将进入同步中心 Outbox 提交至注册商。"))
  ));
}
window.GDRenewDesk = RenewDesk;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/RenewDesk.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/SalesDesk.jsx
try { (() => {
const { Tabs: LTabs, Table: LTable, Badge: LBadge, Money: LMoney, Button: LBtn, Input: LInput, Dialog: LDlg, Checkbox: LCheck, ProgressBar: LProg, Tag: LTag, Toolbar: LToolbar } = window.GoodDealerDesignSystem_b5b0b6;
const FEE = { Atom: 0.1, Afternic: 0.15, SellerHub: 0.12 };
const lnum = (v) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
const money = (n) => Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
function lseed() {
  return {
    listings: [
      { id: 1, domain: "vault.io", platforms: "Atom · Afternic", bin: 28e4, views: 1240, offers: 3, status: "active", listed: "06-02" },
      { id: 2, domain: "kanban.ai", platforms: "Atom", bin: 99999, views: 860, offers: 1, status: "active", listed: "07-14" },
      { id: 3, domain: "quanta.trade", platforms: "Atom · SellerHub", bin: 42e3, views: 410, offers: 1, status: "active", listed: "05-20" },
      { id: 4, domain: "helio.systems", platforms: "Afternic", bin: 18500, views: 96, offers: 0, status: "paused", listed: "04-11" },
      { id: 5, domain: "mint.money", platforms: "Atom", bin: 65e3, views: 520, offers: 0, status: "active", listed: "07-28" },
      { id: 6, domain: "forge.dev", platforms: "—", bin: 12e3, views: 0, offers: 0, status: "draft", listed: "—" }
    ],
    offers: [
      { id: "f1", domain: "vault.io", buyer: "buyer·7Q2", offer: 212e3, bin: 28e4, platform: "Atom", state: "pending", age: "2 小时前" },
      { id: "f2", domain: "kanban.ai", buyer: "buyer·A19", offer: 88e3, bin: 99999, platform: "Atom", state: "pending", age: "今日 09:40" },
      { id: "f3", domain: "quanta.trade", buyer: "buyer·M53", offer: 31e3, bin: 42e3, platform: "SellerHub", state: "countered", age: "昨日", ask: 37e3 },
      { id: "f4", domain: "vault.io", buyer: "buyer·K08", offer: 15e4, bin: 28e4, platform: "Afternic", state: "declined", age: "07-30" },
      { id: "f5", domain: "mint.money", buyer: "buyer·33F", offer: 64e3, bin: 65e3, platform: "Atom", state: "pending", age: "30 分钟前" }
    ],
    deals: [
      { id: "d1", domain: "oxide.dev", amount: 52e3, platform: "Atom", buyer: "buyer·55A", stage: "transfer_pending" },
      { id: "d2", domain: "arc.exchange", amount: 33e3, platform: "Afternic", buyer: "buyer·9C1", stage: "escrow" },
      { id: "d3", domain: "north.capital", amount: 21500, platform: "Atom", buyer: "buyer·B7X", stage: "transferred" },
      { id: "d4", domain: "legacy.io", amount: 14200, platform: "Atom", buyer: "buyer·2D0", stage: "paid" }
    ]
  };
}
const OFFER_STATE = { pending: { tone: "warning", label: "待回应" }, countered: { tone: "sync", label: "已还价" }, accepted: { tone: "gold", label: "已接受" }, declined: { tone: null, label: "已拒绝" }, expired: { tone: null, label: "已过期" } };
const STAGE = [["escrow", "托管中", 0.25, "warning"], ["transfer_pending", "待推送转移", 0.5, "sync"], ["transferred", "已过户·待放款", 0.75, "sync"], ["paid", "已放款·完成", 1, "success"]];
const stageOf = (k) => STAGE.find((s) => s[0] === k);
function SalesDesk({ addUnsynced }) {
  const I = window.GDI;
  const [d, setD] = React.useState(lseed);
  const [tab, setTab] = React.useState("offers");
  const [accept, setAccept] = React.useState(null);
  const [ackA, setAckA] = React.useState(false);
  const [counter, setCounter] = React.useState(null);
  const [cVal, setCVal] = React.useState("");
  const [xfer, setXfer] = React.useState(null);
  const [ackX, setAckX] = React.useState(false);
  const pendingOffers = d.offers.filter((o) => o.state === "pending").length;
  const listedValue = d.listings.filter((l) => l.status === "active").reduce((s, l) => s + l.bin, 0);
  const monthGmv = d.deals.reduce((s, x) => s + x.amount, 0);
  const settling = d.deals.filter((x) => x.stage !== "paid").length;
  const kpis = [["在售 Listing", String(d.listings.filter((l) => l.status === "active").length), null], ["挂牌估值", "$" + money(listedValue), "gold"], ["待处理报价", String(pendingOffers), "warning"], ["成交额（本月）", "$" + money(monthGmv), "gold"], ["交割中", String(settling), "blue"]];
  const kcolor = (t) => t === "gold" ? "var(--gd-gold)" : t === "warning" ? "var(--gd-warning)" : t === "blue" ? "var(--gd-blue)" : "var(--text-1)";
  const feeOf = (o) => FEE[o.platform] ?? 0.12;
  const netOf = (o) => Math.round(o.offer * (1 - feeOf(o)));
  const doAccept = () => {
    const o = accept;
    setAccept(null);
    setAckA(false);
    setD((s) => ({ ...s, offers: s.offers.map((x) => x.id === o.id ? { ...x, state: "accepted" } : x), deals: [{ id: "d" + Date.now(), domain: o.domain, amount: o.offer, platform: o.platform, buyer: o.buyer, stage: "escrow" }, ...s.deals] }));
    setTab("deals");
  };
  const doCounter = () => {
    const o = counter;
    const v = lnum(cVal);
    setCounter(null);
    setCVal("");
    if (!v) return;
    setD((s) => ({ ...s, offers: s.offers.map((x) => x.id === o.id ? { ...x, state: "countered", ask: v } : x) }));
  };
  const decline = (o) => setD((s) => ({ ...s, offers: s.offers.map((x) => x.id === o.id ? { ...x, state: "declined" } : x) }));
  const doXfer = () => {
    const x = xfer;
    setXfer(null);
    setAckX(false);
    setD((s) => ({ ...s, deals: s.deals.map((y) => y.id === x.id ? { ...y, stage: "transferred" } : y) }));
    addUnsynced && addUnsynced(1);
  };
  const listingsTab = /* @__PURE__ */ React.createElement(
    LTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.domain) },
        { key: "platforms", label: "平台", muted: true },
        { key: "bin", label: "BIN", numeric: true, render: (r) => /* @__PURE__ */ React.createElement(LMoney, { amount: r.bin }) },
        { key: "views", label: "浏览", numeric: true, muted: true, width: 72, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, r.views.toLocaleString()) },
        { key: "offers", label: "询价", numeric: true, width: 64, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: r.offers ? "var(--gd-blue)" : "var(--gd-text-faint)" } }, r.offers) },
        { key: "status", label: "状态", width: 88, render: (r) => /* @__PURE__ */ React.createElement(LBadge, { tone: r.status === "active" ? "success" : r.status === "paused" ? "warning" : void 0, mono: false }, r.status === "active" ? "在售" : r.status === "paused" ? "暂停" : "草稿") },
        { key: "listed", label: "上架", numeric: true, muted: true, width: 80 },
        { key: "act", label: "", width: 150, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "flex", gap: 6, justifyContent: "flex-end" } }, r.status === "draft" ? /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "primary" }, "上架") : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost" }, "改价"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost" }, r.status === "paused" ? "恢复" : "暂停"))) }
      ],
      rows: d.listings
    }
  );
  const offersTab = /* @__PURE__ */ React.createElement(
    LTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.domain) },
        { key: "buyer", label: "买家", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-muted)" } }, r.buyer), width: 104 },
        { key: "offer", label: "报价", numeric: true, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", flexDirection: "column", alignItems: "flex-end" } }, /* @__PURE__ */ React.createElement(LMoney, { amount: r.offer, tone: "body" }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--gd-text-faint)", fontFamily: "var(--font-mono)" } }, "BIN ", money(r.bin), " · ", Math.round((r.offer / r.bin - 1) * 100), "%")) },
        { key: "ask", label: "我方还价", numeric: true, width: 104, render: (r) => r.ask ? /* @__PURE__ */ React.createElement(LMoney, { amount: r.ask, tone: "body" }) : /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "—") },
        { key: "platform", label: "平台", muted: true, width: 88 },
        { key: "state", label: "状态", width: 88, render: (r) => /* @__PURE__ */ React.createElement(LBadge, { tone: OFFER_STATE[r.state].tone, mono: false }, OFFER_STATE[r.state].label) },
        { key: "age", label: "时间", numeric: true, muted: true, width: 92 },
        { key: "act", label: "", width: 184, render: (r) => ["pending", "countered"].includes(r.state) ? /* @__PURE__ */ React.createElement("span", { style: { display: "flex", gap: 6, justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "primary", onClick: () => {
          setAccept(r);
          setAckA(false);
        } }, "接受"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", onClick: () => {
          setCounter(r);
          setCVal(String(r.ask || Math.round((r.offer + r.bin) / 2)));
        } }, "还价"), /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost", onClick: () => decline(r) }, "拒绝")) : /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, r.state === "accepted" ? "已转成交" : "—") }
      ],
      rows: d.offers
    }
  );
  const dealsTab = /* @__PURE__ */ React.createElement(
    LTable,
    {
      density: "regular",
      rowKey: "id",
      maxHeight: "100%",
      style: { border: "none", borderRadius: 0 },
      columns: [
        { key: "domain", label: "域名", render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-1)" } }, r.domain) },
        { key: "amount", label: "成交额", numeric: true, render: (r) => /* @__PURE__ */ React.createElement(LMoney, { amount: r.amount }) },
        { key: "net", label: "净收入", numeric: true, width: 120, render: (r) => /* @__PURE__ */ React.createElement(LMoney, { amount: Math.round(r.amount * (1 - (FEE[r.platform] ?? 0.12))) }) },
        { key: "platform", label: "平台", muted: true, width: 84 },
        { key: "buyer", label: "买家", muted: true, width: 96, render: (r) => /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12 } }, r.buyer) },
        { key: "stage", label: "交割进度", width: 190, render: (r) => {
          const st = stageOf(r.stage);
          return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 4 } }, /* @__PURE__ */ React.createElement(LBadge, { tone: r.stage === "paid" ? "gold" : st[3], mono: false }, st[1]), /* @__PURE__ */ React.createElement(LProg, { segments: [{ value: st[2] * 100, tone: st[3] }], height: 4 }));
        } },
        { key: "act", label: "", width: 132, render: (r) => r.stage === "transfer_pending" ? /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "primary", onClick: () => {
          setXfer(r);
          setAckX(false);
        }, icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "推送转移") : r.stage === "escrow" ? /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "待买家付款") : r.stage === "transferred" ? /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "ghost" }, "确认放款") : /* @__PURE__ */ React.createElement(LBadge, { tone: "gold" }, "SOLD") }
      ],
      rows: d.deals
    }
  );
  const MetricStrip = window.GDMetricStrip;
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "销售管理", style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement(MetricStrip, { metrics: kpis.map((k) => ({ label: k[0], value: k[1], tone: k[2] })) }), /* @__PURE__ */ React.createElement(
    LToolbar,
    {
      region: true,
      left: /* @__PURE__ */ React.createElement(LTabs, { active: tab, onChange: setTab, items: [{ key: "listings", label: "在售 Listing", count: d.listings.filter((l) => l.status === "active").length }, { key: "offers", label: "报价 · 议价", count: pendingOffers }, { key: "deals", label: "成交与交割", count: settling }], style: { border: "none" } }),
      right: /* @__PURE__ */ React.createElement(LBtn, { size: "sm", variant: "primary", icon: /* @__PURE__ */ React.createElement(I.Upload, { size: 14 }) }, "新建 Listing")
    }
  ), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0 } }, tab === "listings" ? listingsTab : tab === "offers" ? offersTab : dealsTab), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: !!accept,
      onClose: () => {
        setAccept(null);
        setAckA(false);
      },
      title: "接受报价 · 生成托管交易",
      width: 464,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { onClick: () => {
        setAccept(null);
        setAckA(false);
      } }, "取消"), /* @__PURE__ */ React.createElement(LBtn, { variant: "primary", disabled: !ackA, onClick: doAccept }, "接受 · 净 $", accept && money(netOf(accept))))
    },
    accept && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "接受 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, accept.buyer), " 对 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, accept.domain), " 的报价。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "11px 13px", display: "flex", flexDirection: "column", gap: 7, fontSize: 13 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-muted)" } }, "报价"), /* @__PURE__ */ React.createElement(LMoney, { amount: accept.offer })), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-muted)" } }, accept.platform, " 平台费 ", Math.round(feeOf(accept) * 100), "%"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-danger)" } }, "−$", money(Math.round(accept.offer * feeOf(accept))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "space-between", borderTop: "1px solid var(--gd-line)", paddingTop: 7 } }, /* @__PURE__ */ React.createElement("span", null, "预计净收入"), /* @__PURE__ */ React.createElement(LMoney, { amount: netOf(accept), size: 15 }))), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--gd-line)", paddingTop: 10 } }, /* @__PURE__ */ React.createElement(LCheck, { checked: ackA, onChange: () => setAckA((a) => !a), label: "我确认接受此报价；接受即生成托管交易，具约束力" })))
  ), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: !!counter,
      onClose: () => {
        setCounter(null);
        setCVal("");
      },
      title: "还价 · Counter",
      width: 420,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { onClick: () => {
        setCounter(null);
        setCVal("");
      } }, "取消"), /* @__PURE__ */ React.createElement(LBtn, { variant: "primary", onClick: doCounter }, "发送还价"))
    },
    counter && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, counter.domain), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "买家 $", money(counter.offer), " · BIN $", money(counter.bin))), /* @__PURE__ */ React.createElement(LInput, { label: "我方还价", size: "md", mono: true, prefix: "$", value: cVal, onChange: (e) => setCVal(e.target.value), style: { width: 200 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "还价通过平台发送给买家，等待其回应；不改变 Listing BIN。"))
  ), /* @__PURE__ */ React.createElement(
    LDlg,
    {
      open: !!xfer,
      onClose: () => {
        setXfer(null);
        setAckX(false);
      },
      title: "推送域名转移 · 交割",
      width: 484,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(LBtn, { onClick: () => {
        setXfer(null);
        setAckX(false);
      } }, "取消"), /* @__PURE__ */ React.createElement(LBtn, { variant: "danger", disabled: !ackX, onClick: doXfer }, "推送转移到买家"))
    },
    xfer && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "将 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, xfer.domain), " 转移至买家 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, xfer.buyer), "（成交额 $", money(xfer.amount), "）。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-danger)", background: "var(--gd-danger-tint)", borderRadius: 7, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 15, style: { color: "var(--gd-danger)", flex: "none" } }), /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-danger)", fontSize: 13 } }, "不可逆 · 所有权转移"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-muted)" } }, "由注册商执行")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text)", lineHeight: 1.5 } }, "推送后在注册商发起转移授权码，所有权移交买家，不可撤销。请确认已收到托管放款条件满足。"), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(229,115,95,0.24)", paddingTop: 9 } }, /* @__PURE__ */ React.createElement(LCheck, { checked: ackX, onChange: () => setAckX((a) => !a), label: "我确认托管条件满足，推送不可逆的所有权转移" }))))
  ));
}
window.GDSalesDesk = SalesDesk;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/SalesDesk.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/SettingsPanel.jsx
try { (() => {
const { Panel: PPanel, Switch: PSwitch, Button: PBtn, Badge: PBadge, StatusDot: PDot, Select: PSel, Tag: PTag, Dialog: PDlg, Checkbox: PCheck } = window.GoodDealerDesignSystem_b5b0b6;
const SECTIONS = [["conn", "连接"], ["device", "设备与运行态"], ["license", "许可"], ["sync", "同步偏好"], ["about", "关于"]];
const KV = ({ k, children, muted }) => /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "9px 0", borderBottom: "1px solid var(--gd-line)", fontSize: 13 } }, /* @__PURE__ */ React.createElement("span", { style: { width: 120, flex: "none", color: "var(--gd-text-faint)", fontSize: 12 } }, k), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 8, textAlign: "right", color: muted ? "var(--gd-text-muted)" : void 0 } }, children));
function ConnRow({ name, kind, meta, method, last, onFix }) {
  const dot = { ok: "success", warn: "warning", off: "neutral" }[kind];
  const label = { ok: "已连接", warn: "需重新授权", off: "未连接" }[kind];
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, padding: "11px 14px", borderBottom: "1px solid var(--gd-line)" } }, /* @__PURE__ */ React.createElement(PDot, { kind: dot }), /* @__PURE__ */ React.createElement("span", { style: { width: 126, fontSize: 13, color: "var(--text-1)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, name), /* @__PURE__ */ React.createElement("span", { style: { width: 88, flex: "none" } }, /* @__PURE__ */ React.createElement(PBadge, { tone: kind === "ok" ? "success" : kind === "warn" ? "warning" : void 0, mono: false }, label)), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--gd-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, meta), method && /* @__PURE__ */ React.createElement(PTag, null, method), /* @__PURE__ */ React.createElement("span", { style: { width: 104, flex: "none", textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-text-faint)", whiteSpace: "nowrap" } }, last), /* @__PURE__ */ React.createElement("span", { style: { width: 92, flex: "none", display: "flex", justifyContent: "flex-end" } }, kind === "off" ? /* @__PURE__ */ React.createElement(PBtn, { size: "sm", variant: "primary" }, "连接") : kind === "warn" ? /* @__PURE__ */ React.createElement(PBtn, { size: "sm" }, "重新授权") : /* @__PURE__ */ React.createElement(PBtn, { size: "sm", variant: "ghost" }, "管理")));
}
function DeviceRow({ d, onHandoff }) {
  const map = {
    active: { dot: "active", badge: /* @__PURE__ */ React.createElement(PBadge, { tone: "gold" }, "ACTIVE"), meta: "持有 ActiveDeviceLease · 执行权在此设备" },
    standby: { dot: "standby", badge: /* @__PURE__ */ React.createElement(PBadge, { mono: false }, "Standby"), meta: "待命 · 可申请移交执行权" },
    activating: { dot: "sync", badge: /* @__PURE__ */ React.createElement(PBadge, { tone: "sync", mono: false }, "正在安全激活"), meta: "校验中 · 等待服务端签发新 Lease" },
    draining: { dot: "warning", badge: /* @__PURE__ */ React.createElement(PBadge, { tone: "warning", mono: false }, "排空中"), meta: "提交未同步项后释放执行权" },
    sunset: { dot: "neutral", badge: /* @__PURE__ */ React.createElement(PTag, null, "RETAINED"), meta: "Sunset · LocalContinuation 本地只读延续 · 无执行权" }
  }[d.state];
  const dim = d.state === "sunset";
  const busy = d.state === "activating" || d.state === "draining";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 13, padding: "13px 14px", borderBottom: "1px solid var(--gd-line)", opacity: dim ? 0.55 : 1, background: d.state === "active" ? "linear-gradient(90deg,rgba(212,164,55,0.04),transparent 40%)" : "transparent" } }, /* @__PURE__ */ React.createElement(window.GDI.Monitor, { size: 17, style: { color: d.state === "active" ? "var(--gd-gold)" : "var(--gd-text-muted)", flex: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { width: 158, flex: "none", display: "flex", flexDirection: "column", gap: 3, minWidth: 0 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, color: "var(--text-1)", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" } }, d.name, d.self && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--gd-text-faint)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 5px", lineHeight: "15px", flex: "none" } }, "本机")), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement(PDot, { kind: map.dot, pulse: busy }), map.badge, d.state === "active" && /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "Epoch ", d.epoch))), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, minWidth: 0, fontSize: 12, color: "var(--gd-text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, map.meta), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-text-faint)", width: 80, flex: "none", textAlign: "right", whiteSpace: "nowrap" } }, d.last), /* @__PURE__ */ React.createElement("span", { style: { width: 108, flex: "none", display: "flex", justifyContent: "flex-end" } }, d.state === "standby" && /* @__PURE__ */ React.createElement(PBtn, { size: "sm", onClick: () => onHandoff(d) }, "移交执行权"), d.state === "sunset" && /* @__PURE__ */ React.createElement(PBtn, { size: "sm", variant: "ghost" }, "移除"), busy && /* @__PURE__ */ React.createElement(window.GDI.RefreshCw, { size: 14, style: { color: "var(--gd-text-muted)", animation: "gd-spinner 1s linear infinite" } })));
}
function Settings({ activeDevice, onSetActive, onRunOnboarding }) {
  const I = window.GDI;
  const [sec, setSec] = React.useState("device");
  const [devices, setDevices] = React.useState(() => [
    { id: "mac", name: "MacBook Pro", self: true, state: "active", epoch: activeDevice.epoch, last: "现在" },
    { id: "iph", name: "iPhone 17", self: false, state: "standby", last: "08:30" },
    { id: "air", name: "MacBook Air (2019)", self: false, state: "sunset", last: "06-12" }
  ]);
  const [handoff, setHandoff] = React.useState(null);
  const [ack, setAck] = React.useState(false);
  const [readonly, setReadonly] = React.useState(true);
  const runHandoff = () => {
    const to = handoff;
    setHandoff(null);
    setAck(false);
    const nextEpoch = (devices.find((d) => d.state === "active").epoch || 41) + 1;
    setDevices((ds) => ds.map((d) => d.state === "active" ? { ...d, state: "draining" } : d.id === to.id ? { ...d, state: "activating" } : d));
    setTimeout(() => {
      setDevices((ds) => ds.map((d) => d.state === "draining" ? { ...d, state: "standby", last: "现在" } : d.id === to.id ? { ...d, state: "active", epoch: nextEpoch, self: false, last: "现在" } : d));
      onSetActive({ name: to.name, epoch: nextEpoch });
    }, 1500);
  };
  const conns = {
    registrar: [["Spaceship", "ok", "812 域名 · 主注册商", "", "14:02"], ["Namecheap", "ok", "142 域名", "", "13:58"], ["Dynadot", "warn", "69 域名 · Token 过期", "", "—"]],
    dns: [["Cloudflare", "ok", "601 区域 · A/CNAME/TXT/MX", "", "14:02"]],
    platform: [["Atom", "ok", "511 Listing", "API", "14:01"], ["Afternic", "ok", "601 Listing · 需 CSV 人工", "CSV", "07-28"], ["SellerHub", "off", "未连接", "", "—"]]
  };
  const content = {
    conn: /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(PPanel, { flush: true, title: "注册商", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "Nameserver 变更处理平台") }, conns.registrar.map((c) => /* @__PURE__ */ React.createElement(ConnRow, { key: c[0], name: c[0], kind: c[1], meta: c[2], method: c[3], last: c[4] }))), /* @__PURE__ */ React.createElement(PPanel, { flush: true, title: "DNS 提供商", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "DNS 记录处理平台") }, conns.dns.map((c) => /* @__PURE__ */ React.createElement(ConnRow, { key: c[0], name: c[0], kind: c[1], meta: c[2], method: c[3], last: c[4] }))), /* @__PURE__ */ React.createElement(PPanel, { flush: true, title: "交易平台", actions: /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "改价 / 上下架处理平台") }, conns.platform.map((c) => /* @__PURE__ */ React.createElement(ConnRow, { key: c[0], name: c[0], kind: c[1], meta: c[2], method: c[3], last: c[4] }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9, paddingTop: 2 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "凭据经本地密钥加密保存，永不上云。断开仅移除本地授权，不影响平台侧数据。"), onRunOnboarding && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement(PBtn, { size: "sm", onClick: onRunOnboarding }, "重新运行接入向导"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "设备门禁 · 连接 · 首次导入")))),
    device: /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(PPanel, { flush: true, title: "设备与执行权（ActiveDeviceLease）", actions: /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-gold)" } }, "Epoch ", devices.find((d) => d.state === "active" || d.state === "draining")?.epoch || activeDevice.epoch) }, devices.map((d) => /* @__PURE__ */ React.createElement(DeviceRow, { key: d.id, d, onHandoff: setHandoff }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 12, padding: "11px 14px", border: "1px solid var(--gd-line)", borderRadius: 7, background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/active-lease.svg", width: "26", height: "26", alt: "", style: { flex: "none", marginTop: 1 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)", lineHeight: 1.6 } }, "同一时刻只有一台设备持有执行权（", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-gold)", fontWeight: 500 } }, "金实心 = Active"), "，蓝空心 = Standby）。移交时旧设备", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "排空"), "未同步项后释放，新设备", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "正在安全激活"), "并由服务端签发新 Lease，Epoch 递增。退役设备进入 ", /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "Sunset · LocalContinuation"), " 保留态，仅本地只读，无执行权。"))),
    license: /* @__PURE__ */ React.createElement(PPanel, { title: "许可与所有权", actions: /* @__PURE__ */ React.createElement(PBadge, { tone: "gold" }, "年付 License") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 14, alignItems: "flex-start", marginBottom: 6 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "30", height: "30", alt: "", style: { flex: "none", marginTop: 4, opacity: 0.9 } }), /* @__PURE__ */ React.createElement("div", { style: { flex: 1 } }, /* @__PURE__ */ React.createElement(KV, { k: "License" }, "年付 · 有效至 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, "2026-12-31")), /* @__PURE__ */ React.createElement(KV, { k: "所有权验证" }, "本地密钥签发 · ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-success)" } }, "已验证")), /* @__PURE__ */ React.createElement(KV, { k: "Workspace", muted: true }, "个人 · 4 平台 · 3 账户"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(PBtn, { size: "sm", variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "管理订阅"), /* @__PURE__ */ React.createElement(PBtn, { size: "sm" }, "续期"))))),
    sync: /* @__PURE__ */ React.createElement(PPanel, { title: "同步偏好" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement(KV, { k: "自动同步" }, /* @__PURE__ */ React.createElement(PSwitch, { checked: true, disabled: true })), /* @__PURE__ */ React.createElement(KV, { k: "拉取刷新" }, /* @__PURE__ */ React.createElement(PSel, { size: "sm", options: ["可见时", "每 5 分钟", "每 15 分钟"], value: "每 5 分钟", onChange: () => {
    } })), /* @__PURE__ */ React.createElement(KV, { k: "主动只读" }, /* @__PURE__ */ React.createElement(PSwitch, { checked: readonly, onChange: () => setReadonly((v) => !v) })), /* @__PURE__ */ React.createElement(KV, { k: "冲突策略" }, /* @__PURE__ */ React.createElement(PSel, { size: "sm", options: ["总是人工裁决"], value: "总是人工裁决", onChange: () => {
    } })), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 11, color: "var(--gd-text-faint)", paddingTop: 10, lineHeight: 1.6 } }, "业务变更先提交本地 SQLCipher，再异步复制；Cloud 不可达本身不会切换为只读。主动只读只能收紧已验证运行权限，不能扩权；冲突项统一进入冲突中心人工裁决。"))),
    about: /* @__PURE__ */ React.createElement(PPanel, { title: "关于" }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement(KV, { k: "语言 / Locale" }, /* @__PURE__ */ React.createElement(PSel, { size: "sm", options: ["中文（zh-CN）", "English (en-US)"], value: "中文（zh-CN）", onChange: () => {
    } })), /* @__PURE__ */ React.createElement(KV, { k: "版本", muted: true }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, "0.9.0 · Tauri")), /* @__PURE__ */ React.createElement(KV, { k: "本地数据目录", muted: true }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11 } }, "~/Library/GoodDealer")), /* @__PURE__ */ React.createElement(KV, { k: "Revision 基线", muted: true }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, "8,241"))))
  };
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "设置", style: { display: "flex", height: "100%", minHeight: 0 } }, /* @__PURE__ */ React.createElement("aside", { style: { width: 176, flex: "none", borderRight: "1px solid var(--gd-line)", background: "var(--gd-panel)", padding: 8, display: "flex", flexDirection: "column", gap: 2 } }, SECTIONS.map(([k, l]) => /* @__PURE__ */ React.createElement("button", { key: k, onClick: () => setSec(k), style: {
    textAlign: "left",
    height: 31,
    padding: "0 10px",
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    fontSize: 13,
    fontFamily: "var(--font-sans)",
    background: sec === k ? "var(--gd-panel-raised)" : "transparent",
    color: sec === k ? "var(--text-1)" : "var(--text-2)"
  } }, l))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, overflow: "auto", padding: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { maxWidth: 760 } }, content[sec])), /* @__PURE__ */ React.createElement(
    PDlg,
    {
      open: !!handoff,
      onClose: () => {
        setHandoff(null);
        setAck(false);
      },
      title: "移交执行权 · ActiveDeviceLease",
      width: 512,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(PBtn, { onClick: () => {
        setHandoff(null);
        setAck(false);
      } }, "取消"), /* @__PURE__ */ React.createElement(PBtn, { variant: "primary", disabled: !ack, onClick: runHandoff }, "移交到 ", handoff && handoff.name))
    },
    handoff && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13 } }, "将执行权从 ", /* @__PURE__ */ React.createElement("b", null, "MacBook Pro（本机）"), " 移交到 ", /* @__PURE__ */ React.createElement("b", null, handoff.name), "。"), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-line-strong)", borderRadius: 7, background: "var(--gd-panel)", padding: "11px 13px", display: "flex", flexDirection: "column", gap: 8, fontSize: 12, color: "var(--gd-text-muted)", lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "① 排空"), "：本机先提交 Outbox 未同步项并释放当前 Lease。"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "② 正在安全激活"), "：", handoff.name, " 校验通过后，服务端签发新 ActiveDeviceLease。"), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-text)", fontWeight: 500 } }, "③ Epoch 递增"), "：", devices.find((d) => d.state === "active").epoch, " → ", (devices.find((d) => d.state === "active").epoch || 41) + 1, "，本机转为 Standby。")), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid var(--gd-line)", paddingTop: 10 } }, /* @__PURE__ */ React.createElement(PCheck, { checked: ack, onChange: () => setAck((a) => !a), label: "我确认移交执行权；期间本机将暂时无法执行写操作" })))
  ));
}
window.GDSettings = Settings;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/SettingsPanel.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/Shell.jsx
try { (() => {
const { Badge, StatusDot, IconButton, WindowChrome, StatusBar, Toolbar } = window.GoodDealerDesignSystem_b5b0b6;
const Dot = ({ tone, hollow }) => /* @__PURE__ */ React.createElement("span", { style: { width: 7, height: 7, borderRadius: "50%", flex: "none", display: "inline-block", background: hollow ? "transparent" : `var(--gd-${tone})`, border: hollow ? `1.5px solid var(--gd-${tone})` : "none" } });
const shellStyles = {
  side: { width: 210, flex: "none", background: "var(--gd-panel)", borderRight: "1px solid var(--gd-line)", display: "flex", flexDirection: "column" },
  navSec: { padding: "12px 16px 4px", fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--text-3)", fontWeight: 500 },
  item: (act) => ({ display: "flex", alignItems: "center", gap: 9, margin: "1px 8px", padding: "0 8px", height: 29, borderRadius: 5, cursor: "pointer", fontSize: 13, color: act ? "var(--text-1)" : "var(--text-2)", background: act ? "var(--gd-panel-raised)" : "transparent", border: "none", width: "calc(100% - 16px)", fontFamily: "var(--font-sans)", textAlign: "left", transition: "background 120ms,color 120ms", fontWeight: act ? 500 : 400 }),
  itemActiveBar: { position: "absolute", left: 0, top: 5, bottom: 5, width: 2, borderRadius: 1, background: "var(--gd-gold)" },
  count: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", lineHeight: "15px" },
  cmd: { display: "flex", alignItems: "center", gap: 8, height: 28, padding: "0 8px 0 10px", width: 300, background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 5, color: "var(--text-3)", fontSize: 12, cursor: "text" },
  kbd: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)", border: "1px solid var(--gd-line-strong)", borderRadius: 3, padding: "0 4px", lineHeight: "15px" }
};
function NavItem({ icon: Ic, label, k, active, onGo, count, tone }) {
  const on = active === k;
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      style: { ...shellStyles.item(on), position: "relative" },
      onClick: () => onGo(k),
      onMouseEnter: (e) => {
        if (!on) e.currentTarget.style.background = "var(--gd-panel-raised)";
      },
      onMouseLeave: (e) => {
        if (!on) e.currentTarget.style.background = "transparent";
      }
    },
    on && /* @__PURE__ */ React.createElement("span", { style: shellStyles.itemActiveBar }),
    /* @__PURE__ */ React.createElement(Ic, { size: 15, style: { flex: "none", opacity: on ? 1 : 0.7 } }),
    label,
    count != null && /* @__PURE__ */ React.createElement("span", { style: { ...shellStyles.count, ...tone ? { color: `var(--gd-${tone})` } : {} } }, count)
  );
}
function Shell({ active, onGo, title, crumb, syncing, onSync, unsynced = 0, device = { name: "MacBook Pro", epoch: 41 }, children }) {
  const [shellW, setShellW] = React.useState(1280);
  React.useEffect(() => {
    const el = document.getElementById("root");
    if (!el) return;
    const ro = new ResizeObserver((es) => setShellW(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const showP2 = shellW >= 980, showP3 = shellW >= 1180;
  const I = window.GDI;
  const mark = /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark-flat.svg", width: "18", height: "18", alt: "" });
  const cmd = /* @__PURE__ */ React.createElement("div", { style: shellStyles.cmd }, /* @__PURE__ */ React.createElement(I.Search, { size: 13 }), /* @__PURE__ */ React.createElement("span", null, "搜索域名或输入命令"), /* @__PURE__ */ React.createElement("span", { style: shellStyles.kbd }, "⌘K"));
  const footer = /* @__PURE__ */ React.createElement(
    StatusBar,
    {
      left: [
        /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(Dot, { tone: "blue" }), syncing ? "SYNCING" : "SYNCED"),
        /* @__PURE__ */ React.createElement(React.Fragment, null, "未同步 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: unsynced > 0 ? "var(--gd-blue)" : "var(--text-3)" } }, unsynced)),
        ...showP2 ? [/* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "最后同步 ", syncing ? "…" : "14:02")] : [],
        ...showP3 ? [/* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "rev 8,241")] : []
      ],
      right: [
        ...showP2 ? [/* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "4 平台 · 3 账户")] : [],
        /* @__PURE__ */ React.createElement(React.Fragment, null, device.name, " ", /* @__PURE__ */ React.createElement(Dot, { tone: "gold" }), " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)" } }, "Active")),
        ...showP2 ? [/* @__PURE__ */ React.createElement(React.Fragment, null, device.name === "MacBook Pro" ? "iPhone 17" : "MacBook Pro", " ", /* @__PURE__ */ React.createElement(Dot, { tone: "blue", hollow: true }), " Standby")] : [],
        ...showP3 ? [/* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "Epoch ", device.epoch)] : [],
        ...showP3 ? [/* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "年付 License")] : []
      ]
    }
  );
  return /* @__PURE__ */ React.createElement(WindowChrome, { appName: "GoodDealer", mark, context: `个人 Workspace · ${title}`, footer, style: { minWidth: 760 } }, /* @__PURE__ */ React.createElement("aside", { style: shellStyles.side }, /* @__PURE__ */ React.createElement("div", { style: shellStyles.navSec }, "资产"), /* @__PURE__ */ React.createElement(NavItem, { icon: I.Globe, label: "资产库", k: "assets", active, onGo }), /* @__PURE__ */ React.createElement(NavItem, { icon: I.Coins, label: "销售管理", k: "sales", active, onGo }), /* @__PURE__ */ React.createElement(NavItem, { icon: I.Shield, label: "DNS 与验证", k: "dns", active, onGo }), /* @__PURE__ */ React.createElement("div", { style: shellStyles.navSec }, "执行"), /* @__PURE__ */ React.createElement(NavItem, { icon: I.ListChecks, label: "批量任务", k: "batch", active, onGo }), /* @__PURE__ */ React.createElement(NavItem, { icon: I.AlertTriangle, label: "冲突中心", k: "conflicts", active, onGo, count: 6, tone: "danger" }), /* @__PURE__ */ React.createElement(NavItem, { icon: I.Inbox, label: "人工任务", k: "inbox", active, onGo, count: 4, tone: "warning" }), /* @__PURE__ */ React.createElement(NavItem, { icon: I.History, label: "操作历史", k: "history", active, onGo }), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto" } }, /* @__PURE__ */ React.createElement(NavItem, { icon: I.Settings, label: "设置", k: "settings", active, onGo })), /* @__PURE__ */ React.createElement("div", { style: { padding: "8px 12px 12px", borderTop: "1px solid var(--gd-line)", margin: "4px 0 0", display: "flex", alignItems: "center", gap: 7 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "14", height: "14", alt: "", style: { opacity: 0.85 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 10, color: "var(--text-3)", fontFamily: "var(--font-mono)", lineHeight: 1.3 } }, "凭据本地加密", /* @__PURE__ */ React.createElement("br", null), "永不上云"))), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, display: "flex", flexDirection: "column", minWidth: 0, minHeight: 0 } }, /* @__PURE__ */ React.createElement(
    Toolbar,
    {
      left: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 14, fontWeight: 600, color: "var(--text-1)" } }, title), crumb && /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-3)" } }, crumb)),
      right: /* @__PURE__ */ React.createElement(React.Fragment, null, cmd, /* @__PURE__ */ React.createElement(IconButton, { size: "sm", label: "刷新平台数据", onClick: onSync }, /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 14, style: syncing ? { animation: "gd-spinner 1s linear infinite" } : void 0 })))
    }
  ), /* @__PURE__ */ React.createElement("main", { style: { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column" } }, children)));
}
window.GDShell = Shell;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/Shell.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/SignIn.jsx
try { (() => {
const { Button: SBtn, Input: SInput, Checkbox: SCheck, Badge: SBadge, StatusDot: SDot, WindowChrome: SWin } = window.GoodDealerDesignSystem_b5b0b6;
const T = {
  zh: {
    ctx: "账户登录",
    // brand
    tagline: "本地执行 · 云端同步",
    trust: "凭据经本地密钥加密，永不上云",
    deviceHint: "一个账户最多绑定 2 台执行设备",
    localExec: "本地执行",
    cloudSync: "云端同步",
    // signin
    siTitle: "登录你的账户",
    siSub: "使用 GoodDealer Cloud 账户继续",
    email: "邮箱",
    password: "密码",
    emailPh: "you@domain.com",
    pwPh: "输入密码",
    remember: "记住此设备",
    forgot: "忘记密码？",
    signIn: "登录",
    signingIn: "正在验证…",
    or: "或",
    google: "使用 Google 继续",
    github: "使用 GitHub 继续",
    passkey: "使用 Passkey 登录",
    noAccount: "还没有账户？",
    createOne: "创建账户",
    show: "显示",
    hide: "隐藏",
    // register
    rgTitle: "创建你的账户",
    rgSub: "一个账户，最多绑定 2 台执行设备",
    confirm: "确认密码",
    confirmPh: "再次输入密码",
    pwRule: "至少 10 位，含字母与数字",
    agreePre: "我已阅读并同意",
    terms: "服务条款",
    and: "与",
    privacy: "隐私政策",
    create: "创建账户",
    creating: "正在创建…",
    haveAccount: "已有账户？",
    toSignIn: "登录",
    pwMismatch: "两次输入的密码不一致",
    mustAgree: "请先同意服务条款与隐私政策",
    // verify
    vfTitle: "验证你的邮箱",
    vfSubA: "我们已向 ",
    vfSubB: " 发送 6 位验证码",
    code: "验证码",
    verify: "验证并继续",
    verifying: "正在验证…",
    resend: "重新发送验证码",
    resendIn: "秒后可重发",
    back: "返回",
    codeErr: "验证码有误，请重试",
    // forgot
    fgTitle: "重置密码",
    fgSub: "输入账户邮箱，我们将发送重置链接",
    sendLink: "发送重置链接",
    sending: "正在发送…",
    sentTitle: "重置链接已发送",
    sentSub: "若该邮箱已注册，你将很快收到一封含重置链接的邮件。",
    backToSignIn: "返回登录"
  },
  en: {
    ctx: "Account",
    tagline: "Local execution · Cloud sync",
    trust: "Credentials are encrypted by a local key. Never uploaded.",
    deviceHint: "Up to 2 execution devices per account",
    localExec: "Local execution",
    cloudSync: "Cloud sync",
    siTitle: "Sign in to your account",
    siSub: "Continue with your GoodDealer Cloud account",
    email: "Email",
    password: "Password",
    emailPh: "you@domain.com",
    pwPh: "Enter your password",
    remember: "Remember this device",
    forgot: "Forgot password?",
    signIn: "Sign in",
    signingIn: "Verifying…",
    or: "or",
    google: "Continue with Google",
    github: "Continue with GitHub",
    passkey: "Sign in with a passkey",
    noAccount: "Don't have an account?",
    createOne: "Create one",
    show: "Show",
    hide: "Hide",
    rgTitle: "Create your account",
    rgSub: "One account, up to 2 execution devices",
    confirm: "Confirm password",
    confirmPh: "Re-enter your password",
    pwRule: "At least 10 chars, letters and numbers",
    agreePre: "I agree to the",
    terms: "Terms of Service",
    and: "and",
    privacy: "Privacy Policy",
    create: "Create account",
    creating: "Creating…",
    haveAccount: "Already have an account?",
    toSignIn: "Sign in",
    pwMismatch: "Passwords don't match",
    mustAgree: "Please accept the Terms and Privacy Policy",
    vfTitle: "Verify your email",
    vfSubA: "We sent a 6-digit code to ",
    vfSubB: "",
    code: "Verification code",
    verify: "Verify & continue",
    verifying: "Verifying…",
    resend: "Resend code",
    resendIn: "s to resend",
    back: "Back",
    codeErr: "Incorrect code, try again",
    fgTitle: "Reset your password",
    fgSub: "Enter your account email and we'll send a reset link",
    sendLink: "Send reset link",
    sending: "Sending…",
    sentTitle: "Reset link sent",
    sentSub: "If that email is registered, you'll receive a reset link shortly.",
    backToSignIn: "Back to sign in"
  }
};
function LinkText({ children, onClick }) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick,
      style: { background: "none", border: "none", padding: 0, font: "inherit", fontSize: "inherit", color: "var(--text-link)", cursor: "pointer" },
      onMouseEnter: (e) => e.currentTarget.style.textDecoration = "underline",
      onMouseLeave: (e) => e.currentTarget.style.textDecoration = "none"
    },
    children
  );
}
function LangToggle({ lang, setLang }) {
  const opt = (k, l) => /* @__PURE__ */ React.createElement("button", { onClick: () => setLang(k), style: {
    padding: "3px 9px",
    fontSize: 11,
    fontWeight: 500,
    borderRadius: 5,
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-mono)",
    letterSpacing: "0.02em",
    background: lang === k ? "var(--gd-panel-raised)" : "transparent",
    color: lang === k ? "var(--text-1)" : "var(--text-3)"
  } }, l);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", gap: 1, padding: 2, borderRadius: 7, border: "1px solid var(--gd-line)", background: "var(--gd-ink)" } }, opt("zh", "中"), opt("en", "EN"));
}
function Divider({ label }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, margin: "2px 0" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, height: 1, background: "var(--gd-line)" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--text-3)", textTransform: "uppercase", letterSpacing: "0.08em" } }, label), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, height: 1, background: "var(--gd-line)" } }));
}
function Mono({ ch }) {
  return /* @__PURE__ */ React.createElement("span", { style: { width: 20, height: 20, flex: "none", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 5, border: "1px solid var(--gd-line-strong)", background: "var(--gd-ink)", fontFamily: "var(--font-mono)", fontSize: 11, fontWeight: 600, color: "var(--text-2)" } }, ch);
}
function Oauth({ mono, label, onClick }) {
  return /* @__PURE__ */ React.createElement("button", { onClick, className: "gd-btn gd-btn--md gd-btn--secondary", style: { width: "100%", justifyContent: "flex-start", gap: 10, paddingLeft: 9 } }, /* @__PURE__ */ React.createElement(Mono, { ch: mono }), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, textAlign: "center", marginRight: 20 } }, label));
}
function CodeInput({ value, onChange, error }) {
  const refs = React.useRef([]);
  const set = (i, v) => {
    const c = (value + "").padEnd(6, " ").split("");
    c[i] = v.slice(-1) || " ";
    const nv = c.join("").replace(/ /g, "").slice(0, 6);
    onChange(nv);
  };
  const cells = [];
  for (let i = 0; i < 6; i++) {
    const ch = (value || "")[i] || "";
    cells.push(/* @__PURE__ */ React.createElement(
      "input",
      {
        key: i,
        ref: (el) => refs.current[i] = el,
        value: ch,
        inputMode: "numeric",
        maxLength: 1,
        onChange: (e) => {
          const d = e.target.value.replace(/\D/g, "");
          set(i, d);
          if (d && refs.current[i + 1]) refs.current[i + 1].focus();
        },
        onKeyDown: (e) => {
          if (e.key === "Backspace" && !ch && refs.current[i - 1]) refs.current[i - 1].focus();
        },
        style: {
          width: 42,
          height: 50,
          textAlign: "center",
          fontFamily: "var(--font-mono)",
          fontSize: 20,
          color: "var(--text-1)",
          caretColor: "var(--gd-blue)",
          background: "var(--gd-ink)",
          border: `1px solid ${error ? "var(--gd-danger)" : ch ? "var(--gd-line-strong)" : "var(--gd-line)"}`,
          borderRadius: 7,
          outline: "none"
        },
        onFocus: (e) => e.target.style.borderColor = "var(--gd-blue)",
        onBlur: (e) => e.target.style.borderColor = error ? "var(--gd-danger)" : ch ? "var(--gd-line-strong)" : "var(--gd-line)"
      }
    ));
  }
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, cells);
}
function SignIn({ onAuthed }) {
  const I = window.GDI;
  const [lang, setLang] = React.useState("zh");
  const t = T[lang];
  const [mode, setMode] = React.useState("signin");
  const [email, setEmail] = React.useState("");
  const [pw, setPw] = React.useState("");
  const [pw2, setPw2] = React.useState("");
  const [showPw, setShowPw] = React.useState(false);
  const [remember, setRemember] = React.useState(true);
  const [agree, setAgree] = React.useState(false);
  const [code, setCode] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState("");
  const [sent, setSent] = React.useState(false);
  const [cool, setCool] = React.useState(0);
  React.useEffect(() => {
    if (cool <= 0) return;
    const id = setTimeout(() => setCool(cool - 1), 1e3);
    return () => clearTimeout(id);
  }, [cool]);
  const go = (m) => {
    setErr("");
    setBusy(false);
    setSent(false);
    setMode(m);
  };
  const doSignIn = () => {
    setErr("");
    setBusy(true);
    setTimeout(() => onAuthed && onAuthed(), 950);
  };
  const doRegister = () => {
    setErr("");
    if (pw.length < 10 || pw !== pw2) {
      setErr(t.pwMismatch);
      return;
    }
    if (!agree) {
      setErr(t.mustAgree);
      return;
    }
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setCode("");
      setCool(45);
      go("verify");
    }, 900);
  };
  const doVerify = () => {
    setErr("");
    if (code.length < 6) {
      setErr(t.codeErr);
      return;
    }
    setBusy(true);
    setTimeout(() => onAuthed && onAuthed(), 950);
  };
  const doForgot = () => {
    setBusy(true);
    setTimeout(() => {
      setBusy(false);
      setSent(true);
    }, 900);
  };
  const pwSuffix = /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick: (e) => {
        e.preventDefault();
        setShowPw((s) => !s);
      },
      tabIndex: -1,
      style: { background: "none", border: "none", padding: 0, cursor: "pointer", color: "var(--text-3)", fontSize: 11 }
    },
    showPw ? t.hide : t.show
  );
  const signinBody = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(SInput, { label: t.email, size: "lg", type: "email", placeholder: t.emailPh, value: email, onChange: (e) => setEmail(e.target.value), autoFocus: true }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6 } }, /* @__PURE__ */ React.createElement(SInput, { label: t.password, size: "lg", type: showPw ? "text" : "password", placeholder: t.pwPh, value: pw, onChange: (e) => setPw(e.target.value), suffix: pwSuffix, onKeyDown: (e) => e.key === "Enter" && email && pw && doSignIn() }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12 } }, /* @__PURE__ */ React.createElement(SCheck, { checked: remember, onChange: (e) => setRemember(e.target?.checked ?? !remember), label: t.remember }), /* @__PURE__ */ React.createElement(LinkText, { onClick: () => go("forgot") }, t.forgot)))), err && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-danger)" } }, err), /* @__PURE__ */ React.createElement(
    SBtn,
    {
      variant: "primary",
      size: "lg",
      block: true,
      disabled: busy || !email || !pw,
      onClick: doSignIn,
      icon: busy ? /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 15, style: { animation: "gd-spinner 1s linear infinite" } }) : null
    },
    busy ? t.signingIn : t.signIn
  ), /* @__PURE__ */ React.createElement(Divider, { label: t.or }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement(Oauth, { mono: "G", label: t.google, onClick: doSignIn }), /* @__PURE__ */ React.createElement(Oauth, { mono: "GH", label: t.github, onClick: doSignIn }), /* @__PURE__ */ React.createElement("button", { onClick: doSignIn, className: "gd-btn gd-btn--md gd-btn--gold", style: { width: "100%", justifyContent: "flex-start", gap: 10, paddingLeft: 9 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/icons/keyhole.svg", width: "18", height: "18", alt: "", style: { flex: "none" } }), /* @__PURE__ */ React.createElement("span", { style: { flex: 1, textAlign: "center", marginRight: 20 } }, t.passkey))), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", paddingTop: 8, fontSize: 13, color: "var(--text-2)", display: "flex", gap: 6, justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", null, t.noAccount), /* @__PURE__ */ React.createElement(LinkText, { onClick: () => go("register") }, t.createOne)));
  const registerBody = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(SInput, { label: t.email, size: "lg", type: "email", placeholder: t.emailPh, value: email, onChange: (e) => setEmail(e.target.value), autoFocus: true }), /* @__PURE__ */ React.createElement(SInput, { label: t.password, size: "lg", type: showPw ? "text" : "password", placeholder: t.pwPh, value: pw, onChange: (e) => setPw(e.target.value), suffix: pwSuffix, hint: t.pwRule }), /* @__PURE__ */ React.createElement(SInput, { label: t.confirm, size: "lg", type: showPw ? "text" : "password", placeholder: t.confirmPh, value: pw2, onChange: (e) => setPw2(e.target.value) }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 9, fontSize: 12, color: "var(--text-2)", lineHeight: 1.5 } }, /* @__PURE__ */ React.createElement("span", { style: { marginTop: 1 } }, /* @__PURE__ */ React.createElement(SCheck, { checked: agree, onChange: (e) => setAgree(e.target?.checked ?? !agree) })), /* @__PURE__ */ React.createElement("span", null, t.agreePre, " ", /* @__PURE__ */ React.createElement(LinkText, { onClick: () => {
  } }, t.terms), " ", t.and, " ", /* @__PURE__ */ React.createElement(LinkText, { onClick: () => {
  } }, t.privacy)))), err && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-danger)" } }, err), /* @__PURE__ */ React.createElement(
    SBtn,
    {
      variant: "primary",
      size: "lg",
      block: true,
      disabled: busy || !email || !pw || !pw2,
      onClick: doRegister,
      icon: busy ? /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 15, style: { animation: "gd-spinner 1s linear infinite" } }) : null
    },
    busy ? t.creating : t.create
  ), /* @__PURE__ */ React.createElement("div", { style: { marginTop: "auto", paddingTop: 8, fontSize: 13, color: "var(--text-2)", display: "flex", gap: 6, justifyContent: "center" } }, /* @__PURE__ */ React.createElement("span", null, t.haveAccount), /* @__PURE__ */ React.createElement(LinkText, { onClick: () => go("signin") }, t.toSignIn)));
  const verifyBody = /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 16 } }, /* @__PURE__ */ React.createElement("span", { className: "gd-t-label", style: { fontSize: 11, letterSpacing: "var(--tracking-caps)", textTransform: "uppercase", color: "var(--text-2)" } }, t.code), /* @__PURE__ */ React.createElement(CodeInput, { value: code, onChange: setCode, error: !!err }), err && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 12, color: "var(--gd-danger)" } }, err)), /* @__PURE__ */ React.createElement(
    SBtn,
    {
      variant: "primary",
      size: "lg",
      block: true,
      disabled: busy || code.length < 6,
      onClick: doVerify,
      icon: busy ? /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 15, style: { animation: "gd-spinner 1s linear infinite" } }) : /* @__PURE__ */ React.createElement(I.Shield, { size: 15 })
    },
    busy ? t.verifying : t.verify
  ), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 12, marginTop: 2 } }, /* @__PURE__ */ React.createElement(LinkText, { onClick: () => go("register") }, t.back), cool > 0 ? /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)", fontFamily: "var(--font-mono)" } }, cool, lang === "zh" ? " " : "", t.resendIn) : /* @__PURE__ */ React.createElement(LinkText, { onClick: () => setCool(45) }, t.resend)));
  const forgotBody = sent ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", alignItems: "center", gap: 14, textAlign: "center", margin: "12px 0" } }, /* @__PURE__ */ React.createElement("span", { style: { width: 52, height: 52, borderRadius: "50%", background: "var(--gd-success-tint)", border: "1px solid var(--gd-success)", display: "inline-flex", alignItems: "center", justifyContent: "center" } }, /* @__PURE__ */ React.createElement(I.Check, { size: 26, style: { color: "var(--gd-success)" } })), /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 16, fontWeight: 600, color: "var(--text-1)" } }, t.sentTitle), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--text-2)", marginTop: 6, lineHeight: 1.5 } }, t.sentSub))), /* @__PURE__ */ React.createElement(SBtn, { variant: "secondary", size: "lg", block: true, onClick: () => go("signin") }, t.backToSignIn)) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(SInput, { label: t.email, size: "lg", type: "email", placeholder: t.emailPh, value: email, onChange: (e) => setEmail(e.target.value), autoFocus: true }), /* @__PURE__ */ React.createElement(
    SBtn,
    {
      variant: "primary",
      size: "lg",
      block: true,
      disabled: busy || !email,
      onClick: doForgot,
      icon: busy ? /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 15, style: { animation: "gd-spinner 1s linear infinite" } }) : null
    },
    busy ? t.sending : t.sendLink
  ), /* @__PURE__ */ React.createElement("div", { style: { marginTop: 2 } }, /* @__PURE__ */ React.createElement(LinkText, { onClick: () => go("signin") }, t.backToSignIn)));
  const HEAD = { signin: [t.siTitle, t.siSub], register: [t.rgTitle, t.rgSub], verify: [t.vfTitle, null], forgot: [t.fgTitle, t.fgSub] };
  const [hTitle, hSub] = HEAD[mode];
  const body = { signin: signinBody, register: registerBody, verify: verifyBody, forgot: forgotBody }[mode];
  return /* @__PURE__ */ React.createElement(
    SWin,
    {
      appName: "GoodDealer",
      context: t.ctx,
      mark: /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark-16.svg", width: "16", height: "16", alt: "" }),
      style: { width: 920, height: 600, maxWidth: "100%", maxHeight: "100%" },
      onClose: () => {
      }
    },
    /* @__PURE__ */ React.createElement("div", { style: { width: 380, flex: "none", position: "relative", overflow: "hidden", borderRight: "1px solid var(--gd-line)", background: "var(--gd-panel)", display: "flex", flexDirection: "column", padding: "40px 40px 36px" } }, /* @__PURE__ */ React.createElement("div", { style: { position: "absolute", width: 440, height: 440, left: "50%", top: "44%", transform: "translate(-50%,-50%)", borderRadius: "50%", background: "radial-gradient(circle,rgba(212,164,55,0.13),transparent 68%)", pointerEvents: "none" } }), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", margin: "auto 0", display: "flex", flexDirection: "column", alignItems: "center", textAlign: "center", gap: 26 } }, /* @__PURE__ */ React.createElement("img", { src: "../../assets/logo/mark.svg", width: "132", height: "132", alt: "GoodDealer" }), /* @__PURE__ */ React.createElement("div", { style: { fontSize: 15, color: "var(--text-2)", letterSpacing: "0.05em" } }, t.tagline)), /* @__PURE__ */ React.createElement("div", { style: { position: "relative", display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { height: 1, background: "var(--gd-line)" } }), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "flex-start", gap: 10 } }, /* @__PURE__ */ React.createElement(I.Shield, { size: 14, style: { color: "var(--gd-gold)", marginTop: 2, flex: "none" } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--text-3)", lineHeight: 1.55 } }, t.trust)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(SDot, { kind: "active", size: 7 }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11.5, color: "var(--text-3)" } }, "GoodDealer Cloud · ", lang === "zh" ? "≤ 2 台执行设备" : "≤ 2 devices")))),
    /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--gd-ink)" } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", justifyContent: "flex-end", padding: "12px 16px 2px" } }, /* @__PURE__ */ React.createElement(LangToggle, { lang, setLang })), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minHeight: 0, overflowY: "auto", padding: "2px 40px 22px", display: "flex", flexDirection: "column" } }, /* @__PURE__ */ React.createElement("div", { style: { marginBottom: 16 } }, /* @__PURE__ */ React.createElement("div", { style: { fontSize: 20, fontWeight: 600, letterSpacing: "-0.02em", color: "var(--text-1)" } }, hTitle), hSub && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--text-2)", marginTop: 5 } }, hSub), mode === "verify" && /* @__PURE__ */ React.createElement("div", { style: { fontSize: 13, color: "var(--text-2)", marginTop: 5 } }, t.vfSubA, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-1)", fontFamily: "var(--font-mono)" } }, email || "you@domain.com"), t.vfSubB)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, flex: 1 } }, body)))
  );
}
window.GDSignIn = SignIn;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/SignIn.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/TaskInbox.jsx
try { (() => {
const { Badge, Button, Panel, StatusDot } = window.GoodDealerDesignSystem_b5b0b6;
function TaskInbox() {
  const I = window.GDI;
  const [cur, setCur] = React.useState(1);
  const [doneIds, setDoneIds] = React.useState([]);
  const [automation, setAutomation] = React.useState("user");
  const tasks = window.GD_DATA.tasks;
  const t = tasks.find((x) => x.id === cur);
  const isDone = doneIds.includes(cur);
  const badge = (b) => b === "danger" ? /* @__PURE__ */ React.createElement(Badge, { tone: "danger", mono: false }, "高优先级") : b === "warning" ? /* @__PURE__ */ React.createElement(Badge, { tone: "warning", mono: false }, "等待人工") : /* @__PURE__ */ React.createElement(Badge, { mono: false }, "低优先级");
  return /* @__PURE__ */ React.createElement("div", { "data-screen-label": "人工任务收件箱", style: { display: "flex", gap: 14, height: "100%", minHeight: 0, maxWidth: 1080, margin: "0 auto", padding: 16, width: "100%" } }, /* @__PURE__ */ React.createElement("div", { style: { width: 300, flex: "none", display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 16, fontWeight: 600, padding: "2px 2px 6px" } }, "人工任务 ", /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-muted)" } }, "· ", tasks.length - doneIds.length, " 待处理")), tasks.map((x) => {
    const d = doneIds.includes(x.id);
    return /* @__PURE__ */ React.createElement("button", { key: x.id, onClick: () => setCur(x.id), style: { textAlign: "left", background: cur === x.id ? "var(--gd-panel-raised)" : "var(--gd-panel)", border: `1px solid ${cur === x.id ? "var(--gd-line-strong)" : "var(--gd-line)"}`, borderRadius: 7, padding: "10px 12px", cursor: "pointer", fontFamily: "var(--font-sans)", display: "flex", flexDirection: "column", gap: 6, opacity: d ? 0.55 : 1 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 13, fontWeight: 500, color: "var(--gd-text)", display: "flex", alignItems: "center", gap: 6 } }, d && /* @__PURE__ */ React.createElement(I.Check, { size: 13, style: { color: "var(--gd-success)" } }), x.title), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", gap: 8, alignItems: "center" } }, d ? /* @__PURE__ */ React.createElement(Badge, { tone: "success", mono: false }, "已完成") : badge(x.badge), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, x.account, x.domains ? ` · ${x.domains} 域名` : "")));
  }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)", padding: "4px 2px" } }, "自动化失败会回到同一任务，不创建重复项")), /* @__PURE__ */ React.createElement("div", { style: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement(Panel, { title: t.title, actions: isDone ? /* @__PURE__ */ React.createElement(Badge, { tone: "success", mono: false }, "已完成") : badge(t.badge) }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12, fontSize: 13 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "grid", gridTemplateColumns: "96px 1fr", rowGap: 8, columnGap: 12, fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "为什么需要人工"), /* @__PURE__ */ React.createElement("span", null, t.why), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "目标"), /* @__PURE__ */ React.createElement("span", null, t.platform, " · ", t.account), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "影响域名"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, t.domains || "—"), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "已准备"), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, t.prepared !== "—" && /* @__PURE__ */ React.createElement(I.FileText, { size: 13, style: { color: "var(--gd-text-muted)" } }), t.prepared), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "完成条件"), /* @__PURE__ */ React.createElement("span", null, t.done), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "最后检查"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)" } }, t.lastCheck)), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap" } }, /* @__PURE__ */ React.createElement(Button, { icon: /* @__PURE__ */ React.createElement(I.ExternalLink, { size: 13 }) }, "打开平台并登录"), /* @__PURE__ */ React.createElement(Button, { variant: "gold", onClick: () => setAutomation("software") }, "授权执行"), /* @__PURE__ */ React.createElement(Button, { variant: "ghost", onClick: () => setDoneIds((d) => isDone ? d.filter((i) => i !== cur) : [...d, cur]) }, isDone ? "重新打开" : "我已完成"), /* @__PURE__ */ React.createElement(Button, { variant: "ghost", icon: /* @__PURE__ */ React.createElement(I.RefreshCw, { size: 13 }) }, "重新检查")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "「我已完成」不会直接标记成功——系统将读取平台状态验证完成条件"))), /* @__PURE__ */ React.createElement(Panel, { title: "Remote Browser · 交接状态", actions: /* @__PURE__ */ React.createElement(Badge, { tone: "sync" }, "SESSION 22:41") }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 12 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 16, alignItems: "center", fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, /* @__PURE__ */ React.createElement(I.Monitor, { size: 14 }), t.platform, " · ", t.account), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontSize: 11 } }, "允许 Host: *.", t.platform.toLowerCase(), ".com"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto" } }, automation === "software" ? /* @__PURE__ */ React.createElement(StatusDot, { kind: "sync", pulse: true, label: "软件执行中 · 剩余 3 项" }) : automation === "paused" ? /* @__PURE__ */ React.createElement(StatusDot, { kind: "warning", label: "已暂停 · 等待接管" }) : /* @__PURE__ */ React.createElement(StatusDot, { kind: "neutral", label: "用户操作（密码 / 2FA / CAPTCHA）" }))), /* @__PURE__ */ React.createElement("div", { style: { background: "var(--gd-ink)", border: "1px solid var(--gd-line)", borderRadius: 5, padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--gd-text-muted)", display: "flex", justifyContent: "space-between" } }, /* @__PURE__ */ React.createElement("span", null, "下一步：", automation === "software" ? "填写价格表单 → 提交" : "等待用户完成登录"), /* @__PURE__ */ React.createElement("span", null, "队列 ", automation === "software" ? "3" : "—", " / 12")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, /* @__PURE__ */ React.createElement(Button, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Pause, { size: 12 }), onClick: () => setAutomation("paused"), disabled: automation !== "software" }, "暂停并接管"), /* @__PURE__ */ React.createElement(Button, { size: "sm", icon: /* @__PURE__ */ React.createElement(I.Play, { size: 12 }), onClick: () => setAutomation("software"), disabled: automation === "software" }, "继续"), /* @__PURE__ */ React.createElement(Button, { size: "sm", variant: "danger", onClick: () => setAutomation("user") }, "终止"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-faint)", alignSelf: "center" } }, "密码、2FA、CAPTCHA 页面自动切换为用户操作"))))));
}
window.GDTaskInbox = TaskInbox;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/TaskInbox.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/controls.jsx
try { (() => {
const { Select: GDSelect, IconButton: GDIconButton } = window.GoodDealerDesignSystem_b5b0b6;
function pageWindow(cur, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const s = /* @__PURE__ */ new Set([1, 2, total - 1, total, cur - 1, cur, cur + 1]);
  const arr = [...s].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of arr) {
    if (n - prev > 1) out.push("gap" + n);
    out.push(n);
    prev = n;
  }
  return out;
}
function PageNum({ n, active, onClick }) {
  return /* @__PURE__ */ React.createElement(
    "button",
    {
      onClick,
      onMouseEnter: (e) => {
        if (!active) e.currentTarget.style.background = "var(--gd-panel-raised)";
      },
      onMouseLeave: (e) => {
        if (!active) e.currentTarget.style.background = "transparent";
      },
      style: {
        minWidth: 24,
        height: 24,
        padding: "0 6px",
        borderRadius: 5,
        cursor: "pointer",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        border: active ? "1px solid var(--gd-line-strong)" : "1px solid transparent",
        background: active ? "var(--gd-panel-raised)" : "transparent",
        color: active ? "var(--text-1)" : "var(--text-2)"
      }
    },
    n
  );
}
function Pagination({ page, pageSize, total, onPage, onPageSize, pageSizes = [10, 25, 50], note }) {
  const I = window.GDI;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12, width: "100%", fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums" } }, from.toLocaleString(), "–", to.toLocaleString(), " ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--text-3)" } }, "/ ", total.toLocaleString())), /* @__PURE__ */ React.createElement("span", { style: { display: "flex", alignItems: "center", gap: 6 } }, "每页", /* @__PURE__ */ React.createElement(GDSelect, { size: "sm", options: pageSizes.map(String), value: String(pageSize), onChange: (e) => onPageSize(+e.target.value) })), note && /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)", fontSize: 11 } }, note), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: note ? 16 : "auto", display: "flex", alignItems: "center", gap: 3 } }, /* @__PURE__ */ React.createElement(GDIconButton, { size: "sm", label: "上一页", disabled: cur <= 1, onClick: () => onPage(cur - 1) }, /* @__PURE__ */ React.createElement(I.ChevronLeft, { size: 14 })), pageWindow(cur, pages).map((n, i) => typeof n === "number" ? /* @__PURE__ */ React.createElement(PageNum, { key: i, n, active: n === cur, onClick: () => onPage(n) }) : /* @__PURE__ */ React.createElement("span", { key: i, style: { padding: "0 2px", color: "var(--gd-text-faint)" } }, "…")), /* @__PURE__ */ React.createElement(GDIconButton, { size: "sm", label: "下一页", disabled: cur >= pages, onClick: () => onPage(cur + 1) }, /* @__PURE__ */ React.createElement(I.ChevronRight, { size: 14 }))));
}
window.GDPagination = Pagination;
function EditableCell({ value, display, onCommit, width = 94, prefix }) {
  const [editing, setEditing] = React.useState(false);
  const ref = React.useRef(null);
  const doneRef = React.useRef(false);
  React.useEffect(() => {
    if (editing && ref.current) {
      ref.current.value = value == null ? "" : String(value);
      ref.current.focus();
      ref.current.select();
    }
  }, [editing]);
  const start = () => {
    doneRef.current = false;
    setEditing(true);
  };
  const commit = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    const raw = ref.current ? ref.current.value : "";
    setEditing(false);
    const clean = String(raw).trim();
    if (clean !== "" && clean !== String(value)) onCommit(clean);
  };
  const cancel = () => {
    doneRef.current = true;
    setEditing(false);
  };
  if (editing) {
    return /* @__PURE__ */ React.createElement("span", { style: { display: "inline-flex", alignItems: "center", gap: 2, justifyContent: "flex-end" }, onClick: (e) => e.stopPropagation() }, prefix && /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" } }, prefix), /* @__PURE__ */ React.createElement(
      "input",
      {
        ref,
        inputMode: "decimal",
        onKeyDown: (e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") cancel();
        },
        onBlur: commit,
        style: { width, height: 24, background: "var(--gd-ink)", border: "1px solid var(--gd-blue)", boxShadow: "0 0 0 2px rgba(77,141,255,0.25)", borderRadius: 5, color: "var(--gd-text)", fontFamily: "var(--font-mono)", fontVariantNumeric: "tabular-nums", fontSize: 12, textAlign: "right", padding: "0 7px", outline: "none" }
      }
    ));
  }
  return /* @__PURE__ */ React.createElement(
    "span",
    {
      onDoubleClick: (e) => {
        e.stopPropagation();
        start();
      },
      onClick: (e) => e.stopPropagation(),
      title: "双击编辑 · 回车确认",
      style: { cursor: "text", display: "inline-block", borderBottom: "1px dashed transparent", paddingBottom: 1, transition: "border-color 120ms" },
      onMouseEnter: (e) => e.currentTarget.style.borderBottomColor = "var(--gd-line-strong)",
      onMouseLeave: (e) => e.currentTarget.style.borderBottomColor = "transparent"
    },
    display != null ? display : value
  );
}
window.GDEditableCell = EditableCell;
function MetricStrip({ metrics = [] }) {
  const tone = (t) => ({ gold: "var(--gd-gold)", danger: "var(--gd-danger)", warning: "var(--gd-warning)", blue: "var(--gd-blue)", success: "var(--gd-success)", muted: "var(--text-3)" })[t] || "var(--text-1)";
  return /* @__PURE__ */ React.createElement("div", { style: { display: "flex", height: 72, flex: "none", background: "var(--surface-region)", borderBottom: "1px solid var(--gd-line)" } }, metrics.map((m, i) => {
    const click = m.onClick;
    return /* @__PURE__ */ React.createElement(
      "div",
      {
        key: i,
        onClick: click || void 0,
        onMouseEnter: click ? (e) => {
          e.currentTarget.style.background = "var(--gd-panel-raised)";
        } : void 0,
        onMouseLeave: click ? (e) => {
          e.currentTarget.style.background = "transparent";
        } : void 0,
        style: {
          flex: 1,
          minWidth: 0,
          padding: "0 16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 3,
          transition: "background 120ms",
          borderRight: i < metrics.length - 1 ? "1px solid var(--gd-line)" : "none",
          cursor: click ? "pointer" : "default"
        }
      },
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-label", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.label),
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-metric-sm", style: { color: m.tone === "muted" ? "var(--text-3)" : tone(m.tone), fontFamily: m.mono ? "var(--font-mono)" : void 0, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, m.value),
      /* @__PURE__ */ React.createElement("span", { className: "gd-t-meta", style: { whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minHeight: 14 } }, m.meta != null ? m.meta : " ")
    );
  }));
}
window.GDMetricStrip = MetricStrip;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/controls.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/data.js
try { (() => {
window.GD_DATA = {
  domains: [
    { id: 1, domain: "vault.io", tags: ["三字母"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom · Afternic", status: "sold", bin: 12800, expiry: "2027-03-14" },
    { id: 2, domain: "goldrail.com", tags: ["portfolio-a"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom", status: "synced", bin: 3500, expiry: "2026-11-02" },
    { id: 3, domain: "kanban.ai", tags: ["AI"], registrar: "Namecheap", dns: "注册商", platforms: "Afternic", status: "synced", bin: 45e3, expiry: "2027-01-28" },
    { id: 4, domain: "lumen.dev", tags: [], registrar: "Dynadot", dns: "Cloudflare", platforms: "SellerHub", status: "conflict", bin: 980, expiry: "2026-09-19" },
    { id: 5, domain: "north.capital", tags: ["portfolio-a"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom · Afternic", status: "synced", bin: 8200, expiry: "2028-05-01" },
    { id: 6, domain: "tessera.xyz", tags: [], registrar: "Namecheap", dns: "注册商", platforms: "—", status: "unlisted", bin: null, expiry: "2026-08-30" },
    { id: 7, domain: "quanta.trade", tags: ["金融"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom", status: "synced", bin: 6600, expiry: "2027-06-11" },
    { id: 8, domain: "driftline.com", tags: ["portfolio-b"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom · Afternic", status: "pending", bin: 2400, expiry: "2026-12-24" },
    { id: 9, domain: "helio.systems", tags: [], registrar: "Dynadot", dns: "注册商", platforms: "Afternic", status: "synced", bin: 1750, expiry: "2027-09-08" },
    { id: 10, domain: "marble.finance", tags: ["金融"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom", status: "synced", bin: 15e3, expiry: "2027-02-17" },
    { id: 11, domain: "oxide.dev", tags: ["AI"], registrar: "Namecheap", dns: "Cloudflare", platforms: "Atom · SellerHub", status: "pending", bin: 5200, expiry: "2026-10-05" },
    { id: 12, domain: "lantern.app", tags: [], registrar: "Spaceship", dns: "Cloudflare", platforms: "Afternic", status: "synced", bin: 3900, expiry: "2027-07-22" },
    { id: 13, domain: "crest.capital", tags: ["金融", "portfolio-a"], registrar: "Spaceship", dns: "Cloudflare", platforms: "Atom · Afternic", status: "synced", bin: 9800, expiry: "2027-11-30" },
    { id: 14, domain: "puresignal.com", tags: [], registrar: "Dynadot", dns: "注册商", platforms: "Atom", status: "synced", bin: 4100, expiry: "2026-09-02" }
  ],
  groups: [
    { id: "g1", platform: "Atom", account: "主账户", action: "修改价格", count: 811, method: "API" },
    { id: "g2", platform: "Afternic", account: "主账户", action: "生成 CSV", count: 823, method: "CSV + 人工上传" },
    { id: "g3", platform: "Cloudflare", account: "DNS 提供商", action: "新增 TXT 记录", count: 17, method: "API" },
    { id: "g5", platform: "注册商", account: "Spaceship · Dynadot", action: "变更 Nameserver", count: 3, method: "API", risk: "high" },
    { id: "g4", platform: "冲突", account: "—", action: "同字段被远端修改", count: 6, method: "已排除" }
  ],
  diffs: [
    { id: 1, domain: "vault.io", field: "BIN", oldV: "14,000.00", newV: "12,800.00", src: "批量规则 −8%", risk: "低", method: "API", state: "auto" },
    { id: 2, domain: "goldrail.com", field: "BIN", oldV: "3,900.00", newV: "3,500.00", src: "批量规则 −8%", risk: "低", method: "API", state: "auto" },
    { id: 3, domain: "kanban.ai", field: "BIN", oldV: "48,000.00", newV: "45,000.00", src: "手动", risk: "中 · 价格变化最大", method: "API", state: "auto" },
    { id: 4, domain: "lumen.dev", field: "BIN", oldV: "1,200.00", newV: "980.00", src: "批量规则 −8%", risk: "低", method: "CSV", state: "manual" },
    { id: 5, domain: "north.capital", field: "BIN", oldV: "8,900.00", newV: "8,200.00", src: "批量规则 −8%", risk: "低", method: "API", state: "conflict" },
    { id: 6, domain: "driftline.com", field: "BIN", oldV: "2,600.00", newV: "2,400.00", src: "批量规则 −8%", risk: "低", method: "API", state: "auto" },
    { id: 7, domain: "marble.finance", field: "BIN", oldV: "16,500.00", newV: "15,000.00", src: "手动", risk: "低", method: "API", state: "auto" },
    { id: 8, domain: "oxide.dev", field: "BIN", oldV: "5,800.00", newV: "5,200.00", src: "批量规则 −8%", risk: "低", method: "CSV", state: "manual" },
    { id: 9, domain: "goldrail.com", field: "Nameserver", oldV: "ns.spaceship.com", newV: "cloudflare.com", src: "迁移至 Cloudflare", risk: "高 · Nameserver", method: "API", state: "auto" },
    { id: 10, domain: "quanta.trade", field: "Nameserver", oldV: "ns.spaceship.com", newV: "cloudflare.com", src: "迁移至 Cloudflare", risk: "高 · Nameserver", method: "API", state: "auto" },
    { id: 11, domain: "helio.systems", field: "Nameserver", oldV: "ns.dynadot.com", newV: "cloudflare.com", src: "迁移至 Cloudflare", risk: "高 · Nameserver", method: "API", state: "auto" }
  ],
  conflicts: [
    { id: 1, group: "价格", domain: "north.capital", field: "BIN", base: "8,900.00", local: "8,200.00", remote: "8,450.00", note: "远端 07-31 由 Atom 后台修改" },
    { id: 2, group: "价格", domain: "driftline.com", field: "BIN", base: "2,600.00", local: "2,400.00", remote: "2,550.00", note: "远端 07-30 修改" },
    { id: 3, group: "价格", domain: "lumen.dev", field: "最低报价", base: "400.00", local: "350.00", remote: "500.00", note: "远端 07-29 修改" },
    { id: 4, group: "价格", domain: "tessera.xyz", field: "BIN", base: "—", local: "1,200.00", remote: "1,500.00", note: "远端新建 Listing" },
    { id: 5, group: "DNS", domain: "kanban.ai", field: "TXT _atomverify", base: "（无）", local: "atom-verify=8f2a…", remote: "atom-verify=c91d…", note: "不提供无预览覆盖" },
    { id: 6, group: "销售状态", domain: "vault.io", field: "Listing 状态", base: "BIN 上架", local: "已售 · 下架", remote: "BIN 上架", note: "Sold 状态不提供全选覆盖" }
  ],
  tasks: [
    { id: 1, title: "Afternic · 上传价格 CSV", platform: "Afternic", account: "主账户", badge: "warning", badgeText: "等待人工", why: "Afternic 无价格写入 API，需在 Seller 后台上传 CSV 文件。", domains: 823, prepared: "afternic-prices-0802.csv · 已生成 14:02", done: "Upload History 出现本文件且状态 Processed", lastCheck: "14:06" },
    { id: 2, title: "SellerHub · 已售域名下架", platform: "SellerHub", account: "主账户", badge: "danger", badgeText: "高优先级", why: "vault.io 已在 Atom 售出，需从 SellerHub 手工下架，避免二次销售。", domains: 1, prepared: "域名清单已复制到剪贴板", done: "SellerHub Listing 状态为 Removed", lastCheck: "13:58" },
    { id: 3, title: "Spaceship · 会话已过期", platform: "Spaceship", account: "主账户", badge: "warning", badgeText: "需登录", why: "注册商会话失效，17 项 TXT 验证记录等待写入。", domains: 17, prepared: "TXT 记录值已准备", done: "重新登录后自动继续", lastCheck: "13:40" },
    { id: 4, title: "Atom · API Key 即将到期", platform: "Atom", account: "子账户 B", badge: "neutral", badgeText: "7 天后", why: "API Key 于 08-09 到期，需在 Atom 控制台生成新 Key 并录入。", domains: 0, prepared: "—", done: "新 Key 通过健康检查", lastCheck: "今日 09:00" }
  ],
  batchJobs: [
    { id: "b-draft", name: "批量改价", rule: "BIN −8% · 2 平台", target: 823, platform: "Atom / Afternic", account: "主账户", created: "今日 14:02", status: "draft", risk: "high", auto: 811, manual: 12, conflict: 6 },
    { id: "b-run", name: "变更 Nameserver → Cloudflare", rule: "迁移 DNS · 3 注册商", target: 146, platform: "注册商", account: "Spaceship · Dynadot", created: "今日 13:31", status: "running", risk: "high", progress: 62 },
    { id: "b-done", name: "上架到 Atom", rule: "新建 Listing · BIN", target: 512, platform: "Atom", account: "主账户", created: "今日 11:20", status: "done", risk: "low", progress: 100, result: { ok: 512, waiting: 0, retry: 0, unknown: 0, manual: 0, failed: 0 }, op: "OP-2026-0804-07" },
    { id: "b-part", name: "DNS 记录同步", rule: "TXT 验证写入", target: 88, platform: "Cloudflare / 注册商", account: "DNS 提供商", created: "昨日 18:44", status: "partial", risk: "mid", progress: 100, result: { ok: 79, waiting: 0, retry: 3, unknown: 0, manual: 6, failed: 0 }, op: "OP-2026-0803-22" },
    { id: "b-rb", name: "批量改价", rule: "BIN −12% · 全库", target: 240, platform: "Atom", account: "主账户", created: "昨日 09:12", status: "rolledback", risk: "low", progress: 100, rolledTo: 8204, op: "OP-2026-0803-05" }
  ]
};
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/data.js", error: String((error && error.message) || error) }); }

// ui_kits/desktop/dialogs.jsx
try { (() => {
const { Dialog: GDDialog, Input: GDInput, Select: GDSel, Checkbox: GDCheck, Button: GDBtn, Money: GDMoney, Badge: GDBadge } = window.GoodDealerDesignSystem_b5b0b6;
const fmt = (n) => n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const num = (v) => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
function Seg({ value, onChange, items }) {
  return /* @__PURE__ */ React.createElement("div", { style: { display: "inline-flex", background: "var(--gd-ink)", border: "1px solid var(--gd-line-strong)", borderRadius: 6, padding: 2, gap: 2 } }, items.map((it) => /* @__PURE__ */ React.createElement("button", { key: it.k, onClick: () => onChange(it.k), style: {
    height: 26,
    padding: "0 12px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontFamily: "var(--font-sans)",
    fontSize: 12,
    transition: "background 120ms,color 120ms",
    background: value === it.k ? "var(--gd-panel-raised)" : "transparent",
    color: value === it.k ? "var(--text-1)" : "var(--text-2)",
    fontWeight: value === it.k ? 500 : 400
  } }, it.label)));
}
const rowLine = { display: "flex", alignItems: "center", gap: 10, padding: "7px 0", borderBottom: "1px solid var(--gd-line)" };
const label = { fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--gd-text-muted)", fontWeight: 500 };
function BatchPriceDialog({ open, domains, onClose, onSubmit }) {
  const [mode, setMode] = React.useState("uniform");
  const [uniform, setUniform] = React.useState("");
  const [dir, setDir] = React.useState("down");
  const [pct, setPct] = React.useState("8");
  const [each, setEach] = React.useState({});
  const [master, setMaster] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setMode("uniform");
      setUniform("");
      setDir("down");
      setPct("8");
      setMaster("");
      const m = {};
      domains.forEach((d) => m[d.id] = d.bin != null ? String(d.bin) : "");
      setEach(m);
    }
  }, [open]);
  if (!open) return null;
  const newPrice = (d) => {
    if (mode === "uniform") return uniform === "" ? d.bin : num(uniform);
    if (mode === "percent") {
      const p = num(pct) / 100;
      return d.bin == null ? null : Math.round(d.bin * (dir === "down" ? 1 - p : 1 + p));
    }
    return each[d.id] === "" || each[d.id] == null ? d.bin : num(each[d.id]);
  };
  const oldSum = domains.reduce((s, d) => s + (d.bin || 0), 0);
  const newSum = domains.reduce((s, d) => s + (newPrice(d) || 0), 0);
  const delta = newSum - oldSum;
  return /* @__PURE__ */ React.createElement(
    GDDialog,
    {
      open: true,
      onClose,
      title: `批量改价 · ${domains.length} 个域名`,
      width: mode === "each" ? 600 : 480,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(GDBtn, { onClick: onClose }, "取消"), /* @__PURE__ */ React.createElement(GDBtn, { variant: "primary", onClick: () => onSubmit(domains.length) }, "生成批量计划 · ", domains.length, " 项"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement(Seg, { value: mode, onChange: setMode, items: [{ k: "uniform", label: "统一价格" }, { k: "percent", label: "按比例调整" }, { k: "each", label: "逐个设置" }] }), mode === "uniform" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(GDInput, { size: "md", mono: true, prefix: "$", placeholder: "0.00", value: uniform, onChange: (e) => setUniform(e.target.value), style: { width: 180 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "应用到全部 ", /* @__PURE__ */ React.createElement("b", { style: { fontFamily: "var(--font-mono)" } }, domains.length), " 个域名的 BIN")), mode === "percent" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(Seg, { value: dir, onChange: setDir, items: [{ k: "down", label: "下调" }, { k: "up", label: "上调" }] }), /* @__PURE__ */ React.createElement(GDInput, { size: "md", mono: true, suffix: "%", value: pct, onChange: (e) => setPct(e.target.value), style: { width: 110 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "示例 ", fmt(domains[0] && domains[0].bin), " → ", /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-gold)", fontFamily: "var(--font-mono)" } }, fmt(domains[0] && newPrice(domains[0]))))), mode === "each" && /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "统一填入"), /* @__PURE__ */ React.createElement(GDInput, { size: "sm", mono: true, prefix: "$", placeholder: "0.00", value: master, onChange: (e) => setMaster(e.target.value), style: { width: 140 } }), /* @__PURE__ */ React.createElement(GDBtn, { size: "sm", onClick: () => {
      const m = {};
      domains.forEach((d) => m[d.id] = master);
      setEach(m);
    } }, "应用到全部")), /* @__PURE__ */ React.createElement("div", { style: { maxHeight: 250, overflow: "auto", border: "1px solid var(--gd-line)", borderRadius: 7 } }, /* @__PURE__ */ React.createElement("div", { style: { ...rowLine, padding: "8px 12px", position: "sticky", top: 0, background: "var(--gd-panel)" } }, /* @__PURE__ */ React.createElement("span", { style: { ...label, flex: 1 } }, "域名"), /* @__PURE__ */ React.createElement("span", { style: { ...label, width: 120, textAlign: "right" } }, "当前"), /* @__PURE__ */ React.createElement("span", { style: { ...label, width: 150, textAlign: "right" } }, "新 BIN")), domains.map((d) => /* @__PURE__ */ React.createElement("div", { key: d.id, style: { ...rowLine, padding: "7px 12px" } }, /* @__PURE__ */ React.createElement("span", { style: { flex: 1, fontFamily: "var(--font-mono)", fontSize: 12 } }, d.domain), /* @__PURE__ */ React.createElement("span", { style: { width: 120, textAlign: "right", fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--gd-text-faint)" } }, fmt(d.bin)), /* @__PURE__ */ React.createElement("span", { style: { width: 150, display: "flex", justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement(GDInput, { size: "sm", mono: true, prefix: "$", value: each[d.id] ?? "", onChange: (e) => setEach((x) => ({ ...x, [d.id]: e.target.value })), style: { width: 140 } })))))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid var(--gd-line)", paddingTop: 11, fontSize: 12 } }, /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-muted)" } }, "选中组合估值"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-text-faint)" } }, "$", fmt(oldSum)), /* @__PURE__ */ React.createElement("span", { style: { color: "var(--gd-text-faint)" } }, "→"), /* @__PURE__ */ React.createElement("span", { style: { fontFamily: "var(--font-mono)", color: "var(--gd-gold)" } }, "$", fmt(newSum)), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontFamily: "var(--font-mono)", color: delta < 0 ? "var(--gd-danger)" : delta > 0 ? "var(--gd-success)" : "var(--gd-text-faint)" } }, delta === 0 ? "±0" : `${delta < 0 ? "−" : "+"}$${fmt(Math.abs(delta))}`)), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "生成计划后进入批量差异预览：逐项确认执行方式、风险与冲突，再提交。"))
  );
}
function BatchNsDialog({ open, domains, onClose, onApply }) {
  const [mode, setMode] = React.useState("platform");
  const [target, setTarget] = React.useState("销售平台托管 NS");
  const [ns1, setNs1] = React.useState("");
  const [ns2, setNs2] = React.useState("");
  const [ack, setAck] = React.useState(false);
  const I = window.GDI;
  React.useEffect(() => {
    if (open) {
      setMode("platform");
      setTarget("销售平台托管 NS");
      setNs1("");
      setNs2("");
      setAck(false);
    }
  }, [open]);
  if (!open) return null;
  const applied = mode === "platform" ? target : "自定义 NS";
  return /* @__PURE__ */ React.createElement(
    GDDialog,
    {
      open: true,
      onClose,
      title: `变更 Nameserver · ${domains.length} 个域名`,
      width: 520,
      danger: true,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(GDBtn, { onClick: onClose }, "取消"), /* @__PURE__ */ React.createElement(GDBtn, { variant: "danger", disabled: !ack || mode === "custom" && !ns1, onClick: () => onApply({ mode, applied }) }, "提交 · ", domains.length, " 项"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", { style: { ...label, color: "var(--gd-text-faint)" } }, "处理平台"), /* @__PURE__ */ React.createElement("span", null, "注册商 · 变更域名的 Nameserver 委派")), /* @__PURE__ */ React.createElement(Seg, { value: mode, onChange: setMode, items: [{ k: "platform", label: "指向销售平台 NS · 推荐" }, { k: "custom", label: "自定义 Nameserver" }] }), mode === "platform" ? /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)" } }, "在注册商处将 Nameserver 统一指向所选目标（改变的是 NS 委派，而非具体记录）。"), /* @__PURE__ */ React.createElement("label", { className: "gd-field", style: { maxWidth: 280 } }, /* @__PURE__ */ React.createElement("span", { style: label }, "目标 Nameserver"), /* @__PURE__ */ React.createElement(GDSel, { size: "md", options: ["销售平台托管 NS", "Cloudflare NS", "注册商默认 NS"], value: target, onChange: (e) => setTarget(e.target.value) }))) : /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10 } }, /* @__PURE__ */ React.createElement(GDInput, { label: "NS 1", size: "md", mono: true, placeholder: "ns1.example.com", value: ns1, onChange: (e) => setNs1(e.target.value), style: { flex: 1 } }), /* @__PURE__ */ React.createElement(GDInput, { label: "NS 2", size: "md", mono: true, placeholder: "ns2.example.com", value: ns2, onChange: (e) => setNs2(e.target.value), style: { flex: 1 } })), /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-danger)", background: "var(--gd-danger-tint)", borderRadius: 7, padding: "11px 13px", display: "flex", flexDirection: "column", gap: 9 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8 } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 15, style: { color: "var(--gd-danger)", flex: "none" } }), /* @__PURE__ */ React.createElement("b", { style: { color: "var(--gd-danger)", fontSize: 13 } }, "高风险 · Nameserver 变更"), /* @__PURE__ */ React.createElement("span", { style: { marginLeft: "auto", fontSize: 11, color: "var(--gd-text-muted)" } }, "可回滚")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text)", lineHeight: 1.5 } }, "切换 Nameserver 会将 DNS 权威整体移交给新 NS：旧提供商的全部记录（A/MX/TXT）立即失效，解析与邮件在传播完成前可能中断（约 5–30 分钟）。回滚同样需要传播时间。"), /* @__PURE__ */ React.createElement("div", { style: { borderTop: "1px solid rgba(229,115,95,0.24)", paddingTop: 9 } }, /* @__PURE__ */ React.createElement(GDCheck, { checked: ack, onChange: () => setAck((a) => !a), label: `我已理解后果，确认在注册商处对这 ${domains.length} 个域名变更 Nameserver` }))))
  );
}
function BatchRecordsDialog({ open, domains, onClose, onApply }) {
  const I = window.GDI;
  const TYPES = ["A", "AAAA", "CNAME", "TXT", "MX"];
  const [rtype, setRtype] = React.useState("TXT");
  const [host, setHost] = React.useState("@");
  const [value, setValue] = React.useState("");
  const [ttl, setTtl] = React.useState("Auto");
  React.useEffect(() => {
    if (open) {
      setRtype("TXT");
      setHost("@");
      setValue("");
      setTtl("Auto");
    }
  }, [open]);
  if (!open) return null;
  const ph = { A: "185.199.108.153", AAAA: "2606:50c0:8000::153", CNAME: "target.example.com", TXT: "atom-verify=8f2a…", MX: "10 mail.example.com" }[rtype] || "";
  const routing = ["A", "AAAA", "CNAME", "MX"].includes(rtype);
  return /* @__PURE__ */ React.createElement(
    GDDialog,
    {
      open: true,
      onClose,
      title: `修改 DNS 记录 · ${domains.length} 个域名`,
      width: 560,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(GDBtn, { onClick: onClose }, "取消"), /* @__PURE__ */ React.createElement(GDBtn, { variant: "primary", disabled: !value, onClick: () => onApply({ rtype, host, value, ttl }) }, "提交 · ", domains.length, " 项"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gd-text-muted)" } }, /* @__PURE__ */ React.createElement("span", { style: { ...label, color: "var(--gd-text-faint)" } }, "处理平台"), /* @__PURE__ */ React.createElement("span", null, "DNS 提供商 · 按各域名当前提供商分别下发（Nameserver 不变）")), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 10, alignItems: "flex-end" } }, /* @__PURE__ */ React.createElement("label", { className: "gd-field", style: { width: 110 } }, /* @__PURE__ */ React.createElement("span", { style: label }, "类型"), /* @__PURE__ */ React.createElement(GDSel, { size: "md", options: TYPES, value: rtype, onChange: (e) => setRtype(e.target.value) })), /* @__PURE__ */ React.createElement(GDInput, { label: "主机", size: "md", mono: true, placeholder: "@ 或 www", value: host, onChange: (e) => setHost(e.target.value), style: { width: 160 } }), /* @__PURE__ */ React.createElement("label", { className: "gd-field", style: { width: 110 } }, /* @__PURE__ */ React.createElement("span", { style: label }, "TTL"), /* @__PURE__ */ React.createElement(GDSel, { size: "md", options: ["Auto", "300", "3600", "86400"], value: ttl, onChange: (e) => setTtl(e.target.value) }))), /* @__PURE__ */ React.createElement(GDInput, { label: `值（${rtype}）`, size: "md", mono: true, placeholder: ph, value, onChange: (e) => setValue(e.target.value) }), routing && /* @__PURE__ */ React.createElement("div", { style: { border: "1px solid var(--gd-warning)", background: "var(--gd-warning-tint)", borderRadius: 7, padding: "9px 12px", display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--gd-text)" } }, /* @__PURE__ */ React.createElement(I.AlertTriangle, { size: 14, style: { color: "var(--gd-warning)", flex: "none" } }), "需留意 · 修改 ", rtype, " 记录会影响解析", rtype === "MX" ? "与邮件收发" : "", "；DNS 提供商即时下发，无 Nameserver 传播等待。"), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "与 Nameserver 变更不同：记录由 DNS 提供商即时生效，不改变域名的 NS 委派；可安全重试。"))
  );
}
function ListDialog({ open, domains, onClose, onApply }) {
  const ALL = ["Atom", "Afternic", "SellerHub"];
  const [plats, setPlats] = React.useState(["Atom"]);
  const [price, setPrice] = React.useState("");
  React.useEffect(() => {
    if (open) {
      setPlats(["Atom"]);
      setPrice("");
    }
  }, [open]);
  if (!open) return null;
  const toggle = (p) => setPlats((x) => x.includes(p) ? x.filter((i) => i !== p) : [...x, p]);
  return /* @__PURE__ */ React.createElement(
    GDDialog,
    {
      open: true,
      onClose,
      title: `上架 · ${domains.length} 个域名`,
      width: 480,
      footer: /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement(GDBtn, { onClick: onClose }, "取消"), /* @__PURE__ */ React.createElement(GDBtn, { variant: "primary", disabled: plats.length === 0, onClick: () => onApply({ platforms: plats, price: price === "" ? null : num(price) }) }, "上架 · ", domains.length, " 项"))
    },
    /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 14 } }, /* @__PURE__ */ React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 8 } }, /* @__PURE__ */ React.createElement("span", { style: label }, "上架平台"), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", gap: 8 } }, ALL.map((p) => {
      const on = plats.includes(p);
      return /* @__PURE__ */ React.createElement("button", { key: p, onClick: () => toggle(p), style: {
        height: 32,
        padding: "0 14px",
        borderRadius: 6,
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        fontSize: 13,
        transition: "all 120ms",
        border: `1px solid ${on ? "var(--gd-blue)" : "var(--gd-line-strong)"}`,
        background: on ? "var(--gd-blue-tint)" : "var(--gd-ink)",
        color: on ? "var(--gd-blue)" : "var(--gd-text-muted)"
      } }, p);
    }))), /* @__PURE__ */ React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 12 } }, /* @__PURE__ */ React.createElement(GDInput, { label: "统一 BIN（可选）", size: "md", mono: true, prefix: "$", placeholder: "0.00", value: price, onChange: (e) => setPrice(e.target.value), style: { width: 200 } }), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 12, color: "var(--gd-text-muted)", alignSelf: "flex-end", paddingBottom: 7 } }, "留空则沿用各域名当前 BIN，可上架后单独调整")), /* @__PURE__ */ React.createElement("span", { style: { fontSize: 11, color: "var(--gd-text-faint)" } }, "上架为可安全重试操作；结果以平台 Listing 状态为准，写入未同步修改并在下次同步提交。"))
  );
}
window.GDDialogs = { BatchPriceDialog, BatchNsDialog, BatchRecordsDialog, ListDialog };
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/dialogs.jsx", error: String((error && error.message) || error) }); }

// ui_kits/desktop/icons.jsx
try { (() => {
const mkIcon = (children) => ({ size = 15, style, ...p }) => /* @__PURE__ */ React.createElement("svg", { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round", style, ...p }, children);
const GDI = {
  Globe: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "10" }), /* @__PURE__ */ React.createElement("path", { d: "M2 12h20" }), /* @__PURE__ */ React.createElement("path", { d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" }))),
  Coins: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "8", cy: "8", r: "6" }), /* @__PURE__ */ React.createElement("path", { d: "M18.09 10.37A6 6 0 1 1 10.34 18" }), /* @__PURE__ */ React.createElement("path", { d: "M7 6h1v4" }), /* @__PURE__ */ React.createElement("path", { d: "m16.71 13.88.7.71-2.82 2.82" }))),
  Shield: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" }), /* @__PURE__ */ React.createElement("path", { d: "m9 12 2 2 4-4" }))),
  ListChecks: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m3 17 2 2 4-4" }), /* @__PURE__ */ React.createElement("path", { d: "m3 7 2 2 4-4" }), /* @__PURE__ */ React.createElement("path", { d: "M13 6h8" }), /* @__PURE__ */ React.createElement("path", { d: "M13 12h8" }), /* @__PURE__ */ React.createElement("path", { d: "M13 18h8" }))),
  AlertTriangle: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" }), /* @__PURE__ */ React.createElement("path", { d: "M12 9v4" }), /* @__PURE__ */ React.createElement("path", { d: "M12 17h.01" }))),
  Inbox: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("polyline", { points: "22 12 16 12 14 15 10 15 8 12 2 12" }), /* @__PURE__ */ React.createElement("path", { d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" }))),
  History: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 3v5h5" }), /* @__PURE__ */ React.createElement("path", { d: "M3.05 13A9 9 0 1 0 6 5.3L3 8" }), /* @__PURE__ */ React.createElement("path", { d: "M12 7v5l4 2" }))),
  Settings: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" }), /* @__PURE__ */ React.createElement("circle", { cx: "12", cy: "12", r: "3" }))),
  Search: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("circle", { cx: "11", cy: "11", r: "7" }), /* @__PURE__ */ React.createElement("path", { d: "m20 20-3.5-3.5" }))),
  RefreshCw: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M3 12a9 9 0 0 1 15.6-6.2L21 8" }), /* @__PURE__ */ React.createElement("path", { d: "M21 3v5h-5" }), /* @__PURE__ */ React.createElement("path", { d: "M21 12a9 9 0 0 1-15.6 6.2L3 16" }), /* @__PURE__ */ React.createElement("path", { d: "M3 21v-5h5" }))),
  Upload: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" }), /* @__PURE__ */ React.createElement("polyline", { points: "17 8 12 3 7 8" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "3", x2: "12", y2: "15" }))),
  X: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M18 6 6 18" }), /* @__PURE__ */ React.createElement("path", { d: "m6 6 12 12" }))),
  ChevronRight: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m9 18 6-6-6-6" })),
  ChevronLeft: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "m15 18-6-6 6-6" })),
  ExternalLink: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 3h6v6" }), /* @__PURE__ */ React.createElement("path", { d: "M10 14 21 3" }), /* @__PURE__ */ React.createElement("path", { d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" }))),
  Monitor: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "2", y: "3", width: "20", height: "14", rx: "2" }), /* @__PURE__ */ React.createElement("line", { x1: "8", y1: "21", x2: "16", y2: "21" }), /* @__PURE__ */ React.createElement("line", { x1: "12", y1: "17", x2: "12", y2: "21" }))),
  Pause: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("rect", { x: "14", y: "4", width: "4", height: "16", rx: "1" }), /* @__PURE__ */ React.createElement("rect", { x: "6", y: "4", width: "4", height: "16", rx: "1" }))),
  Play: mkIcon(/* @__PURE__ */ React.createElement("polygon", { points: "6 3 20 12 6 21 6 3" })),
  FileText: mkIcon(/* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("path", { d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" }), /* @__PURE__ */ React.createElement("path", { d: "M14 2v4a2 2 0 0 0 2 2h4" }), /* @__PURE__ */ React.createElement("path", { d: "M10 9H8" }), /* @__PURE__ */ React.createElement("path", { d: "M16 13H8" }), /* @__PURE__ */ React.createElement("path", { d: "M16 17H8" }))),
  Check: mkIcon(/* @__PURE__ */ React.createElement("path", { d: "M20 6 9 17l-5-5" }))
};
window.GDI = GDI;
})(); } catch (error) { __ds_ns.__errors.push({ path: "ui_kits/desktop/icons.jsx", error: String((error && error.message) || error) }); }

})();
