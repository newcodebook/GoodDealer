/* @ds-bundle: {"format":4,"namespace":"GoodDealerDesignSystem_b5b0b6","components":[{"name":"Button","sourcePath":"components/buttons/Button.jsx"},{"name":"IconButton","sourcePath":"components/buttons/IconButton.jsx"},{"name":"Checkbox","sourcePath":"components/inputs/Checkbox.jsx"},{"name":"Input","sourcePath":"components/inputs/Input.jsx"},{"name":"Select","sourcePath":"components/inputs/Select.jsx"},{"name":"Switch","sourcePath":"components/inputs/Switch.jsx"},{"name":"StatusBar","sourcePath":"components/navigation/StatusBar.jsx"},{"name":"Tabs","sourcePath":"components/navigation/Tabs.jsx"},{"name":"Dialog","sourcePath":"components/overlay/Dialog.jsx"},{"name":"Tooltip","sourcePath":"components/overlay/Tooltip.jsx"},{"name":"Badge","sourcePath":"components/status/Badge.jsx"},{"name":"DiffValue","sourcePath":"components/status/DiffValue.jsx"},{"name":"Money","sourcePath":"components/status/Money.jsx"},{"name":"ProgressBar","sourcePath":"components/status/ProgressBar.jsx"},{"name":"StatusDot","sourcePath":"components/status/StatusDot.jsx"},{"name":"Tag","sourcePath":"components/status/Tag.jsx"},{"name":"KpiStat","sourcePath":"components/surfaces/KpiStat.jsx"},{"name":"Panel","sourcePath":"components/surfaces/Panel.jsx"},{"name":"Toolbar","sourcePath":"components/surfaces/Toolbar.jsx"},{"name":"WindowChrome","sourcePath":"components/surfaces/WindowChrome.jsx"},{"name":"BatchBar","sourcePath":"components/table/BatchBar.jsx"},{"name":"Pagination","sourcePath":"components/table/Pagination.jsx"},{"name":"Table","sourcePath":"components/table/Table.jsx"}],"sourceHashes":{"components/buttons/Button.jsx":"06f13793a4c3","components/buttons/IconButton.jsx":"5073d2ee2468","components/inputs/Checkbox.jsx":"eab26333fdff","components/inputs/Input.jsx":"28bc9a3cfb1e","components/inputs/Select.jsx":"13bef0c63f99","components/inputs/Switch.jsx":"e2b8bc78d246","components/navigation/StatusBar.jsx":"6b8a50890fd0","components/navigation/Tabs.jsx":"292f9554a615","components/overlay/Dialog.jsx":"76f86cbedce4","components/overlay/Tooltip.jsx":"0dc6e2c56a61","components/status/Badge.jsx":"c0d923706bbc","components/status/DiffValue.jsx":"1cb3d1ff1b04","components/status/Money.jsx":"265b084b3d35","components/status/ProgressBar.jsx":"1a02180b9287","components/status/StatusDot.jsx":"3e7a02a85357","components/status/Tag.jsx":"88ba07570965","components/surfaces/KpiStat.jsx":"a3935e7c2da7","components/surfaces/Panel.jsx":"7af100184d7e","components/surfaces/Toolbar.jsx":"be0f9dfc2c9b","components/surfaces/WindowChrome.jsx":"49f93dd09b9a","components/table/BatchBar.jsx":"399466fcca69","components/table/Pagination.jsx":"8fd31f35c36a","components/table/Table.jsx":"7964646bfb44","ui_kits/desktop/AssetLibrary.jsx":"0835b46ff655","ui_kits/desktop/BatchPreview.jsx":"f9080e120842","ui_kits/desktop/ConflictCenter.jsx":"0a733db80ba7","ui_kits/desktop/DnsVerify.jsx":"2f5b367690c0","ui_kits/desktop/DomainDetail.jsx":"341c32cc552e","ui_kits/desktop/HistoryLog.jsx":"e7b6f789fa65","ui_kits/desktop/Onboarding.jsx":"e3571551122f","ui_kits/desktop/RenewDesk.jsx":"01266ba2165a","ui_kits/desktop/SalesDesk.jsx":"39d28c2c4dee","ui_kits/desktop/SettingsPanel.jsx":"41e319230579","ui_kits/desktop/Shell.jsx":"c758843b23b7","ui_kits/desktop/SignIn.jsx":"4de44c94b53b","ui_kits/desktop/TaskInbox.jsx":"5bc32f07cd02","ui_kits/desktop/controls.jsx":"dcc2609626ba","ui_kits/desktop/data.js":"d24f606c3fc6","ui_kits/desktop/dialogs.jsx":"e2796821d7aa","ui_kits/desktop/icons.jsx":"c9a0fded6c44"},"inlinedExternals":[],"unexposedExports":[{"name":"ensureGdCss","sourcePath":"components/buttons/Button.jsx"}]} */

(() => {

const __ds_ns = (window.GoodDealerDesignSystem_b5b0b6 = window.GoodDealerDesignSystem_b5b0b6 || {});

const __ds_scope = {};

(__ds_ns.__errors = __ds_ns.__errors || []);

// components/buttons/Button.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
function Button({
  variant = "secondary",
  size = "md",
  icon,
  children,
  block,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    className: `gd-btn gd-btn--${size} gd-btn--${variant}`,
    style: block ? {
      width: "100%"
    } : undefined
  }, rest), icon, children);
}
Object.assign(__ds_scope, { ensureGdCss, Button });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/Button.jsx", error: String((e && e.message) || e) }); }

// components/buttons/IconButton.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
__ds_scope.ensureGdCss("gd-iconbtn-css", css);
function IconButton({
  variant = "ghost",
  size = "md",
  label,
  children,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("button", _extends({
    className: `gd-iconbtn gd-iconbtn--${size}${variant === "outline" ? " gd-iconbtn--outline" : ""}`,
    title: label,
    "aria-label": label
  }, rest), children);
}
Object.assign(__ds_scope, { IconButton });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/buttons/IconButton.jsx", error: String((e && e.message) || e) }); }

// components/inputs/Checkbox.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-check-css", css);
function Checkbox({
  checked,
  indeterminate,
  onChange,
  label,
  disabled,
  stop
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: `gd-check${disabled ? " gd-check--disabled" : ""}`,
    onClick: stop ? e => e.stopPropagation() : undefined
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!checked,
    disabled: disabled,
    onChange: onChange || (() => {})
  }), /*#__PURE__*/React.createElement("span", {
    className: `gd-check-box${indeterminate && !checked ? " gd-check-box--ind" : ""}`
  }, /*#__PURE__*/React.createElement("svg", {
    className: "gd-check-tick",
    width: "9",
    height: "9",
    viewBox: "0 0 10 10",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1.5 5.5L4 8L8.5 2",
    stroke: "#fff",
    strokeWidth: "1.8",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), /*#__PURE__*/React.createElement("svg", {
    className: "gd-check-dash",
    width: "9",
    height: "9",
    viewBox: "0 0 10 10",
    fill: "none"
  }, /*#__PURE__*/React.createElement("path", {
    d: "M2 5H8",
    stroke: "#fff",
    strokeWidth: "1.8",
    strokeLinecap: "round"
  }))), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Checkbox });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/inputs/Checkbox.jsx", error: String((e && e.message) || e) }); }

// components/inputs/Input.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
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
__ds_scope.ensureGdCss("gd-input-css", css);
function Input({
  label,
  size = "md",
  mono,
  prefix,
  suffix,
  error,
  hint,
  style,
  ...rest
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: "gd-field",
    style: style
  }, label && /*#__PURE__*/React.createElement("span", {
    className: "gd-field-label"
  }, label), /*#__PURE__*/React.createElement("span", {
    className: `gd-input-wrap gd-input-wrap--${size}${error ? " gd-input-wrap--error" : ""}`
  }, prefix && /*#__PURE__*/React.createElement("span", {
    className: "gd-input-affix"
  }, prefix), /*#__PURE__*/React.createElement("input", _extends({
    className: `gd-input${mono ? " gd-input--mono" : ""}`
  }, rest)), suffix && /*#__PURE__*/React.createElement("span", {
    className: "gd-input-affix"
  }, suffix)), (error || hint) && /*#__PURE__*/React.createElement("span", {
    className: `gd-field-hint${error ? " gd-field-hint--error" : ""}`
  }, error || hint));
}
Object.assign(__ds_scope, { Input });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/inputs/Input.jsx", error: String((e && e.message) || e) }); }

// components/inputs/Select.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const css = `
.gd-select{appearance:none;background:var(--gd-ink);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);color:var(--gd-text);font-family:var(--font-sans);font-size:13px;padding:0 26px 0 9px;cursor:pointer;transition:border-color var(--dur-fast) var(--ease-out)}
.gd-select:focus-visible{outline:none;border-color:var(--gd-blue);box-shadow:0 0 0 2px rgba(77,141,255,0.25)}
.gd-select:hover{border-color:#343B4E}
.gd-select--sm{height:var(--control-sm)}.gd-select--md{height:var(--control-md)}.gd-select--lg{height:var(--control-lg)}
.gd-select-wrap{position:relative;display:inline-flex}
.gd-select-wrap:after{content:"";position:absolute;right:9px;top:50%;margin-top:-2px;width:7px;height:7px;border-right:1.5px solid var(--gd-text-muted);border-bottom:1.5px solid var(--gd-text-muted);transform:rotate(45deg) translateY(-50%);pointer-events:none}
`;
__ds_scope.ensureGdCss("gd-select-css", css);
function Select({
  label,
  size = "md",
  options = [],
  style,
  ...rest
}) {
  const sel = /*#__PURE__*/React.createElement("span", {
    className: "gd-select-wrap",
    style: label ? undefined : style
  }, /*#__PURE__*/React.createElement("select", _extends({
    className: `gd-select gd-select--${size}`
  }, rest), options.map(o => typeof o === "string" ? /*#__PURE__*/React.createElement("option", {
    key: o,
    value: o
  }, o) : /*#__PURE__*/React.createElement("option", {
    key: o.value,
    value: o.value
  }, o.label))));
  if (!label) return sel;
  return /*#__PURE__*/React.createElement("label", {
    className: "gd-field",
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-field-label"
  }, label), sel);
}
Object.assign(__ds_scope, { Select });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/inputs/Select.jsx", error: String((e && e.message) || e) }); }

// components/inputs/Switch.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-switch-css", css);
function Switch({
  checked,
  onChange,
  label,
  disabled
}) {
  return /*#__PURE__*/React.createElement("label", {
    className: `gd-switch${disabled ? " gd-switch--disabled" : ""}`
  }, /*#__PURE__*/React.createElement("input", {
    type: "checkbox",
    checked: !!checked,
    disabled: disabled,
    onChange: onChange || (() => {})
  }), /*#__PURE__*/React.createElement("span", {
    className: "gd-switch-track"
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { Switch });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/inputs/Switch.jsx", error: String((e && e.message) || e) }); }

// components/navigation/StatusBar.jsx
try { (() => {
const css = `
.gd-statusbar{height:var(--statusbar-h);flex:none;display:flex;align-items:center;padding:0 6px;background:var(--gd-chrome);border-top:1px solid var(--gd-line);font-family:var(--font-mono);font-size:11px;font-variant-numeric:tabular-nums;color:var(--text-2);user-select:none}
.gd-statusbar-seg{display:inline-flex;align-items:center;gap:6px;padding:0 10px;white-space:nowrap}
.gd-statusbar-div{width:1px;height:12px;background:var(--gd-line-strong);flex:none}
.gd-statusbar-spacer{flex:1}
`;
__ds_scope.ensureGdCss("gd-statusbar-css", css);
function join(arr) {
  const out = [];
  arr.forEach((n, i) => {
    if (i) out.push(/*#__PURE__*/React.createElement("span", {
      key: "d" + i,
      className: "gd-statusbar-div"
    }));
    out.push(/*#__PURE__*/React.createElement("span", {
      key: i,
      className: "gd-statusbar-seg"
    }, n));
  });
  return out;
}
function StatusBar({
  left = [],
  right = [],
  style
}) {
  return /*#__PURE__*/React.createElement("footer", {
    className: "gd-statusbar",
    style: style
  }, join(left), /*#__PURE__*/React.createElement("span", {
    className: "gd-statusbar-spacer"
  }), join(right));
}
Object.assign(__ds_scope, { StatusBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/StatusBar.jsx", error: String((e && e.message) || e) }); }

// components/navigation/Tabs.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-tabs-css", css);
function Tabs({
  items = [],
  active,
  onChange,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "gd-tabs",
    style: style,
    role: "tablist"
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.key,
    role: "tab",
    "aria-selected": active === it.key,
    className: `gd-tab${active === it.key ? " gd-tab--active" : ""}`,
    onClick: () => onChange && onChange(it.key)
  }, it.label, it.count != null && /*#__PURE__*/React.createElement("span", {
    className: "gd-tab-count"
  }, it.count))));
}
Object.assign(__ds_scope, { Tabs });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/navigation/Tabs.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Dialog.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-dialog-css", css);
function Dialog({
  open,
  onClose,
  title,
  children,
  footer,
  width = 440,
  danger
}) {
  React.useEffect(() => {
    if (!open) return;
    const h = e => {
      if (e.key === "Escape" && onClose) onClose();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open, onClose]);
  if (!open) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "gd-dialog-scrim",
    onMouseDown: e => {
      if (e.target === e.currentTarget && onClose) onClose();
    }
  }, /*#__PURE__*/React.createElement("div", {
    className: `gd-dialog${danger ? " gd-dialog--danger" : ""}`,
    style: {
      width
    },
    role: "dialog",
    "aria-modal": "true"
  }, /*#__PURE__*/React.createElement("div", {
    className: "gd-dialog-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-dialog-title"
  }, title), onClose && /*#__PURE__*/React.createElement("button", {
    className: "gd-dialog-x",
    onClick: onClose,
    "aria-label": "\u5173\u95ED"
  }, "\u2715")), /*#__PURE__*/React.createElement("div", {
    className: "gd-dialog-body"
  }, children), footer && /*#__PURE__*/React.createElement("div", {
    className: "gd-dialog-foot"
  }, footer)));
}
Object.assign(__ds_scope, { Dialog });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Dialog.jsx", error: String((e && e.message) || e) }); }

// components/overlay/Tooltip.jsx
try { (() => {
const css = `
.gd-tip{position:relative;display:inline-flex}
.gd-tip-bubble{position:absolute;bottom:calc(100% + 6px);left:50%;transform:translateX(-50%) translateY(2px);background:var(--gd-panel-raised);border:1px solid var(--gd-line-strong);border-radius:var(--radius-sm);box-shadow:var(--shadow-raised);color:var(--gd-text);font-size:11px;line-height:1.4;padding:5px 8px;white-space:nowrap;opacity:0;pointer-events:none;transition:opacity var(--dur-fast) var(--ease-out),transform var(--dur-fast) var(--ease-out);z-index:50}
.gd-tip:hover .gd-tip-bubble,.gd-tip:focus-within .gd-tip-bubble{opacity:1;transform:translateX(-50%) translateY(0)}
`;
__ds_scope.ensureGdCss("gd-tip-css", css);
function Tooltip({
  label,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "gd-tip",
    style: style
  }, children, /*#__PURE__*/React.createElement("span", {
    className: "gd-tip-bubble",
    role: "tooltip"
  }, label));
}
Object.assign(__ds_scope, { Tooltip });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/overlay/Tooltip.jsx", error: String((e && e.message) || e) }); }

// components/status/Badge.jsx
try { (() => {
const css = `
.gd-badge{display:inline-flex;align-items:center;gap:5px;border-radius:var(--radius-full);padding:2px 8px;font-family:var(--font-mono);font-size:10px;font-weight:500;letter-spacing:0.06em;text-transform:uppercase;white-space:nowrap}
.gd-badge--sans{font-family:var(--font-sans);font-size:11px;letter-spacing:0;text-transform:none}
.gd-badge-dot{width:5px;height:5px;border-radius:50%;background:currentColor;flex:none}
`;
__ds_scope.ensureGdCss("gd-badge-css", css);
const TONES = {
  sync: {
    color: "var(--gd-blue)",
    background: "var(--gd-blue-tint)"
  },
  gold: {
    color: "var(--gd-gold)",
    background: "var(--gd-gold-tint)"
  },
  success: {
    color: "var(--gd-success)",
    background: "var(--gd-success-tint)"
  },
  warning: {
    color: "var(--gd-warning)",
    background: "var(--gd-warning-tint)"
  },
  danger: {
    color: "var(--gd-danger)",
    background: "var(--gd-danger-tint)"
  },
  neutral: {
    color: "var(--gd-text-muted)",
    background: "rgba(141,147,163,0.12)"
  }
};
function Badge({
  tone = "neutral",
  dot,
  mono = true,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `gd-badge${mono ? "" : " gd-badge--sans"}`,
    style: {
      ...(TONES[tone] || TONES.neutral),
      ...style
    }
  }, dot && /*#__PURE__*/React.createElement("span", {
    className: "gd-badge-dot"
  }), children);
}
Object.assign(__ds_scope, { Badge });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/Badge.jsx", error: String((e && e.message) || e) }); }

// components/status/DiffValue.jsx
try { (() => {
function DiffValue({
  oldValue,
  newValue,
  mono = true,
  size = 12,
  style
}) {
  const f = mono ? {
    fontFamily: "var(--font-mono)",
    fontVariantNumeric: "tabular-nums"
  } : {};
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 7,
      fontSize: size,
      ...f,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)",
      textDecoration: "line-through",
      textDecorationColor: "rgba(92,98,114,0.6)"
    }
  }, oldValue ?? "—"), /*#__PURE__*/React.createElement("svg", {
    width: "11",
    height: "8",
    viewBox: "0 0 12 8",
    fill: "none",
    style: {
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("path", {
    d: "M1 4H10M10 4L7 1M10 4L7 7",
    stroke: "var(--gd-text-muted)",
    strokeWidth: "1.2",
    strokeLinecap: "round",
    strokeLinejoin: "round"
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text)"
    }
  }, newValue ?? "—"));
}
Object.assign(__ds_scope, { DiffValue });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/DiffValue.jsx", error: String((e && e.message) || e) }); }

// components/status/Money.jsx
try { (() => {
function Money({
  amount,
  currency = "USD",
  size = 13,
  tone = "gold",
  showCurrency = false,
  sign = false,
  style
}) {
  let text = amount;
  if (typeof amount === "number") {
    const abs = Math.abs(amount);
    text = abs.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    });
    if (amount < 0) text = "−" + text;else if (sign && amount > 0) text = "+" + text;
  }
  const colors = {
    gold: "var(--gd-gold)",
    body: "var(--gd-text)",
    muted: "var(--gd-text-muted)",
    success: "var(--gd-success)",
    danger: "var(--gd-danger)"
  };
  if (amount == null || amount === "") return /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)",
      fontFamily: "var(--font-mono)",
      fontSize: size,
      ...style
    }
  }, "\u2014");
  return /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      fontSize: size,
      color: colors[tone] || colors.gold,
      ...style
    }
  }, showCurrency && /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)",
      fontSize: Math.max(10, size - 3),
      marginRight: 5
    }
  }, currency), text);
}
Object.assign(__ds_scope, { Money });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/Money.jsx", error: String((e && e.message) || e) }); }

// components/status/ProgressBar.jsx
try { (() => {
function ProgressBar({
  segments,
  value,
  max = 100,
  height = 6,
  showTrack = true,
  style
}) {
  const segs = segments || [{
    value: Math.min(100, value / max * 100),
    tone: "sync"
  }];
  const colors = {
    sync: "var(--gd-blue)",
    gold: "var(--gd-gold)",
    success: "var(--gd-success)",
    warning: "var(--gd-warning)",
    danger: "var(--gd-danger)",
    neutral: "var(--gd-viz-drawdown)"
  };
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height,
      borderRadius: height / 2,
      overflow: "hidden",
      background: showTrack ? "var(--gd-line)" : "transparent",
      width: "100%",
      ...style
    }
  }, segs.map((s, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      width: `${s.value}%`,
      background: colors[s.tone] || colors.sync,
      transition: "width var(--dur-slow) var(--ease-out)"
    }
  })));
}
Object.assign(__ds_scope, { ProgressBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/ProgressBar.jsx", error: String((e && e.message) || e) }); }

// components/status/StatusDot.jsx
try { (() => {
const css = `
.gd-statusdot{display:inline-flex;align-items:center;gap:7px;font-size:12px;color:var(--gd-text-muted)}
.gd-statusdot-i{border-radius:50%;flex:none;box-sizing:border-box}
@keyframes gd-dot-pulse{0%,100%{opacity:1}50%{opacity:.35}}
.gd-statusdot--pulse .gd-statusdot-i{animation:gd-dot-pulse 1.6s var(--ease-out) infinite}
`;
__ds_scope.ensureGdCss("gd-statusdot-css", css);
const KINDS = {
  active: {
    background: "var(--gd-gold)"
  },
  standby: {
    background: "transparent",
    border: "1.5px solid var(--gd-blue)"
  },
  sync: {
    background: "var(--gd-blue)"
  },
  success: {
    background: "var(--gd-success)"
  },
  warning: {
    background: "var(--gd-warning)"
  },
  danger: {
    background: "var(--gd-danger)"
  },
  neutral: {
    background: "var(--gd-viz-drawdown)"
  }
};
function StatusDot({
  kind = "neutral",
  label,
  size = 8,
  pulse,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: `gd-statusdot${pulse ? " gd-statusdot--pulse" : ""}`,
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-statusdot-i",
    style: {
      width: size,
      height: size,
      ...(KINDS[kind] || KINDS.neutral)
    }
  }), label && /*#__PURE__*/React.createElement("span", null, label));
}
Object.assign(__ds_scope, { StatusDot });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/StatusDot.jsx", error: String((e && e.message) || e) }); }

// components/status/Tag.jsx
try { (() => {
const css = `
.gd-tag{display:inline-flex;align-items:center;gap:5px;border:1px solid var(--gd-line-strong);background:var(--gd-panel-raised);border-radius:var(--radius-xs);padding:1px 7px;font-size:11px;color:var(--gd-text-muted);white-space:nowrap}
.gd-tag-x{background:none;border:none;padding:0;margin-left:1px;cursor:pointer;color:var(--gd-text-faint);font-size:12px;line-height:1;font-family:var(--font-sans)}
.gd-tag-x:hover{color:var(--gd-text)}
`;
__ds_scope.ensureGdCss("gd-tag-css", css);
function Tag({
  color,
  children,
  onRemove,
  style
}) {
  return /*#__PURE__*/React.createElement("span", {
    className: "gd-tag",
    style: style
  }, color && /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: color,
      flex: "none"
    }
  }), children, onRemove && /*#__PURE__*/React.createElement("button", {
    className: "gd-tag-x",
    onClick: onRemove,
    "aria-label": "\u79FB\u9664"
  }, "\xD7"));
}
Object.assign(__ds_scope, { Tag });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/status/Tag.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/KpiStat.jsx
try { (() => {
function KpiStat({
  label,
  value,
  currency,
  tone = "body",
  meta,
  style
}) {
  const isNum = typeof value === "number";
  const toneColor = tone === "gold" ? "var(--gd-gold)" : tone === "danger" ? "var(--gd-danger)" : tone === "warning" ? "var(--gd-warning)" : "var(--text-1)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 4,
      ...style
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-t-label"
  }, label), isNum && currency ? /*#__PURE__*/React.createElement(__ds_scope.Money, {
    amount: value,
    currency: currency,
    showCurrency: true,
    size: 28,
    tone: tone === "body" ? "gold" : tone
  }) : /*#__PURE__*/React.createElement("span", {
    className: "gd-t-metric",
    style: {
      color: toneColor
    }
  }, isNum ? value.toLocaleString("en-US") : value), meta && /*#__PURE__*/React.createElement("span", {
    className: "gd-t-meta"
  }, meta));
}
Object.assign(__ds_scope, { KpiStat });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/KpiStat.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Panel.jsx
try { (() => {
const css = `
.gd-panel{background:var(--gd-panel);border:1px solid var(--gd-line);border-radius:var(--radius-md)}
.gd-panel--seamed{border-radius:0;border-left:none;border-right:none}
.gd-panel-head{display:flex;align-items:center;gap:10px;padding:11px 14px;border-bottom:1px solid var(--gd-line)}
.gd-panel-title{font-size:14px;font-weight:600;flex:1}
.gd-panel-body{padding:14px}
.gd-panel--flush .gd-panel-body{padding:0}
`;
__ds_scope.ensureGdCss("gd-panel-css", css);
function Panel({
  title,
  actions,
  flush,
  seamed,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("section", {
    className: `gd-panel${flush ? " gd-panel--flush" : ""}${seamed ? " gd-panel--seamed" : ""}`,
    style: style
  }, (title || actions) && /*#__PURE__*/React.createElement("header", {
    className: "gd-panel-head"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-panel-title"
  }, title), actions), /*#__PURE__*/React.createElement("div", {
    className: "gd-panel-body"
  }, children));
}
Object.assign(__ds_scope, { Panel });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Panel.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/Toolbar.jsx
try { (() => {
const css = `
.gd-toolbar{height:var(--toolbar-h);flex:none;display:flex;align-items:center;gap:10px;padding:0 12px;background:var(--gd-ink);border-bottom:1px solid var(--gd-line)}
.gd-toolbar--region{background:var(--surface-region)}
.gd-toolbar-side{display:flex;align-items:center;gap:8px;min-width:0}
.gd-toolbar-spacer{flex:1}
`;
__ds_scope.ensureGdCss("gd-toolbar-css", css);
function Toolbar({
  left,
  right,
  region,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: `gd-toolbar${region ? " gd-toolbar--region" : ""}`,
    style: style
  }, /*#__PURE__*/React.createElement("div", {
    className: "gd-toolbar-side"
  }, left), /*#__PURE__*/React.createElement("span", {
    className: "gd-toolbar-spacer"
  }), /*#__PURE__*/React.createElement("div", {
    className: "gd-toolbar-side"
  }, right));
}
Object.assign(__ds_scope, { Toolbar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/Toolbar.jsx", error: String((e && e.message) || e) }); }

// components/surfaces/WindowChrome.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-window-css", css);
const G = d => /*#__PURE__*/React.createElement("svg", {
  width: "10",
  height: "10",
  viewBox: "0 0 10 10",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.2",
  strokeLinecap: "round"
}, d);
function WindowChrome({
  appName = "GoodDealer",
  mark,
  context,
  footer,
  onClose,
  children,
  style
}) {
  return /*#__PURE__*/React.createElement("div", {
    className: "gd-window",
    style: style
  }, /*#__PURE__*/React.createElement("div", {
    className: "gd-titlebar"
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-tb-brand"
  }, mark, appName), context && /*#__PURE__*/React.createElement("span", {
    className: "gd-tb-context"
  }, context), /*#__PURE__*/React.createElement("span", {
    className: "gd-tb-ctl"
  }, /*#__PURE__*/React.createElement("button", {
    tabIndex: -1,
    "aria-label": "\u6700\u5C0F\u5316"
  }, G(/*#__PURE__*/React.createElement("path", {
    d: "M1 5h8"
  }))), /*#__PURE__*/React.createElement("button", {
    tabIndex: -1,
    "aria-label": "\u6700\u5927\u5316"
  }, G(/*#__PURE__*/React.createElement("rect", {
    x: "1.4",
    y: "1.4",
    width: "7.2",
    height: "7.2",
    rx: "1"
  }))), /*#__PURE__*/React.createElement("button", {
    tabIndex: -1,
    className: "gd-tb-close",
    "aria-label": "\u5173\u95ED",
    onClick: onClose
  }, G(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M1.5 1.5l7 7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M8.5 1.5l-7 7"
  })))))), /*#__PURE__*/React.createElement("div", {
    className: "gd-window-body"
  }, children), footer);
}
Object.assign(__ds_scope, { WindowChrome });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/surfaces/WindowChrome.jsx", error: String((e && e.message) || e) }); }

// components/table/BatchBar.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-batchbar-css", css);
function BatchBar({
  count,
  unit = "域名",
  children,
  onClear,
  style
}) {
  if (!count) return null;
  return /*#__PURE__*/React.createElement("div", {
    className: "gd-batchbar",
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-batchbar-count"
  }, /*#__PURE__*/React.createElement("span", {
    className: "lbl"
  }, "\u5DF2\u9009"), /*#__PURE__*/React.createElement("b", null, count), /*#__PURE__*/React.createElement("span", {
    className: "u"
  }, unit)), /*#__PURE__*/React.createElement("span", {
    className: "gd-batchbar-sep"
  }), /*#__PURE__*/React.createElement("div", {
    className: "gd-batchbar-actions"
  }, children), onClear && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
    className: "gd-batchbar-sep"
  }), /*#__PURE__*/React.createElement("button", {
    className: "gd-batchbar-clear",
    onClick: onClear
  }, "\u6E05\u9664")));
}
Object.assign(__ds_scope, { BatchBar });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/table/BatchBar.jsx", error: String((e && e.message) || e) }); }

// components/table/Pagination.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-pager-css", css);
const chevron = d => /*#__PURE__*/React.createElement("svg", {
  width: "14",
  height: "14",
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.7",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}, /*#__PURE__*/React.createElement("path", {
  d: d
}));
function pageWindow(cur, total) {
  if (total <= 7) return Array.from({
    length: total
  }, (_, i) => i + 1);
  const s = new Set([1, 2, total - 1, total, cur - 1, cur, cur + 1]);
  const arr = [...s].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of arr) {
    if (n - prev > 1) out.push("g" + n);
    out.push(n);
    prev = n;
  }
  return out;
}
/** Table pagination: range + page-size + windowed page numbers. Numeric-mono, hairline, native. */
function Pagination({
  page = 1,
  pageSize = 25,
  total = 0,
  onPageChange,
  onPageSizeChange,
  pageSizes = [10, 25, 50, 100],
  note,
  style
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(Math.max(1, page), pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  const go = n => onPageChange && onPageChange(n);
  return /*#__PURE__*/React.createElement("div", {
    className: "gd-pager",
    style: style
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-pager-range"
  }, /*#__PURE__*/React.createElement("b", null, from.toLocaleString(), "\u2013", to.toLocaleString()), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "/ ", total.toLocaleString())), /*#__PURE__*/React.createElement("span", {
    className: "gd-pager-size"
  }, "\u6BCF\u9875", /*#__PURE__*/React.createElement(__ds_scope.Select, {
    size: "sm",
    options: pageSizes.map(String),
    value: String(pageSize),
    onChange: e => onPageSizeChange && onPageSizeChange(+e.target.value)
  })), note && /*#__PURE__*/React.createElement("span", {
    className: "gd-pager-note"
  }, note), /*#__PURE__*/React.createElement("span", {
    className: "gd-pager-nav",
    style: {
      marginLeft: note ? 16 : "auto"
    }
  }, /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    size: "sm",
    label: "\u4E0A\u4E00\u9875",
    disabled: cur <= 1,
    onClick: () => go(cur - 1)
  }, chevron("m15 18-6-6 6-6")), pageWindow(cur, pages).map((n, i) => typeof n === "number" ? /*#__PURE__*/React.createElement("button", {
    key: i,
    className: `gd-pager-num${n === cur ? " gd-pager-num--active" : ""}`,
    onClick: () => go(n)
  }, n) : /*#__PURE__*/React.createElement("span", {
    key: i,
    className: "gd-pager-gap"
  }, "\u2026")), /*#__PURE__*/React.createElement(__ds_scope.IconButton, {
    size: "sm",
    label: "\u4E0B\u4E00\u9875",
    disabled: cur >= pages,
    onClick: () => go(cur + 1)
  }, chevron("m9 18 6-6-6-6"))));
}
Object.assign(__ds_scope, { Pagination });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/table/Pagination.jsx", error: String((e && e.message) || e) }); }

// components/table/Table.jsx
try { (() => {
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
__ds_scope.ensureGdCss("gd-table-css", css);
const SortGlyph = ({
  dir
}) => /*#__PURE__*/React.createElement("svg", {
  width: "8",
  height: "10",
  viewBox: "0 0 8 10",
  fill: "none"
}, /*#__PURE__*/React.createElement("path", {
  d: dir === "desc" ? "M1 4L4 8L7 4" : "M1 6L4 2L7 6",
  stroke: "currentColor",
  strokeWidth: "1.4",
  strokeLinecap: "round",
  strokeLinejoin: "round"
}));
function Table({
  columns = [],
  rows = [],
  rowKey = "id",
  density = "regular",
  selectable = false,
  selected = [],
  onSelectionChange,
  sortKey,
  sortDir = "asc",
  onSort,
  onRowClick,
  hover = true,
  maxHeight,
  footer,
  emptyText = "没有匹配的项目",
  style
}) {
  const sel = new Set(selected);
  const keyOf = (r, i) => typeof rowKey === "function" ? rowKey(r) : r[rowKey] !== undefined ? r[rowKey] : i;
  const allKeys = rows.map(keyOf);
  const allSel = rows.length > 0 && allKeys.every(k => sel.has(k));
  const someSel = allKeys.some(k => sel.has(k));
  const toggleAll = () => onSelectionChange && onSelectionChange(allSel ? [] : allKeys);
  const toggleOne = k => {
    const n = new Set(sel);
    n.has(k) ? n.delete(k) : n.add(k);
    onSelectionChange && onSelectionChange([...n]);
  };
  const cellCls = c => `${c.numeric ? " gd-cell--num" : ""}${c.align === "right" && !c.numeric ? " gd-cell--num" : ""}${c.align === "center" ? " gd-cell--center" : ""}${c.muted ? " gd-cell--muted" : ""}`;
  return /*#__PURE__*/React.createElement("div", {
    className: "gd-table-shell",
    style: style
  }, /*#__PURE__*/React.createElement("div", {
    className: "gd-table-scroll",
    style: maxHeight ? {
      maxHeight
    } : undefined
  }, /*#__PURE__*/React.createElement("table", {
    className: `gd-table gd-table--${density}${hover ? " gd-table--hover" : ""}`
  }, /*#__PURE__*/React.createElement("thead", null, /*#__PURE__*/React.createElement("tr", null, selectable && /*#__PURE__*/React.createElement("th", {
    className: "gd-cell--check"
  }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
    checked: allSel,
    indeterminate: someSel && !allSel,
    onChange: toggleAll
  })), columns.map(c => /*#__PURE__*/React.createElement("th", {
    key: c.key,
    className: cellCls(c),
    style: c.width ? {
      width: c.width
    } : undefined
  }, c.sortable ? /*#__PURE__*/React.createElement("span", {
    className: `gd-th-sort${sortKey === c.key ? " gd-th-sort--active" : ""}`,
    onClick: () => onSort && onSort(c.key, sortKey === c.key && sortDir === "asc" ? "desc" : "asc")
  }, c.label, /*#__PURE__*/React.createElement(SortGlyph, {
    dir: sortKey === c.key ? sortDir : "asc"
  })) : c.label)))), /*#__PURE__*/React.createElement("tbody", null, rows.map((r, i) => {
    const k = keyOf(r, i);
    const isSel = sel.has(k);
    return /*#__PURE__*/React.createElement("tr", {
      key: k,
      className: `${isSel ? "gd-row--selected" : ""}${onRowClick ? " gd-row--clickable" : ""}`,
      onClick: onRowClick ? () => onRowClick(r) : undefined
    }, selectable && /*#__PURE__*/React.createElement("td", {
      className: "gd-cell--check"
    }, /*#__PURE__*/React.createElement(__ds_scope.Checkbox, {
      stop: true,
      checked: isSel,
      onChange: () => toggleOne(k)
    })), columns.map(c => /*#__PURE__*/React.createElement("td", {
      key: c.key,
      className: cellCls(c),
      style: c.width ? {
        width: c.width
      } : undefined
    }, c.render ? c.render(r, i) : r[c.key])));
  }))), rows.length === 0 && /*#__PURE__*/React.createElement("div", {
    className: "gd-table-empty"
  }, emptyText)), footer && /*#__PURE__*/React.createElement("div", {
    className: "gd-table-foot"
  }, footer));
}
Object.assign(__ds_scope, { Table });
})(); } catch (e) { __ds_ns.__errors.push({ path: "components/table/Table.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/AssetLibrary.jsx
try { (() => {
const {
  Table,
  BatchBar,
  Badge,
  Money,
  Tag,
  Button,
  IconButton,
  Input,
  Select,
  KpiStat,
  Toolbar,
  Dialog
} = window.GoodDealerDesignSystem_b5b0b6;
const afmt = n => n == null ? "—" : Number(n).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const anum = v => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
const nsProvider = a => /Cloudflare/.test(a) ? "Cloudflare" : /销售平台/.test(a) ? "销售平台" : /注册商/.test(a) ? "注册商" : "自定义 NS";
function Ribbon({
  onRenew
}) {
  const MetricStrip = window.GDMetricStrip;
  return /*#__PURE__*/React.createElement(MetricStrip, {
    metrics: [{
      label: "域名总数",
      value: "1,024",
      meta: "Spaceship 812 · 其他 212"
    }, {
      label: "组合估值",
      value: "$284,120.00",
      tone: "gold",
      meta: "较上月 +2.1%"
    }, {
      label: "60 天内到期",
      value: "18",
      tone: "warning",
      meta: "续费预算 $312.00 · 去续费 →",
      onClick: onRenew
    }, {
      label: "活跃 Listing",
      value: "692",
      meta: "Atom 511 · Afternic 601"
    }, {
      label: "待裁决冲突",
      value: "6",
      tone: "danger",
      meta: "同字段被远端修改"
    }]
  });
}
const STATUS_MAP = {
  "全部状态": null,
  "已同步": "synced",
  "等待平台": "pending",
  "冲突": "conflict",
  "未上架": "unlisted",
  "已售": "sold"
};
function AssetLibrary({
  domains,
  updateDomains,
  addUnsynced,
  onPlan,
  onOpenDomain,
  onRenew
}) {
  const I = window.GDI;
  const EditableCell = window.GDEditableCell,
    Pagination = window.GDPagination;
  const {
    BatchPriceDialog,
    BatchNsDialog,
    BatchRecordsDialog,
    ListDialog
  } = window.GDDialogs;
  const STATUS_BADGE = {
    synced: /*#__PURE__*/React.createElement(Badge, {
      tone: "sync"
    }, "SYNCED"),
    pending: /*#__PURE__*/React.createElement(Badge, {
      tone: "warning",
      mono: false
    }, "\u7B49\u5F85\u5E73\u53F0"),
    conflict: /*#__PURE__*/React.createElement(Badge, {
      tone: "danger",
      mono: false
    }, "\u51B2\u7A81"),
    unlisted: /*#__PURE__*/React.createElement(Badge, {
      mono: false
    }, "\u672A\u4E0A\u67B6"),
    sold: /*#__PURE__*/React.createElement(Badge, {
      tone: "gold"
    }, "SOLD")
  };
  const [sel, setSel] = React.useState([]);
  const [q, setQ] = React.useState("");
  const [reg, setReg] = React.useState("全部");
  const [statusF, setStatusF] = React.useState("全部状态");
  const [sortKey, setSortKey] = React.useState("bin");
  const [sortDir, setSortDir] = React.useState("desc");
  const [page, setPage] = React.useState(1);
  const [pageSize, setPageSize] = React.useState(10);
  const [dlg, setDlg] = React.useState(null); // price | dns | list | delist
  const [pending, setPending] = React.useState(null); // {row,newVal} inline edit
  React.useEffect(() => {
    setPage(1);
  }, [q, reg, statusF, pageSize]);
  const sfKey = STATUS_MAP[statusF];
  let rows = domains.filter(r => (reg === "全部" || r.registrar === reg) && (sfKey == null || r.status === sfKey) && (q === "" || r.domain.includes(q.toLowerCase()) || r.tags.some(t => t.includes(q))));
  rows = [...rows].sort((a, b) => {
    const m = sortDir === "asc" ? 1 : -1;
    const va = a[sortKey],
      vb = b[sortKey];
    if (va == null) return 1;
    if (vb == null) return -1;
    return va > vb ? m : -m;
  });
  const viewSum = rows.reduce((s, r) => s + (r.bin || 0), 0);
  const pages = Math.max(1, Math.ceil(rows.length / pageSize));
  const cur = Math.min(page, pages);
  const pageRows = rows.slice((cur - 1) * pageSize, cur * pageSize);
  const selDomains = domains.filter(d => sel.includes(d.id)).map(d => ({
    id: d.id,
    domain: d.domain,
    bin: d.bin
  }));
  const patchSel = patch => {
    updateDomains(ds => ds.map(d => sel.includes(d.id) ? {
      ...d,
      ...patch
    } : d));
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
    updateDomains(ds => ds.map(d => d.id === pending.row.id ? {
      ...d,
      bin: pending.newVal
    } : d));
    addUnsynced(1);
    setPending(null);
  };
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u8D44\u4EA7\u5E93",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(Ribbon, {
    onRenew: onRenew
  }), /*#__PURE__*/React.createElement(Toolbar, {
    region: true,
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Input, {
      size: "sm",
      prefix: /*#__PURE__*/React.createElement(I.Search, {
        size: 13
      }),
      placeholder: "\u7B5B\u9009\u57DF\u540D\u3001\u6807\u7B7E\u2026",
      value: q,
      onChange: e => setQ(e.target.value),
      style: {
        width: 210
      }
    }), /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      options: ["全部", "Spaceship", "Namecheap", "Dynadot"],
      value: reg,
      onChange: e => setReg(e.target.value)
    }), /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      options: Object.keys(STATUS_MAP),
      value: statusF,
      onChange: e => setStatusF(e.target.value)
    })),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      icon: /*#__PURE__*/React.createElement(I.Upload, {
        size: 14
      })
    }, "\u5BFC\u5165 CSV"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      disabled: sel.length === 0,
      onClick: () => setDlg("price")
    }, "\u751F\u6210\u6279\u91CF\u8BA1\u5212", sel.length > 0 ? ` · ${sel.length}` : ""))
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      position: "relative",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement(Table, {
    density: "regular",
    selectable: true,
    selected: sel,
    onSelectionChange: setSel,
    onRowClick: r => onOpenDomain(r.id),
    sortKey: sortKey,
    sortDir: sortDir,
    onSort: (k, d) => {
      setSortKey(k);
      setSortDir(d);
    },
    maxHeight: "100%",
    style: {
      flex: 1,
      minHeight: 0,
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "domain",
      label: "域名",
      sortable: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-1)"
        }
      }, r.domain)
    }, {
      key: "tags",
      label: "标签",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          gap: 4
        }
      }, r.tags.map(t => /*#__PURE__*/React.createElement(Tag, {
        key: t,
        color: t.startsWith("portfolio") ? "var(--gd-blue)" : undefined
      }, t)))
    }, {
      key: "registrar",
      label: "注册商",
      muted: true
    }, {
      key: "dns",
      label: "DNS",
      muted: true
    }, {
      key: "platforms",
      label: "平台",
      muted: true
    }, {
      key: "status",
      label: "状态",
      render: r => STATUS_BADGE[r.status]
    }, {
      key: "bin",
      label: "BIN",
      numeric: true,
      sortable: true,
      render: r => /*#__PURE__*/React.createElement(EditableCell, {
        value: r.bin,
        prefix: "$",
        display: /*#__PURE__*/React.createElement(Money, {
          amount: r.bin
        }),
        onCommit: v => setPending({
          row: r,
          newVal: anum(v)
        })
      })
    }, {
      key: "expiry",
      label: "到期",
      numeric: true,
      muted: true,
      sortable: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: r.expiry < "2026-10-01" ? "var(--gd-warning)" : undefined
        }
      }, r.expiry)
    }],
    rows: pageRows,
    footer: /*#__PURE__*/React.createElement(Pagination, {
      page: cur,
      pageSize: pageSize,
      total: rows.length,
      onPage: setPage,
      onPageSize: setPageSize,
      note: /*#__PURE__*/React.createElement(React.Fragment, null, "\u89C6\u56FE\u4F30\u503C ", /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-gold)"
        }
      }, "$", afmt(viewSum)))
    })
  }), sel.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: 14,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      pointerEvents: "none",
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement(BatchBar, {
    count: sel.length,
    onClear: () => setSel([]),
    style: {
      pointerEvents: "auto"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "primary",
    onClick: () => setDlg("price")
  }, "\u6279\u91CF\u6539\u4EF7"), /*#__PURE__*/React.createElement("span", {
    className: "gd-batchbar-sep"
  }), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setDlg("ns")
  }, "\u53D8\u66F4 NS"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setDlg("records")
  }, "DNS \u8BB0\u5F55"), /*#__PURE__*/React.createElement("span", {
    className: "gd-batchbar-sep"
  }), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setDlg("list")
  }, "\u4E0A\u67B6"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => setDlg("delist")
  }, "\u4E0B\u67B6")))), dlg === "price" && /*#__PURE__*/React.createElement(BatchPriceDialog, {
    open: true,
    domains: selDomains,
    onClose: () => setDlg(null),
    onSubmit: c => {
      setDlg(null);
      onPlan(c);
    }
  }), dlg === "ns" && /*#__PURE__*/React.createElement(BatchNsDialog, {
    open: true,
    domains: selDomains,
    onClose: () => setDlg(null),
    onApply: ({
      applied
    }) => patchSel({
      dns: nsProvider(applied)
    })
  }), dlg === "records" && /*#__PURE__*/React.createElement(BatchRecordsDialog, {
    open: true,
    domains: selDomains,
    onClose: () => setDlg(null),
    onApply: () => queueSel()
  }), dlg === "list" && /*#__PURE__*/React.createElement(ListDialog, {
    open: true,
    domains: selDomains,
    onClose: () => setDlg(null),
    onApply: ({
      platforms,
      price
    }) => patchSel(price != null ? {
      status: "synced",
      platforms: platforms.join(" · "),
      bin: price
    } : {
      status: "synced",
      platforms: platforms.join(" · ")
    })
  }), /*#__PURE__*/React.createElement(Dialog, {
    open: dlg === "delist",
    onClose: () => setDlg(null),
    title: `下架 · ${sel.length} 个域名`,
    width: 440,
    danger: true,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      onClick: () => setDlg(null)
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(Button, {
      variant: "danger",
      onClick: () => patchSel({
        status: "unlisted",
        platforms: "—"
      })
    }, "\u4E0B\u67B6 \xB7 ", sel.length, " \u9879"))
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u5C06 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, sel.length), " \u4E2A\u57DF\u540D\u4ECE\u5F53\u524D\u9500\u552E\u5E73\u53F0\u4E0B\u67B6\u3002\u53EF\u5B89\u5168\u91CD\u8BD5\uFF1B\u7ED3\u679C\u4EE5\u5E73\u53F0 Listing \u72B6\u6001\u4E3A\u51C6\uFF0C\u5199\u5165\u672A\u540C\u6B65\u4FEE\u6539\u3002")), /*#__PURE__*/React.createElement(Dialog, {
    open: !!pending,
    onClose: () => setPending(null),
    title: "\u4FDD\u5B58\u5E76\u540C\u6B65",
    width: 420,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      onClick: () => setPending(null)
    }, "\u653E\u5F03"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: savePending
    }, "\u4FDD\u5B58\u5E76\u540C\u6B65"))
  }, pending && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, pending.row.domain), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "BIN"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-faint)"
    }
  }, "$", afmt(pending.row.bin)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u2192"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-gold)"
    }
  }, "$", afmt(pending.newVal))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u4FDD\u5B58\u5199\u5165\u672A\u540C\u6B65\u4FEE\u6539\uFF0C\u5C06\u5728\u4E0B\u6B21\u540C\u6B65\u65F6\u63D0\u4EA4\u5230\u9500\u552E\u5E73\u53F0\uFF1B\u653E\u5F03\u5219\u4E0D\u6539\u52A8\u3002"))));
}
window.GDAssetLibrary = AssetLibrary;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/AssetLibrary.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/BatchPreview.jsx
try { (() => {
// 批量任务 = 作业级编排：列表（稳定主屏）+ 详情（推入）。
// 详情按状态分形态：计划中→差异预览与执行；执行中→进度；已完成/部分失败/已回滚→结果。
// 执行结果记入「操作历史」，派生人工项见「人工任务」；本地变更自动同步云端（无手动 Outbox）。
const {
  Table,
  Badge,
  DiffValue,
  Button,
  KpiStat,
  Panel,
  Tabs,
  Dialog,
  ProgressBar,
  IconButton,
  Checkbox,
  Input,
  Select,
  Toolbar
} = window.GoodDealerDesignSystem_b5b0b6;
const JOB_STATUS = {
  draft: {
    label: "计划中",
    tone: "warning"
  },
  running: {
    label: "执行中",
    tone: "sync"
  },
  done: {
    label: "已完成",
    tone: "success"
  },
  partial: {
    label: "部分失败",
    tone: "danger"
  },
  rolledback: {
    label: "已回滚",
    tone: null
  },
  canceled: {
    label: "已取消",
    tone: null
  }
};
const jobBadge = s => {
  const m = JOB_STATUS[s] || JOB_STATUS.draft;
  return /*#__PURE__*/React.createElement(Badge, {
    tone: m.tone || undefined,
    mono: false
  }, m.label);
};
const riskBadge = r => r === "high" ? /*#__PURE__*/React.createElement(Badge, {
  tone: "danger",
  mono: false
}, "\u9AD8\u98CE\u9669") : r === "mid" ? /*#__PURE__*/React.createElement(Badge, {
  tone: "warning",
  mono: false
}, "\u4E2D\u98CE\u9669") : null;
function ResultChips({
  res
}) {
  if (!res) return /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)",
      fontSize: 12
    }
  }, "\u2014");
  const items = [res.ok != null && ["success", res.ok], res.manual && ["warning", res.manual], res.retry && ["danger", res.retry], res.conflict && ["danger", res.conflict]].filter(Boolean);
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      gap: 12,
      alignItems: "center",
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      fontSize: 12
    }
  }, items.map(([tone, n], i) => /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 6,
      height: 6,
      borderRadius: "50%",
      background: `var(--gd-${tone})`
    }
  }), n.toLocaleString())));
}
function ProgCell({
  job
}) {
  if (job.status === "draft") return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-warning)"
    }
  }, "\u5F85\u786E\u8BA4");
  if (job.status === "rolledback") return /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-faint)"
    }
  }, "\u5DF2\u56DE\u6EDA");
  const tone = job.status === "running" ? "sync" : job.status === "partial" ? "danger" : "success";
  const col = job.status === "running" ? "var(--gd-blue)" : "var(--gd-text-faint)";
  return /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 8,
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 60
    }
  }, /*#__PURE__*/React.createElement(ProgressBar, {
    segments: [{
      value: job.progress,
      tone
    }],
    height: 5
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: col
    }
  }, job.progress, "%"));
}

// ---------- 列表 ----------
function BatchList({
  jobs,
  onOpen,
  onGoAssets
}) {
  const I = window.GDI;
  const MetricStrip = window.GDMetricStrip;
  const [q, setQ] = React.useState("");
  const [sf, setSf] = React.useState("全部状态");
  const SF = {
    "全部状态": null,
    "计划中": "draft",
    "执行中": "running",
    "已完成": "done",
    "部分失败": "partial",
    "已回滚": "rolledback"
  };
  const c = s => jobs.filter(j => j.status === s).length;
  const key = SF[sf];
  const rows = jobs.filter(j => (key == null || j.status === key) && (q === "" || j.name.includes(q) || j.rule.includes(q)));
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u6279\u91CF\u4EFB\u52A1",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MetricStrip, {
    metrics: [{
      label: "执行中",
      value: c("running"),
      tone: c("running") ? "blue" : "muted",
      meta: c("running") ? "实时进度" : null
    }, {
      label: "计划待确认",
      value: c("draft"),
      tone: c("draft") ? "warning" : "muted",
      meta: c("draft") ? "待确认执行" : null
    }, {
      label: "今日完成",
      value: c("done"),
      tone: c("done") ? "success" : "muted"
    }, {
      label: "部分失败",
      value: c("partial"),
      tone: c("partial") ? "danger" : "muted",
      meta: c("partial") ? "有失败项待处理" : null
    }, {
      label: "已回滚",
      value: c("rolledback"),
      tone: "muted"
    }]
  }), /*#__PURE__*/React.createElement(Toolbar, {
    region: true,
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Input, {
      size: "sm",
      prefix: /*#__PURE__*/React.createElement(I.Search, {
        size: 13
      }),
      placeholder: "\u641C\u7D22\u6279\u6B21 / \u89C4\u5219\u2026",
      value: q,
      onChange: e => setQ(e.target.value),
      style: {
        width: 220
      }
    }), /*#__PURE__*/React.createElement(Select, {
      size: "sm",
      options: Object.keys(SF),
      value: sf,
      onChange: e => setSf(e.target.value)
    })),
    right: /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      onClick: onGoAssets
    }, "\u53BB\u8D44\u4EA7\u5E93\u65B0\u5EFA")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement(Table, {
    density: "regular",
    rowKey: "id",
    onRowClick: r => onOpen(r.id),
    maxHeight: "100%",
    style: {
      flex: 1,
      minHeight: 0,
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "name",
      label: "批次",
      render: r => /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 2
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 13,
          color: "var(--text-1)",
          fontWeight: 500
        }
      }, r.name), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, r.rule))
    }, {
      key: "target",
      label: "目标",
      numeric: true,
      width: 76,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12
        }
      }, r.target.toLocaleString())
    }, {
      key: "where",
      label: "平台 · 账户",
      render: r => /*#__PURE__*/React.createElement("div", {
        style: {
          display: "flex",
          flexDirection: "column",
          gap: 2
        }
      }, /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12
        }
      }, r.platform), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, r.account))
    }, {
      key: "created",
      label: "创建",
      width: 92,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: "var(--gd-text-muted)"
        }
      }, r.created)
    }, {
      key: "status",
      label: "状态",
      width: 92,
      render: r => jobBadge(r.status)
    }, {
      key: "progress",
      label: "进度",
      width: 150,
      render: r => /*#__PURE__*/React.createElement(ProgCell, {
        job: r
      })
    }, {
      key: "result",
      label: "结果",
      render: r => r.status === "draft" ? /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 12,
          color: "var(--gd-text-faint)"
        }
      }, "\u81EA\u52A8 ", r.auto, " \xB7 \u4EBA\u5DE5 ", r.manual, " \xB7 \u51B2\u7A81 ", r.conflict) : /*#__PURE__*/React.createElement(ResultChips, {
        res: r.result
      })
    }, {
      key: "risk",
      label: "风险",
      width: 72,
      render: r => riskBadge(r.risk) || /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-text-faint)",
          fontSize: 12
        }
      }, "\u2014")
    }, {
      key: "act",
      label: "",
      width: 40,
      align: "right",
      render: () => /*#__PURE__*/React.createElement(I.ChevronRight, {
        size: 14,
        style: {
          color: "var(--gd-text-faint)"
        }
      })
    }],
    rows: rows,
    emptyText: "\u6CA1\u6709\u5339\u914D\u7684\u6279\u91CF\u4EFB\u52A1",
    footer: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--gd-text-faint)"
      }
    }, "\u5171 ", rows.length, " \u4E2A\u6279\u6B21 \xB7 \u70B9\u51FB\u884C\u67E5\u770B\u8BE6\u60C5\u4E0E\u6267\u884C \xB7 \u6267\u884C\u7ED3\u679C\u8BB0\u5165\u300C\u64CD\u4F5C\u5386\u53F2\u300D")
  })));
}

// ---------- 详情 ----------
function BatchDetail({
  job,
  onBack,
  onGoInbox,
  onGoConflicts,
  onGoHistory
}) {
  const I = window.GDI;
  const D = window.GD_DATA;
  const isDraft = job.status === "draft";
  const [tab, setTab] = React.useState("all");
  const [excluded, setExcluded] = React.useState([]);
  const [confirm, setConfirm] = React.useState(false);
  const [ack, setAck] = React.useState(false);
  const [phase, setPhase] = React.useState(job.status === "draft" ? "plan" : job.status === "running" ? "run" : "done");
  const [prog, setProg] = React.useState(job.status === "running" ? job.progress : job.status === "draft" ? 0 : 100);
  const diffs = D.diffs.map(d => excluded.includes(d.id) ? {
    ...d,
    state: "excluded"
  } : d);
  const counts = {
    all: diffs.length,
    auto: diffs.filter(d => d.state === "auto").length,
    manual: diffs.filter(d => d.state === "manual").length,
    conflict: diffs.filter(d => d.state === "conflict").length,
    excluded: diffs.filter(d => d.state === "excluded").length
  };
  const submitCount = (job.auto != null ? job.auto : 811) - excluded.length;
  const highRiskRows = diffs.filter(d => String(d.risk).startsWith("高") && d.state !== "excluded");
  const highRiskCount = highRiskRows.length;
  const rows = tab === "all" ? diffs : diffs.filter(d => d.state === tab);
  React.useEffect(() => {
    if (phase !== "run") return;
    const t = setInterval(() => setProg(p => {
      if (p >= 100) {
        clearInterval(t);
        setPhase("done");
        return 100;
      }
      return p + 4;
    }), 120);
    return () => clearInterval(t);
  }, [phase]);
  const stateBadge = s => s === "auto" ? /*#__PURE__*/React.createElement(Badge, {
    tone: "sync",
    mono: false
  }, "\u81EA\u52A8") : s === "manual" ? /*#__PURE__*/React.createElement(Badge, {
    tone: "warning",
    mono: false
  }, "\u4EBA\u5DE5") : s === "conflict" ? /*#__PURE__*/React.createElement(Badge, {
    tone: "danger",
    mono: false
  }, "\u51B2\u7A81") : /*#__PURE__*/React.createElement(Badge, {
    mono: false
  }, "\u5DF2\u6392\u9664");
  const res = isDraft ? {
    ok: 789,
    waiting: 5,
    retry: 3,
    unknown: 2,
    manual: 12,
    failed: 0
  } : job.result || {
    ok: 0
  };
  const isRolled = job.status === "rolledback";
  const header = /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 18px",
      borderBottom: "1px solid var(--gd-line)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "ghost",
    icon: /*#__PURE__*/React.createElement(I.ChevronLeft, {
      size: 15
    }),
    onClick: onBack
  }, "\u6279\u91CF\u4EFB\u52A1"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 15,
      fontWeight: 600
    }
  }, job.name), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-faint)"
    }
  }, job.rule, " \xB7 ", job.target.toLocaleString(), " \u4E2A\u57DF\u540D"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8,
      alignItems: "center"
    }
  }, riskBadge(job.risk), jobBadge(phase === "run" ? "running" : phase === "done" && isDraft ? res.retry || res.unknown ? "partial" : "done" : job.status)));
  const planBody = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(6,1fr)",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(KpiStat, {
    label: "\u76EE\u6807\u57DF\u540D",
    value: job.target,
    meta: "2 \u5E73\u53F0 \xB7 3 \u8D26\u6237"
  }), /*#__PURE__*/React.createElement(KpiStat, {
    label: "\u53EF\u81EA\u52A8\u6267\u884C",
    value: job.auto
  }), /*#__PURE__*/React.createElement(KpiStat, {
    label: "\u9700\u4EBA\u5DE5",
    value: job.manual,
    tone: "warning"
  }), /*#__PURE__*/React.createElement(KpiStat, {
    label: "\u9AD8\u98CE\u9669",
    value: highRiskCount,
    tone: "danger",
    meta: "Nameserver \u53D8\u66F4"
  }), /*#__PURE__*/React.createElement(KpiStat, {
    label: "\u51B2\u7A81",
    value: job.conflict,
    tone: "danger",
    meta: "\u540C\u5B57\u6BB5\u88AB\u8FDC\u7AEF\u4FEE\u6539"
  }), /*#__PURE__*/React.createElement(KpiStat, {
    label: "\u9884\u8BA1\u65F6\u957F",
    value: "6 \u5206",
    meta: "\u6700\u5927\u4EF7\u683C\u53D8\u5316 \u2212$3,000"
  }))), /*#__PURE__*/React.createElement(Panel, {
    flush: true,
    title: "\u5206\u7EC4"
  }, /*#__PURE__*/React.createElement("div", null, D.groups.map(g => /*#__PURE__*/React.createElement("div", {
    key: g.id,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "9px 14px",
      borderBottom: "1px solid var(--gd-line)",
      fontSize: 13,
      cursor: "pointer"
    },
    onMouseEnter: e => e.currentTarget.style.background = "var(--gd-panel-raised)",
    onMouseLeave: e => e.currentTarget.style.background = "transparent"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 110,
      fontWeight: 500,
      color: g.platform === "冲突" ? "var(--gd-danger)" : undefined
    }
  }, g.platform), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 90,
      color: "var(--gd-text-muted)"
    }
  }, g.account), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, g.action, g.risk === "high" && /*#__PURE__*/React.createElement(Badge, {
    tone: "danger",
    mono: false
  }, "\u9AD8\u98CE\u9669")), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)",
      fontSize: 12
    }
  }, g.method), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      width: 56,
      textAlign: "right"
    }
  }, g.count.toLocaleString()), /*#__PURE__*/React.createElement(I.ChevronRight, {
    size: 13,
    style: {
      color: "var(--gd-text-faint)"
    }
  }))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Tabs, {
    active: tab,
    onChange: setTab,
    items: [{
      key: "all",
      label: "全部",
      count: counts.all
    }, {
      key: "auto",
      label: "可自动执行",
      count: counts.auto
    }, {
      key: "manual",
      label: "需人工",
      count: counts.manual
    }, {
      key: "conflict",
      label: "冲突",
      count: counts.conflict
    }, {
      key: "excluded",
      label: "已排除",
      count: counts.excluded
    }]
  }), /*#__PURE__*/React.createElement(Table, {
    density: "compact",
    rowKey: "id",
    columns: [{
      key: "domain",
      label: "域名",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12
        }
      }, r.domain)
    }, {
      key: "field",
      label: "字段",
      muted: true,
      width: 92
    }, {
      key: "diff",
      label: "旧值 → 新值",
      render: r => /*#__PURE__*/React.createElement(DiffValue, {
        oldValue: r.oldV,
        newValue: r.newV
      })
    }, {
      key: "src",
      label: "来源",
      muted: true
    }, {
      key: "risk",
      label: "风险",
      render: r => String(r.risk).startsWith("高") ? /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-danger)",
          fontSize: 12,
          display: "inline-flex",
          alignItems: "center",
          gap: 4
        }
      }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
        size: 12
      }), r.risk) : String(r.risk).startsWith("中") ? /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-warning)",
          fontSize: 12
        }
      }, r.risk) : /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-text-faint)",
          fontSize: 12
        }
      }, r.risk)
    }, {
      key: "method",
      label: "执行",
      muted: true,
      width: 70
    }, {
      key: "state",
      label: "状态",
      render: r => stateBadge(r.state),
      width: 86
    }, {
      key: "act",
      label: "",
      width: 60,
      align: "right",
      render: r => r.state !== "excluded" ? /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "ghost",
        onClick: () => setExcluded(x => [...x, r.id])
      }, "\u6392\u9664") : /*#__PURE__*/React.createElement(Button, {
        size: "sm",
        variant: "ghost",
        onClick: () => setExcluded(x => x.filter(i => i !== r.id))
      }, "\u6062\u590D")
    }],
    rows: rows,
    emptyText: "\u6B64\u5206\u7C7B\u4E0B\u6CA1\u6709\u9879\u76EE",
    footer: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--gd-text-faint)"
      }
    }, "\u9884\u89C8 ", rows.length, " / ", job.target, " \u884C \xB7 \u51B2\u7A81\u9879\u4E0D\u4F1A\u63D0\u4EA4")
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      background: "var(--gd-panel-raised)",
      border: "1px solid var(--gd-line-strong)",
      borderRadius: 7,
      padding: "10px 14px",
      boxShadow: "var(--shadow-raised)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u5C06\u63D0\u4EA4 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-blue)"
    }
  }, submitCount), " \u9879", highRiskCount > 0 && /*#__PURE__*/React.createElement(React.Fragment, null, " \xB7 \u542B ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-danger)"
    }
  }, highRiskCount), " \u9879\u9AD8\u98CE\u9669"), " \xB7 \u51B2\u7A81 ", job.conflict, " \u9879\u5DF2\u6392\u9664 \xB7 \u4EBA\u5DE5 ", job.manual, " \u9879\u8F6C\u6536\u4EF6\u7BB1"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    onClick: onBack
  }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(Button, {
    variant: "primary",
    onClick: () => setConfirm(true)
  }, "\u786E\u8BA4\u5E76\u5F00\u59CB\u6267\u884C"))));
  const runView = () => {
    const pct = Math.min(prog, 100),
      okN = Math.round(pct / 100 * 789),
      csvN = Math.round(pct / 100 * 12);
    return /*#__PURE__*/React.createElement(Panel, {
      title: "\u6B63\u5728\u6267\u884C",
      actions: /*#__PURE__*/React.createElement(Badge, {
        tone: "sync"
      }, "RUNNING")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(ProgressBar, {
      segments: [{
        value: pct,
        tone: "sync"
      }],
      height: 8
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(6,1fr)",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u6210\u529F",
      value: okN,
      tone: "body"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u7B49\u5F85\u786E\u8BA4",
      value: 0,
      meta: "\u8FDC\u7AEF\u5DF2\u63A5\u53D7"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u53EF\u5B89\u5168\u91CD\u8BD5",
      value: 0,
      tone: "danger"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u7ED3\u679C\u672A\u77E5",
      value: 0,
      tone: "warning"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u4EBA\u5DE5\u5904\u7406",
      value: csvN
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u6700\u7EC8\u5931\u8D25",
      value: 0
    })), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--gd-text-muted)"
      }
    }, job.platform, " \xB7 API \u9650\u901F 2 req/s \xB7 \u9884\u8BA1\u5269\u4F59 ", Math.max(0, Math.round((100 - pct) * 2.4 / 10)), " \u79D2 \xB7 \u53EF\u968F\u65F6\u6682\u505C")));
  };
  const doneView = () => {
    if (isRolled) return /*#__PURE__*/React.createElement(Panel, {
      title: "\u6279\u6B21\u5DF2\u56DE\u6EDA",
      actions: /*#__PURE__*/React.createElement(Badge, {
        mono: false
      }, "\u5DF2\u56DE\u6EDA")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        border: "1px solid var(--gd-line-strong)",
        background: "var(--gd-panel-raised)",
        borderRadius: 7,
        padding: "11px 13px",
        fontSize: 12,
        color: "var(--gd-text)",
        lineHeight: 1.5
      }
    }, "\u6B64\u6279\u6B21\u7684 ", job.target, " \u9879\u4FEE\u6539\u5DF2\u6574\u4F53\u56DE\u6EDA\u81F3 ", /*#__PURE__*/React.createElement("b", {
      style: {
        fontFamily: "var(--font-mono)"
      }
    }, "Revision ", job.rolledTo), "\u3002\u56DE\u6EDA\u751F\u6210\u4E86\u65B0\u7684 Revision\uFF0C\u539F\u4FEE\u6539\u5728\u8D26\u672C\u4E2D\u4FDD\u7559\u53EF\u8FFD\u6EAF\u3002"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center"
      }
    }, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      onClick: onGoHistory
    }, "\u5728\u64CD\u4F5C\u5386\u53F2\u67E5\u770B"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: onBack
    }, "\u8FD4\u56DE\u6279\u91CF\u4EFB\u52A1"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 11,
        color: "var(--gd-text-faint)",
        fontFamily: "var(--font-mono)"
      }
    }, job.op))));
    const T = job.target || 1,
      hasFail = (res.retry || 0) > 0 || (res.unknown || 0) > 0;
    return /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Panel, {
      title: "\u6279\u6B21\u5B8C\u6210",
      actions: /*#__PURE__*/React.createElement(Badge, {
        tone: hasFail ? "warning" : "success",
        mono: false
      }, hasFail ? "部分失败" : "已完成")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(ProgressBar, {
      segments: [{
        value: (res.ok || 0) / T * 100,
        tone: "success"
      }, {
        value: (res.retry || 0) / T * 100,
        tone: "danger"
      }, {
        value: (res.manual || 0) / T * 100,
        tone: "warning"
      }],
      height: 8
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(6,1fr)",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u6210\u529F",
      value: res.ok || 0,
      tone: "body"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u7B49\u5F85\u786E\u8BA4",
      value: res.waiting || 0,
      meta: "\u8FDC\u7AEF\u5DF2\u63A5\u53D7"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u53EF\u5B89\u5168\u91CD\u8BD5",
      value: res.retry || 0,
      tone: "danger"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u7ED3\u679C\u672A\u77E5",
      value: res.unknown || 0,
      tone: "warning",
      meta: "\u53EA\u80FD\u786E\u8BA4"
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u4EBA\u5DE5\u5904\u7406",
      value: res.manual || 0
    }), /*#__PURE__*/React.createElement(KpiStat, {
      label: "\u6700\u7EC8\u5931\u8D25",
      value: res.failed || 0
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap"
      }
    }, hasFail && /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      size: "sm"
    }, "\u91CD\u8BD5\u5931\u8D25\u9879 \xB7 ", res.retry || 0), (res.unknown || 0) > 0 && /*#__PURE__*/React.createElement(Button, {
      size: "sm"
    }, "\u68C0\u67E5\u5E73\u53F0\u72B6\u6001 \xB7 ", res.unknown), (res.manual || 0) > 0 && /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: onGoInbox
    }, "\u53BB\u4EBA\u5DE5\u4EFB\u52A1 \xB7 ", res.manual), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: onBack
    }, "\u8FD4\u56DE\u6279\u91CF\u4EFB\u52A1"), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 11,
        color: "var(--gd-text-faint)",
        fontFamily: "var(--font-mono)"
      }
    }, "\u5BA1\u8BA1\u5DF2\u8BB0\u5F55 \xB7 ", job.op || "OP-2026-0804-11")))), (res.manual || 0) > 0 && /*#__PURE__*/React.createElement(Panel, {
      title: "\u4EBA\u5DE5\u4EFB\u52A1\u5DF2\u521B\u5EFA",
      actions: /*#__PURE__*/React.createElement(Badge, {
        tone: "warning",
        mono: false
      }, res.manual, " \u9879")
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--gd-text-muted)"
      }
    }, "CSV / \u540E\u53F0\u64CD\u4F5C\u7C7B\u4FEE\u6539\u5DF2\u8F6C\u300C\u4EBA\u5DE5\u4EFB\u52A1\u6536\u4EF6\u7BB1\u300D\u7B49\u5F85\u5904\u7406\u3002\u5931\u8D25\u91CD\u8BD5\u53EA\u9009\u62E9 failed_retryable\uFF0C\u4E0D\u4F1A\u91CD\u63D0\u6210\u529F\u9879\u548C\u7ED3\u679C\u672A\u77E5\u9879\u3002")));
  };
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u6279\u91CF\u4EFB\u52A1\u8BE6\u60C5",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, header, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflow: "auto"
    }
  }, phase === "plan" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14,
      maxWidth: 1080,
      margin: "0 auto",
      padding: 16,
      width: "100%"
    }
  }, planBody) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14,
      maxWidth: 760,
      margin: "0 auto",
      padding: "24px 16px",
      width: "100%"
    }
  }, phase === "run" ? runView() : doneView())), /*#__PURE__*/React.createElement(Dialog, {
    open: confirm,
    onClose: () => {
      setConfirm(false);
      setAck(false);
    },
    title: "\u6700\u7EC8\u786E\u8BA4 \xB7 \u6279\u91CF\u6539\u4EF7",
    width: highRiskCount > 0 ? 544 : 480,
    danger: highRiskCount > 0,
    footer: highRiskCount > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      onClick: () => {
        setConfirm(false);
        setAck(false);
      }
    }, "\u8FD4\u56DE\u4FEE\u6539"), /*#__PURE__*/React.createElement(Button, {
      onClick: () => {
        setConfirm(false);
        setAck(false);
        setPhase("run");
        setProg(0);
      }
    }, "\u4EC5\u63D0\u4EA4\u5E38\u89C4 \xB7 ", submitCount - highRiskCount, " \u9879"), /*#__PURE__*/React.createElement(Button, {
      variant: "danger",
      disabled: !ack,
      onClick: () => {
        setConfirm(false);
        setAck(false);
        setPhase("run");
        setProg(0);
      }
    }, "\u63D0\u4EA4\u5168\u90E8 \xB7 ", submitCount, " \u9879")) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      onClick: () => setConfirm(false)
    }, "\u8FD4\u56DE\u4FEE\u6539"), /*#__PURE__*/React.createElement(Button, {
      variant: "primary",
      onClick: () => {
        setConfirm(false);
        setPhase("run");
        setProg(0);
      }
    }, "\u63D0\u4EA4 ", submitCount, " \u9879\u4FEE\u6539"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u5411 ", /*#__PURE__*/React.createElement("b", null, "Atom \xB7 \u4E3B\u8D26\u6237"), " \u63D0\u4EA4 ", submitCount - 12, " \u9879 API \u4FEE\u6539\uFF1B\u4E3A ", /*#__PURE__*/React.createElement("b", null, "Afternic"), " \u751F\u6210 CSV \u5E76\u521B\u5EFA 12 \u9879\u4EBA\u5DE5\u4EFB\u52A1\u3002"), highRiskCount > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-danger)",
      background: "var(--gd-danger-tint)",
      borderRadius: 7,
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
    size: 15,
    style: {
      color: "var(--gd-danger)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-danger)",
      fontSize: 13
    }
  }, "\u9AD8\u98CE\u9669 \xB7 Nameserver \u53D8\u66F4 \xB7 ", highRiskCount, " \u4E2A\u57DF\u540D"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--gd-text-muted)"
    }
  }, "\u53EF\u56DE\u6EDA")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text)",
      lineHeight: 1.5
    }
  }, "\u53D8\u66F4\u540E\u6307\u5411\u65E7 DNS \u7684\u89E3\u6790\u4E0E\u90AE\u4EF6\u5728\u4F20\u64AD\u5B8C\u6210\u524D\u53EF\u80FD\u4E2D\u65AD\uFF08\u7EA6 5\u201330 \u5206\u949F\uFF09\u3002\u56DE\u6EDA\u5230\u5F53\u524D Nameserver \u540C\u6837\u9700\u8981\u4F20\u64AD\u65F6\u95F4\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexWrap: "wrap",
      gap: 6
    }
  }, highRiskRows.map(r => /*#__PURE__*/React.createElement("span", {
    key: r.id,
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--gd-text)",
      background: "var(--gd-ink)",
      border: "1px solid var(--gd-line)",
      borderRadius: 4,
      padding: "2px 7px"
    }
  }, r.domain))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid rgba(229,115,95,0.24)",
      paddingTop: 9
    }
  }, /*#__PURE__*/React.createElement(Checkbox, {
    checked: ack,
    onChange: () => setAck(a => !a),
    label: `我已理解后果，确认对这 ${highRiskCount} 个域名执行 Nameserver 变更`
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u6700\u5927\u4EF7\u683C\u53D8\u5316 \u2212$3,000.00 \xB7 \u9884\u8BA1\u6267\u884C 6 \u5206\u949F \xB7 \u5168\u7A0B\u53EF\u6682\u505C\u5E76\u63A5\u7BA1"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u6267\u884C\u524D\u57FA\u7EBF Revision 8,241 \xB7 \u5199\u5165\u5BA1\u8BA1\u65E5\u5FD7 \xB7 Afternic CSV \u9700\u4EBA\u5DE5\u4E0A\u4F20"))));
}

// ---------- 路由：列表 ↔ 详情 ----------
function BatchPreview({
  focus,
  onConsumeFocus,
  onBack,
  onGoAssets,
  onGoInbox,
  onGoConflicts,
  onGoHistory
}) {
  const jobs = window.GD_DATA.batchJobs;
  const [selId, setSelId] = React.useState(null);
  React.useEffect(() => {
    if (focus) {
      setSelId(focus === "draft" ? "b-draft" : focus);
      onConsumeFocus && onConsumeFocus();
    }
  }, [focus]);
  const job = selId ? jobs.find(j => j.id === selId) : null;
  if (job) return /*#__PURE__*/React.createElement(BatchDetail, {
    job: job,
    onBack: () => setSelId(null),
    onGoInbox: onGoInbox,
    onGoConflicts: onGoConflicts,
    onGoHistory: onGoHistory
  });
  return /*#__PURE__*/React.createElement(BatchList, {
    jobs: jobs,
    onOpen: setSelId,
    onGoAssets: onGoAssets
  });
}
window.GDBatchPreview = BatchPreview;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/BatchPreview.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/ConflictCenter.jsx
try { (() => {
const {
  Badge,
  Button,
  Panel,
  Tabs
} = window.GoodDealerDesignSystem_b5b0b6;
function TriValue({
  label,
  value,
  tone,
  chosen,
  onPick,
  pickable
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 5,
      background: "var(--gd-ink)",
      border: `1px solid ${chosen ? "var(--gd-blue)" : "var(--gd-line)"}`,
      borderRadius: 5,
      padding: "8px 10px",
      cursor: pickable ? "pointer" : "default",
      transition: "border-color 120ms"
    },
    onClick: pickable ? onPick : undefined
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      letterSpacing: "0.08em",
      textTransform: "uppercase",
      color: tone || "var(--gd-text-faint)",
      fontWeight: 500
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums",
      fontSize: 13,
      color: "var(--gd-text)"
    }
  }, value));
}
function ConflictCenter() {
  const [tab, setTab] = React.useState("全部");
  const [resolved, setResolved] = React.useState({});
  const all = window.GD_DATA.conflicts;
  const tabs = ["全部", "价格", "DNS", "销售状态"];
  const list = all.filter(c => tab === "全部" || c.group === tab);
  const openCount = all.filter(c => !resolved[c.id]).length;
  const resolve = (id, how) => setResolved(r => ({
    ...r,
    [id]: how
  }));
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u51B2\u7A81\u4E2D\u5FC3",
    style: {
      maxWidth: 920,
      margin: "0 auto",
      padding: 16,
      width: "100%",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 600
    }
  }, "\u51B2\u7A81\u4E2D\u5FC3"), /*#__PURE__*/React.createElement(Badge, {
    tone: openCount > 0 ? "danger" : "success",
    mono: false
  }, openCount > 0 ? `${openCount} 项待裁决` : "全部已裁决"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "DNS\u3001Nameserver \u548C Sold \u72B6\u6001\u4E0D\u63D0\u4F9B\u65E0\u9884\u89C8\u7684\u6279\u91CF\u8986\u76D6")), /*#__PURE__*/React.createElement(Tabs, {
    active: tab,
    onChange: setTab,
    items: tabs.map(t => ({
      key: t,
      label: t,
      count: all.filter(c => (t === "全部" || c.group === t) && !resolved[c.id]).length
    }))
  }), tab === "价格" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u5BF9\u540C\u7C7B\u51B2\u7A81\u6279\u91CF\u5E94\u7528\uFF1A"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => all.filter(c => c.group === "价格").forEach(c => resolve(c.id, "local"))
  }, "\u5168\u90E8\u4FDD\u7559\u672C\u5730"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    onClick: () => all.filter(c => c.group === "价格").forEach(c => resolve(c.id, "remote"))
  }, "\u5168\u90E8\u63A5\u53D7\u5E73\u53F0")), list.map(c => {
    const done = resolved[c.id];
    return /*#__PURE__*/React.createElement(Panel, {
      key: c.id
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
        opacity: done ? .55 : 1
      }
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 13
      }
    }, c.domain), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--gd-text-muted)"
      }
    }, c.field), /*#__PURE__*/React.createElement(Badge, {
      mono: false
    }, c.group), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 11,
        color: "var(--gd-text-faint)"
      }
    }, c.note)), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(TriValue, {
      label: "\u7F16\u8F91\u57FA\u7EBF Base",
      value: c.base
    }), /*#__PURE__*/React.createElement(TriValue, {
      label: "\u672C\u5730\u76EE\u6807 Local",
      value: c.local,
      tone: "var(--gd-blue)",
      chosen: done === "local",
      pickable: !done,
      onPick: () => resolve(c.id, "local")
    }), /*#__PURE__*/React.createElement(TriValue, {
      label: "\u5E73\u53F0\u5F53\u524D Remote",
      value: c.remote,
      tone: "var(--gd-warning)",
      chosen: done === "remote",
      pickable: !done,
      onPick: () => resolve(c.id, "remote")
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center"
      }
    }, !done && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "primary",
      onClick: () => resolve(c.id, "local")
    }, "\u4FDD\u7559\u672C\u5730"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      onClick: () => resolve(c.id, "remote")
    }, "\u63A5\u53D7\u5E73\u53F0"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost"
    }, "\u7F16\u8F91\u65B0\u503C")), done && /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      mono: false
    }, done === "local" ? "已保留本地" : "已接受平台"), /*#__PURE__*/React.createElement(Button, {
      size: "sm",
      variant: "ghost",
      onClick: () => setResolved(r => {
        const n = {
          ...r
        };
        delete n[c.id];
        return n;
      })
    }, "\u64A4\u9500")), /*#__PURE__*/React.createElement("span", {
      style: {
        marginLeft: "auto",
        fontSize: 11,
        color: "var(--gd-text-faint)",
        fontFamily: "var(--font-mono)"
      }
    }, "Base rev 8,203"))));
  }));
}
window.GDConflictCenter = ConflictCenter;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/ConflictCenter.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/DnsVerify.jsx
try { (() => {
// DNS 与验证 / DNS & Verification — cross-domain NS/records health + ownership verification.
// NS(注册商委派) vs 记录(DNS 提供商) kept distinct; 所有权 via TXT _atomverify (gold moment).
// Fix actions reuse the batch NS / records dialogs; re-verify re-checks the TXT token.
const {
  Table: VTable,
  Badge: VBadge,
  Button: VBtn,
  StatusDot: VDot,
  Select: VSel,
  Input: VInput,
  Toolbar: VToolbar,
  Tag: VTag,
  Dialog: VDlg
} = window.GoodDealerDesignSystem_b5b0b6;
function vseed() {
  const t = d => "_atomverify=" + d.replace(/\W/g, "").slice(0, 4) + Math.floor(Math.random() * 90 + 10);
  const r = (id, domain, owner, ns, nsOk, records, provider, status, last) => ({
    id,
    domain,
    owner,
    ns,
    nsOk,
    records,
    provider,
    status,
    last,
    token: t(domain)
  });
  return [r(1, "vault.io", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "14:02"), r(2, "kanban.ai", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "14:01"), r(3, "goldrail.com", "pending", "Cloudflare", true, "warn", "Cloudflare", "propagating", "13:40"), r(4, "quanta.trade", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "12:20"), r(5, "helio.systems", "failed", "ns.dynadot.com", false, "missing", "Dynadot", "warn", "07-30"), r(6, "crest.capital", "verified", "Cloudflare", true, "warn", "Cloudflare", "warn", "11:05"), r(7, "north.capital", "pending", "ns.spaceship.com", false, "ok", "Spaceship", "warn", "09-12"), r(8, "mint.money", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "14:00"), r(9, "forge.dev", "pending", "未知 NS", false, "missing", "—", "warn", "—"), r(10, "spark.trade", "verified", "Cloudflare", true, "ok", "Cloudflare", "ok", "13:58")];
}
const OWNER = {
  verified: {
    tone: "gold",
    label: "已验证"
  },
  pending: {
    tone: "warning",
    label: "待验证"
  },
  failed: {
    tone: "danger",
    label: "失效"
  }
};
const REC = {
  ok: {
    tone: "success",
    label: "正常"
  },
  warn: {
    tone: "warning",
    label: "告警"
  },
  missing: {
    tone: "danger",
    label: "缺失"
  }
};
const STAT = {
  ok: {
    dot: "success",
    label: "正常"
  },
  propagating: {
    dot: "sync",
    label: "传播中"
  },
  warn: {
    dot: "warning",
    label: "告警"
  }
};
function DnsVerify({
  addUnsynced
}) {
  const I = window.GDI;
  const {
    BatchNsDialog,
    BatchRecordsDialog
  } = window.GDDialogs;
  const [rows, setRows] = React.useState(vseed);
  const [q, setQ] = React.useState("");
  const [ownerF, setOwnerF] = React.useState("全部");
  const [verifying, setVerifying] = React.useState({});
  const [dlg, setDlg] = React.useState(null); // {type:'ns'|'records', domain}
  const [tokenFor, setTokenFor] = React.useState(null);
  const OWNERF = {
    全部: null,
    已验证: "verified",
    待验证: "pending",
    失效: "failed"
  };
  const view = rows.filter(r => (OWNERF[ownerF] == null || r.owner === OWNERF[ownerF]) && (q === "" || r.domain.includes(q) || r.provider.includes(q)));
  const verified = rows.filter(r => r.owner === "verified").length;
  const pending = rows.filter(r => r.owner !== "verified").length;
  const nsBad = rows.filter(r => !r.nsOk).length;
  const recBad = rows.filter(r => r.records !== "ok").length;
  const propagating = rows.filter(r => r.status === "propagating").length;
  const kpis = [["已验证所有权", String(verified), "gold"], ["待验证 / 失效", String(pending), "warning"], ["NS 指向异常", String(nsBad), "danger"], ["记录告警 / 缺失", String(recBad), "warning"], ["传播中", String(propagating), "blue"]];
  const kcolor = t => t === "gold" ? "var(--gd-gold)" : t === "warning" ? "var(--gd-warning)" : t === "danger" ? "var(--gd-danger)" : t === "blue" ? "var(--gd-blue)" : "var(--text-1)";
  const reverify = r => {
    setVerifying(v => ({
      ...v,
      [r.id]: true
    }));
    setTimeout(() => {
      setVerifying(v => ({
        ...v,
        [r.id]: false
      }));
      setRows(rs => rs.map(x => x.id === r.id ? {
        ...x,
        owner: "verified",
        last: "现在"
      } : x));
    }, 1200);
  };
  const applyNs = r => {
    setRows(rs => rs.map(x => x.id === r.id ? {
      ...x,
      ns: "Cloudflare",
      nsOk: true,
      provider: "Cloudflare",
      status: "propagating",
      last: "现在"
    } : x));
    addUnsynced && addUnsynced(1);
    setDlg(null);
  };
  const applyRec = r => {
    setRows(rs => rs.map(x => x.id === r.id ? {
      ...x,
      records: "ok",
      status: "propagating",
      last: "现在"
    } : x));
    addUnsynced && addUnsynced(1);
    setDlg(null);
  };
  const pendingCount = rows.filter(r => r.owner === "pending").length;
  const reverifyAll = () => {
    const ids = rows.filter(r => r.owner === "pending").map(r => r.id);
    setVerifying(v => {
      const n = {
        ...v
      };
      ids.forEach(i => n[i] = true);
      return n;
    });
    setTimeout(() => {
      setVerifying({});
      setRows(rs => rs.map(x => ids.includes(x.id) ? {
        ...x,
        owner: "verified",
        last: "现在"
      } : x));
    }, 1400);
  };
  const actionCell = r => {
    if (verifying[r.id]) return /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        color: "var(--gd-blue)",
        fontSize: 12,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 12,
      style: {
        animation: "gd-spinner 1s linear infinite"
      }
    }), "\u9A8C\u8BC1\u4E2D");
    if (r.owner !== "verified") return /*#__PURE__*/React.createElement(VBtn, {
      size: "sm",
      onClick: () => reverify(r)
    }, "\u91CD\u65B0\u9A8C\u8BC1");
    if (!r.nsOk) return /*#__PURE__*/React.createElement(VBtn, {
      size: "sm",
      onClick: () => setDlg({
        type: "ns",
        row: r
      })
    }, "\u6539 NS");
    if (r.records !== "ok") return /*#__PURE__*/React.createElement(VBtn, {
      size: "sm",
      onClick: () => setDlg({
        type: "records",
        row: r
      })
    }, "\u6539\u8BB0\u5F55");
    return /*#__PURE__*/React.createElement(VBtn, {
      size: "sm",
      variant: "ghost",
      onClick: () => setTokenFor(r)
    }, "\u9A8C\u8BC1 TXT");
  };
  const MetricStrip = window.GDMetricStrip;
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "DNS \u4E0E\u9A8C\u8BC1",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MetricStrip, {
    metrics: kpis.map(k => ({
      label: k[0],
      value: k[1],
      tone: k[2]
    }))
  }), /*#__PURE__*/React.createElement(VToolbar, {
    region: true,
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(VInput, {
      size: "sm",
      prefix: /*#__PURE__*/React.createElement(I.Search, {
        size: 13
      }),
      placeholder: "\u641C\u7D22\u57DF\u540D / \u63D0\u4F9B\u5546",
      value: q,
      onChange: e => setQ(e.target.value),
      style: {
        width: 210
      }
    }), /*#__PURE__*/React.createElement(VSel, {
      size: "sm",
      options: Object.keys(OWNERF),
      value: ownerF,
      onChange: e => setOwnerF(e.target.value)
    })),
    right: /*#__PURE__*/React.createElement(VBtn, {
      size: "sm",
      variant: "primary",
      disabled: pendingCount === 0,
      onClick: reverifyAll,
      icon: /*#__PURE__*/React.createElement(I.Shield, {
        size: 14
      })
    }, "\u91CD\u65B0\u9A8C\u8BC1\u5F85\u9A8C\u8BC1\u9879", pendingCount ? ` · ${pendingCount}` : "")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 16px",
      borderBottom: "1px solid var(--gd-line)",
      background: "var(--gd-panel)",
      display: "flex",
      alignItems: "center",
      gap: 8,
      flex: "none",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, /*#__PURE__*/React.createElement(I.Shield, {
    size: 13,
    style: {
      color: "var(--gd-text-faint)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-text)",
      fontWeight: 500
    }
  }, "Nameserver"), " \u7531\u6CE8\u518C\u5546\u59D4\u6D3E\u3001", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-text)",
      fontWeight: 500
    }
  }, "DNS \u8BB0\u5F55"), " \u7531 DNS \u63D0\u4F9B\u5546\u4E0B\u53D1\uFF1B", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-text)",
      fontWeight: 500
    }
  }, "\u6240\u6709\u6743"), "\u7ECF DNS TXT ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text)"
    }
  }, "_atomverify"), " \u6821\u9A8C\u3002\u4FEE\u590D\u5206\u522B\u8D70\u5BF9\u5E94\u5904\u7406\u5E73\u53F0\u3002")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(VTable, {
    density: "regular",
    rowKey: "id",
    maxHeight: "100%",
    style: {
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "domain",
      label: "域名",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-1)"
        }
      }, r.domain)
    }, {
      key: "owner",
      label: "所有权",
      width: 96,
      render: r => /*#__PURE__*/React.createElement(VBadge, {
        tone: OWNER[r.owner].tone,
        mono: false
      }, OWNER[r.owner].label)
    }, {
      key: "ns",
      label: "Nameserver",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: r.nsOk ? "var(--gd-text-muted)" : "var(--gd-danger)"
        }
      }, !r.nsOk && /*#__PURE__*/React.createElement(I.AlertTriangle, {
        size: 12
      }), r.ns)
    }, {
      key: "records",
      label: "记录",
      width: 84,
      render: r => /*#__PURE__*/React.createElement(VBadge, {
        tone: REC[r.records].tone,
        mono: false
      }, REC[r.records].label)
    }, {
      key: "provider",
      label: "DNS 提供商",
      muted: true,
      width: 112
    }, {
      key: "status",
      label: "状态",
      width: 100,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 6,
          fontSize: 12
        }
      }, /*#__PURE__*/React.createElement(VDot, {
        kind: STAT[r.status].dot,
        pulse: r.status === "propagating"
      }), STAT[r.status].label)
    }, {
      key: "last",
      label: "最后校验",
      numeric: true,
      muted: true,
      width: 92
    }, {
      key: "act",
      label: "",
      width: 118,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "flex",
          justifyContent: "flex-end"
        }
      }, actionCell(r))
    }],
    rows: view
  })), dlg && dlg.type === "ns" && /*#__PURE__*/React.createElement(BatchNsDialog, {
    open: true,
    domains: [{
      id: dlg.row.id,
      domain: dlg.row.domain
    }],
    onClose: () => setDlg(null),
    onApply: () => applyNs(dlg.row)
  }), dlg && dlg.type === "records" && /*#__PURE__*/React.createElement(BatchRecordsDialog, {
    open: true,
    domains: [{
      id: dlg.row.id,
      domain: dlg.row.domain
    }],
    onClose: () => setDlg(null),
    onApply: () => applyRec(dlg.row)
  }), /*#__PURE__*/React.createElement(VDlg, {
    open: !!tokenFor,
    onClose: () => setTokenFor(null),
    title: "\u6240\u6709\u6743\u9A8C\u8BC1 \xB7 DNS TXT",
    width: 460,
    footer: /*#__PURE__*/React.createElement(VBtn, {
      variant: "primary",
      onClick: () => setTokenFor(null)
    }, "\u5B8C\u6210")
  }, tokenFor && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(VBadge, {
    tone: "gold"
  }, "OWNER VERIFIED"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, tokenFor.domain, " \xB7 \u6700\u540E\u6821\u9A8C ", tokenFor.last)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-t-label"
  }, "\u9A8C\u8BC1\u8BB0\u5F55\uFF08DNS \u63D0\u4F9B\u5546 \xB7 ", tokenFor.provider, "\uFF09"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "64px 1fr",
      gap: 8,
      fontFamily: "var(--font-mono)",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u7C7B\u578B"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-blue)"
    }
  }, "TXT"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u4E3B\u673A"), /*#__PURE__*/React.createElement("span", null, "_atomverify"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u503C"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text)",
      wordBreak: "break-all"
    }
  }, tokenFor.token))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u8BE5 TXT \u8BB0\u5F55\u7528\u4E8E\u5411\u5E73\u53F0\u8BC1\u660E\u57DF\u540D\u6240\u6709\u6743\uFF1B\u672C\u5730\u5BC6\u94A5\u7B7E\u53D1\uFF0C\u5220\u9664\u4F1A\u5BFC\u81F4\u9A8C\u8BC1\u5931\u6548\u3002"))));
}
window.GDDnsVerify = DnsVerify;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/DnsVerify.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/DomainDetail.jsx
try { (() => {
// Domain detail screen — reached by clicking a row in the asset library.
const {
  Panel: DPanel,
  Badge: DBadge,
  Money: DMoney,
  Tag: DTag,
  Button: DBtn,
  Switch: DSwitch,
  StatusDot: DDot,
  Table: DTable,
  Dialog: DDlg
} = window.GoodDealerDesignSystem_b5b0b6;
const dfmt = n => n == null ? "—" : Number(n).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const dnum = v => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
const nsProv = a => /Cloudflare/.test(a) ? "Cloudflare" : /销售平台/.test(a) ? "销售平台" : /注册商/.test(a) ? "注册商" : "自定义 NS";
function synth(d) {
  const yr = +d.expiry.slice(0, 4);
  const created = yr - 2 + d.expiry.slice(4);
  const nsMap = {
    "Cloudflare": ["ada.ns.cloudflare.com", "bob.ns.cloudflare.com"],
    "注册商": ["ns1." + d.registrar.toLowerCase() + ".com", "ns2." + d.registrar.toLowerCase() + ".com"]
  };
  const ns = nsMap[d.dns] || ["ns1." + d.dns.toLowerCase() + ".com", "ns2." + d.dns.toLowerCase() + ".com"];
  const records = [{
    type: "A",
    host: "@",
    value: "185.199.108.153",
    ttl: "Auto"
  }, {
    type: "CNAME",
    host: "www",
    value: d.domain,
    ttl: "Auto"
  }, {
    type: "TXT",
    host: "_atomverify",
    value: "atom-verify=8f2a…",
    ttl: "3600"
  }, {
    type: "MX",
    host: "@",
    value: "10 mail." + d.domain,
    ttl: "3600"
  }];
  const plats = d.platforms === "—" ? [] : d.platforms.split(" · ");
  const listings = plats.map((p, i) => ({
    platform: p,
    status: d.status === "sold" && i === 0 ? "sold" : d.status === "pending" ? "pending" : "active",
    price: d.bin,
    updated: i === 0 ? "14:02" : "07-28"
  }));
  const history = [{
    rev: "8,241",
    when: "今日 14:02",
    who: "批量改价 −8%",
    field: "BIN"
  }, {
    rev: "8,180",
    when: "07-30 09:11",
    who: "同步 · Atom",
    field: "Listing"
  }, {
    rev: "7,905",
    when: "07-14 16:40",
    who: "手动编辑",
    field: "标签"
  }];
  return {
    created,
    ns,
    records,
    listings,
    history
  };
}
function KV({
  k,
  children
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "8px 0",
      borderBottom: "1px solid var(--gd-line)",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 96,
      flex: "none",
      color: "var(--gd-text-faint)",
      fontSize: 12
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      gap: 8,
      justifyContent: "flex-end",
      textAlign: "right"
    }
  }, children));
}
function DomainDetail({
  domain,
  onBack,
  updateDomains,
  addUnsynced
}) {
  const I = window.GDI;
  const s = React.useMemo(() => synth(domain), [domain.id]);
  const [autoRenew, setAutoRenew] = React.useState(true);
  const [lock, setLock] = React.useState(true);
  const [dlg, setDlg] = React.useState(null); // dns | list | price | delist
  const [priceVal, setPriceVal] = React.useState("");
  const {
    BatchNsDialog,
    BatchRecordsDialog,
    ListDialog
  } = window.GDDialogs;
  const one = [{
    id: domain.id,
    domain: domain.domain,
    bin: domain.bin
  }];
  const set = patch => {
    updateDomains(ds => ds.map(x => x.id === domain.id ? {
      ...x,
      ...patch
    } : x));
    addUnsynced(1);
  };
  const STATUS = {
    synced: /*#__PURE__*/React.createElement(DBadge, {
      tone: "sync"
    }, "SYNCED"),
    pending: /*#__PURE__*/React.createElement(DBadge, {
      tone: "warning",
      mono: false
    }, "\u7B49\u5F85\u5E73\u53F0"),
    conflict: /*#__PURE__*/React.createElement(DBadge, {
      tone: "danger",
      mono: false
    }, "\u51B2\u7A81"),
    unlisted: /*#__PURE__*/React.createElement(DBadge, {
      mono: false
    }, "\u672A\u4E0A\u67B6"),
    sold: /*#__PURE__*/React.createElement(DBadge, {
      tone: "gold"
    }, "SOLD")
  };
  const listed = domain.status !== "unlisted" && domain.status !== "sold";
  const soon = domain.expiry < "2026-10-01";
  const ribbon = [{
    l: "BIN 估值",
    v: /*#__PURE__*/React.createElement(DMoney, {
      amount: domain.bin,
      size: 26
    })
  }, {
    l: "当前状态",
    v: /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex"
      }
    }, STATUS[domain.status])
  }, {
    l: "到期",
    v: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 16,
        color: soon ? "var(--gd-warning)" : "var(--text-1)"
      }
    }, domain.expiry)
  }, {
    l: "活跃 Listing",
    v: /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 18
      }
    }, s.listings.filter(x => x.status === "active").length)
  }];
  const lstBadge = st => st === "sold" ? /*#__PURE__*/React.createElement(DBadge, {
    tone: "gold"
  }, "SOLD") : st === "pending" ? /*#__PURE__*/React.createElement(DBadge, {
    tone: "warning",
    mono: false
  }, "\u7B49\u5F85") : /*#__PURE__*/React.createElement(DBadge, {
    tone: "success",
    mono: false
  }, "\u5728\u552E");
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u57DF\u540D\u8BE6\u60C5",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0,
      overflow: "auto"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "14px 18px",
      borderBottom: "1px solid var(--gd-line)",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    variant: "ghost",
    icon: /*#__PURE__*/React.createElement(I.ChevronLeft, {
      size: 15
    }),
    onClick: onBack
  }, "\u8D44\u4EA7\u5E93"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 20,
      color: "var(--text-1)"
    }
  }, domain.domain), STATUS[domain.status], /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      gap: 5
    }
  }, domain.tags.map(t => /*#__PURE__*/React.createElement(DTag, {
    key: t,
    color: t.startsWith("portfolio") ? "var(--gd-blue)" : undefined
  }, t))), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    onClick: () => {
      setPriceVal(domain.bin != null ? String(domain.bin) : "");
      setDlg("price");
    }
  }, "\u7F16\u8F91\u4EF7\u683C"), listed ? /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    onClick: () => setDlg("delist")
  }, "\u4E0B\u67B6") : /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    variant: "primary",
    onClick: () => setDlg("list")
  }, "\u4E0A\u67B6"), /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    variant: "ghost",
    icon: /*#__PURE__*/React.createElement(I.ExternalLink, {
      size: 13
    })
  }, "\u6253\u5F00\u6CE8\u518C\u5546"))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      background: "var(--surface-region)",
      borderBottom: "1px solid var(--gd-line)",
      flex: "none"
    }
  }, ribbon.map((r, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      flex: 1,
      padding: "12px 18px",
      borderRight: i < ribbon.length - 1 ? "1px solid var(--gd-line)" : "none",
      display: "flex",
      flexDirection: "column",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-t-label"
  }, r.l), r.v))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "minmax(0,1fr) minmax(0,1.1fr)",
      gap: 14,
      padding: 16,
      alignItems: "start"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(DPanel, {
    title: "\u6CE8\u518C\u4FE1\u606F"
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement(KV, {
    k: "\u6CE8\u518C\u5546"
  }, domain.registrar), /*#__PURE__*/React.createElement(KV, {
    k: "\u6CE8\u518C\u65E5\u671F"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-muted)"
    }
  }, s.created)), /*#__PURE__*/React.createElement(KV, {
    k: "\u5230\u671F"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: soon ? "var(--gd-warning)" : undefined
    }
  }, domain.expiry)), /*#__PURE__*/React.createElement(KV, {
    k: "\u81EA\u52A8\u7EED\u8D39"
  }, /*#__PURE__*/React.createElement(DSwitch, {
    checked: autoRenew,
    onChange: () => {
      setAutoRenew(v => !v);
      addUnsynced(1);
    }
  })), /*#__PURE__*/React.createElement(KV, {
    k: "\u8F6C\u79FB\u9501"
  }, /*#__PURE__*/React.createElement(DSwitch, {
    checked: lock,
    onChange: () => {
      setLock(v => !v);
      addUnsynced(1);
    }
  })), /*#__PURE__*/React.createElement(KV, {
    k: "DNS \u63D0\u4F9B\u5546"
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-muted)"
    }
  }, domain.dns)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "8px 0",
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 96,
      flex: "none",
      color: "var(--gd-text-faint)",
      fontSize: 12
    }
  }, "Nameserver"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, s.ns[0]), /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    variant: "ghost",
    onClick: () => setDlg("ns")
  }, "\u53D8\u66F4"))), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "6px 0 0",
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "Nameserver \u7531\u6CE8\u518C\u5546\u7BA1\u7406 \xB7 DNS \u8BB0\u5F55\u7531 DNS \u63D0\u4F9B\u5546\u4E0B\u53D1"))), /*#__PURE__*/React.createElement(DPanel, {
    title: "\u6240\u6709\u6743\u9A8C\u8BC1",
    actions: /*#__PURE__*/React.createElement(DBadge, {
      tone: "success",
      mono: false
    }, "\u5DF2\u9A8C\u8BC1")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 12,
      alignItems: "flex-start"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/icons/keyhole.svg",
    width: "30",
    height: "30",
    alt: "",
    style: {
      opacity: .9,
      flex: "none",
      marginTop: 2
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      fontSize: 12,
      color: "var(--gd-text-muted)",
      lineHeight: 1.6
    }
  }, "\u901A\u8FC7 DNS TXT ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text)"
    }
  }, "_atomverify"), " \u9A8C\u8BC1\u6240\u6709\u6743 \xB7 \u6700\u540E\u9A8C\u8BC1 07-30 09:11\u3002", /*#__PURE__*/React.createElement("br", null), "\u672C\u5730\u5BC6\u94A5\u7B7E\u53D1 License\uFF0C\u51ED\u636E\u6C38\u4E0D\u4E0A\u4E91\u3002")))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(DPanel, {
    flush: true,
    title: "\u9500\u552E Listing",
    actions: listed ? /*#__PURE__*/React.createElement(DBtn, {
      size: "sm",
      variant: "ghost",
      onClick: () => setDlg("price")
    }, "\u6539\u4EF7") : null
  }, s.listings.length > 0 ? /*#__PURE__*/React.createElement(DTable, {
    density: "compact",
    rowKey: "platform",
    columns: [{
      key: "platform",
      label: "平台"
    }, {
      key: "status",
      label: "状态",
      render: r => lstBadge(r.status)
    }, {
      key: "price",
      label: "价格",
      numeric: true,
      render: r => /*#__PURE__*/React.createElement(DMoney, {
        amount: r.price
      })
    }, {
      key: "updated",
      label: "更新",
      numeric: true,
      muted: true
    }],
    rows: s.listings,
    style: {
      border: "none",
      borderRadius: 0
    }
  }) : /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "20px 14px",
      fontSize: 12,
      color: "var(--gd-text-faint)",
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, "\u672A\u5728\u4EFB\u4F55\u5E73\u53F0\u4E0A\u67B6 \xB7 ", /*#__PURE__*/React.createElement(DBtn, {
    size: "sm",
    variant: "primary",
    onClick: () => setDlg("list")
  }, "\u4E0A\u67B6"))), /*#__PURE__*/React.createElement(DPanel, {
    flush: true,
    title: "DNS \u8BB0\u5F55",
    actions: /*#__PURE__*/React.createElement(DBtn, {
      size: "sm",
      variant: "ghost",
      onClick: () => setDlg("records")
    }, "\u4FEE\u6539\u8BB0\u5F55")
  }, /*#__PURE__*/React.createElement(DTable, {
    density: "compact",
    rowKey: "host",
    columns: [{
      key: "type",
      label: "类型",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--gd-blue)"
        }
      }, r.type),
      width: 64
    }, {
      key: "host",
      label: "主机",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12
        }
      }, r.host)
    }, {
      key: "value",
      label: "值",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--gd-text-muted)"
        }
      }, r.value)
    }, {
      key: "ttl",
      label: "TTL",
      numeric: true,
      muted: true,
      width: 64
    }],
    rows: s.records,
    style: {
      border: "none",
      borderRadius: 0
    }
  })), /*#__PURE__*/React.createElement(DPanel, {
    flush: true,
    title: "\u64CD\u4F5C\u5386\u53F2"
  }, /*#__PURE__*/React.createElement("div", null, s.history.map((h, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "9px 14px",
      borderBottom: i < s.history.length - 1 ? "1px solid var(--gd-line)" : "none",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-faint)",
      width: 52
    }
  }, "rev ", h.rev), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }, h.who), /*#__PURE__*/React.createElement(DTag, null, h.field), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-faint)",
      width: 90,
      textAlign: "right"
    }
  }, h.when))))))), dlg === "ns" && /*#__PURE__*/React.createElement(BatchNsDialog, {
    open: true,
    domains: one,
    onClose: () => setDlg(null),
    onApply: ({
      applied
    }) => {
      set({
        dns: nsProv(applied)
      });
      setDlg(null);
    }
  }), dlg === "records" && /*#__PURE__*/React.createElement(BatchRecordsDialog, {
    open: true,
    domains: one,
    onClose: () => setDlg(null),
    onApply: () => {
      addUnsynced(1);
      setDlg(null);
    }
  }), dlg === "list" && /*#__PURE__*/React.createElement(ListDialog, {
    open: true,
    domains: one,
    onClose: () => setDlg(null),
    onApply: ({
      platforms,
      price
    }) => {
      set({
        status: "synced",
        platforms: platforms.join(" · "),
        bin: price != null ? price : domain.bin
      });
      setDlg(null);
    }
  }), /*#__PURE__*/React.createElement(DDlg, {
    open: dlg === "price",
    onClose: () => setDlg(null),
    title: `编辑价格 · ${domain.domain}`,
    width: 420,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DBtn, {
      onClick: () => setDlg(null)
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(DBtn, {
      variant: "primary",
      onClick: () => {
        set({
          bin: dnum(priceVal)
        });
        setDlg(null);
      }
    }, "\u4FDD\u5B58\u5E76\u540C\u6B65"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u5F53\u524D ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-faint)"
    }
  }, "$", dfmt(domain.bin))), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u2192"), /*#__PURE__*/React.createElement("input", {
    autoFocus: true,
    value: priceVal,
    onChange: e => setPriceVal(e.target.value),
    inputMode: "decimal",
    style: {
      width: 150,
      height: 30,
      background: "var(--gd-ink)",
      border: "1px solid var(--gd-blue)",
      boxShadow: "0 0 0 2px rgba(77,141,255,0.25)",
      borderRadius: 5,
      color: "var(--gd-text)",
      fontFamily: "var(--font-mono)",
      fontSize: 14,
      textAlign: "right",
      padding: "0 9px",
      outline: "none"
    }
  })), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u4FDD\u5B58\u540E\u5199\u5165\u672A\u540C\u6B65\u4FEE\u6539\uFF0C\u5C06\u5728\u4E0B\u6B21\u540C\u6B65\u65F6\u63D0\u4EA4\u5230\u9500\u552E\u5E73\u53F0\u3002"))), /*#__PURE__*/React.createElement(DDlg, {
    open: dlg === "delist",
    onClose: () => setDlg(null),
    title: `下架 · ${domain.domain}`,
    width: 420,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(DBtn, {
      onClick: () => setDlg(null)
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(DBtn, {
      variant: "danger",
      onClick: () => {
        set({
          status: "unlisted",
          platforms: "—"
        });
        setDlg(null);
      }
    }, "\u4E0B\u67B6\u5E76\u4ECE\u5E73\u53F0\u79FB\u9664"))
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u5C06 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, domain.domain), " \u4ECE\u5F53\u524D\u9500\u552E\u5E73\u53F0\u4E0B\u67B6\u3002\u53EF\u5B89\u5168\u91CD\u8BD5\uFF1B\u7ED3\u679C\u4EE5\u5E73\u53F0 Listing \u72B6\u6001\u4E3A\u51C6\u3002")));
}
window.GDDomainDetail = DomainDetail;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/DomainDetail.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/HistoryLog.jsx
try { (() => {
// 操作历史 / Audit & Rollback — the append-only Revision ledger.
// Every change is a Revision; the ledger is read-only except 回滚, which creates a NEW
// forward revision that reverts (history is never deleted) and enqueues to Outbox.
// Rollback of Nameserver entries is high-risk → confirmation ceremony with ack gate.
const {
  Table: HTable,
  Badge: HBadge,
  Button: HBtn,
  DiffValue: HDiff,
  Tag: HTag,
  Dialog: HDlg,
  Checkbox: HCheck,
  Select: HSel,
  Input: HInput,
  Panel: HPanel,
  Toolbar: HToolbar
} = window.GoodDealerDesignSystem_b5b0b6;
const H_STATE = {
  applied: {
    tone: null,
    label: "本地"
  },
  synced: {
    tone: "success",
    label: "已同步"
  },
  rolled_back: {
    tone: "warning",
    label: "已回滚"
  },
  pull: {
    tone: "sync",
    label: "云端拉取"
  },
  device: {
    tone: "gold",
    label: "设备"
  }
};
function hseed() {
  const d = (rev, ts, actor, scope, action, platform, count, state, risk, diffs) => ({
    rev,
    ts,
    actor,
    scope,
    action,
    platform,
    count,
    state,
    risk,
    diffs
  });
  return [d("8,241", "今日 14:02", "MacBook Pro", "批量", "批量改价 −8%", "交易平台 · Atom", 799, "synced", false, [["vault.io", "BIN", "3,000.00", "2,760.00"], ["oxide.dev", "BIN", "5,800.00", "5,336.00"], ["arc.exchange", "BIN", "12,000.00", "11,040.00"]]), d("8,240", "今日 14:02", "MacBook Pro", "批量", "变更 Nameserver", "注册商 · Spaceship·Dynadot", 3, "synced", true, [["goldrail.com", "NS", "ns.spaceship.com", "cloudflare.com"], ["quanta.trade", "NS", "ns.dynadot.com", "cloudflare.com"]]), d("8,239", "今日 14:01", "MacBook Pro", "批量", "新增 TXT 记录", "DNS 提供商 · Cloudflare", 17, "synced", false, [["crest.capital", "TXT", "—", "_atom=8f2a…"], ["mint.money", "TXT", "—", "_atom=1c90…"]]), d("8,238", "今日 13:58", "MacBook Pro", "批量", "上架 · Atom", "交易平台 · Atom", 12, "synced", false, [["north.capital", "Listing", "未上架", "Atom · $8,900"]]), d("8,237", "昨日 18:22", "MacBook Pro", "单域", "手动改价", "交易平台 · Atom", 1, "applied", false, [["kanban.ai", "BIN", "45,000.00", "99,999.00"]]), d("8,231", "07-30 09:11", "云端同步", "同步", "拉取远端变更", "GoodDealer Cloud", 41, "pull", false, []), d("8,220", "07-28 11:03", "MacBook Pro", "批量", "下架", "交易平台 · Afternic", 6, "synced", false, [["legacy.io", "Listing", "Afternic", "已下架"]]), d("8,180", "07-14 16:40", "MacBook Pro", "单域", "编辑标签", "本地", 1, "applied", false, [["vault.io", "标签", "三字母", "三字母 · portfolio-a"]]), d("8,150", "07-02 08:15", "系统", "设备", "移交执行权 · Epoch 40→41", "设备门禁", 1, "device", false, []), d("8,102", "06-20 10:30", "MacBook Pro", "批量", "回滚 → rev 8,098", "交易平台 · Atom", 23, "rolled_back", false, [["misfire.co", "BIN", "900.00", "1,200.00"]])];
}
function DetailPane({
  e,
  onRollback
}) {
  const I = window.GDI;
  if (!e) return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      width: 344,
      borderLeft: "1px solid var(--gd-line)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      color: "var(--gd-text-faint)",
      fontSize: 12
    }
  }, "\u9009\u62E9\u4E00\u6761 Revision \u67E5\u770B\u660E\u7EC6");
  const st = H_STATE[e.state];
  const rollbackable = !["pull", "device", "rolled_back"].includes(e.state);
  const M = ({
    k,
    children
  }) => /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      gap: 12,
      padding: "7px 0",
      borderBottom: "1px solid var(--gd-line)",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, k), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: k === "Revision" || k === "Epoch" ? "var(--font-mono)" : undefined,
      color: "var(--gd-text-muted)",
      textAlign: "right"
    }
  }, children));
  return /*#__PURE__*/React.createElement("div", {
    style: {
      flex: "none",
      width: 344,
      borderLeft: "1px solid var(--gd-line)",
      display: "flex",
      flexDirection: "column",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "13px 15px",
      borderBottom: "1px solid var(--gd-line)",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 15,
      color: "var(--text-1)"
    }
  }, "rev ", e.rev), /*#__PURE__*/React.createElement(HBadge, {
    tone: st.tone,
    mono: false
  }, st.label), e.risk && /*#__PURE__*/React.createElement(HBadge, {
    tone: "danger",
    mono: false
  }, "\u9AD8\u98CE\u9669")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--text-1)"
    }
  }, e.action)), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "4px 15px",
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(M, {
    k: "Revision"
  }, e.rev), /*#__PURE__*/React.createElement(M, {
    k: "\u65F6\u95F4"
  }, e.ts), /*#__PURE__*/React.createElement(M, {
    k: "\u6765\u6E90"
  }, e.actor), /*#__PURE__*/React.createElement(M, {
    k: "\u5904\u7406\u5E73\u53F0"
  }, e.platform), /*#__PURE__*/React.createElement(M, {
    k: "\u5F71\u54CD\u6761\u76EE"
  }, e.count, " \u9879")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflow: "auto",
      padding: "6px 15px"
    }
  }, e.diffs.length > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    className: "gd-t-label",
    style: {
      margin: "4px 0 8px"
    }
  }, "\u5B57\u6BB5\u53D8\u66F4 \xB7 \u793A\u4F8B ", e.diffs.length, " / ", e.count), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, e.diffs.map((df, i) => /*#__PURE__*/React.createElement("div", {
    key: i,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 3,
      paddingBottom: 9,
      borderBottom: "1px solid var(--gd-line)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--text-1)"
    }
  }, df[0], " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\xB7 ", df[1])), /*#__PURE__*/React.createElement(HDiff, {
    oldValue: df[2],
    newValue: df[3],
    size: 11
  }))))) : /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-faint)",
      padding: "12px 0"
    }
  }, e.state === "pull" ? "同步拉取，无本地字段变更明细。" : e.state === "device" ? "设备门禁事件，见设置 · 设备与运行态。" : "无字段变更。")), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "11px 15px",
      borderTop: "1px solid var(--gd-line)",
      display: "flex",
      gap: 8,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(HBtn, {
    size: "sm",
    variant: "ghost",
    icon: /*#__PURE__*/React.createElement(I.FileText, {
      size: 13
    })
  }, "\u5BFC\u51FA"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), rollbackable ? /*#__PURE__*/React.createElement(HBtn, {
    size: "sm",
    variant: e.risk ? "danger" : "primary",
    onClick: () => onRollback(e),
    icon: /*#__PURE__*/React.createElement(I.History, {
      size: 13
    })
  }, "\u56DE\u6EDA\u6B64 Revision") : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)",
      alignSelf: "center"
    }
  }, e.state === "rolled_back" ? "已回滚" : "不可回滚")));
}
function HistoryLog({
  addUnsynced
}) {
  const I = window.GDI;
  const [entries, setEntries] = React.useState(hseed);
  const [selRev, setSelRev] = React.useState("8,241");
  const [q, setQ] = React.useState("");
  const [typeF, setTypeF] = React.useState("全部类型");
  const [rb, setRb] = React.useState(null);
  const [ack, setAck] = React.useState(false);
  const TYPES = {
    全部类型: null,
    改价: "改价",
    DNS: "记录",
    NS: "Nameserver",
    上架下架: "架",
    同步: "拉取",
    回滚: "回滚"
  };
  const rows = entries.filter(e => (TYPES[typeF] == null || e.action.includes(TYPES[typeF])) && (q === "" || e.action.includes(q) || e.rev.includes(q) || e.platform.includes(q)));
  const sel = entries.find(e => e.rev === selRev) || rows[0];
  const nextRev = () => {
    const top = parseInt(entries[0].rev.replace(/,/g, ""), 10) + 1;
    return top.toLocaleString("en-US");
  };
  const doRollback = () => {
    const t = rb;
    const nr = nextRev();
    setRb(null);
    setAck(false);
    setEntries(es => [{
      rev: nr,
      ts: "现在",
      actor: "MacBook Pro",
      scope: t.scope,
      action: `回滚 → rev ${t.rev}`,
      platform: t.platform,
      count: t.count,
      state: "applied",
      risk: t.risk,
      diffs: t.diffs.map(d => [d[0], d[1], d[3], d[2]])
    }, ...es.map(e => e.rev === t.rev ? {
      ...e,
      state: "rolled_back"
    } : e)]);
    setSelRev(nr);
    addUnsynced && addUnsynced(Math.min(t.count, 12));
  };
  const kpis = [["总 Revision", "8,241", null], ["今日变更", "4 批 · 831 项", null], ["待同步 Revision", "2", "blue"], ["已回滚", "1", "warning"]];
  const kcolor = t => t === "blue" ? "var(--gd-blue)" : t === "warning" ? "var(--gd-warning)" : "var(--text-1)";
  const MetricStrip = window.GDMetricStrip;
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u64CD\u4F5C\u5386\u53F2",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MetricStrip, {
    metrics: kpis.map((k, i) => ({
      label: k[0],
      value: k[1],
      tone: k[2],
      mono: k[0].includes("Revision") && i === 0
    }))
  }), /*#__PURE__*/React.createElement(HToolbar, {
    region: true,
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(HInput, {
      size: "sm",
      prefix: /*#__PURE__*/React.createElement(I.Search, {
        size: 13
      }),
      placeholder: "\u641C\u7D22 Revision / \u64CD\u4F5C / \u5E73\u53F0",
      value: q,
      onChange: e => setQ(e.target.value),
      style: {
        width: 230
      }
    }), /*#__PURE__*/React.createElement(HSel, {
      size: "sm",
      options: Object.keys(TYPES),
      value: typeF,
      onChange: e => setTypeF(e.target.value)
    })),
    right: /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--gd-text-faint)",
        whiteSpace: "nowrap"
      }
    }, "\u53EA\u8BFB\u8D26\u672C \xB7 \u8FFD\u52A0\u4E0D\u53EF\u7BE1\u6539 \xB7 \u56DE\u6EDA\u751F\u6210\u65B0 Revision")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement(HTable, {
    density: "regular",
    rowKey: "rev",
    maxHeight: "100%",
    onRowClick: r => setSelRev(r.rev),
    style: {
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "rev",
      label: "Revision",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: r.rev === (sel && sel.rev) ? "var(--gd-blue)" : "var(--text-1)"
        }
      }, "rev ", r.rev),
      width: 96
    }, {
      key: "action",
      label: "操作",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          alignItems: "center",
          gap: 7
        }
      }, r.action, r.risk && /*#__PURE__*/React.createElement(I.AlertTriangle, {
        size: 12,
        style: {
          color: "var(--gd-danger)"
        }
      }))
    }, {
      key: "platform",
      label: "处理平台",
      muted: true
    }, {
      key: "actor",
      label: "来源",
      muted: true,
      width: 104
    }, {
      key: "count",
      label: "条目",
      numeric: true,
      width: 64,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)"
        }
      }, r.count)
    }, {
      key: "state",
      label: "状态",
      width: 96,
      render: r => /*#__PURE__*/React.createElement(HBadge, {
        tone: H_STATE[r.state].tone,
        mono: false
      }, H_STATE[r.state].label)
    }, {
      key: "ts",
      label: "时间",
      numeric: true,
      muted: true,
      width: 104
    }],
    rows: rows
  })), /*#__PURE__*/React.createElement(DetailPane, {
    e: sel,
    onRollback: e => {
      setRb(e);
      setAck(false);
    }
  })), /*#__PURE__*/React.createElement(HDlg, {
    open: !!rb,
    onClose: () => {
      setRb(null);
      setAck(false);
    },
    title: `回滚 Revision ${rb && rb.rev}`,
    width: rb && rb.risk ? 528 : 460,
    danger: rb && rb.risk,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(HBtn, {
      onClick: () => {
        setRb(null);
        setAck(false);
      }
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(HBtn, {
      variant: rb && rb.risk ? "danger" : "primary",
      disabled: rb && rb.risk && !ack,
      onClick: doRollback
    }, "\u751F\u6210\u56DE\u6EDA Revision \xB7 ", rb && rb.count, " \u9879"))
  }, rb && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u56DE\u6EDA ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, "rev ", rb.rev), "\uFF08", rb.action, "\uFF09\u3002\u5C06\u751F\u6210\u65B0 Revision ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, nextRev()), " \u53CD\u5411\u5E94\u7528\u5176 ", rb.count, " \u9879\u53D8\u66F4\u5E76\u81EA\u52A8\u540C\u6B65\u4E91\u7AEF\u2014\u2014", /*#__PURE__*/React.createElement("b", null, "\u5386\u53F2\u4E0D\u4F1A\u88AB\u5220\u9664"), "\uFF0C\u539F Revision \u6807\u8BB0\u4E3A\u5DF2\u56DE\u6EDA\u3002"), rb.risk && /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-danger)",
      background: "var(--gd-danger-tint)",
      borderRadius: 7,
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
    size: 15,
    style: {
      color: "var(--gd-danger)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-danger)",
      fontSize: 13
    }
  }, "\u9AD8\u98CE\u9669 \xB7 \u542B Nameserver \u53D8\u66F4"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--gd-text-muted)"
    }
  }, "\u53EF\u56DE\u6EDA")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text)",
      lineHeight: 1.5
    }
  }, "\u56DE\u6EDA\u4F1A\u5C06 Nameserver \u6539\u56DE\u539F\u503C\uFF0C\u89E3\u6790\u4E0E\u90AE\u4EF6\u5728\u4F20\u64AD\u5B8C\u6210\u524D\u53EF\u80FD\u4E2D\u65AD\uFF08\u7EA6 5\u201330 \u5206\u949F\uFF09\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid rgba(229,115,95,0.24)",
      paddingTop: 9
    }
  }, /*#__PURE__*/React.createElement(HCheck, {
    checked: ack,
    onChange: () => setAck(a => !a),
    label: `我已理解后果，确认回滚这 ${rb.count} 项`
  }))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u56DE\u6EDA\u751F\u6210\u7684\u65B0 Revision \u5C06\u81EA\u52A8\u540C\u6B65\u81F3\u4E91\u7AEF\u3002"))));
}
window.GDHistoryLog = HistoryLog;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/HistoryLog.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/Onboarding.jsx
try { (() => {
// 接入 / Onboarding — first-run wizard. The journey entrance.
// Steps: 欢迎 → 设备门禁(签发 ActiveDeviceLease) → 连接账户 → 首次导入 → 完成.
// Hardware-wallet mind: this device becomes Active, local key issues the lease (Epoch 1).
const {
  Button: OBtn,
  Input: OInput,
  Badge: OBadge,
  ProgressBar: OProg,
  StatusDot: ODot
} = window.GoodDealerDesignSystem_b5b0b6;
const STEPS = [["welcome", "欢迎"], ["device", "设备门禁"], ["connect", "连接账户"], ["import", "首次导入"], ["done", "完成"]];
function Stepper({
  idx
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: 180,
      flex: "none",
      borderRight: "1px solid var(--gd-line)",
      background: "var(--gd-panel)",
      padding: "20px 16px",
      display: "flex",
      flexDirection: "column",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      marginBottom: 18,
      padding: "0 4px"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-16.svg",
    width: "18",
    height: "18",
    alt: ""
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      fontWeight: 600,
      letterSpacing: "-0.01em",
      color: "var(--text-1)"
    }
  }, "GoodDealer")), STEPS.map(([k, l], i) => {
    const st = i < idx ? "done" : i === idx ? "cur" : "up";
    return /*#__PURE__*/React.createElement("div", {
      key: k,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "8px 4px",
        fontSize: 13,
        color: st === "up" ? "var(--text-3)" : "var(--text-1)"
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
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
      }
    }, st === "done" ? /*#__PURE__*/React.createElement(window.GDI.Check, {
      size: 12
    }) : i + 1), l);
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      fontSize: 10,
      color: "var(--gd-text-faint)",
      lineHeight: 1.6,
      padding: "0 4px"
    }
  }, "\u672C\u5730\u6267\u884C \xB7 \u4E91\u7AEF\u540C\u6B65", /*#__PURE__*/React.createElement("br", null), "\u51ED\u636E\u7ECF\u672C\u5730\u5BC6\u94A5\u52A0\u5BC6\uFF0C\u6C38\u4E0D\u4E0A\u4E91"));
}
const Field = ({
  label,
  children
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    flexDirection: "column",
    gap: 6
  }
}, /*#__PURE__*/React.createElement("span", {
  className: "gd-t-label"
}, label), children);
function ConnCard({
  name,
  meta,
  connected,
  onToggle
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onToggle,
    style: {
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
    }
  }, /*#__PURE__*/React.createElement(ODot, {
    kind: connected ? "success" : "neutral"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-1)"
    }
  }, name), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, meta)), connected ? /*#__PURE__*/React.createElement(OBadge, {
    tone: "success",
    mono: false
  }, "\u5DF2\u8FDE\u63A5") : /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-blue)"
    }
  }, "\u8FDE\u63A5"));
}
function Onboarding({
  onFinish,
  onSkip,
  startIdx = 0
}) {
  const I = window.GDI;
  const [idx, setIdx] = React.useState(startIdx);
  const [dev, setDev] = React.useState("MacBook Pro");
  const [activating, setActivating] = React.useState(false);
  const [activated, setActivated] = React.useState(false);
  const [conns, setConns] = React.useState({});
  const [importing, setImporting] = React.useState(false);
  const [pct, setPct] = React.useState(0);
  const [imported, setImported] = React.useState(false);
  const toggle = k => setConns(c => ({
    ...c,
    [k]: !c[k]
  }));
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
    const t = setInterval(() => setPct(p => {
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
  const foot = (back, next, nextLabel, nextDisabled, nextVariant) => /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      display: "flex",
      alignItems: "center",
      gap: 10,
      paddingTop: 16
    }
  }, back != null ? /*#__PURE__*/React.createElement(OBtn, {
    variant: "ghost",
    onClick: back
  }, "\u8FD4\u56DE") : /*#__PURE__*/React.createElement(OBtn, {
    variant: "ghost",
    onClick: onSkip
  }, "\u8DF3\u8FC7\u63A5\u5165"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, idx + 1, " / ", STEPS.length), /*#__PURE__*/React.createElement(OBtn, {
    variant: nextVariant || "primary",
    disabled: nextDisabled,
    onClick: next
  }, nextLabel));
  const panes = [
  /*#__PURE__*/
  // 0 welcome
  React.createElement("div", {
    key: "w",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 16,
      margin: "auto 0",
      textAlign: "center",
      paddingTop: 12
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark.svg",
    width: "76",
    height: "76",
    alt: ""
  }), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      color: "var(--text-1)"
    }
  }, "GoodDealer"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 14,
      color: "var(--gd-text-muted)",
      marginTop: 6
    }
  }, "\u672C\u5730\u6267\u884C \xB7 \u4E91\u7AEF\u540C\u6B65\u7684\u57DF\u540D\u8D44\u4EA7\u7EC8\u7AEF")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      marginTop: 8
    }
  }, [["私人银行级掌控", "批量差异预览 · 精确到项的确认"], ["硬件钱包式门禁", "执行权绑定单台 Active 设备"], ["可回滚审计", "每次变更皆为 Revision"]].map(v => /*#__PURE__*/React.createElement("div", {
    key: v[0],
    style: {
      width: 150,
      padding: "12px 13px",
      border: "1px solid var(--gd-line)",
      borderRadius: 8,
      background: "var(--gd-panel)",
      display: "flex",
      flexDirection: "column",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      fontWeight: 500,
      color: "var(--text-1)"
    }
  }, v[0]), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)",
      lineHeight: 1.5
    }
  }, v[1]))))), foot(null, () => setIdx(1), "开始接入", false)),
  /*#__PURE__*/
  // 1 device
  React.createElement("div", {
    key: "d",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 600,
      color: "var(--text-1)"
    }
  }, "\u8BBE\u5907\u95E8\u7981"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)",
      marginTop: 4
    }
  }, "\u5C06\u6B64\u8BBE\u5907\u8BBE\u4E3A", /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-gold)",
      fontWeight: 500
    }
  }, "\u6267\u884C\u8BBE\u5907\uFF08Active\uFF09"), "\u3002\u672C\u5730\u5BC6\u94A5\u7B7E\u53D1 ActiveDeviceLease\uFF0C\u540C\u4E00\u65F6\u523B\u4EC5\u4E00\u53F0\u8BBE\u5907\u53EF\u6267\u884C\u5199\u64CD\u4F5C\u3002")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 14,
      alignItems: "flex-start",
      padding: "16px",
      border: "1px solid var(--gd-line)",
      borderRadius: 9,
      background: "var(--gd-panel)"
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/icons/keyhole.svg",
    width: "40",
    height: "40",
    alt: "",
    style: {
      flex: "none",
      opacity: activated ? 1 : .8
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Field, {
    label: "\u8BBE\u5907\u540D\u79F0"
  }, /*#__PURE__*/React.createElement(OInput, {
    size: "md",
    value: dev,
    onChange: e => setDev(e.target.value),
    disabled: activating || activated,
    style: {
      maxWidth: 280
    }
  })), !activated ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(OBtn, {
    variant: "primary",
    disabled: activating || !dev,
    onClick: activate,
    icon: activating ? /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 14,
      style: {
        animation: "gd-spinner 1s linear infinite"
      }
    }) : /*#__PURE__*/React.createElement(I.Shield, {
      size: 14
    })
  }, activating ? "正在安全激活…" : "生成本地密钥并激活"), activating && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-blue)"
    }
  }, "\u6821\u9A8C\u8BBE\u5907\u6307\u7EB9 \xB7 \u7B7E\u53D1 Lease")) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(ODot, {
    kind: "active"
  }), /*#__PURE__*/React.createElement(OBadge, {
    tone: "gold"
  }, "ACTIVE"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u5DF2\u7B7E\u53D1 ActiveDeviceLease \xB7 ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-gold)"
    }
  }, "Epoch 1"))))), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)",
      lineHeight: 1.6
    }
  }, "\u5BC6\u94A5\u4EC5\u5B58\u4E8E\u672C\u8BBE\u5907\u5B89\u5168\u533A\uFF0C\u6C38\u4E0D\u4E0A\u4E91\u3002\u65E5\u540E\u53EF\u5728\u8BBE\u7F6E \xB7 \u8BBE\u5907\u4E0E\u8FD0\u884C\u6001\u4E2D\u79FB\u4EA4\u6267\u884C\u6743\u5230\u5176\u5B83\u8BBE\u5907\u3002")), foot(() => setIdx(0), () => setIdx(2), "继续", !activated)),
  /*#__PURE__*/
  // 2 connect
  React.createElement("div", {
    key: "c",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 600,
      color: "var(--text-1)"
    }
  }, "\u8FDE\u63A5\u8D26\u6237"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)",
      marginTop: 4
    }
  }, "\u8FDE\u63A5\u6CE8\u518C\u5546\u3001DNS \u4E0E\u4EA4\u6613\u5E73\u53F0\uFF0C\u81F3\u5C11\u4E00\u9879\u3002\u51ED\u636E\u7ECF\u672C\u5730\u5BC6\u94A5\u52A0\u5BC6\u4FDD\u5B58\u3002")), [["注册商 · Nameserver 处理平台", "registrar"], ["DNS 提供商 · 记录处理平台", "dns"], ["交易平台 · 改价上下架处理平台", "platform"]].map(([t, g]) => /*#__PURE__*/React.createElement("div", {
    key: g,
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-t-label"
  }, t), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(3,1fr)",
      gap: 8
    }
  }, PROVIDERS[g].map(([n, m]) => /*#__PURE__*/React.createElement(ConnCard, {
    key: n,
    name: n,
    meta: m,
    connected: !!conns[g + ":" + n],
    onToggle: () => toggle(g + ":" + n)
  })))))), foot(() => setIdx(1), () => setIdx(3), connectedCount > 0 ? `继续 · 已连接 ${connectedCount}` : "继续", connectedCount === 0)),
  /*#__PURE__*/
  // 3 import
  React.createElement("div", {
    key: "i",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16,
      marginTop: 6
    }
  }, /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 17,
      fontWeight: 600,
      color: "var(--text-1)"
    }
  }, "\u9996\u6B21\u5BFC\u5165"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)",
      marginTop: 4
    }
  }, "\u4ECE\u5DF2\u8FDE\u63A5\u7684 ", connectedCount, " \u4E2A\u8D26\u6237\u62C9\u53D6\u57DF\u540D\u3001Listing \u4E0E DNS \u72B6\u6001\uFF0C\u5EFA\u7ACB\u672C\u5730\u57FA\u7EBF Revision\u3002")), !imported ? /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "18px",
      border: "1px solid var(--gd-line)",
      borderRadius: 9,
      background: "var(--gd-panel)",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, importing || pct > 0 ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(OProg, {
    segments: [{
      value: pct,
      tone: "sync"
    }],
    height: 8
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, pct, "% \xB7 \u6B63\u5728\u62C9\u53D6\u57DF\u540D\u4E0E Listing\u2026")) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(I.RefreshCw, {
    size: 16,
    style: {
      color: "var(--gd-text-muted)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--gd-text-muted)"
    }
  }, "\u51C6\u5907\u5BFC\u5165 \xB7 \u9884\u8BA1 823 \u57DF\u540D"), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(OBtn, {
    variant: "primary",
    onClick: runImport
  }, "\u5F00\u59CB\u5BFC\u5165"))) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 10
    }
  }, [["域名", "823", null], ["Listing", "692", null], ["冲突", "6", "danger"], ["基线", "rev 1", "gold"]].map(k => /*#__PURE__*/React.createElement("div", {
    key: k[0],
    style: {
      padding: "14px",
      border: "1px solid var(--gd-line)",
      borderRadius: 8,
      background: "var(--gd-panel)",
      display: "flex",
      flexDirection: "column",
      gap: 5
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-t-label"
  }, k[0]), /*#__PURE__*/React.createElement("span", {
    className: "gd-t-metric-sm",
    style: {
      color: k[2] === "danger" ? "var(--gd-danger)" : k[2] === "gold" ? "var(--gd-gold)" : "var(--text-1)",
      fontFamily: k[0] === "基线" ? "var(--font-mono)" : undefined
    }
  }, k[1])))), imported && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u5BFC\u5165\u5B8C\u6210 \xB7 6 \u9879\u5B57\u6BB5\u51B2\u7A81\u5DF2\u6807\u8BB0\uFF0C\u53EF\u5728\u51B2\u7A81\u4E2D\u5FC3\u4EBA\u5DE5\u88C1\u51B3\u3002")), foot(() => setIdx(2), () => setIdx(4), "继续", !imported)),
  /*#__PURE__*/
  // 4 done
  React.createElement("div", {
    key: "f",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14,
      margin: "auto 0",
      textAlign: "center"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 60,
      height: 60,
      borderRadius: "50%",
      background: "rgba(92,174,125,0.14)",
      border: "1px solid var(--gd-success)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(I.Check, {
    size: 30,
    style: {
      color: "var(--gd-success)"
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 19,
      fontWeight: 600,
      color: "var(--text-1)"
    }
  }, "\u63A5\u5165\u5B8C\u6210"), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--gd-text-muted)",
      marginTop: 6
    }
  }, dev, " \u5DF2\u6FC0\u6D3B\u4E3A\u6267\u884C\u8BBE\u5907 \xB7 823 \u57DF\u540D\u5DF2\u5BFC\u5165 \xB7 \u57FA\u7EBF rev 1")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      alignItems: "center",
      fontSize: 12,
      color: "var(--gd-text-faint)"
    }
  }, /*#__PURE__*/React.createElement(ODot, {
    kind: "active"
  }), "Active \xB7 Epoch 1", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-line-strong)"
    }
  }, "\xB7"), /*#__PURE__*/React.createElement(ODot, {
    kind: "sync"
  }), "\u4E91\u7AEF\u540C\u6B65\u5C31\u7EEA")), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      display: "flex",
      paddingTop: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(OBtn, {
    variant: "primary",
    onClick: () => onFinish ? onFinish() : setIdx(0)
  }, "\u8FDB\u5165 GoodDealer")))];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      width: "100%",
      height: "100%",
      display: "flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 860,
      height: 560,
      maxWidth: "100%",
      maxHeight: "100%",
      display: "flex",
      background: "var(--surface-app)",
      border: "1px solid var(--gd-line-strong)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-overlay)",
      overflow: "hidden"
    }
  }, /*#__PURE__*/React.createElement(Stepper, {
    idx: idx
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      padding: "22px 26px",
      display: "flex",
      flexDirection: "column"
    }
  }, panes[idx])));
}
window.GDOnboarding = Onboarding;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/Onboarding.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/RenewDesk.jsx
try { (() => {
// 续费 / Renewal — batch renew expiring domains against a budget. Registrar operation.
// Launched from the 资产库「到期」KPI. Per-domain term, budget guard, enqueues to Outbox.
const {
  Table: RTable,
  Badge: RBadge,
  Button: RBtn,
  Select: RSel,
  Money: RMoney,
  Switch: RSwitch,
  Toolbar: RToolbar,
  Dialog: RDlg,
  BatchBar: RBatch
} = window.GoodDealerDesignSystem_b5b0b6;
const TLD = {
  io: 32,
  com: 11,
  ai: 75,
  dev: 14,
  money: 33,
  trade: 28,
  systems: 30,
  capital: 30,
  finance: 35,
  exchange: 42,
  co: 28,
  net: 13
};
const priceOf = d => {
  const t = d.split(".").pop();
  return TLD[t] || 20;
};
const BUDGET = 312;
const TODAY = new Date("2026-08-03");
const daysTo = s => Math.round((new Date(s) - TODAY) / 86400000);
const rmoney = n => Number(n).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
function rseed() {
  const r = (id, domain, registrar, expiry, auto) => ({
    id,
    domain,
    registrar,
    expiry,
    auto
  });
  return [r(1, "vault.io", "Spaceship", "2026-08-10", false), r(2, "arc.exchange", "Spaceship", "2026-08-14", false), r(3, "kanban.ai", "Namecheap", "2026-08-19", false), r(4, "quanta.trade", "Dynadot", "2026-08-25", true), r(5, "helio.systems", "Dynadot", "2026-09-01", false), r(6, "crest.capital", "Spaceship", "2026-09-05", false), r(7, "mint.money", "Spaceship", "2026-09-12", true), r(8, "north.capital", "Spaceship", "2026-09-18", false), r(9, "forge.dev", "Namecheap", "2026-09-22", false), r(10, "spark.trade", "Dynadot", "2026-09-28", false), r(11, "oxide.dev", "Namecheap", "2026-09-30", true), r(12, "goldrail.com", "Spaceship", "2026-10-01", false)];
}
function RenewDesk({
  onBack,
  addUnsynced
}) {
  const I = window.GDI;
  const [rows, setRows] = React.useState(rseed);
  const [sel, setSel] = React.useState([]);
  const [term, setTerm] = React.useState({});
  const [uniform, setUniform] = React.useState("1");
  const [confirm, setConfirm] = React.useState(false);
  const yearsOf = id => +(term[id] || uniform);
  const active = rows.filter(r => !r.renewed);
  const selRows = active.filter(r => sel.includes(r.id));
  const lineCost = r => priceOf(r.domain) * yearsOf(r.id);
  const selTotal = selRows.reduce((s, r) => s + lineCost(r), 0);
  const autoCovered = active.filter(r => r.auto).length;
  const over = selTotal > BUDGET;
  const setAuto = (id, v) => setRows(rs => rs.map(x => x.id === id ? {
    ...x,
    auto: v
  } : x));
  const doRenew = () => {
    const ids = [...sel];
    setConfirm(false);
    setRows(rs => rs.map(x => ids.includes(x.id) ? {
      ...x,
      renewed: true
    } : x));
    setSel([]);
    addUnsynced && addUnsynced(ids.length);
  };
  const applyUniform = () => {
    setTerm(t => {
      const n = {
        ...t
      };
      sel.forEach(id => n[id] = uniform);
      return n;
    });
  };
  const expColor = d => {
    const dd = daysTo(d);
    return dd < 14 ? "var(--gd-danger)" : dd < 30 ? "var(--gd-warning)" : "var(--text-1)";
  };
  const kpis = [["到期域名", String(active.length), null], ["续费预算", "$" + rmoney(BUDGET), "gold"], ["已选续费额", "$" + rmoney(selTotal), over ? "danger" : "gold"], ["预算余量", "$" + rmoney(BUDGET - selTotal), over ? "danger" : null], ["自动续费覆盖", `${autoCovered} / ${active.length}`, "blue"]];
  const kcolor = t => t === "gold" ? "var(--gd-gold)" : t === "danger" ? "var(--gd-danger)" : t === "blue" ? "var(--gd-blue)" : "var(--text-1)";
  const MetricStrip = window.GDMetricStrip;
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u7EED\u8D39",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MetricStrip, {
    metrics: kpis.map(k => ({
      label: k[0],
      value: k[1],
      tone: k[2]
    }))
  }), /*#__PURE__*/React.createElement(RToolbar, {
    region: true,
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(RBtn, {
      size: "sm",
      variant: "ghost",
      icon: /*#__PURE__*/React.createElement(I.ChevronLeft, {
        size: 15
      }),
      onClick: onBack
    }, "\u8D44\u4EA7\u5E93"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--gd-text-muted)",
        whiteSpace: "nowrap"
      }
    }, "60 \u5929\u5185\u5230\u671F \xB7 \u6309\u5230\u671F\u5347\u5E8F \xB7 \u7EED\u8D39\u4E3A\u6CE8\u518C\u5546\u64CD\u4F5C")),
    right: /*#__PURE__*/React.createElement(RBtn, {
      size: "sm",
      variant: "primary",
      disabled: sel.length === 0,
      onClick: () => setConfirm(true)
    }, "\u7EED\u8D39\u6240\u9009", sel.length ? ` · ${sel.length}` : "")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      position: "relative",
      display: "flex"
    }
  }, /*#__PURE__*/React.createElement(RTable, {
    density: "regular",
    selectable: true,
    selected: sel,
    onSelectionChange: setSel,
    rowKey: "id",
    maxHeight: "100%",
    style: {
      flex: 1,
      minHeight: 0,
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "domain",
      label: "域名",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: r.renewed ? "var(--gd-text-faint)" : "var(--text-1)"
        }
      }, r.domain)
    }, {
      key: "expiry",
      label: "到期",
      numeric: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: r.renewed ? "var(--gd-text-faint)" : expColor(r.expiry)
        }
      }, r.expiry),
      width: 108
    }, {
      key: "days",
      label: "剩余",
      numeric: true,
      width: 64,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--gd-text-muted)"
        }
      }, daysTo(r.expiry), "d")
    }, {
      key: "registrar",
      label: "注册商",
      muted: true,
      width: 104
    }, {
      key: "auto",
      label: "自动续费",
      width: 88,
      render: r => r.renewed ? /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-text-faint)",
          fontSize: 12
        }
      }, "\u2014") : /*#__PURE__*/React.createElement(RSwitch, {
        checked: r.auto,
        onChange: () => setAuto(r.id, !r.auto)
      })
    }, {
      key: "term",
      label: "续费年限",
      width: 112,
      render: r => r.renewed ? /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-text-faint)",
          fontSize: 12
        }
      }, "\u2014") : /*#__PURE__*/React.createElement(RSel, {
        size: "sm",
        options: ["1", "2", "3"],
        value: String(yearsOf(r.id)),
        onChange: e => setTerm(t => ({
          ...t,
          [r.id]: e.target.value
        }))
      })
    }, {
      key: "price",
      label: "单价/年",
      numeric: true,
      width: 90,
      render: r => /*#__PURE__*/React.createElement(RMoney, {
        amount: priceOf(r.domain),
        tone: "body"
      })
    }, {
      key: "subtotal",
      label: "小计",
      numeric: true,
      width: 104,
      render: r => r.renewed ? /*#__PURE__*/React.createElement(RBadge, {
        tone: "success",
        mono: false
      }, "\u5DF2\u7EED\u8D39") : /*#__PURE__*/React.createElement(RMoney, {
        amount: lineCost(r)
      })
    }],
    rows: rows
  }), sel.length > 0 && /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      bottom: 14,
      left: 0,
      right: 0,
      display: "flex",
      justifyContent: "center",
      pointerEvents: "none",
      zIndex: 5
    }
  }, /*#__PURE__*/React.createElement(RBatch, {
    count: sel.length,
    onClear: () => setSel([]),
    style: {
      pointerEvents: "auto"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 6,
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u7EDF\u4E00\u5E74\u9650", /*#__PURE__*/React.createElement(RSel, {
    size: "sm",
    options: ["1", "2", "3"],
    value: uniform,
    onChange: e => setUniform(e.target.value)
  })), /*#__PURE__*/React.createElement(RBtn, {
    size: "sm",
    onClick: applyUniform
  }, "\u5E94\u7528\u5230\u6240\u9009"), /*#__PURE__*/React.createElement("span", {
    className: "gd-batchbar-sep"
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      whiteSpace: "nowrap"
    }
  }, "\u5408\u8BA1 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)",
      color: over ? "var(--gd-danger)" : "var(--gd-gold)"
    }
  }, "$", rmoney(selTotal))), /*#__PURE__*/React.createElement(RBtn, {
    size: "sm",
    variant: "primary",
    onClick: () => setConfirm(true)
  }, "\u7EED\u8D39")))), /*#__PURE__*/React.createElement(RDlg, {
    open: confirm,
    onClose: () => setConfirm(false),
    title: `续费 · ${sel.length} 个域名`,
    width: 470,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(RBtn, {
      onClick: () => setConfirm(false)
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(RBtn, {
      variant: "primary",
      onClick: doRenew
    }, "\u786E\u8BA4\u7EED\u8D39 \xB7 $", rmoney(selTotal)))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u5411\u5404\u6CE8\u518C\u5546\u63D0\u4EA4 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, sel.length), " \u4E2A\u57DF\u540D\u7684\u7EED\u8D39\uFF0C\u6309\u6240\u9009\u5E74\u9650\u6263\u8D39\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-line-strong)",
      borderRadius: 7,
      background: "var(--gd-panel)",
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 7,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-muted)"
    }
  }, "\u7EED\u8D39\u603B\u989D"), /*#__PURE__*/React.createElement(RMoney, {
    amount: selTotal,
    size: 15
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-muted)"
    }
  }, "\u7EED\u8D39\u9884\u7B97"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-muted)"
    }
  }, "$", rmoney(BUDGET))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      borderTop: "1px solid var(--gd-line)",
      paddingTop: 7
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u9884\u7B97\u4F59\u91CF"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: over ? "var(--gd-danger)" : "var(--gd-success)"
    }
  }, over ? "−" : "", "$", rmoney(Math.abs(BUDGET - selTotal))))), over && /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-warning)",
      background: "var(--gd-warning-tint)",
      borderRadius: 7,
      padding: "9px 12px",
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--gd-text)"
    }
  }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
    size: 14,
    style: {
      color: "var(--gd-warning)",
      flex: "none"
    }
  }), "\u8D85\u51FA\u7EED\u8D39\u9884\u7B97 $", rmoney(selTotal - BUDGET), "\uFF0C\u4ECD\u53EF\u7EE7\u7EED\u3002"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u7EED\u8D39\u4E3A\u53EF\u5B89\u5168\u91CD\u8BD5\u64CD\u4F5C\uFF0C\u5C06\u8FDB\u5165\u540C\u6B65\u4E2D\u5FC3 Outbox \u63D0\u4EA4\u81F3\u6CE8\u518C\u5546\u3002"))));
}
window.GDRenewDesk = RenewDesk;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/RenewDesk.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/SalesDesk.jsx
try { (() => {
// 销售管理 / Sales Desk — the revenue surface: Listings · Offers(议价) · Deals(成交与交割).
// Money moments: 接受报价 = binding commitment (precise offer/fee/net + ack); 推送转移 = registrar handoff to buyer.
// Gold is reserved for value results (成交额 / 净收入 / 挂牌估值 / SOLD) — never process amounts.
const {
  Tabs: LTabs,
  Table: LTable,
  Badge: LBadge,
  Money: LMoney,
  Button: LBtn,
  Input: LInput,
  Dialog: LDlg,
  Checkbox: LCheck,
  ProgressBar: LProg,
  Tag: LTag,
  Toolbar: LToolbar
} = window.GoodDealerDesignSystem_b5b0b6;
const FEE = {
  Atom: 0.10,
  Afternic: 0.15,
  SellerHub: 0.12
};
const lnum = v => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
const money = n => Number(n).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
function lseed() {
  return {
    listings: [{
      id: 1,
      domain: "vault.io",
      platforms: "Atom · Afternic",
      bin: 280000,
      views: 1240,
      offers: 3,
      status: "active",
      listed: "06-02"
    }, {
      id: 2,
      domain: "kanban.ai",
      platforms: "Atom",
      bin: 99999,
      views: 860,
      offers: 1,
      status: "active",
      listed: "07-14"
    }, {
      id: 3,
      domain: "quanta.trade",
      platforms: "Atom · SellerHub",
      bin: 42000,
      views: 410,
      offers: 1,
      status: "active",
      listed: "05-20"
    }, {
      id: 4,
      domain: "helio.systems",
      platforms: "Afternic",
      bin: 18500,
      views: 96,
      offers: 0,
      status: "paused",
      listed: "04-11"
    }, {
      id: 5,
      domain: "mint.money",
      platforms: "Atom",
      bin: 65000,
      views: 520,
      offers: 0,
      status: "active",
      listed: "07-28"
    }, {
      id: 6,
      domain: "forge.dev",
      platforms: "—",
      bin: 12000,
      views: 0,
      offers: 0,
      status: "draft",
      listed: "—"
    }],
    offers: [{
      id: "f1",
      domain: "vault.io",
      buyer: "buyer·7Q2",
      offer: 212000,
      bin: 280000,
      platform: "Atom",
      state: "pending",
      age: "2 小时前"
    }, {
      id: "f2",
      domain: "kanban.ai",
      buyer: "buyer·A19",
      offer: 88000,
      bin: 99999,
      platform: "Atom",
      state: "pending",
      age: "今日 09:40"
    }, {
      id: "f3",
      domain: "quanta.trade",
      buyer: "buyer·M53",
      offer: 31000,
      bin: 42000,
      platform: "SellerHub",
      state: "countered",
      age: "昨日",
      ask: 37000
    }, {
      id: "f4",
      domain: "vault.io",
      buyer: "buyer·K08",
      offer: 150000,
      bin: 280000,
      platform: "Afternic",
      state: "declined",
      age: "07-30"
    }, {
      id: "f5",
      domain: "mint.money",
      buyer: "buyer·33F",
      offer: 64000,
      bin: 65000,
      platform: "Atom",
      state: "pending",
      age: "30 分钟前"
    }],
    deals: [{
      id: "d1",
      domain: "oxide.dev",
      amount: 52000,
      platform: "Atom",
      buyer: "buyer·55A",
      stage: "transfer_pending"
    }, {
      id: "d2",
      domain: "arc.exchange",
      amount: 33000,
      platform: "Afternic",
      buyer: "buyer·9C1",
      stage: "escrow"
    }, {
      id: "d3",
      domain: "north.capital",
      amount: 21500,
      platform: "Atom",
      buyer: "buyer·B7X",
      stage: "transferred"
    }, {
      id: "d4",
      domain: "legacy.io",
      amount: 14200,
      platform: "Atom",
      buyer: "buyer·2D0",
      stage: "paid"
    }]
  };
}
const OFFER_STATE = {
  pending: {
    tone: "warning",
    label: "待回应"
  },
  countered: {
    tone: "sync",
    label: "已还价"
  },
  accepted: {
    tone: "gold",
    label: "已接受"
  },
  declined: {
    tone: null,
    label: "已拒绝"
  },
  expired: {
    tone: null,
    label: "已过期"
  }
};
const STAGE = [["escrow", "托管中", 0.25, "warning"], ["transfer_pending", "待推送转移", 0.5, "sync"], ["transferred", "已过户·待放款", 0.75, "sync"], ["paid", "已放款·完成", 1, "success"]];
const stageOf = k => STAGE.find(s => s[0] === k);
function SalesDesk({
  addUnsynced
}) {
  const I = window.GDI;
  const [d, setD] = React.useState(lseed);
  const [tab, setTab] = React.useState("offers");
  const [accept, setAccept] = React.useState(null);
  const [ackA, setAckA] = React.useState(false);
  const [counter, setCounter] = React.useState(null);
  const [cVal, setCVal] = React.useState("");
  const [xfer, setXfer] = React.useState(null);
  const [ackX, setAckX] = React.useState(false);
  const pendingOffers = d.offers.filter(o => o.state === "pending").length;
  const listedValue = d.listings.filter(l => l.status === "active").reduce((s, l) => s + l.bin, 0);
  const monthGmv = d.deals.reduce((s, x) => s + x.amount, 0);
  const settling = d.deals.filter(x => x.stage !== "paid").length;
  const kpis = [["在售 Listing", String(d.listings.filter(l => l.status === "active").length), null], ["挂牌估值", "$" + money(listedValue), "gold"], ["待处理报价", String(pendingOffers), "warning"], ["成交额（本月）", "$" + money(monthGmv), "gold"], ["交割中", String(settling), "blue"]];
  const kcolor = t => t === "gold" ? "var(--gd-gold)" : t === "warning" ? "var(--gd-warning)" : t === "blue" ? "var(--gd-blue)" : "var(--text-1)";
  const feeOf = o => FEE[o.platform] ?? 0.12;
  const netOf = o => Math.round(o.offer * (1 - feeOf(o)));
  const doAccept = () => {
    const o = accept;
    setAccept(null);
    setAckA(false);
    setD(s => ({
      ...s,
      offers: s.offers.map(x => x.id === o.id ? {
        ...x,
        state: "accepted"
      } : x),
      deals: [{
        id: "d" + Date.now(),
        domain: o.domain,
        amount: o.offer,
        platform: o.platform,
        buyer: o.buyer,
        stage: "escrow"
      }, ...s.deals]
    }));
    setTab("deals");
  };
  const doCounter = () => {
    const o = counter;
    const v = lnum(cVal);
    setCounter(null);
    setCVal("");
    if (!v) return;
    setD(s => ({
      ...s,
      offers: s.offers.map(x => x.id === o.id ? {
        ...x,
        state: "countered",
        ask: v
      } : x)
    }));
  };
  const decline = o => setD(s => ({
    ...s,
    offers: s.offers.map(x => x.id === o.id ? {
      ...x,
      state: "declined"
    } : x)
  }));
  const doXfer = () => {
    const x = xfer;
    setXfer(null);
    setAckX(false);
    setD(s => ({
      ...s,
      deals: s.deals.map(y => y.id === x.id ? {
        ...y,
        stage: "transferred"
      } : y)
    }));
    addUnsynced && addUnsynced(1);
  };
  const listingsTab = /*#__PURE__*/React.createElement(LTable, {
    density: "regular",
    rowKey: "id",
    maxHeight: "100%",
    style: {
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "domain",
      label: "域名",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-1)"
        }
      }, r.domain)
    }, {
      key: "platforms",
      label: "平台",
      muted: true
    }, {
      key: "bin",
      label: "BIN",
      numeric: true,
      render: r => /*#__PURE__*/React.createElement(LMoney, {
        amount: r.bin
      })
    }, {
      key: "views",
      label: "浏览",
      numeric: true,
      muted: true,
      width: 72,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)"
        }
      }, r.views.toLocaleString())
    }, {
      key: "offers",
      label: "询价",
      numeric: true,
      width: 64,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          color: r.offers ? "var(--gd-blue)" : "var(--gd-text-faint)"
        }
      }, r.offers)
    }, {
      key: "status",
      label: "状态",
      width: 88,
      render: r => /*#__PURE__*/React.createElement(LBadge, {
        tone: r.status === "active" ? "success" : r.status === "paused" ? "warning" : undefined,
        mono: false
      }, r.status === "active" ? "在售" : r.status === "paused" ? "暂停" : "草稿")
    }, {
      key: "listed",
      label: "上架",
      numeric: true,
      muted: true,
      width: 80
    }, {
      key: "act",
      label: "",
      width: 150,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "flex",
          gap: 6,
          justifyContent: "flex-end"
        }
      }, r.status === "draft" ? /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "primary"
      }, "\u4E0A\u67B6") : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "ghost"
      }, "\u6539\u4EF7"), /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "ghost"
      }, r.status === "paused" ? "恢复" : "暂停")))
    }],
    rows: d.listings
  });
  const offersTab = /*#__PURE__*/React.createElement(LTable, {
    density: "regular",
    rowKey: "id",
    maxHeight: "100%",
    style: {
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "domain",
      label: "域名",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-1)"
        }
      }, r.domain)
    }, {
      key: "buyer",
      label: "买家",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--gd-text-muted)"
        }
      }, r.buyer),
      width: 104
    }, {
      key: "offer",
      label: "报价",
      numeric: true,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          display: "inline-flex",
          flexDirection: "column",
          alignItems: "flex-end"
        }
      }, /*#__PURE__*/React.createElement(LMoney, {
        amount: r.offer,
        tone: "body"
      }), /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 10,
          color: "var(--gd-text-faint)",
          fontFamily: "var(--font-mono)"
        }
      }, "BIN ", money(r.bin), " \xB7 ", Math.round((r.offer / r.bin - 1) * 100), "%"))
    }, {
      key: "ask",
      label: "我方还价",
      numeric: true,
      width: 104,
      render: r => r.ask ? /*#__PURE__*/React.createElement(LMoney, {
        amount: r.ask,
        tone: "body"
      }) : /*#__PURE__*/React.createElement("span", {
        style: {
          color: "var(--gd-text-faint)"
        }
      }, "\u2014")
    }, {
      key: "platform",
      label: "平台",
      muted: true,
      width: 88
    }, {
      key: "state",
      label: "状态",
      width: 88,
      render: r => /*#__PURE__*/React.createElement(LBadge, {
        tone: OFFER_STATE[r.state].tone,
        mono: false
      }, OFFER_STATE[r.state].label)
    }, {
      key: "age",
      label: "时间",
      numeric: true,
      muted: true,
      width: 92
    }, {
      key: "act",
      label: "",
      width: 184,
      render: r => ["pending", "countered"].includes(r.state) ? /*#__PURE__*/React.createElement("span", {
        style: {
          display: "flex",
          gap: 6,
          justifyContent: "flex-end"
        }
      }, /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "primary",
        onClick: () => {
          setAccept(r);
          setAckA(false);
        }
      }, "\u63A5\u53D7"), /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        onClick: () => {
          setCounter(r);
          setCVal(String(r.ask || Math.round((r.offer + r.bin) / 2)));
        }
      }, "\u8FD8\u4EF7"), /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "ghost",
        onClick: () => decline(r)
      }, "\u62D2\u7EDD")) : /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, r.state === "accepted" ? "已转成交" : "—")
    }],
    rows: d.offers
  });
  const dealsTab = /*#__PURE__*/React.createElement(LTable, {
    density: "regular",
    rowKey: "id",
    maxHeight: "100%",
    style: {
      border: "none",
      borderRadius: 0
    },
    columns: [{
      key: "domain",
      label: "域名",
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12,
          color: "var(--text-1)"
        }
      }, r.domain)
    }, {
      key: "amount",
      label: "成交额",
      numeric: true,
      render: r => /*#__PURE__*/React.createElement(LMoney, {
        amount: r.amount
      })
    }, {
      key: "net",
      label: "净收入",
      numeric: true,
      width: 120,
      render: r => /*#__PURE__*/React.createElement(LMoney, {
        amount: Math.round(r.amount * (1 - (FEE[r.platform] ?? 0.12)))
      })
    }, {
      key: "platform",
      label: "平台",
      muted: true,
      width: 84
    }, {
      key: "buyer",
      label: "买家",
      muted: true,
      width: 96,
      render: r => /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 12
        }
      }, r.buyer)
    }, {
      key: "stage",
      label: "交割进度",
      width: 190,
      render: r => {
        const st = stageOf(r.stage);
        return /*#__PURE__*/React.createElement("div", {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 4
          }
        }, /*#__PURE__*/React.createElement(LBadge, {
          tone: r.stage === "paid" ? "gold" : st[3],
          mono: false
        }, st[1]), /*#__PURE__*/React.createElement(LProg, {
          segments: [{
            value: st[2] * 100,
            tone: st[3]
          }],
          height: 4
        }));
      }
    }, {
      key: "act",
      label: "",
      width: 132,
      render: r => r.stage === "transfer_pending" ? /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "primary",
        onClick: () => {
          setXfer(r);
          setAckX(false);
        },
        icon: /*#__PURE__*/React.createElement(I.ExternalLink, {
          size: 13
        })
      }, "\u63A8\u9001\u8F6C\u79FB") : r.stage === "escrow" ? /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, "\u5F85\u4E70\u5BB6\u4ED8\u6B3E") : r.stage === "transferred" ? /*#__PURE__*/React.createElement(LBtn, {
        size: "sm",
        variant: "ghost"
      }, "\u786E\u8BA4\u653E\u6B3E") : /*#__PURE__*/React.createElement(LBadge, {
        tone: "gold"
      }, "SOLD")
    }],
    rows: d.deals
  });
  const MetricStrip = window.GDMetricStrip;
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u9500\u552E\u7BA1\u7406",
    style: {
      display: "flex",
      flexDirection: "column",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(MetricStrip, {
    metrics: kpis.map(k => ({
      label: k[0],
      value: k[1],
      tone: k[2]
    }))
  }), /*#__PURE__*/React.createElement(LToolbar, {
    region: true,
    left: /*#__PURE__*/React.createElement(LTabs, {
      active: tab,
      onChange: setTab,
      items: [{
        key: "listings",
        label: "在售 Listing",
        count: d.listings.filter(l => l.status === "active").length
      }, {
        key: "offers",
        label: "报价 · 议价",
        count: pendingOffers
      }, {
        key: "deals",
        label: "成交与交割",
        count: settling
      }],
      style: {
        border: "none"
      }
    }),
    right: /*#__PURE__*/React.createElement(LBtn, {
      size: "sm",
      variant: "primary",
      icon: /*#__PURE__*/React.createElement(I.Upload, {
        size: 14
      })
    }, "\u65B0\u5EFA Listing")
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0
    }
  }, tab === "listings" ? listingsTab : tab === "offers" ? offersTab : dealsTab), /*#__PURE__*/React.createElement(LDlg, {
    open: !!accept,
    onClose: () => {
      setAccept(null);
      setAckA(false);
    },
    title: "\u63A5\u53D7\u62A5\u4EF7 \xB7 \u751F\u6210\u6258\u7BA1\u4EA4\u6613",
    width: 464,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LBtn, {
      onClick: () => {
        setAccept(null);
        setAckA(false);
      }
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(LBtn, {
      variant: "primary",
      disabled: !ackA,
      onClick: doAccept
    }, "\u63A5\u53D7 \xB7 \u51C0 $", accept && money(netOf(accept))))
  }, accept && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u63A5\u53D7 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, accept.buyer), " \u5BF9 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, accept.domain), " \u7684\u62A5\u4EF7\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-line-strong)",
      borderRadius: 7,
      background: "var(--gd-panel)",
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 7,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-muted)"
    }
  }, "\u62A5\u4EF7"), /*#__PURE__*/React.createElement(LMoney, {
    amount: accept.offer
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-muted)"
    }
  }, accept.platform, " \u5E73\u53F0\u8D39 ", Math.round(feeOf(accept) * 100), "%"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-danger)"
    }
  }, "\u2212$", money(Math.round(accept.offer * feeOf(accept))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      borderTop: "1px solid var(--gd-line)",
      paddingTop: 7
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u9884\u8BA1\u51C0\u6536\u5165"), /*#__PURE__*/React.createElement(LMoney, {
    amount: netOf(accept),
    size: 15
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid var(--gd-line)",
      paddingTop: 10
    }
  }, /*#__PURE__*/React.createElement(LCheck, {
    checked: ackA,
    onChange: () => setAckA(a => !a),
    label: "\u6211\u786E\u8BA4\u63A5\u53D7\u6B64\u62A5\u4EF7\uFF1B\u63A5\u53D7\u5373\u751F\u6210\u6258\u7BA1\u4EA4\u6613\uFF0C\u5177\u7EA6\u675F\u529B"
  })))), /*#__PURE__*/React.createElement(LDlg, {
    open: !!counter,
    onClose: () => {
      setCounter(null);
      setCVal("");
    },
    title: "\u8FD8\u4EF7 \xB7 Counter",
    width: 420,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LBtn, {
      onClick: () => {
        setCounter(null);
        setCVal("");
      }
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(LBtn, {
      variant: "primary",
      onClick: doCounter
    }, "\u53D1\u9001\u8FD8\u4EF7"))
  }, counter && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, counter.domain), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u4E70\u5BB6 $", money(counter.offer), " \xB7 BIN $", money(counter.bin))), /*#__PURE__*/React.createElement(LInput, {
    label: "\u6211\u65B9\u8FD8\u4EF7",
    size: "md",
    mono: true,
    prefix: "$",
    value: cVal,
    onChange: e => setCVal(e.target.value),
    style: {
      width: 200
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u8FD8\u4EF7\u901A\u8FC7\u5E73\u53F0\u53D1\u9001\u7ED9\u4E70\u5BB6\uFF0C\u7B49\u5F85\u5176\u56DE\u5E94\uFF1B\u4E0D\u6539\u53D8 Listing BIN\u3002"))), /*#__PURE__*/React.createElement(LDlg, {
    open: !!xfer,
    onClose: () => {
      setXfer(null);
      setAckX(false);
    },
    title: "\u63A8\u9001\u57DF\u540D\u8F6C\u79FB \xB7 \u4EA4\u5272",
    width: 484,
    danger: true,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(LBtn, {
      onClick: () => {
        setXfer(null);
        setAckX(false);
      }
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(LBtn, {
      variant: "danger",
      disabled: !ackX,
      onClick: doXfer
    }, "\u63A8\u9001\u8F6C\u79FB\u5230\u4E70\u5BB6"))
  }, xfer && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u5C06 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, xfer.domain), " \u8F6C\u79FB\u81F3\u4E70\u5BB6 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, xfer.buyer), "\uFF08\u6210\u4EA4\u989D $", money(xfer.amount), "\uFF09\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-danger)",
      background: "var(--gd-danger-tint)",
      borderRadius: 7,
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
    size: 15,
    style: {
      color: "var(--gd-danger)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-danger)",
      fontSize: 13
    }
  }, "\u4E0D\u53EF\u9006 \xB7 \u6240\u6709\u6743\u8F6C\u79FB"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--gd-text-muted)"
    }
  }, "\u7531\u6CE8\u518C\u5546\u6267\u884C")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text)",
      lineHeight: 1.5
    }
  }, "\u63A8\u9001\u540E\u5728\u6CE8\u518C\u5546\u53D1\u8D77\u8F6C\u79FB\u6388\u6743\u7801\uFF0C\u6240\u6709\u6743\u79FB\u4EA4\u4E70\u5BB6\uFF0C\u4E0D\u53EF\u64A4\u9500\u3002\u8BF7\u786E\u8BA4\u5DF2\u6536\u5230\u6258\u7BA1\u653E\u6B3E\u6761\u4EF6\u6EE1\u8DB3\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid rgba(229,115,95,0.24)",
      paddingTop: 9
    }
  }, /*#__PURE__*/React.createElement(LCheck, {
    checked: ackX,
    onChange: () => setAckX(a => !a),
    label: "\u6211\u786E\u8BA4\u6258\u7BA1\u6761\u4EF6\u6EE1\u8DB3\uFF0C\u63A8\u9001\u4E0D\u53EF\u9006\u7684\u6240\u6709\u6743\u8F6C\u79FB"
  }))))));
}
window.GDSalesDesk = SalesDesk;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/SalesDesk.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/SettingsPanel.jsx
try { (() => {
// 设置 / Settings — connections, device lease (门禁), license, sync, about.
// Centerpiece: 设备与运行态 — Active(金) / Standby(蓝空心) / 激活中 / 排空中 / Sunset·LocalContinuation(保留态),
// the hardware-wallet lease system (Trezor device-status lesson). Handoff runs a confirmation ceremony.
const {
  Panel: PPanel,
  Switch: PSwitch,
  Button: PBtn,
  Badge: PBadge,
  StatusDot: PDot,
  Select: PSel,
  Tag: PTag,
  Dialog: PDlg,
  Checkbox: PCheck
} = window.GoodDealerDesignSystem_b5b0b6;
const SECTIONS = [["conn", "连接"], ["device", "设备与运行态"], ["license", "许可"], ["sync", "同步偏好"], ["about", "关于"]];
const KV = ({
  k,
  children,
  muted
}) => /*#__PURE__*/React.createElement("div", {
  style: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "9px 0",
    borderBottom: "1px solid var(--gd-line)",
    fontSize: 13
  }
}, /*#__PURE__*/React.createElement("span", {
  style: {
    width: 120,
    flex: "none",
    color: "var(--gd-text-faint)",
    fontSize: 12
  }
}, k), /*#__PURE__*/React.createElement("span", {
  style: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
    gap: 8,
    textAlign: "right",
    color: muted ? "var(--gd-text-muted)" : undefined
  }
}, children));
function ConnRow({
  name,
  kind,
  meta,
  method,
  last,
  onFix
}) {
  const dot = {
    ok: "success",
    warn: "warning",
    off: "neutral"
  }[kind];
  const label = {
    ok: "已连接",
    warn: "需重新授权",
    off: "未连接"
  }[kind];
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      padding: "11px 14px",
      borderBottom: "1px solid var(--gd-line)"
    }
  }, /*#__PURE__*/React.createElement(PDot, {
    kind: dot
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 126,
      fontSize: 13,
      color: "var(--text-1)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, name), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 88,
      flex: "none"
    }
  }, /*#__PURE__*/React.createElement(PBadge, {
    tone: kind === "ok" ? "success" : kind === "warn" ? "warning" : undefined,
    mono: false
  }, label)), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      color: "var(--gd-text-muted)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, meta), method && /*#__PURE__*/React.createElement(PTag, null, method), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 104,
      flex: "none",
      textAlign: "right",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--gd-text-faint)",
      whiteSpace: "nowrap"
    }
  }, last), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 92,
      flex: "none",
      display: "flex",
      justifyContent: "flex-end"
    }
  }, kind === "off" ? /*#__PURE__*/React.createElement(PBtn, {
    size: "sm",
    variant: "primary"
  }, "\u8FDE\u63A5") : kind === "warn" ? /*#__PURE__*/React.createElement(PBtn, {
    size: "sm"
  }, "\u91CD\u65B0\u6388\u6743") : /*#__PURE__*/React.createElement(PBtn, {
    size: "sm",
    variant: "ghost"
  }, "\u7BA1\u7406")));
}
function DeviceRow({
  d,
  onHandoff
}) {
  const map = {
    active: {
      dot: "active",
      badge: /*#__PURE__*/React.createElement(PBadge, {
        tone: "gold"
      }, "ACTIVE"),
      meta: "持有 ActiveDeviceLease · 执行权在此设备"
    },
    standby: {
      dot: "standby",
      badge: /*#__PURE__*/React.createElement(PBadge, {
        mono: false
      }, "Standby"),
      meta: "待命 · 可申请移交执行权"
    },
    activating: {
      dot: "sync",
      badge: /*#__PURE__*/React.createElement(PBadge, {
        tone: "sync",
        mono: false
      }, "\u6B63\u5728\u5B89\u5168\u6FC0\u6D3B"),
      meta: "校验中 · 等待服务端签发新 Lease"
    },
    draining: {
      dot: "warning",
      badge: /*#__PURE__*/React.createElement(PBadge, {
        tone: "warning",
        mono: false
      }, "\u6392\u7A7A\u4E2D"),
      meta: "提交未同步项后释放执行权"
    },
    sunset: {
      dot: "neutral",
      badge: /*#__PURE__*/React.createElement(PTag, null, "RETAINED"),
      meta: "Sunset · LocalContinuation 本地只读延续 · 无执行权"
    }
  }[d.state];
  const dim = d.state === "sunset";
  const busy = d.state === "activating" || d.state === "draining";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 13,
      padding: "13px 14px",
      borderBottom: "1px solid var(--gd-line)",
      opacity: dim ? .55 : 1,
      background: d.state === "active" ? "linear-gradient(90deg,rgba(212,164,55,0.04),transparent 40%)" : "transparent"
    }
  }, /*#__PURE__*/React.createElement(window.GDI.Monitor, {
    size: 17,
    style: {
      color: d.state === "active" ? "var(--gd-gold)" : "var(--gd-text-muted)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      width: 158,
      flex: "none",
      display: "flex",
      flexDirection: "column",
      gap: 3,
      minWidth: 0
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13,
      color: "var(--text-1)",
      display: "flex",
      alignItems: "center",
      gap: 7,
      whiteSpace: "nowrap"
    }
  }, d.name, d.self && /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--gd-text-faint)",
      border: "1px solid var(--gd-line-strong)",
      borderRadius: 3,
      padding: "0 5px",
      lineHeight: "15px",
      flex: "none"
    }
  }, "\u672C\u673A")), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(PDot, {
    kind: map.dot,
    pulse: busy
  }), map.badge, d.state === "active" && /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--gd-gold)"
    }
  }, "Epoch ", d.epoch))), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      minWidth: 0,
      fontSize: 12,
      color: "var(--gd-text-muted)",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis"
    }
  }, map.meta), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--gd-text-faint)",
      width: 80,
      flex: "none",
      textAlign: "right",
      whiteSpace: "nowrap"
    }
  }, d.last), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 108,
      flex: "none",
      display: "flex",
      justifyContent: "flex-end"
    }
  }, d.state === "standby" && /*#__PURE__*/React.createElement(PBtn, {
    size: "sm",
    onClick: () => onHandoff(d)
  }, "\u79FB\u4EA4\u6267\u884C\u6743"), d.state === "sunset" && /*#__PURE__*/React.createElement(PBtn, {
    size: "sm",
    variant: "ghost"
  }, "\u79FB\u9664"), busy && /*#__PURE__*/React.createElement(window.GDI.RefreshCw, {
    size: 14,
    style: {
      color: "var(--gd-text-muted)",
      animation: "gd-spinner 1s linear infinite"
    }
  })));
}
function Settings({
  activeDevice,
  onSetActive,
  onRunOnboarding
}) {
  const I = window.GDI;
  const [sec, setSec] = React.useState("device");
  const [devices, setDevices] = React.useState(() => [{
    id: "mac",
    name: "MacBook Pro",
    self: true,
    state: "active",
    epoch: activeDevice.epoch,
    last: "现在"
  }, {
    id: "iph",
    name: "iPhone 17",
    self: false,
    state: "standby",
    last: "08:30"
  }, {
    id: "air",
    name: "MacBook Air (2019)",
    self: false,
    state: "sunset",
    last: "06-12"
  }]);
  const [handoff, setHandoff] = React.useState(null);
  const [ack, setAck] = React.useState(false);
  const [autoSync, setAutoSync] = React.useState(true);
  const [readonly, setReadonly] = React.useState(true);
  const runHandoff = () => {
    const to = handoff;
    setHandoff(null);
    setAck(false);
    const nextEpoch = (devices.find(d => d.state === "active").epoch || 41) + 1;
    setDevices(ds => ds.map(d => d.state === "active" ? {
      ...d,
      state: "draining"
    } : d.id === to.id ? {
      ...d,
      state: "activating"
    } : d));
    setTimeout(() => {
      setDevices(ds => ds.map(d => d.state === "draining" ? {
        ...d,
        state: "standby",
        last: "现在"
      } : d.id === to.id ? {
        ...d,
        state: "active",
        epoch: nextEpoch,
        self: false,
        last: "现在"
      } : d));
      onSetActive({
        name: to.name,
        epoch: nextEpoch
      });
    }, 1500);
  };
  const conns = {
    registrar: [["Spaceship", "ok", "812 域名 · 主注册商", "", "14:02"], ["Namecheap", "ok", "142 域名", "", "13:58"], ["Dynadot", "warn", "69 域名 · Token 过期", "", "—"]],
    dns: [["Cloudflare", "ok", "601 区域 · A/CNAME/TXT/MX", "", "14:02"]],
    platform: [["Atom", "ok", "511 Listing", "API", "14:01"], ["Afternic", "ok", "601 Listing · 需 CSV 人工", "CSV", "07-28"], ["SellerHub", "off", "未连接", "", "—"]]
  };
  const content = {
    conn: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(PPanel, {
      flush: true,
      title: "\u6CE8\u518C\u5546",
      actions: /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, "Nameserver \u53D8\u66F4\u5904\u7406\u5E73\u53F0")
    }, conns.registrar.map(c => /*#__PURE__*/React.createElement(ConnRow, {
      key: c[0],
      name: c[0],
      kind: c[1],
      meta: c[2],
      method: c[3],
      last: c[4]
    }))), /*#__PURE__*/React.createElement(PPanel, {
      flush: true,
      title: "DNS \u63D0\u4F9B\u5546",
      actions: /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, "DNS \u8BB0\u5F55\u5904\u7406\u5E73\u53F0")
    }, conns.dns.map(c => /*#__PURE__*/React.createElement(ConnRow, {
      key: c[0],
      name: c[0],
      kind: c[1],
      meta: c[2],
      method: c[3],
      last: c[4]
    }))), /*#__PURE__*/React.createElement(PPanel, {
      flush: true,
      title: "\u4EA4\u6613\u5E73\u53F0",
      actions: /*#__PURE__*/React.createElement("span", {
        style: {
          fontSize: 11,
          color: "var(--gd-text-faint)"
        }
      }, "\u6539\u4EF7 / \u4E0A\u4E0B\u67B6\u5904\u7406\u5E73\u53F0")
    }, conns.platform.map(c => /*#__PURE__*/React.createElement(ConnRow, {
      key: c[0],
      name: c[0],
      kind: c[1],
      meta: c[2],
      method: c[3],
      last: c[4]
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 9,
        paddingTop: 2
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--gd-text-faint)"
      }
    }, "\u51ED\u636E\u7ECF\u672C\u5730\u5BC6\u94A5\u52A0\u5BC6\u4FDD\u5B58\uFF0C\u6C38\u4E0D\u4E0A\u4E91\u3002\u65AD\u5F00\u4EC5\u79FB\u9664\u672C\u5730\u6388\u6743\uFF0C\u4E0D\u5F71\u54CD\u5E73\u53F0\u4FA7\u6570\u636E\u3002"), onRunOnboarding && /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10
      }
    }, /*#__PURE__*/React.createElement(PBtn, {
      size: "sm",
      onClick: onRunOnboarding
    }, "\u91CD\u65B0\u8FD0\u884C\u63A5\u5165\u5411\u5BFC"), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--gd-text-faint)"
      }
    }, "\u8BBE\u5907\u95E8\u7981 \xB7 \u8FDE\u63A5 \xB7 \u9996\u6B21\u5BFC\u5165")))),
    device: /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 14
      }
    }, /*#__PURE__*/React.createElement(PPanel, {
      flush: true,
      title: "\u8BBE\u5907\u4E0E\u6267\u884C\u6743\uFF08ActiveDeviceLease\uFF09",
      actions: /*#__PURE__*/React.createElement("span", {
        style: {
          fontFamily: "var(--font-mono)",
          fontSize: 11,
          color: "var(--gd-gold)"
        }
      }, "Epoch ", devices.find(d => d.state === "active" || d.state === "draining")?.epoch || activeDevice.epoch)
    }, devices.map(d => /*#__PURE__*/React.createElement(DeviceRow, {
      key: d.id,
      d: d,
      onHandoff: setHandoff
    }))), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 12,
        padding: "11px 14px",
        border: "1px solid var(--gd-line)",
        borderRadius: 7,
        background: "var(--gd-panel)"
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/icons/active-lease.svg",
      width: "26",
      height: "26",
      alt: "",
      style: {
        flex: "none",
        marginTop: 1
      }
    }), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--gd-text-muted)",
        lineHeight: 1.6
      }
    }, "\u540C\u4E00\u65F6\u523B\u53EA\u6709\u4E00\u53F0\u8BBE\u5907\u6301\u6709\u6267\u884C\u6743\uFF08", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--gd-gold)",
        fontWeight: 500
      }
    }, "\u91D1\u5B9E\u5FC3 = Active"), "\uFF0C\u84DD\u7A7A\u5FC3 = Standby\uFF09\u3002\u79FB\u4EA4\u65F6\u65E7\u8BBE\u5907", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--gd-text)",
        fontWeight: 500
      }
    }, "\u6392\u7A7A"), "\u672A\u540C\u6B65\u9879\u540E\u91CA\u653E\uFF0C\u65B0\u8BBE\u5907", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--gd-text)",
        fontWeight: 500
      }
    }, "\u6B63\u5728\u5B89\u5168\u6FC0\u6D3B"), "\u5E76\u7531\u670D\u52A1\u7AEF\u7B7E\u53D1\u65B0 Lease\uFF0CEpoch \u9012\u589E\u3002\u9000\u5F79\u8BBE\u5907\u8FDB\u5165 ", /*#__PURE__*/React.createElement("b", {
      style: {
        color: "var(--gd-text)",
        fontWeight: 500
      }
    }, "Sunset \xB7 LocalContinuation"), " \u4FDD\u7559\u6001\uFF0C\u4EC5\u672C\u5730\u53EA\u8BFB\uFF0C\u65E0\u6267\u884C\u6743\u3002"))),
    license: /*#__PURE__*/React.createElement(PPanel, {
      title: "\u8BB8\u53EF\u4E0E\u6240\u6709\u6743",
      actions: /*#__PURE__*/React.createElement(PBadge, {
        tone: "gold"
      }, "\u5E74\u4ED8 License")
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 14,
        alignItems: "flex-start",
        marginBottom: 6
      }
    }, /*#__PURE__*/React.createElement("img", {
      src: "../../assets/icons/keyhole.svg",
      width: "30",
      height: "30",
      alt: "",
      style: {
        flex: "none",
        marginTop: 4,
        opacity: .9
      }
    }), /*#__PURE__*/React.createElement("div", {
      style: {
        flex: 1
      }
    }, /*#__PURE__*/React.createElement(KV, {
      k: "License"
    }, "\u5E74\u4ED8 \xB7 \u6709\u6548\u81F3 ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)"
      }
    }, "2026-12-31")), /*#__PURE__*/React.createElement(KV, {
      k: "\u6240\u6709\u6743\u9A8C\u8BC1"
    }, "\u672C\u5730\u5BC6\u94A5\u7B7E\u53D1 \xB7 ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--gd-success)"
      }
    }, "\u5DF2\u9A8C\u8BC1")), /*#__PURE__*/React.createElement(KV, {
      k: "Workspace",
      muted: true
    }, "\u4E2A\u4EBA \xB7 4 \u5E73\u53F0 \xB7 3 \u8D26\u6237"), /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 12,
        justifyContent: "flex-end"
      }
    }, /*#__PURE__*/React.createElement(PBtn, {
      size: "sm",
      variant: "ghost",
      icon: /*#__PURE__*/React.createElement(I.ExternalLink, {
        size: 13
      })
    }, "\u7BA1\u7406\u8BA2\u9605"), /*#__PURE__*/React.createElement(PBtn, {
      size: "sm"
    }, "\u7EED\u671F"))))),
    sync: /*#__PURE__*/React.createElement(PPanel, {
      title: "\u540C\u6B65\u504F\u597D"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column"
      }
    }, /*#__PURE__*/React.createElement(KV, {
      k: "\u81EA\u52A8\u540C\u6B65"
    }, /*#__PURE__*/React.createElement(PSwitch, {
      checked: autoSync,
      onChange: () => setAutoSync(v => !v)
    })), /*#__PURE__*/React.createElement(KV, {
      k: "\u540C\u6B65\u95F4\u9694"
    }, /*#__PURE__*/React.createElement(PSel, {
      size: "sm",
      options: ["实时", "每 5 分钟", "每 15 分钟", "仅手动"],
      value: "\u6BCF 5 \u5206\u949F",
      onChange: () => {}
    })), /*#__PURE__*/React.createElement(KV, {
      k: "\u79BB\u7EBF\u53EA\u8BFB"
    }, /*#__PURE__*/React.createElement(PSwitch, {
      checked: readonly,
      onChange: () => setReadonly(v => !v)
    })), /*#__PURE__*/React.createElement(KV, {
      k: "\u51B2\u7A81\u7B56\u7565"
    }, /*#__PURE__*/React.createElement(PSel, {
      size: "sm",
      options: ["总是人工裁决", "优先本地", "优先云端"],
      value: "\u603B\u662F\u4EBA\u5DE5\u88C1\u51B3",
      onChange: () => {}
    })), /*#__PURE__*/React.createElement("div", {
      style: {
        fontSize: 11,
        color: "var(--gd-text-faint)",
        paddingTop: 10,
        lineHeight: 1.6
      }
    }, "\u79BB\u7EBF\u53EA\u8BFB\u5F00\u542F\u65F6\uFF0C\u4E91\u7AEF\u4E0D\u53EF\u8FBE\u5373\u8FDB\u5165\u53EA\u8BFB\u89C6\u56FE\uFF0C\u5E38\u9A7B\u663E\u793A\u300C\u6570\u636E\u6765\u81EA GoodDealer Cloud \xB7 \u622A\u81F3\u65F6\u95F4\u300D\u3002\u51B2\u7A81\u9879\u6C38\u4E0D\u81EA\u52A8\u8986\u76D6\uFF0C\u7EDF\u4E00\u5165\u51B2\u7A81\u4E2D\u5FC3\u4EBA\u5DE5\u88C1\u51B3\u3002"))),
    about: /*#__PURE__*/React.createElement(PPanel, {
      title: "\u5173\u4E8E"
    }, /*#__PURE__*/React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column"
      }
    }, /*#__PURE__*/React.createElement(KV, {
      k: "\u8BED\u8A00 / Locale"
    }, /*#__PURE__*/React.createElement(PSel, {
      size: "sm",
      options: ["中文（zh-CN）", "English (en-US)"],
      value: "\u4E2D\u6587\uFF08zh-CN\uFF09",
      onChange: () => {}
    })), /*#__PURE__*/React.createElement(KV, {
      k: "\u7248\u672C",
      muted: true
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)"
      }
    }, "0.9.0 \xB7 Tauri")), /*#__PURE__*/React.createElement(KV, {
      k: "\u672C\u5730\u6570\u636E\u76EE\u5F55",
      muted: true
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        fontSize: 11
      }
    }, "~/Library/GoodDealer")), /*#__PURE__*/React.createElement(KV, {
      k: "Revision \u57FA\u7EBF",
      muted: true
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)"
      }
    }, "8,241"))))
  };
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u8BBE\u7F6E",
    style: {
      display: "flex",
      height: "100%",
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: {
      width: 176,
      flex: "none",
      borderRight: "1px solid var(--gd-line)",
      background: "var(--gd-panel)",
      padding: 8,
      display: "flex",
      flexDirection: "column",
      gap: 2
    }
  }, SECTIONS.map(([k, l]) => /*#__PURE__*/React.createElement("button", {
    key: k,
    onClick: () => setSec(k),
    style: {
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
    }
  }, l))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      overflow: "auto",
      padding: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      maxWidth: 760
    }
  }, content[sec])), /*#__PURE__*/React.createElement(PDlg, {
    open: !!handoff,
    onClose: () => {
      setHandoff(null);
      setAck(false);
    },
    title: "\u79FB\u4EA4\u6267\u884C\u6743 \xB7 ActiveDeviceLease",
    width: 512,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(PBtn, {
      onClick: () => {
        setHandoff(null);
        setAck(false);
      }
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(PBtn, {
      variant: "primary",
      disabled: !ack,
      onClick: runHandoff
    }, "\u79FB\u4EA4\u5230 ", handoff && handoff.name))
  }, handoff && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 13
    }
  }, "\u5C06\u6267\u884C\u6743\u4ECE ", /*#__PURE__*/React.createElement("b", null, "MacBook Pro\uFF08\u672C\u673A\uFF09"), " \u79FB\u4EA4\u5230 ", /*#__PURE__*/React.createElement("b", null, handoff.name), "\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-line-strong)",
      borderRadius: 7,
      background: "var(--gd-panel)",
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 8,
      fontSize: 12,
      color: "var(--gd-text-muted)",
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-text)",
      fontWeight: 500
    }
  }, "\u2460 \u6392\u7A7A"), "\uFF1A\u672C\u673A\u5148\u63D0\u4EA4 Outbox \u672A\u540C\u6B65\u9879\u5E76\u91CA\u653E\u5F53\u524D Lease\u3002"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-text)",
      fontWeight: 500
    }
  }, "\u2461 \u6B63\u5728\u5B89\u5168\u6FC0\u6D3B"), "\uFF1A", handoff.name, " \u6821\u9A8C\u901A\u8FC7\u540E\uFF0C\u670D\u52A1\u7AEF\u7B7E\u53D1\u65B0 ActiveDeviceLease\u3002"), /*#__PURE__*/React.createElement("span", null, /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-text)",
      fontWeight: 500
    }
  }, "\u2462 Epoch \u9012\u589E"), "\uFF1A", devices.find(d => d.state === "active").epoch, " \u2192 ", (devices.find(d => d.state === "active").epoch || 41) + 1, "\uFF0C\u672C\u673A\u8F6C\u4E3A Standby\u3002")), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid var(--gd-line)",
      paddingTop: 10
    }
  }, /*#__PURE__*/React.createElement(PCheck, {
    checked: ack,
    onChange: () => setAck(a => !a),
    label: "\u6211\u786E\u8BA4\u79FB\u4EA4\u6267\u884C\u6743\uFF1B\u671F\u95F4\u672C\u673A\u5C06\u6682\u65F6\u65E0\u6CD5\u6267\u884C\u5199\u64CD\u4F5C"
  })))));
}
window.GDSettings = Settings;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/SettingsPanel.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/Shell.jsx
try { (() => {
const {
  Badge,
  StatusDot,
  IconButton,
  WindowChrome,
  StatusBar,
  Toolbar
} = window.GoodDealerDesignSystem_b5b0b6;
const Dot = ({
  tone,
  hollow
}) => /*#__PURE__*/React.createElement("span", {
  style: {
    width: 7,
    height: 7,
    borderRadius: "50%",
    flex: "none",
    display: "inline-block",
    background: hollow ? "transparent" : `var(--gd-${tone})`,
    border: hollow ? `1.5px solid var(--gd-${tone})` : "none"
  }
});
const shellStyles = {
  side: {
    width: 210,
    flex: "none",
    background: "var(--gd-panel)",
    borderRight: "1px solid var(--gd-line)",
    display: "flex",
    flexDirection: "column"
  },
  navSec: {
    padding: "12px 16px 4px",
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase",
    color: "var(--text-3)",
    fontWeight: 500
  },
  item: act => ({
    display: "flex",
    alignItems: "center",
    gap: 9,
    margin: "1px 8px",
    padding: "0 8px",
    height: 29,
    borderRadius: 5,
    cursor: "pointer",
    fontSize: 13,
    color: act ? "var(--text-1)" : "var(--text-2)",
    background: act ? "var(--gd-panel-raised)" : "transparent",
    border: "none",
    width: "calc(100% - 16px)",
    fontFamily: "var(--font-sans)",
    textAlign: "left",
    transition: "background 120ms,color 120ms",
    fontWeight: act ? 500 : 400
  }),
  itemActiveBar: {
    position: "absolute",
    left: 0,
    top: 5,
    bottom: 5,
    width: 2,
    borderRadius: 1,
    background: "var(--gd-gold)"
  },
  count: {
    marginLeft: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-3)",
    lineHeight: "15px"
  },
  cmd: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    height: 28,
    padding: "0 8px 0 10px",
    width: 300,
    background: "var(--gd-ink)",
    border: "1px solid var(--gd-line-strong)",
    borderRadius: 5,
    color: "var(--text-3)",
    fontSize: 12,
    cursor: "text"
  },
  kbd: {
    marginLeft: "auto",
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    color: "var(--text-3)",
    border: "1px solid var(--gd-line-strong)",
    borderRadius: 3,
    padding: "0 4px",
    lineHeight: "15px"
  }
};
function NavItem({
  icon: Ic,
  label,
  k,
  active,
  onGo,
  count,
  tone
}) {
  const on = active === k;
  return /*#__PURE__*/React.createElement("button", {
    style: {
      ...shellStyles.item(on),
      position: "relative"
    },
    onClick: () => onGo(k),
    onMouseEnter: e => {
      if (!on) e.currentTarget.style.background = "var(--gd-panel-raised)";
    },
    onMouseLeave: e => {
      if (!on) e.currentTarget.style.background = "transparent";
    }
  }, on && /*#__PURE__*/React.createElement("span", {
    style: shellStyles.itemActiveBar
  }), /*#__PURE__*/React.createElement(Ic, {
    size: 15,
    style: {
      flex: "none",
      opacity: on ? 1 : .7
    }
  }), label, count != null && /*#__PURE__*/React.createElement("span", {
    style: {
      ...shellStyles.count,
      ...(tone ? {
        color: `var(--gd-${tone})`
      } : {})
    }
  }, count));
}
function Shell({
  active,
  onGo,
  title,
  crumb,
  syncing,
  onSync,
  unsynced = 0,
  device = {
    name: "MacBook Pro",
    epoch: 41
  },
  children
}) {
  const [shellW, setShellW] = React.useState(1280);
  React.useEffect(() => {
    const el = document.getElementById("root");
    if (!el) return;
    const ro = new ResizeObserver(es => setShellW(es[0].contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const showP2 = shellW >= 980,
    showP3 = shellW >= 1180;
  const I = window.GDI;
  const mark = /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark-flat.svg",
    width: "18",
    height: "18",
    alt: ""
  });
  const cmd = /*#__PURE__*/React.createElement("div", {
    style: shellStyles.cmd
  }, /*#__PURE__*/React.createElement(I.Search, {
    size: 13
  }), /*#__PURE__*/React.createElement("span", null, "\u641C\u7D22\u57DF\u540D\u6216\u8F93\u5165\u547D\u4EE4"), /*#__PURE__*/React.createElement("span", {
    style: shellStyles.kbd
  }, "\u2318K"));
  const footer = /*#__PURE__*/React.createElement(StatusBar, {
    left: [/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(Dot, {
      tone: "blue"
    }), syncing ? "SYNCING" : "SYNCED"), /*#__PURE__*/React.createElement(React.Fragment, null, "\u672A\u540C\u6B65 ", /*#__PURE__*/React.createElement("span", {
      style: {
        fontFamily: "var(--font-mono)",
        color: unsynced > 0 ? "var(--gd-blue)" : "var(--text-3)"
      }
    }, unsynced)), ...(showP2 ? [/*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-3)"
      }
    }, "\u6700\u540E\u540C\u6B65 ", syncing ? "…" : "14:02")] : []), ...(showP3 ? [/*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-3)"
      }
    }, "rev 8,241")] : [])],
    right: [...(showP2 ? [/*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-3)"
      }
    }, "4 \u5E73\u53F0 \xB7 3 \u8D26\u6237")] : []), /*#__PURE__*/React.createElement(React.Fragment, null, device.name, " ", /*#__PURE__*/React.createElement(Dot, {
      tone: "gold"
    }), " ", /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--gd-gold)"
      }
    }, "Active")), ...(showP2 ? [/*#__PURE__*/React.createElement(React.Fragment, null, device.name === "MacBook Pro" ? "iPhone 17" : "MacBook Pro", " ", /*#__PURE__*/React.createElement(Dot, {
      tone: "blue",
      hollow: true
    }), " Standby")] : []), ...(showP3 ? [/*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-3)"
      }
    }, "Epoch ", device.epoch)] : []), ...(showP3 ? [/*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--text-3)"
      }
    }, "\u5E74\u4ED8 License")] : [])]
  });
  return /*#__PURE__*/React.createElement(WindowChrome, {
    appName: "GoodDealer",
    mark: mark,
    context: `个人 Workspace · ${title}`,
    footer: footer,
    style: {
      minWidth: 760
    }
  }, /*#__PURE__*/React.createElement("aside", {
    style: shellStyles.side
  }, /*#__PURE__*/React.createElement("div", {
    style: shellStyles.navSec
  }, "\u8D44\u4EA7"), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.Globe,
    label: "\u8D44\u4EA7\u5E93",
    k: "assets",
    active: active,
    onGo: onGo
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.Coins,
    label: "\u9500\u552E\u7BA1\u7406",
    k: "sales",
    active: active,
    onGo: onGo
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.Shield,
    label: "DNS \u4E0E\u9A8C\u8BC1",
    k: "dns",
    active: active,
    onGo: onGo
  }), /*#__PURE__*/React.createElement("div", {
    style: shellStyles.navSec
  }, "\u6267\u884C"), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.ListChecks,
    label: "\u6279\u91CF\u4EFB\u52A1",
    k: "batch",
    active: active,
    onGo: onGo
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.AlertTriangle,
    label: "\u51B2\u7A81\u4E2D\u5FC3",
    k: "conflicts",
    active: active,
    onGo: onGo,
    count: 6,
    tone: "danger"
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.Inbox,
    label: "\u4EBA\u5DE5\u4EFB\u52A1",
    k: "inbox",
    active: active,
    onGo: onGo,
    count: 4,
    tone: "warning"
  }), /*#__PURE__*/React.createElement(NavItem, {
    icon: I.History,
    label: "\u64CD\u4F5C\u5386\u53F2",
    k: "history",
    active: active,
    onGo: onGo
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto"
    }
  }, /*#__PURE__*/React.createElement(NavItem, {
    icon: I.Settings,
    label: "\u8BBE\u7F6E",
    k: "settings",
    active: active,
    onGo: onGo
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      padding: "8px 12px 12px",
      borderTop: "1px solid var(--gd-line)",
      margin: "4px 0 0",
      display: "flex",
      alignItems: "center",
      gap: 7
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/icons/keyhole.svg",
    width: "14",
    height: "14",
    alt: "",
    style: {
      opacity: .85
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 10,
      color: "var(--text-3)",
      fontFamily: "var(--font-mono)",
      lineHeight: 1.3
    }
  }, "\u51ED\u636E\u672C\u5730\u52A0\u5BC6", /*#__PURE__*/React.createElement("br", null), "\u6C38\u4E0D\u4E0A\u4E91"))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      minHeight: 0
    }
  }, /*#__PURE__*/React.createElement(Toolbar, {
    left: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 14,
        fontWeight: 600,
        color: "var(--text-1)"
      }
    }, title), crumb && /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 12,
        color: "var(--text-3)"
      }
    }, crumb)),
    right: /*#__PURE__*/React.createElement(React.Fragment, null, cmd, /*#__PURE__*/React.createElement(IconButton, {
      size: "sm",
      label: "\u5237\u65B0\u5E73\u53F0\u6570\u636E",
      onClick: onSync
    }, /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 14,
      style: syncing ? {
        animation: "gd-spinner 1s linear infinite"
      } : undefined
    })))
  }), /*#__PURE__*/React.createElement("main", {
    style: {
      flex: 1,
      minWidth: 0,
      minHeight: 0,
      overflow: "auto",
      display: "flex",
      flexDirection: "column"
    }
  }, children)));
}
window.GDShell = Shell;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/Shell.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/SignIn.jsx
try { (() => {
// 账户登录 / SignIn — the account gate that precedes 设备门禁.
// Account = GoodDealer Cloud identity (≤2 execution devices). Device Lease = execution right.
// States: signin → register → verify(email code) → hands off to Onboarding(device gate).
// Hardware-wallet mind: credentials are encrypted by a LOCAL key, never uploaded.
const {
  Button: SBtn,
  Input: SInput,
  Checkbox: SCheck,
  Badge: SBadge,
  StatusDot: SDot,
  WindowChrome: SWin
} = window.GoodDealerDesignSystem_b5b0b6;
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
function LinkText({
  children,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    style: {
      background: "none",
      border: "none",
      padding: 0,
      font: "inherit",
      fontSize: "inherit",
      color: "var(--text-link)",
      cursor: "pointer"
    },
    onMouseEnter: e => e.currentTarget.style.textDecoration = "underline",
    onMouseLeave: e => e.currentTarget.style.textDecoration = "none"
  }, children);
}
function LangToggle({
  lang,
  setLang
}) {
  const opt = (k, l) => /*#__PURE__*/React.createElement("button", {
    onClick: () => setLang(k),
    style: {
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
    }
  }, l);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      gap: 1,
      padding: 2,
      borderRadius: 7,
      border: "1px solid var(--gd-line)",
      background: "var(--gd-ink)"
    }
  }, opt("zh", "中"), opt("en", "EN"));
}
function Divider({
  label
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      margin: "2px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--gd-line)"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--text-3)",
      textTransform: "uppercase",
      letterSpacing: "0.08em"
    }
  }, label), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      height: 1,
      background: "var(--gd-line)"
    }
  }));
}
function Mono({
  ch
}) {
  return /*#__PURE__*/React.createElement("span", {
    style: {
      width: 20,
      height: 20,
      flex: "none",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      borderRadius: 5,
      border: "1px solid var(--gd-line-strong)",
      background: "var(--gd-ink)",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      fontWeight: 600,
      color: "var(--text-2)"
    }
  }, ch);
}
function Oauth({
  mono,
  label,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    className: "gd-btn gd-btn--md gd-btn--secondary",
    style: {
      width: "100%",
      justifyContent: "flex-start",
      gap: 10,
      paddingLeft: 9
    }
  }, /*#__PURE__*/React.createElement(Mono, {
    ch: mono
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      textAlign: "center",
      marginRight: 20
    }
  }, label));
}

// 6-cell verification code
function CodeInput({
  value,
  onChange,
  error
}) {
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
    cells.push(/*#__PURE__*/React.createElement("input", {
      key: i,
      ref: el => refs.current[i] = el,
      value: ch,
      inputMode: "numeric",
      maxLength: 1,
      onChange: e => {
        const d = e.target.value.replace(/\D/g, "");
        set(i, d);
        if (d && refs.current[i + 1]) refs.current[i + 1].focus();
      },
      onKeyDown: e => {
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
      onFocus: e => e.target.style.borderColor = "var(--gd-blue)",
      onBlur: e => e.target.style.borderColor = error ? "var(--gd-danger)" : ch ? "var(--gd-line-strong)" : "var(--gd-line)"
    }));
  }
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, cells);
}
function SignIn({
  onAuthed
}) {
  const I = window.GDI;
  const [lang, setLang] = React.useState("zh");
  const t = T[lang];
  const [mode, setMode] = React.useState("signin"); // signin | register | verify | forgot
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
    const id = setTimeout(() => setCool(cool - 1), 1000);
    return () => clearTimeout(id);
  }, [cool]);
  const go = m => {
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
  const pwSuffix = /*#__PURE__*/React.createElement("button", {
    onClick: e => {
      e.preventDefault();
      setShowPw(s => !s);
    },
    tabIndex: -1,
    style: {
      background: "none",
      border: "none",
      padding: 0,
      cursor: "pointer",
      color: "var(--text-3)",
      fontSize: 11
    }
  }, showPw ? t.hide : t.show);

  // ——— right-panel bodies ———
  const signinBody = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SInput, {
    label: t.email,
    size: "lg",
    type: "email",
    placeholder: t.emailPh,
    value: email,
    onChange: e => setEmail(e.target.value),
    autoFocus: true
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(SInput, {
    label: t.password,
    size: "lg",
    type: showPw ? "text" : "password",
    placeholder: t.pwPh,
    value: pw,
    onChange: e => setPw(e.target.value),
    suffix: pwSuffix,
    onKeyDown: e => e.key === "Enter" && email && pw && doSignIn()
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement(SCheck, {
    checked: remember,
    onChange: e => setRemember(e.target?.checked ?? !remember),
    label: t.remember
  }), /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => go("forgot")
  }, t.forgot)))), err && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-danger)"
    }
  }, err), /*#__PURE__*/React.createElement(SBtn, {
    variant: "primary",
    size: "lg",
    block: true,
    disabled: busy || !email || !pw,
    onClick: doSignIn,
    icon: busy ? /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 15,
      style: {
        animation: "gd-spinner 1s linear infinite"
      }
    }) : null
  }, busy ? t.signingIn : t.signIn), /*#__PURE__*/React.createElement(Divider, {
    label: t.or
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Oauth, {
    mono: "G",
    label: t.google,
    onClick: doSignIn
  }), /*#__PURE__*/React.createElement(Oauth, {
    mono: "GH",
    label: t.github,
    onClick: doSignIn
  }), /*#__PURE__*/React.createElement("button", {
    onClick: doSignIn,
    className: "gd-btn gd-btn--md gd-btn--gold",
    style: {
      width: "100%",
      justifyContent: "flex-start",
      gap: 10,
      paddingLeft: 9
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/icons/keyhole.svg",
    width: "18",
    height: "18",
    alt: "",
    style: {
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      textAlign: "center",
      marginRight: 20
    }
  }, t.passkey))), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      paddingTop: 8,
      fontSize: 13,
      color: "var(--text-2)",
      display: "flex",
      gap: 6,
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("span", null, t.noAccount), /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => go("register")
  }, t.createOne)));
  const registerBody = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(SInput, {
    label: t.email,
    size: "lg",
    type: "email",
    placeholder: t.emailPh,
    value: email,
    onChange: e => setEmail(e.target.value),
    autoFocus: true
  }), /*#__PURE__*/React.createElement(SInput, {
    label: t.password,
    size: "lg",
    type: showPw ? "text" : "password",
    placeholder: t.pwPh,
    value: pw,
    onChange: e => setPw(e.target.value),
    suffix: pwSuffix,
    hint: t.pwRule
  }), /*#__PURE__*/React.createElement(SInput, {
    label: t.confirm,
    size: "lg",
    type: showPw ? "text" : "password",
    placeholder: t.confirmPh,
    value: pw2,
    onChange: e => setPw2(e.target.value)
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 9,
      fontSize: 12,
      color: "var(--text-2)",
      lineHeight: 1.5
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      marginTop: 1
    }
  }, /*#__PURE__*/React.createElement(SCheck, {
    checked: agree,
    onChange: e => setAgree(e.target?.checked ?? !agree)
  })), /*#__PURE__*/React.createElement("span", null, t.agreePre, " ", /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => {}
  }, t.terms), " ", t.and, " ", /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => {}
  }, t.privacy)))), err && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-danger)"
    }
  }, err), /*#__PURE__*/React.createElement(SBtn, {
    variant: "primary",
    size: "lg",
    block: true,
    disabled: busy || !email || !pw || !pw2,
    onClick: doRegister,
    icon: busy ? /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 15,
      style: {
        animation: "gd-spinner 1s linear infinite"
      }
    }) : null
  }, busy ? t.creating : t.create), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: "auto",
      paddingTop: 8,
      fontSize: 13,
      color: "var(--text-2)",
      display: "flex",
      gap: 6,
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement("span", null, t.haveAccount), /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => go("signin")
  }, t.toSignIn)));
  const verifyBody = /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 16
    }
  }, /*#__PURE__*/React.createElement("span", {
    className: "gd-t-label",
    style: {
      fontSize: 11,
      letterSpacing: "var(--tracking-caps)",
      textTransform: "uppercase",
      color: "var(--text-2)"
    }
  }, t.code), /*#__PURE__*/React.createElement(CodeInput, {
    value: code,
    onChange: setCode,
    error: !!err
  }), err && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 12,
      color: "var(--gd-danger)"
    }
  }, err)), /*#__PURE__*/React.createElement(SBtn, {
    variant: "primary",
    size: "lg",
    block: true,
    disabled: busy || code.length < 6,
    onClick: doVerify,
    icon: busy ? /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 15,
      style: {
        animation: "gd-spinner 1s linear infinite"
      }
    }) : /*#__PURE__*/React.createElement(I.Shield, {
      size: 15
    })
  }, busy ? t.verifying : t.verify), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      fontSize: 12,
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => go("register")
  }, t.back), cool > 0 ? /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-3)",
      fontFamily: "var(--font-mono)"
    }
  }, cool, lang === "zh" ? " " : "", t.resendIn) : /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => setCool(45)
  }, t.resend)));
  const forgotBody = sent ? /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 14,
      textAlign: "center",
      margin: "12px 0"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      width: 52,
      height: 52,
      borderRadius: "50%",
      background: "var(--gd-success-tint)",
      border: "1px solid var(--gd-success)",
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center"
    }
  }, /*#__PURE__*/React.createElement(I.Check, {
    size: 26,
    style: {
      color: "var(--gd-success)"
    }
  })), /*#__PURE__*/React.createElement("div", null, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 16,
      fontWeight: 600,
      color: "var(--text-1)"
    }
  }, t.sentTitle), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-2)",
      marginTop: 6,
      lineHeight: 1.5
    }
  }, t.sentSub))), /*#__PURE__*/React.createElement(SBtn, {
    variant: "secondary",
    size: "lg",
    block: true,
    onClick: () => go("signin")
  }, t.backToSignIn)) : /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(SInput, {
    label: t.email,
    size: "lg",
    type: "email",
    placeholder: t.emailPh,
    value: email,
    onChange: e => setEmail(e.target.value),
    autoFocus: true
  }), /*#__PURE__*/React.createElement(SBtn, {
    variant: "primary",
    size: "lg",
    block: true,
    disabled: busy || !email,
    onClick: doForgot,
    icon: busy ? /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 15,
      style: {
        animation: "gd-spinner 1s linear infinite"
      }
    }) : null
  }, busy ? t.sending : t.sendLink), /*#__PURE__*/React.createElement("div", {
    style: {
      marginTop: 2
    }
  }, /*#__PURE__*/React.createElement(LinkText, {
    onClick: () => go("signin")
  }, t.backToSignIn)));
  const HEAD = {
    signin: [t.siTitle, t.siSub],
    register: [t.rgTitle, t.rgSub],
    verify: [t.vfTitle, null],
    forgot: [t.fgTitle, t.fgSub]
  };
  const [hTitle, hSub] = HEAD[mode];
  const body = {
    signin: signinBody,
    register: registerBody,
    verify: verifyBody,
    forgot: forgotBody
  }[mode];
  return /*#__PURE__*/React.createElement(SWin, {
    appName: "GoodDealer",
    context: t.ctx,
    mark: /*#__PURE__*/React.createElement("img", {
      src: "../../assets/logo/mark-16.svg",
      width: "16",
      height: "16",
      alt: ""
    }),
    style: {
      width: 920,
      height: 600,
      maxWidth: "100%",
      maxHeight: "100%"
    },
    onClose: () => {}
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 380,
      flex: "none",
      position: "relative",
      overflow: "hidden",
      borderRight: "1px solid var(--gd-line)",
      background: "var(--gd-panel)",
      display: "flex",
      flexDirection: "column",
      padding: "40px 40px 36px"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      position: "absolute",
      width: 440,
      height: 440,
      left: "50%",
      top: "44%",
      transform: "translate(-50%,-50%)",
      borderRadius: "50%",
      background: "radial-gradient(circle,rgba(212,164,55,0.13),transparent 68%)",
      pointerEvents: "none"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      margin: "auto 0",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      textAlign: "center",
      gap: 26
    }
  }, /*#__PURE__*/React.createElement("img", {
    src: "../../assets/logo/mark.svg",
    width: "132",
    height: "132",
    alt: "GoodDealer"
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 15,
      color: "var(--text-2)",
      letterSpacing: "0.05em"
    }
  }, t.tagline)), /*#__PURE__*/React.createElement("div", {
    style: {
      position: "relative",
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      height: 1,
      background: "var(--gd-line)"
    }
  }), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "flex-start",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(I.Shield, {
    size: 14,
    style: {
      color: "var(--gd-gold)",
      marginTop: 2,
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--text-3)",
      lineHeight: 1.55
    }
  }, t.trust)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(SDot, {
    kind: "active",
    size: 7
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11.5,
      color: "var(--text-3)"
    }
  }, "GoodDealer Cloud \xB7 ", lang === "zh" ? "≤ 2 台执行设备" : "≤ 2 devices")))), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      background: "var(--gd-ink)"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "flex-end",
      padding: "12px 16px 2px"
    }
  }, /*#__PURE__*/React.createElement(LangToggle, {
    lang: lang,
    setLang: setLang
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minHeight: 0,
      overflowY: "auto",
      padding: "2px 40px 22px",
      display: "flex",
      flexDirection: "column"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      marginBottom: 16
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 20,
      fontWeight: 600,
      letterSpacing: "-0.02em",
      color: "var(--text-1)"
    }
  }, hTitle), hSub && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-2)",
      marginTop: 5
    }
  }, hSub), mode === "verify" && /*#__PURE__*/React.createElement("div", {
    style: {
      fontSize: 13,
      color: "var(--text-2)",
      marginTop: 5
    }
  }, t.vfSubA, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-1)",
      fontFamily: "var(--font-mono)"
    }
  }, email || "you@domain.com"), t.vfSubB)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      flex: 1
    }
  }, body))));
}
window.GDSignIn = SignIn;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/SignIn.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/TaskInbox.jsx
try { (() => {
const {
  Badge,
  Button,
  Panel,
  StatusDot
} = window.GoodDealerDesignSystem_b5b0b6;
function TaskInbox() {
  const I = window.GDI;
  const [cur, setCur] = React.useState(1);
  const [doneIds, setDoneIds] = React.useState([]);
  const [automation, setAutomation] = React.useState("user"); // user | software | paused
  const tasks = window.GD_DATA.tasks;
  const t = tasks.find(x => x.id === cur);
  const isDone = doneIds.includes(cur);
  const badge = b => b === "danger" ? /*#__PURE__*/React.createElement(Badge, {
    tone: "danger",
    mono: false
  }, "\u9AD8\u4F18\u5148\u7EA7") : b === "warning" ? /*#__PURE__*/React.createElement(Badge, {
    tone: "warning",
    mono: false
  }, "\u7B49\u5F85\u4EBA\u5DE5") : /*#__PURE__*/React.createElement(Badge, {
    mono: false
  }, "\u4F4E\u4F18\u5148\u7EA7");
  return /*#__PURE__*/React.createElement("div", {
    "data-screen-label": "\u4EBA\u5DE5\u4EFB\u52A1\u6536\u4EF6\u7BB1",
    style: {
      display: "flex",
      gap: 14,
      height: "100%",
      minHeight: 0,
      maxWidth: 1080,
      margin: "0 auto",
      padding: 16,
      width: "100%"
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      width: 300,
      flex: "none",
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 16,
      fontWeight: 600,
      padding: "2px 2px 6px"
    }
  }, "\u4EBA\u5DE5\u4EFB\u52A1 ", /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\xB7 ", tasks.length - doneIds.length, " \u5F85\u5904\u7406")), tasks.map(x => {
    const d = doneIds.includes(x.id);
    return /*#__PURE__*/React.createElement("button", {
      key: x.id,
      onClick: () => setCur(x.id),
      style: {
        textAlign: "left",
        background: cur === x.id ? "var(--gd-panel-raised)" : "var(--gd-panel)",
        border: `1px solid ${cur === x.id ? "var(--gd-line-strong)" : "var(--gd-line)"}`,
        borderRadius: 7,
        padding: "10px 12px",
        cursor: "pointer",
        fontFamily: "var(--font-sans)",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        opacity: d ? .55 : 1
      }
    }, /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 13,
        fontWeight: 500,
        color: "var(--gd-text)",
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, d && /*#__PURE__*/React.createElement(I.Check, {
      size: 13,
      style: {
        color: "var(--gd-success)"
      }
    }), x.title), /*#__PURE__*/React.createElement("span", {
      style: {
        display: "flex",
        gap: 8,
        alignItems: "center"
      }
    }, d ? /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      mono: false
    }, "\u5DF2\u5B8C\u6210") : badge(x.badge), /*#__PURE__*/React.createElement("span", {
      style: {
        fontSize: 11,
        color: "var(--gd-text-faint)"
      }
    }, x.account, x.domains ? ` · ${x.domains} 域名` : "")));
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)",
      padding: "4px 2px"
    }
  }, "\u81EA\u52A8\u5316\u5931\u8D25\u4F1A\u56DE\u5230\u540C\u4E00\u4EFB\u52A1\uFF0C\u4E0D\u521B\u5EFA\u91CD\u590D\u9879")), /*#__PURE__*/React.createElement("div", {
    style: {
      flex: 1,
      minWidth: 0,
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Panel, {
    title: t.title,
    actions: isDone ? /*#__PURE__*/React.createElement(Badge, {
      tone: "success",
      mono: false
    }, "\u5DF2\u5B8C\u6210") : badge(t.badge)
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12,
      fontSize: 13
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "96px 1fr",
      rowGap: 8,
      columnGap: 12,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u4E3A\u4EC0\u4E48\u9700\u8981\u4EBA\u5DE5"), /*#__PURE__*/React.createElement("span", null, t.why), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u76EE\u6807"), /*#__PURE__*/React.createElement("span", null, t.platform, " \xB7 ", t.account), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u5F71\u54CD\u57DF\u540D"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, t.domains || "—"), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u5DF2\u51C6\u5907"), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, t.prepared !== "—" && /*#__PURE__*/React.createElement(I.FileText, {
    size: 13,
    style: {
      color: "var(--gd-text-muted)"
    }
  }), t.prepared), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u5B8C\u6210\u6761\u4EF6"), /*#__PURE__*/React.createElement("span", null, t.done), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u6700\u540E\u68C0\u67E5"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, t.lastCheck)), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8,
      flexWrap: "wrap"
    }
  }, /*#__PURE__*/React.createElement(Button, {
    icon: /*#__PURE__*/React.createElement(I.ExternalLink, {
      size: 13
    })
  }, "\u6253\u5F00\u5E73\u53F0\u5E76\u767B\u5F55"), /*#__PURE__*/React.createElement(Button, {
    variant: "gold",
    onClick: () => setAutomation("software")
  }, "\u6388\u6743\u6267\u884C"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    onClick: () => setDoneIds(d => isDone ? d.filter(i => i !== cur) : [...d, cur])
  }, isDone ? "重新打开" : "我已完成"), /*#__PURE__*/React.createElement(Button, {
    variant: "ghost",
    icon: /*#__PURE__*/React.createElement(I.RefreshCw, {
      size: 13
    })
  }, "\u91CD\u65B0\u68C0\u67E5")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u300C\u6211\u5DF2\u5B8C\u6210\u300D\u4E0D\u4F1A\u76F4\u63A5\u6807\u8BB0\u6210\u529F\u2014\u2014\u7CFB\u7EDF\u5C06\u8BFB\u53D6\u5E73\u53F0\u72B6\u6001\u9A8C\u8BC1\u5B8C\u6210\u6761\u4EF6"))), /*#__PURE__*/React.createElement(Panel, {
    title: "Remote Browser \xB7 \u4EA4\u63A5\u72B6\u6001",
    actions: /*#__PURE__*/React.createElement(Badge, {
      tone: "sync"
    }, "SESSION 22:41")
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 16,
      alignItems: "center",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, /*#__PURE__*/React.createElement(I.Monitor, {
    size: 14
  }), t.platform, " \xB7 ", t.account), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontSize: 11
    }
  }, "\u5141\u8BB8 Host: *.", t.platform.toLowerCase(), ".com"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto"
    }
  }, automation === "software" ? /*#__PURE__*/React.createElement(StatusDot, {
    kind: "sync",
    pulse: true,
    label: "\u8F6F\u4EF6\u6267\u884C\u4E2D \xB7 \u5269\u4F59 3 \u9879"
  }) : automation === "paused" ? /*#__PURE__*/React.createElement(StatusDot, {
    kind: "warning",
    label: "\u5DF2\u6682\u505C \xB7 \u7B49\u5F85\u63A5\u7BA1"
  }) : /*#__PURE__*/React.createElement(StatusDot, {
    kind: "neutral",
    label: "\u7528\u6237\u64CD\u4F5C\uFF08\u5BC6\u7801 / 2FA / CAPTCHA\uFF09"
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      background: "var(--gd-ink)",
      border: "1px solid var(--gd-line)",
      borderRadius: 5,
      padding: "8px 12px",
      fontFamily: "var(--font-mono)",
      fontSize: 11,
      color: "var(--gd-text-muted)",
      display: "flex",
      justifyContent: "space-between"
    }
  }, /*#__PURE__*/React.createElement("span", null, "\u4E0B\u4E00\u6B65\uFF1A", automation === "software" ? "填写价格表单 → 提交" : "等待用户完成登录"), /*#__PURE__*/React.createElement("span", null, "\u961F\u5217 ", automation === "software" ? "3" : "—", " / 12")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: /*#__PURE__*/React.createElement(I.Pause, {
      size: 12
    }),
    onClick: () => setAutomation("paused"),
    disabled: automation !== "software"
  }, "\u6682\u505C\u5E76\u63A5\u7BA1"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    icon: /*#__PURE__*/React.createElement(I.Play, {
      size: 12
    }),
    onClick: () => setAutomation("software"),
    disabled: automation === "software"
  }, "\u7EE7\u7EED"), /*#__PURE__*/React.createElement(Button, {
    size: "sm",
    variant: "danger",
    onClick: () => setAutomation("user")
  }, "\u7EC8\u6B62"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--gd-text-faint)",
      alignSelf: "center"
    }
  }, "\u5BC6\u7801\u30012FA\u3001CAPTCHA \u9875\u9762\u81EA\u52A8\u5207\u6362\u4E3A\u7528\u6237\u64CD\u4F5C"))))));
}
window.GDTaskInbox = TaskInbox;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/TaskInbox.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/controls.jsx
try { (() => {
// Kit-local reusable controls: Pagination + EditableCell (inline double-click edit).
// Composed from DS primitives; loaded via Babel so they work without a bundle recompile.
const {
  Select: GDSelect,
  IconButton: GDIconButton
} = window.GoodDealerDesignSystem_b5b0b6;
function pageWindow(cur, total) {
  if (total <= 7) return Array.from({
    length: total
  }, (_, i) => i + 1);
  const s = new Set([1, 2, total - 1, total, cur - 1, cur, cur + 1]);
  const arr = [...s].filter(n => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  let prev = 0;
  for (const n of arr) {
    if (n - prev > 1) out.push("gap" + n);
    out.push(n);
    prev = n;
  }
  return out;
}
function PageNum({
  n,
  active,
  onClick
}) {
  return /*#__PURE__*/React.createElement("button", {
    onClick: onClick,
    onMouseEnter: e => {
      if (!active) e.currentTarget.style.background = "var(--gd-panel-raised)";
    },
    onMouseLeave: e => {
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
  }, n);
}
function Pagination({
  page,
  pageSize,
  total,
  onPage,
  onPageSize,
  pageSizes = [10, 25, 50],
  note
}) {
  const I = window.GDI;
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const cur = Math.min(page, pages);
  const from = total === 0 ? 0 : (cur - 1) * pageSize + 1;
  const to = Math.min(total, cur * pageSize);
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12,
      width: "100%",
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      fontVariantNumeric: "tabular-nums"
    }
  }, from.toLocaleString(), "\u2013", to.toLocaleString(), " ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--text-3)"
    }
  }, "/ ", total.toLocaleString())), /*#__PURE__*/React.createElement("span", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 6
    }
  }, "\u6BCF\u9875", /*#__PURE__*/React.createElement(GDSelect, {
    size: "sm",
    options: pageSizes.map(String),
    value: String(pageSize),
    onChange: e => onPageSize(+e.target.value)
  })), note && /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      fontSize: 11
    }
  }, note), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: note ? 16 : "auto",
      display: "flex",
      alignItems: "center",
      gap: 3
    }
  }, /*#__PURE__*/React.createElement(GDIconButton, {
    size: "sm",
    label: "\u4E0A\u4E00\u9875",
    disabled: cur <= 1,
    onClick: () => onPage(cur - 1)
  }, /*#__PURE__*/React.createElement(I.ChevronLeft, {
    size: 14
  })), pageWindow(cur, pages).map((n, i) => typeof n === "number" ? /*#__PURE__*/React.createElement(PageNum, {
    key: i,
    n: n,
    active: n === cur,
    onClick: () => onPage(n)
  }) : /*#__PURE__*/React.createElement("span", {
    key: i,
    style: {
      padding: "0 2px",
      color: "var(--gd-text-faint)"
    }
  }, "\u2026")), /*#__PURE__*/React.createElement(GDIconButton, {
    size: "sm",
    label: "\u4E0B\u4E00\u9875",
    disabled: cur >= pages,
    onClick: () => onPage(cur + 1)
  }, /*#__PURE__*/React.createElement(I.ChevronRight, {
    size: 14
  }))));
}
window.GDPagination = Pagination;

// EditableCell — double-click to edit in place (uncontrolled input read via ref on
// commit, so it is race-free); Enter/blur reports the pending value to onCommit
// (parent shows the "save & sync?" prompt); Escape cancels.
function EditableCell({
  value,
  display,
  onCommit,
  width = 94,
  prefix
}) {
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
    return /*#__PURE__*/React.createElement("span", {
      style: {
        display: "inline-flex",
        alignItems: "center",
        gap: 2,
        justifyContent: "flex-end"
      },
      onClick: e => e.stopPropagation()
    }, prefix && /*#__PURE__*/React.createElement("span", {
      style: {
        color: "var(--gd-text-faint)",
        fontSize: 11,
        fontFamily: "var(--font-mono)"
      }
    }, prefix), /*#__PURE__*/React.createElement("input", {
      ref: ref,
      inputMode: "decimal",
      onKeyDown: e => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") cancel();
      },
      onBlur: commit,
      style: {
        width,
        height: 24,
        background: "var(--gd-ink)",
        border: "1px solid var(--gd-blue)",
        boxShadow: "0 0 0 2px rgba(77,141,255,0.25)",
        borderRadius: 5,
        color: "var(--gd-text)",
        fontFamily: "var(--font-mono)",
        fontVariantNumeric: "tabular-nums",
        fontSize: 12,
        textAlign: "right",
        padding: "0 7px",
        outline: "none"
      }
    }));
  }
  return /*#__PURE__*/React.createElement("span", {
    onDoubleClick: e => {
      e.stopPropagation();
      start();
    },
    onClick: e => e.stopPropagation(),
    title: "\u53CC\u51FB\u7F16\u8F91 \xB7 \u56DE\u8F66\u786E\u8BA4",
    style: {
      cursor: "text",
      display: "inline-block",
      borderBottom: "1px dashed transparent",
      paddingBottom: 1,
      transition: "border-color 120ms"
    },
    onMouseEnter: e => e.currentTarget.style.borderBottomColor = "var(--gd-line-strong)",
    onMouseLeave: e => e.currentTarget.style.borderBottomColor = "transparent"
  }, display != null ? display : value);
}
window.GDEditableCell = EditableCell;

// MetricStrip — the anti-jitter KPI band. Fixed height on EVERY screen (the meta line
// is always reserved, so 2-line and 3-line screens are the same height); equal-flex
// cells; optional per-cell drill-in (pointer + hover). Because the height is constant,
// the content baseline never shifts when you switch screens — the frame stays put.
function MetricStrip({
  metrics = []
}) {
  const tone = t => ({
    gold: "var(--gd-gold)",
    danger: "var(--gd-danger)",
    warning: "var(--gd-warning)",
    blue: "var(--gd-blue)",
    success: "var(--gd-success)",
    muted: "var(--text-3)"
  })[t] || "var(--text-1)";
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      height: 72,
      flex: "none",
      background: "var(--surface-region)",
      borderBottom: "1px solid var(--gd-line)"
    }
  }, metrics.map((m, i) => {
    const click = m.onClick;
    return /*#__PURE__*/React.createElement("div", {
      key: i,
      onClick: click || undefined,
      onMouseEnter: click ? e => {
        e.currentTarget.style.background = "var(--gd-panel-raised)";
      } : undefined,
      onMouseLeave: click ? e => {
        e.currentTarget.style.background = "transparent";
      } : undefined,
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
    }, /*#__PURE__*/React.createElement("span", {
      className: "gd-t-label",
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, m.label), /*#__PURE__*/React.createElement("span", {
      className: "gd-t-metric-sm",
      style: {
        color: m.tone === "muted" ? "var(--text-3)" : tone(m.tone),
        fontFamily: m.mono ? "var(--font-mono)" : undefined,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis"
      }
    }, m.value), /*#__PURE__*/React.createElement("span", {
      className: "gd-t-meta",
      style: {
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        minHeight: 14
      }
    }, m.meta != null ? m.meta : "\u00A0"));
  }));
}
window.GDMetricStrip = MetricStrip;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/controls.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/data.js
try { (() => {
window.GD_DATA = {
  domains: [{
    id: 1,
    domain: "vault.io",
    tags: ["三字母"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom · Afternic",
    status: "sold",
    bin: 12800,
    expiry: "2027-03-14"
  }, {
    id: 2,
    domain: "goldrail.com",
    tags: ["portfolio-a"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom",
    status: "synced",
    bin: 3500,
    expiry: "2026-11-02"
  }, {
    id: 3,
    domain: "kanban.ai",
    tags: ["AI"],
    registrar: "Namecheap",
    dns: "注册商",
    platforms: "Afternic",
    status: "synced",
    bin: 45000,
    expiry: "2027-01-28"
  }, {
    id: 4,
    domain: "lumen.dev",
    tags: [],
    registrar: "Dynadot",
    dns: "Cloudflare",
    platforms: "SellerHub",
    status: "conflict",
    bin: 980,
    expiry: "2026-09-19"
  }, {
    id: 5,
    domain: "north.capital",
    tags: ["portfolio-a"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom · Afternic",
    status: "synced",
    bin: 8200,
    expiry: "2028-05-01"
  }, {
    id: 6,
    domain: "tessera.xyz",
    tags: [],
    registrar: "Namecheap",
    dns: "注册商",
    platforms: "—",
    status: "unlisted",
    bin: null,
    expiry: "2026-08-30"
  }, {
    id: 7,
    domain: "quanta.trade",
    tags: ["金融"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom",
    status: "synced",
    bin: 6600,
    expiry: "2027-06-11"
  }, {
    id: 8,
    domain: "driftline.com",
    tags: ["portfolio-b"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom · Afternic",
    status: "pending",
    bin: 2400,
    expiry: "2026-12-24"
  }, {
    id: 9,
    domain: "helio.systems",
    tags: [],
    registrar: "Dynadot",
    dns: "注册商",
    platforms: "Afternic",
    status: "synced",
    bin: 1750,
    expiry: "2027-09-08"
  }, {
    id: 10,
    domain: "marble.finance",
    tags: ["金融"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom",
    status: "synced",
    bin: 15000,
    expiry: "2027-02-17"
  }, {
    id: 11,
    domain: "oxide.dev",
    tags: ["AI"],
    registrar: "Namecheap",
    dns: "Cloudflare",
    platforms: "Atom · SellerHub",
    status: "pending",
    bin: 5200,
    expiry: "2026-10-05"
  }, {
    id: 12,
    domain: "lantern.app",
    tags: [],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Afternic",
    status: "synced",
    bin: 3900,
    expiry: "2027-07-22"
  }, {
    id: 13,
    domain: "crest.capital",
    tags: ["金融", "portfolio-a"],
    registrar: "Spaceship",
    dns: "Cloudflare",
    platforms: "Atom · Afternic",
    status: "synced",
    bin: 9800,
    expiry: "2027-11-30"
  }, {
    id: 14,
    domain: "puresignal.com",
    tags: [],
    registrar: "Dynadot",
    dns: "注册商",
    platforms: "Atom",
    status: "synced",
    bin: 4100,
    expiry: "2026-09-02"
  }],
  groups: [{
    id: "g1",
    platform: "Atom",
    account: "主账户",
    action: "修改价格",
    count: 811,
    method: "API"
  }, {
    id: "g2",
    platform: "Afternic",
    account: "主账户",
    action: "生成 CSV",
    count: 823,
    method: "CSV + 人工上传"
  }, {
    id: "g3",
    platform: "Cloudflare",
    account: "DNS 提供商",
    action: "新增 TXT 记录",
    count: 17,
    method: "API"
  }, {
    id: "g5",
    platform: "注册商",
    account: "Spaceship · Dynadot",
    action: "变更 Nameserver",
    count: 3,
    method: "API",
    risk: "high"
  }, {
    id: "g4",
    platform: "冲突",
    account: "—",
    action: "同字段被远端修改",
    count: 6,
    method: "已排除"
  }],
  diffs: [{
    id: 1,
    domain: "vault.io",
    field: "BIN",
    oldV: "14,000.00",
    newV: "12,800.00",
    src: "批量规则 −8%",
    risk: "低",
    method: "API",
    state: "auto"
  }, {
    id: 2,
    domain: "goldrail.com",
    field: "BIN",
    oldV: "3,900.00",
    newV: "3,500.00",
    src: "批量规则 −8%",
    risk: "低",
    method: "API",
    state: "auto"
  }, {
    id: 3,
    domain: "kanban.ai",
    field: "BIN",
    oldV: "48,000.00",
    newV: "45,000.00",
    src: "手动",
    risk: "中 · 价格变化最大",
    method: "API",
    state: "auto"
  }, {
    id: 4,
    domain: "lumen.dev",
    field: "BIN",
    oldV: "1,200.00",
    newV: "980.00",
    src: "批量规则 −8%",
    risk: "低",
    method: "CSV",
    state: "manual"
  }, {
    id: 5,
    domain: "north.capital",
    field: "BIN",
    oldV: "8,900.00",
    newV: "8,200.00",
    src: "批量规则 −8%",
    risk: "低",
    method: "API",
    state: "conflict"
  }, {
    id: 6,
    domain: "driftline.com",
    field: "BIN",
    oldV: "2,600.00",
    newV: "2,400.00",
    src: "批量规则 −8%",
    risk: "低",
    method: "API",
    state: "auto"
  }, {
    id: 7,
    domain: "marble.finance",
    field: "BIN",
    oldV: "16,500.00",
    newV: "15,000.00",
    src: "手动",
    risk: "低",
    method: "API",
    state: "auto"
  }, {
    id: 8,
    domain: "oxide.dev",
    field: "BIN",
    oldV: "5,800.00",
    newV: "5,200.00",
    src: "批量规则 −8%",
    risk: "低",
    method: "CSV",
    state: "manual"
  }, {
    id: 9,
    domain: "goldrail.com",
    field: "Nameserver",
    oldV: "ns.spaceship.com",
    newV: "cloudflare.com",
    src: "迁移至 Cloudflare",
    risk: "高 · Nameserver",
    method: "API",
    state: "auto"
  }, {
    id: 10,
    domain: "quanta.trade",
    field: "Nameserver",
    oldV: "ns.spaceship.com",
    newV: "cloudflare.com",
    src: "迁移至 Cloudflare",
    risk: "高 · Nameserver",
    method: "API",
    state: "auto"
  }, {
    id: 11,
    domain: "helio.systems",
    field: "Nameserver",
    oldV: "ns.dynadot.com",
    newV: "cloudflare.com",
    src: "迁移至 Cloudflare",
    risk: "高 · Nameserver",
    method: "API",
    state: "auto"
  }],
  conflicts: [{
    id: 1,
    group: "价格",
    domain: "north.capital",
    field: "BIN",
    base: "8,900.00",
    local: "8,200.00",
    remote: "8,450.00",
    note: "远端 07-31 由 Atom 后台修改"
  }, {
    id: 2,
    group: "价格",
    domain: "driftline.com",
    field: "BIN",
    base: "2,600.00",
    local: "2,400.00",
    remote: "2,550.00",
    note: "远端 07-30 修改"
  }, {
    id: 3,
    group: "价格",
    domain: "lumen.dev",
    field: "最低报价",
    base: "400.00",
    local: "350.00",
    remote: "500.00",
    note: "远端 07-29 修改"
  }, {
    id: 4,
    group: "价格",
    domain: "tessera.xyz",
    field: "BIN",
    base: "—",
    local: "1,200.00",
    remote: "1,500.00",
    note: "远端新建 Listing"
  }, {
    id: 5,
    group: "DNS",
    domain: "kanban.ai",
    field: "TXT _atomverify",
    base: "（无）",
    local: "atom-verify=8f2a…",
    remote: "atom-verify=c91d…",
    note: "不提供无预览覆盖"
  }, {
    id: 6,
    group: "销售状态",
    domain: "vault.io",
    field: "Listing 状态",
    base: "BIN 上架",
    local: "已售 · 下架",
    remote: "BIN 上架",
    note: "Sold 状态不提供全选覆盖"
  }],
  tasks: [{
    id: 1,
    title: "Afternic · 上传价格 CSV",
    platform: "Afternic",
    account: "主账户",
    badge: "warning",
    badgeText: "等待人工",
    why: "Afternic 无价格写入 API，需在 Seller 后台上传 CSV 文件。",
    domains: 823,
    prepared: "afternic-prices-0802.csv · 已生成 14:02",
    done: "Upload History 出现本文件且状态 Processed",
    lastCheck: "14:06"
  }, {
    id: 2,
    title: "SellerHub · 已售域名下架",
    platform: "SellerHub",
    account: "主账户",
    badge: "danger",
    badgeText: "高优先级",
    why: "vault.io 已在 Atom 售出，需从 SellerHub 手工下架，避免二次销售。",
    domains: 1,
    prepared: "域名清单已复制到剪贴板",
    done: "SellerHub Listing 状态为 Removed",
    lastCheck: "13:58"
  }, {
    id: 3,
    title: "Spaceship · 会话已过期",
    platform: "Spaceship",
    account: "主账户",
    badge: "warning",
    badgeText: "需登录",
    why: "注册商会话失效，17 项 TXT 验证记录等待写入。",
    domains: 17,
    prepared: "TXT 记录值已准备",
    done: "重新登录后自动继续",
    lastCheck: "13:40"
  }, {
    id: 4,
    title: "Atom · API Key 即将到期",
    platform: "Atom",
    account: "子账户 B",
    badge: "neutral",
    badgeText: "7 天后",
    why: "API Key 于 08-09 到期，需在 Atom 控制台生成新 Key 并录入。",
    domains: 0,
    prepared: "—",
    done: "新 Key 通过健康检查",
    lastCheck: "今日 09:00"
  }],
  batchJobs: [{
    id: "b-draft",
    name: "批量改价",
    rule: "BIN −8% · 2 平台",
    target: 823,
    platform: "Atom / Afternic",
    account: "主账户",
    created: "今日 14:02",
    status: "draft",
    risk: "high",
    auto: 811,
    manual: 12,
    conflict: 6
  }, {
    id: "b-run",
    name: "变更 Nameserver → Cloudflare",
    rule: "迁移 DNS · 3 注册商",
    target: 146,
    platform: "注册商",
    account: "Spaceship · Dynadot",
    created: "今日 13:31",
    status: "running",
    risk: "high",
    progress: 62
  }, {
    id: "b-done",
    name: "上架到 Atom",
    rule: "新建 Listing · BIN",
    target: 512,
    platform: "Atom",
    account: "主账户",
    created: "今日 11:20",
    status: "done",
    risk: "low",
    progress: 100,
    result: {
      ok: 512,
      waiting: 0,
      retry: 0,
      unknown: 0,
      manual: 0,
      failed: 0
    },
    op: "OP-2026-0804-07"
  }, {
    id: "b-part",
    name: "DNS 记录同步",
    rule: "TXT 验证写入",
    target: 88,
    platform: "Cloudflare / 注册商",
    account: "DNS 提供商",
    created: "昨日 18:44",
    status: "partial",
    risk: "mid",
    progress: 100,
    result: {
      ok: 79,
      waiting: 0,
      retry: 3,
      unknown: 0,
      manual: 6,
      failed: 0
    },
    op: "OP-2026-0803-22"
  }, {
    id: "b-rb",
    name: "批量改价",
    rule: "BIN −12% · 全库",
    target: 240,
    platform: "Atom",
    account: "主账户",
    created: "昨日 09:12",
    status: "rolledback",
    risk: "low",
    progress: 100,
    rolledTo: 8204,
    op: "OP-2026-0803-05"
  }]
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/data.js", error: String((e && e.message) || e) }); }

// ui_kits/desktop/dialogs.jsx
try { (() => {
// Batch-task input windows. All composed from DS primitives (Dialog, Input, Select, Checkbox, Button…).
const {
  Dialog: GDDialog,
  Input: GDInput,
  Select: GDSel,
  Checkbox: GDCheck,
  Button: GDBtn,
  Money: GDMoney,
  Badge: GDBadge
} = window.GoodDealerDesignSystem_b5b0b6;
const fmt = n => n == null || n === "" ? "—" : Number(n).toLocaleString("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});
const num = v => {
  const n = Number(String(v).replace(/[^0-9.]/g, ""));
  return isFinite(n) ? n : 0;
};
function Seg({
  value,
  onChange,
  items
}) {
  return /*#__PURE__*/React.createElement("div", {
    style: {
      display: "inline-flex",
      background: "var(--gd-ink)",
      border: "1px solid var(--gd-line-strong)",
      borderRadius: 6,
      padding: 2,
      gap: 2
    }
  }, items.map(it => /*#__PURE__*/React.createElement("button", {
    key: it.k,
    onClick: () => onChange(it.k),
    style: {
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
    }
  }, it.label)));
}
const rowLine = {
  display: "flex",
  alignItems: "center",
  gap: 10,
  padding: "7px 0",
  borderBottom: "1px solid var(--gd-line)"
};
const label = {
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
  color: "var(--gd-text-muted)",
  fontWeight: 500
};

// ---- Batch price ---------------------------------------------------------
function BatchPriceDialog({
  open,
  domains,
  onClose,
  onSubmit
}) {
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
      domains.forEach(d => m[d.id] = d.bin != null ? String(d.bin) : "");
      setEach(m);
    }
  }, [open]);
  if (!open) return null;
  const newPrice = d => {
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
  return /*#__PURE__*/React.createElement(GDDialog, {
    open: true,
    onClose: onClose,
    title: `批量改价 · ${domains.length} 个域名`,
    width: mode === "each" ? 600 : 480,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(GDBtn, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(GDBtn, {
      variant: "primary",
      onClick: () => onSubmit(domains.length)
    }, "\u751F\u6210\u6279\u91CF\u8BA1\u5212 \xB7 ", domains.length, " \u9879"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement(Seg, {
    value: mode,
    onChange: setMode,
    items: [{
      k: "uniform",
      label: "统一价格"
    }, {
      k: "percent",
      label: "按比例调整"
    }, {
      k: "each",
      label: "逐个设置"
    }]
  }), mode === "uniform" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(GDInput, {
    size: "md",
    mono: true,
    prefix: "$",
    placeholder: "0.00",
    value: uniform,
    onChange: e => setUniform(e.target.value),
    style: {
      width: 180
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u5E94\u7528\u5230\u5168\u90E8 ", /*#__PURE__*/React.createElement("b", {
    style: {
      fontFamily: "var(--font-mono)"
    }
  }, domains.length), " \u4E2A\u57DF\u540D\u7684 BIN")), mode === "percent" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(Seg, {
    value: dir,
    onChange: setDir,
    items: [{
      k: "down",
      label: "下调"
    }, {
      k: "up",
      label: "上调"
    }]
  }), /*#__PURE__*/React.createElement(GDInput, {
    size: "md",
    mono: true,
    suffix: "%",
    value: pct,
    onChange: e => setPct(e.target.value),
    style: {
      width: 110
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u793A\u4F8B ", fmt(domains[0] && domains[0].bin), " \u2192 ", /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-gold)",
      fontFamily: "var(--font-mono)"
    }
  }, fmt(domains[0] && newPrice(domains[0]))))), mode === "each" && /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u7EDF\u4E00\u586B\u5165"), /*#__PURE__*/React.createElement(GDInput, {
    size: "sm",
    mono: true,
    prefix: "$",
    placeholder: "0.00",
    value: master,
    onChange: e => setMaster(e.target.value),
    style: {
      width: 140
    }
  }), /*#__PURE__*/React.createElement(GDBtn, {
    size: "sm",
    onClick: () => {
      const m = {};
      domains.forEach(d => m[d.id] = master);
      setEach(m);
    }
  }, "\u5E94\u7528\u5230\u5168\u90E8")), /*#__PURE__*/React.createElement("div", {
    style: {
      maxHeight: 250,
      overflow: "auto",
      border: "1px solid var(--gd-line)",
      borderRadius: 7
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      ...rowLine,
      padding: "8px 12px",
      position: "sticky",
      top: 0,
      background: "var(--gd-panel)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...label,
      flex: 1
    }
  }, "\u57DF\u540D"), /*#__PURE__*/React.createElement("span", {
    style: {
      ...label,
      width: 120,
      textAlign: "right"
    }
  }, "\u5F53\u524D"), /*#__PURE__*/React.createElement("span", {
    style: {
      ...label,
      width: 150,
      textAlign: "right"
    }
  }, "\u65B0 BIN")), domains.map(d => /*#__PURE__*/React.createElement("div", {
    key: d.id,
    style: {
      ...rowLine,
      padding: "7px 12px"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      flex: 1,
      fontFamily: "var(--font-mono)",
      fontSize: 12
    }
  }, d.domain), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 120,
      textAlign: "right",
      fontFamily: "var(--font-mono)",
      fontSize: 12,
      color: "var(--gd-text-faint)"
    }
  }, fmt(d.bin)), /*#__PURE__*/React.createElement("span", {
    style: {
      width: 150,
      display: "flex",
      justifyContent: "flex-end"
    }
  }, /*#__PURE__*/React.createElement(GDInput, {
    size: "sm",
    mono: true,
    prefix: "$",
    value: each[d.id] ?? "",
    onChange: e => setEach(x => ({
      ...x,
      [d.id]: e.target.value
    })),
    style: {
      width: 140
    }
  })))))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      borderTop: "1px solid var(--gd-line)",
      paddingTop: 11,
      fontSize: 12
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-muted)"
    }
  }, "\u9009\u4E2D\u7EC4\u5408\u4F30\u503C"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-text-faint)"
    }
  }, "$", fmt(oldSum)), /*#__PURE__*/React.createElement("span", {
    style: {
      color: "var(--gd-text-faint)"
    }
  }, "\u2192"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontFamily: "var(--font-mono)",
      color: "var(--gd-gold)"
    }
  }, "$", fmt(newSum)), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontFamily: "var(--font-mono)",
      color: delta < 0 ? "var(--gd-danger)" : delta > 0 ? "var(--gd-success)" : "var(--gd-text-faint)"
    }
  }, delta === 0 ? "±0" : `${delta < 0 ? "−" : "+"}$${fmt(Math.abs(delta))}`)), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u751F\u6210\u8BA1\u5212\u540E\u8FDB\u5165\u6279\u91CF\u5DEE\u5F02\u9884\u89C8\uFF1A\u9010\u9879\u786E\u8BA4\u6267\u884C\u65B9\u5F0F\u3001\u98CE\u9669\u4E0E\u51B2\u7A81\uFF0C\u518D\u63D0\u4EA4\u3002")));
}

// ---- Nameserver change (handled by the REGISTRAR; high risk) -------------
function BatchNsDialog({
  open,
  domains,
  onClose,
  onApply
}) {
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
  return /*#__PURE__*/React.createElement(GDDialog, {
    open: true,
    onClose: onClose,
    title: `变更 Nameserver · ${domains.length} 个域名`,
    width: 520,
    danger: true,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(GDBtn, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(GDBtn, {
      variant: "danger",
      disabled: !ack || mode === "custom" && !ns1,
      onClick: () => onApply({
        mode,
        applied
      })
    }, "\u63D0\u4EA4 \xB7 ", domains.length, " \u9879"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...label,
      color: "var(--gd-text-faint)"
    }
  }, "\u5904\u7406\u5E73\u53F0"), /*#__PURE__*/React.createElement("span", null, "\u6CE8\u518C\u5546 \xB7 \u53D8\u66F4\u57DF\u540D\u7684 Nameserver \u59D4\u6D3E")), /*#__PURE__*/React.createElement(Seg, {
    value: mode,
    onChange: setMode,
    items: [{
      k: "platform",
      label: "指向销售平台 NS · 推荐"
    }, {
      k: "custom",
      label: "自定义 Nameserver"
    }]
  }), mode === "platform" ? /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, "\u5728\u6CE8\u518C\u5546\u5904\u5C06 Nameserver \u7EDF\u4E00\u6307\u5411\u6240\u9009\u76EE\u6807\uFF08\u6539\u53D8\u7684\u662F NS \u59D4\u6D3E\uFF0C\u800C\u975E\u5177\u4F53\u8BB0\u5F55\uFF09\u3002"), /*#__PURE__*/React.createElement("label", {
    className: "gd-field",
    style: {
      maxWidth: 280
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: label
  }, "\u76EE\u6807 Nameserver"), /*#__PURE__*/React.createElement(GDSel, {
    size: "md",
    options: ["销售平台托管 NS", "Cloudflare NS", "注册商默认 NS"],
    value: target,
    onChange: e => setTarget(e.target.value)
  }))) : /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10
    }
  }, /*#__PURE__*/React.createElement(GDInput, {
    label: "NS 1",
    size: "md",
    mono: true,
    placeholder: "ns1.example.com",
    value: ns1,
    onChange: e => setNs1(e.target.value),
    style: {
      flex: 1
    }
  }), /*#__PURE__*/React.createElement(GDInput, {
    label: "NS 2",
    size: "md",
    mono: true,
    placeholder: "ns2.example.com",
    value: ns2,
    onChange: e => setNs2(e.target.value),
    style: {
      flex: 1
    }
  })), /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-danger)",
      background: "var(--gd-danger-tint)",
      borderRadius: 7,
      padding: "11px 13px",
      display: "flex",
      flexDirection: "column",
      gap: 9
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
    size: 15,
    style: {
      color: "var(--gd-danger)",
      flex: "none"
    }
  }), /*#__PURE__*/React.createElement("b", {
    style: {
      color: "var(--gd-danger)",
      fontSize: 13
    }
  }, "\u9AD8\u98CE\u9669 \xB7 Nameserver \u53D8\u66F4"), /*#__PURE__*/React.createElement("span", {
    style: {
      marginLeft: "auto",
      fontSize: 11,
      color: "var(--gd-text-muted)"
    }
  }, "\u53EF\u56DE\u6EDA")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text)",
      lineHeight: 1.5
    }
  }, "\u5207\u6362 Nameserver \u4F1A\u5C06 DNS \u6743\u5A01\u6574\u4F53\u79FB\u4EA4\u7ED9\u65B0 NS\uFF1A\u65E7\u63D0\u4F9B\u5546\u7684\u5168\u90E8\u8BB0\u5F55\uFF08A/MX/TXT\uFF09\u7ACB\u5373\u5931\u6548\uFF0C\u89E3\u6790\u4E0E\u90AE\u4EF6\u5728\u4F20\u64AD\u5B8C\u6210\u524D\u53EF\u80FD\u4E2D\u65AD\uFF08\u7EA6 5\u201330 \u5206\u949F\uFF09\u3002\u56DE\u6EDA\u540C\u6837\u9700\u8981\u4F20\u64AD\u65F6\u95F4\u3002"), /*#__PURE__*/React.createElement("div", {
    style: {
      borderTop: "1px solid rgba(229,115,95,0.24)",
      paddingTop: 9
    }
  }, /*#__PURE__*/React.createElement(GDCheck, {
    checked: ack,
    onChange: () => setAck(a => !a),
    label: `我已理解后果，确认在注册商处对这 ${domains.length} 个域名变更 Nameserver`
  })))));
}

// ---- DNS records (handled by the DNS PROVIDER; per-record) ---------------
function BatchRecordsDialog({
  open,
  domains,
  onClose,
  onApply
}) {
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
  const ph = {
    A: "185.199.108.153",
    AAAA: "2606:50c0:8000::153",
    CNAME: "target.example.com",
    TXT: "atom-verify=8f2a…",
    MX: "10 mail.example.com"
  }[rtype] || "";
  const routing = ["A", "AAAA", "CNAME", "MX"].includes(rtype);
  return /*#__PURE__*/React.createElement(GDDialog, {
    open: true,
    onClose: onClose,
    title: `修改 DNS 记录 · ${domains.length} 个域名`,
    width: 560,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(GDBtn, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(GDBtn, {
      variant: "primary",
      disabled: !value,
      onClick: () => onApply({
        rtype,
        host,
        value,
        ttl
      })
    }, "\u63D0\u4EA4 \xB7 ", domains.length, " \u9879"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--gd-text-muted)"
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: {
      ...label,
      color: "var(--gd-text-faint)"
    }
  }, "\u5904\u7406\u5E73\u53F0"), /*#__PURE__*/React.createElement("span", null, "DNS \u63D0\u4F9B\u5546 \xB7 \u6309\u5404\u57DF\u540D\u5F53\u524D\u63D0\u4F9B\u5546\u5206\u522B\u4E0B\u53D1\uFF08Nameserver \u4E0D\u53D8\uFF09")), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 10,
      alignItems: "flex-end"
    }
  }, /*#__PURE__*/React.createElement("label", {
    className: "gd-field",
    style: {
      width: 110
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: label
  }, "\u7C7B\u578B"), /*#__PURE__*/React.createElement(GDSel, {
    size: "md",
    options: TYPES,
    value: rtype,
    onChange: e => setRtype(e.target.value)
  })), /*#__PURE__*/React.createElement(GDInput, {
    label: "\u4E3B\u673A",
    size: "md",
    mono: true,
    placeholder: "@ \u6216 www",
    value: host,
    onChange: e => setHost(e.target.value),
    style: {
      width: 160
    }
  }), /*#__PURE__*/React.createElement("label", {
    className: "gd-field",
    style: {
      width: 110
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: label
  }, "TTL"), /*#__PURE__*/React.createElement(GDSel, {
    size: "md",
    options: ["Auto", "300", "3600", "86400"],
    value: ttl,
    onChange: e => setTtl(e.target.value)
  }))), /*#__PURE__*/React.createElement(GDInput, {
    label: `值（${rtype}）`,
    size: "md",
    mono: true,
    placeholder: ph,
    value: value,
    onChange: e => setValue(e.target.value)
  }), routing && /*#__PURE__*/React.createElement("div", {
    style: {
      border: "1px solid var(--gd-warning)",
      background: "var(--gd-warning-tint)",
      borderRadius: 7,
      padding: "9px 12px",
      display: "flex",
      alignItems: "center",
      gap: 8,
      fontSize: 12,
      color: "var(--gd-text)"
    }
  }, /*#__PURE__*/React.createElement(I.AlertTriangle, {
    size: 14,
    style: {
      color: "var(--gd-warning)",
      flex: "none"
    }
  }), "\u9700\u7559\u610F \xB7 \u4FEE\u6539 ", rtype, " \u8BB0\u5F55\u4F1A\u5F71\u54CD\u89E3\u6790", rtype === "MX" ? "与邮件收发" : "", "\uFF1BDNS \u63D0\u4F9B\u5546\u5373\u65F6\u4E0B\u53D1\uFF0C\u65E0 Nameserver \u4F20\u64AD\u7B49\u5F85\u3002"), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u4E0E Nameserver \u53D8\u66F4\u4E0D\u540C\uFF1A\u8BB0\u5F55\u7531 DNS \u63D0\u4F9B\u5546\u5373\u65F6\u751F\u6548\uFF0C\u4E0D\u6539\u53D8\u57DF\u540D\u7684 NS \u59D4\u6D3E\uFF1B\u53EF\u5B89\u5168\u91CD\u8BD5\u3002")));
}

// ---- List (上架) ---------------------------------------------------------
function ListDialog({
  open,
  domains,
  onClose,
  onApply
}) {
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
  const toggle = p => setPlats(x => x.includes(p) ? x.filter(i => i !== p) : [...x, p]);
  return /*#__PURE__*/React.createElement(GDDialog, {
    open: true,
    onClose: onClose,
    title: `上架 · ${domains.length} 个域名`,
    width: 480,
    footer: /*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement(GDBtn, {
      onClick: onClose
    }, "\u53D6\u6D88"), /*#__PURE__*/React.createElement(GDBtn, {
      variant: "primary",
      disabled: plats.length === 0,
      onClick: () => onApply({
        platforms: plats,
        price: price === "" ? null : num(price)
      })
    }, "\u4E0A\u67B6 \xB7 ", domains.length, " \u9879"))
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 14
    }
  }, /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, /*#__PURE__*/React.createElement("span", {
    style: label
  }, "\u4E0A\u67B6\u5E73\u53F0"), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      gap: 8
    }
  }, ALL.map(p => {
    const on = plats.includes(p);
    return /*#__PURE__*/React.createElement("button", {
      key: p,
      onClick: () => toggle(p),
      style: {
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
      }
    }, p);
  }))), /*#__PURE__*/React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 12
    }
  }, /*#__PURE__*/React.createElement(GDInput, {
    label: "\u7EDF\u4E00 BIN\uFF08\u53EF\u9009\uFF09",
    size: "md",
    mono: true,
    prefix: "$",
    placeholder: "0.00",
    value: price,
    onChange: e => setPrice(e.target.value),
    style: {
      width: 200
    }
  }), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 12,
      color: "var(--gd-text-muted)",
      alignSelf: "flex-end",
      paddingBottom: 7
    }
  }, "\u7559\u7A7A\u5219\u6CBF\u7528\u5404\u57DF\u540D\u5F53\u524D BIN\uFF0C\u53EF\u4E0A\u67B6\u540E\u5355\u72EC\u8C03\u6574")), /*#__PURE__*/React.createElement("span", {
    style: {
      fontSize: 11,
      color: "var(--gd-text-faint)"
    }
  }, "\u4E0A\u67B6\u4E3A\u53EF\u5B89\u5168\u91CD\u8BD5\u64CD\u4F5C\uFF1B\u7ED3\u679C\u4EE5\u5E73\u53F0 Listing \u72B6\u6001\u4E3A\u51C6\uFF0C\u5199\u5165\u672A\u540C\u6B65\u4FEE\u6539\u5E76\u5728\u4E0B\u6B21\u540C\u6B65\u63D0\u4EA4\u3002")));
}
window.GDDialogs = {
  BatchPriceDialog,
  BatchNsDialog,
  BatchRecordsDialog,
  ListDialog
};
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/dialogs.jsx", error: String((e && e.message) || e) }); }

// ui_kits/desktop/icons.jsx
try { (() => {
function _extends() { return _extends = Object.assign ? Object.assign.bind() : function (n) { for (var e = 1; e < arguments.length; e++) { var t = arguments[e]; for (var r in t) ({}).hasOwnProperty.call(t, r) && (n[r] = t[r]); } return n; }, _extends.apply(null, arguments); }
const mkIcon = children => ({
  size = 15,
  style,
  ...p
}) => /*#__PURE__*/React.createElement("svg", _extends({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: "1.7",
  strokeLinecap: "round",
  strokeLinejoin: "round",
  style: style
}, p), children);
const GDI = {
  Globe: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "10"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M2 12h20"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"
  }))),
  Coins: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "8",
    cy: "8",
    r: "6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18.09 10.37A6 6 0 1 1 10.34 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M7 6h1v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m16.71 13.88.7.71-2.82 2.82"
  }))),
  Shield: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1 1 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m9 12 2 2 4-4"
  }))),
  ListChecks: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "m3 17 2 2 4-4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m3 7 2 2 4-4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13 6h8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13 12h8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M13 18h8"
  }))),
  AlertTriangle: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 9v4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 17h.01"
  }))),
  Inbox: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("polyline", {
    points: "22 12 16 12 14 15 10 15 8 12 2 12"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M5.45 5.11 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z"
  }))),
  History: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 3v5h5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3.05 13A9 9 0 1 0 6 5.3L3 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M12 7v5l4 2"
  }))),
  Settings: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"
  }), /*#__PURE__*/React.createElement("circle", {
    cx: "12",
    cy: "12",
    r: "3"
  }))),
  Search: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("circle", {
    cx: "11",
    cy: "11",
    r: "7"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m20 20-3.5-3.5"
  }))),
  RefreshCw: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M3 12a9 9 0 0 1 15.6-6.2L21 8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 3v5h-5"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M21 12a9 9 0 0 1-15.6 6.2L3 16"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M3 21v-5h5"
  }))),
  Upload: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"
  }), /*#__PURE__*/React.createElement("polyline", {
    points: "17 8 12 3 7 8"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "3",
    x2: "12",
    y2: "15"
  }))),
  X: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M18 6 6 18"
  }), /*#__PURE__*/React.createElement("path", {
    d: "m6 6 12 12"
  }))),
  ChevronRight: mkIcon(/*#__PURE__*/React.createElement("path", {
    d: "m9 18 6-6-6-6"
  })),
  ChevronLeft: mkIcon(/*#__PURE__*/React.createElement("path", {
    d: "m15 18-6-6 6-6"
  })),
  ExternalLink: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M15 3h6v6"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 14 21 3"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"
  }))),
  Monitor: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "2",
    y: "3",
    width: "20",
    height: "14",
    rx: "2"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "8",
    y1: "21",
    x2: "16",
    y2: "21"
  }), /*#__PURE__*/React.createElement("line", {
    x1: "12",
    y1: "17",
    x2: "12",
    y2: "21"
  }))),
  Pause: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("rect", {
    x: "14",
    y: "4",
    width: "4",
    height: "16",
    rx: "1"
  }), /*#__PURE__*/React.createElement("rect", {
    x: "6",
    y: "4",
    width: "4",
    height: "16",
    rx: "1"
  }))),
  Play: mkIcon(/*#__PURE__*/React.createElement("polygon", {
    points: "6 3 20 12 6 21 6 3"
  })),
  FileText: mkIcon(/*#__PURE__*/React.createElement(React.Fragment, null, /*#__PURE__*/React.createElement("path", {
    d: "M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M14 2v4a2 2 0 0 0 2 2h4"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M10 9H8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 13H8"
  }), /*#__PURE__*/React.createElement("path", {
    d: "M16 17H8"
  }))),
  Check: mkIcon(/*#__PURE__*/React.createElement("path", {
    d: "M20 6 9 17l-5-5"
  }))
};
window.GDI = GDI;
})(); } catch (e) { __ds_ns.__errors.push({ path: "ui_kits/desktop/icons.jsx", error: String((e && e.message) || e) }); }

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

})();
