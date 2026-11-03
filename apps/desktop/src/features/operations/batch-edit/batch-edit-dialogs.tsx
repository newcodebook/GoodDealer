import { formatNumber, getPresentationCopy, type Locale } from "@gooddealer/i18n";
import {
  AlertTriangleIcon,
  Button,
  Checkbox,
  Dialog,
  Input,
  SegmentedControl,
  Select,
} from "@gooddealer/ui";
import { useState } from "react";

import { formatAssetMoney, parseTargetPriceInput } from "../../portfolio";
import {
  applyPriceRule,
  dnsRecordTtls,
  dnsRecordTypes,
  isNameserverHost,
  isRecordHost,
  parsePercentInput,
  recordRoutingImpact,
  type BatchEditTarget,
  type BatchPriceRule,
  type DnsRecordChange,
  type DnsRecordTtl,
  type DnsRecordType,
  type ListingChange,
  type NameserverChange,
  type NameserverTarget,
} from "./batch-edit-contract";
import "./batch-edit.css";

function fill(template: string, values: Readonly<Record<string, string>>): string {
  return template.replace(/\{(\w+)\}/gu, (match, key: string) => values[key] ?? match);
}

interface DialogBaseProps {
  readonly locale: Locale;
  readonly open: boolean;
  readonly targets: readonly BatchEditTarget[];
  readonly onClose: () => void;
}

function sumAmounts(amounts: readonly (string | null)[]): number {
  return amounts.reduce((sum, amount) => sum + (amount === null ? 0 : Number(amount)), 0);
}

/** Batch reprice: uniform / percent / per-domain rules that produce a batch plan, never a direct write. */
export function BatchPriceDialog({ locale, open, targets, onClose, onSubmit }: DialogBaseProps & { readonly onSubmit: (rule: BatchPriceRule) => void }) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [mode, setMode] = useState<BatchPriceRule["mode"]>("uniform");
  const [uniform, setUniform] = useState("");
  const [direction, setDirection] = useState<"decrease" | "increase">("decrease");
  const [percent, setPercent] = useState("8");
  const [master, setMaster] = useState("");
  const [each, setEach] = useState<Readonly<Record<string, string>>>(() => Object.fromEntries(targets.map((target) => [target.id, target.targetPrice?.amount ?? ""])));
  if (!open) return null;

  const money = (value: number) => formatAssetMoney(locale, value.toFixed(2), "USD");
  const rule: BatchPriceRule | null = mode === "uniform"
    ? (() => { const amount = parseTargetPriceInput(uniform); return amount === null ? null : { mode, amount }; })()
    : mode === "percent"
      ? (() => { const value = parsePercentInput(percent); return value === null ? null : { mode, direction, percent: value }; })()
      : (() => {
        const amounts: Record<string, string> = {};
        for (const target of targets) {
          const raw = each[target.id] ?? "";
          if (raw === "") continue;
          const amount = parseTargetPriceInput(raw);
          if (amount === null) return null;
          amounts[target.id] = amount;
        }
        return { mode, amounts };
      })();
  const before = sumAmounts(targets.map((target) => target.targetPrice?.amount ?? null));
  const after = rule === null ? before : sumAmounts(targets.map((target) => applyPriceRule(target, rule)));
  const delta = after - before;
  const sample = targets[0];

  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(copy.priceDialogTitle, { count: formatNumber(locale, targets.length) })}
      width={mode === "each" ? 600 : 480}
      footer={(
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant="primary" disabled={rule === null} onClick={() => { if (rule !== null) onSubmit(rule); }}>
            {fill(copy.createPlanCount, { count: formatNumber(locale, targets.length) })}
          </Button>
        </>
      )}
    >
      <div className="batch-edit">
        <SegmentedControl
          label={copy.priceDialogTitle}
          value={mode}
          onChange={setMode}
          items={[{ value: "uniform", label: copy.uniformPrice }, { value: "percent", label: copy.percentAdjust }, { value: "each", label: copy.perDomain }]}
        />
        {mode === "uniform" ? (
          <div className="batch-edit-row">
            <Input mono prefix="$" placeholder="0.00" aria-label={copy.uniformPrice} value={uniform} onChange={(event) => setUniform(event.currentTarget.value)} {...(uniform !== "" && rule === null ? { error: copy.invalidAmount } : {})} />
            <span className="gd-t-body-2">{fill(copy.uniformHint, { count: formatNumber(locale, targets.length) })}</span>
          </div>
        ) : null}
        {mode === "percent" ? (
          <div className="batch-edit-row">
            <SegmentedControl label={copy.percentAdjust} value={direction} onChange={setDirection} items={[{ value: "decrease", label: copy.decrease }, { value: "increase", label: copy.increase }]} />
            <Input mono suffix="%" aria-label={copy.percentAdjust} value={percent} onChange={(event) => setPercent(event.currentTarget.value)} {...(rule === null ? { error: copy.invalidAmount } : {})} />
            {sample === undefined || sample.targetPrice === null || rule === null ? null : (
              <span className="gd-t-body-2">
                {copy.example} {money(Number(sample.targetPrice.amount))} → <span className="batch-edit-gold">{money(Number(applyPriceRule(sample, rule) ?? 0))}</span>
              </span>
            )}
          </div>
        ) : null}
        {mode === "each" ? (
          <div className="batch-edit-each">
            <div className="batch-edit-row">
              <span className="gd-t-body-2">{copy.fillAll}</span>
              <Input size="sm" mono prefix="$" placeholder="0.00" aria-label={copy.fillAll} value={master} onChange={(event) => setMaster(event.currentTarget.value)} />
              <Button size="sm" onClick={() => setEach(Object.fromEntries(targets.map((target) => [target.id, master])))}>{copy.applyToAll}</Button>
            </div>
            <div className="batch-edit-table" role="table">
              <div className="batch-edit-table-head" role="row">
                <span className="gd-t-label">{copy.domain}</span>
                <span className="gd-t-label">{copy.currentValue}</span>
                <span className="gd-t-label">{copy.newBin}</span>
              </div>
              {targets.map((target) => (
                <div key={target.id} className="batch-edit-table-row" role="row">
                  <span className="batch-edit-mono">{target.domain}</span>
                  <span className="batch-edit-mono batch-edit-faint">{target.targetPrice === null ? "—" : money(Number(target.targetPrice.amount))}</span>
                  <Input
                    size="sm"
                    mono
                    prefix="$"
                    aria-label={`${copy.newBin} · ${target.domain}`}
                    value={each[target.id] ?? ""}
                    onChange={(event) => { const value = event.currentTarget.value; setEach((current) => ({ ...current, [target.id]: value })); }}
                  />
                </div>
              ))}
            </div>
          </div>
        ) : null}
        <div className="batch-edit-total">
          <span className="gd-t-body-2">{copy.selectedValue}</span>
          <span className="batch-edit-mono batch-edit-faint">{money(before)}</span>
          <span className="batch-edit-faint">→</span>
          <span className="batch-edit-mono batch-edit-gold">{money(after)}</span>
          <span className={`batch-edit-mono batch-edit-delta${delta < 0 ? " batch-edit-delta--down" : delta > 0 ? " batch-edit-delta--up" : ""}`}>
            {delta === 0 ? "±0" : `${delta < 0 ? "−" : "+"}${money(Math.abs(delta))}`}
          </span>
        </div>
        <span className="gd-t-meta">{copy.planHint}</span>
      </div>
    </Dialog>
  );
}

/** Nameserver change: registrar-handled, always the high-risk tier with an acknowledgement gate. */
export function NameserverDialog({ locale, open, targets, onClose, onSubmit }: DialogBaseProps & { readonly onSubmit: (change: NameserverChange) => void }) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [mode, setMode] = useState<NameserverChange["mode"]>("platform");
  const [target, setTarget] = useState<NameserverTarget>("marketplace");
  const [primary, setPrimary] = useState("");
  const [secondary, setSecondary] = useState("");
  const [acknowledged, setAcknowledged] = useState(false);
  if (!open) return null;

  const count = formatNumber(locale, targets.length);
  const customValid = isNameserverHost(primary) && (secondary.trim() === "" || isNameserverHost(secondary));
  const change: NameserverChange | null = mode === "platform"
    ? { mode, target }
    : customValid ? { mode, nameservers: [primary.trim().toLowerCase(), ...(secondary.trim() === "" ? [] : [secondary.trim().toLowerCase()])] } : null;
  const nameserverTargets: readonly { readonly value: NameserverTarget; readonly label: string }[] = [
    { value: "marketplace", label: copy.nsTargetMarketplace },
    { value: "cloudflare", label: copy.nsTargetCloudflare },
    { value: "registrar", label: copy.nsTargetRegistrar },
  ];

  return (
    <Dialog
      open
      danger
      onClose={onClose}
      title={fill(copy.nsDialogTitle, { count })}
      width={520}
      footer={(
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant="danger" disabled={!acknowledged || change === null} onClick={() => { if (change !== null) onSubmit(change); }}>
            {fill(copy.submitN, { count })}
          </Button>
        </>
      )}
    >
      <div className="batch-edit">
        <div className="batch-edit-handled"><span className="gd-t-label">{copy.handledBy}</span><span className="gd-t-body-2">{copy.nsHandledBy}</span></div>
        <SegmentedControl label={copy.nsDialogTitle} value={mode} onChange={setMode} items={[{ value: "platform", label: copy.nsPlatform }, { value: "custom", label: copy.nsCustom }]} />
        {mode === "platform" ? (
          <div className="batch-edit-stack">
            <span className="gd-t-body-2">{copy.nsPlatformHint}</span>
            <Select
              label={copy.targetNameserver}
              options={nameserverTargets.map((item) => ({ value: item.value, label: item.label }))}
              value={target}
              onChange={(event) => { const next = nameserverTargets.find((item) => item.value === event.currentTarget.value); if (next !== undefined) setTarget(next.value); }}
            />
          </div>
        ) : (
          <div className="batch-edit-row batch-edit-row--fill">
            <Input label="NS 1" mono placeholder="ns1.example.com" value={primary} onChange={(event) => setPrimary(event.currentTarget.value)} {...(primary !== "" && !isNameserverHost(primary) ? { error: copy.invalidNameserver } : {})} />
            <Input label="NS 2" mono placeholder="ns2.example.com" value={secondary} onChange={(event) => setSecondary(event.currentTarget.value)} {...(secondary !== "" && !isNameserverHost(secondary) ? { error: copy.invalidNameserver } : {})} />
          </div>
        )}
        <div className="batch-edit-risk">
          <div className="batch-edit-risk-head">
            <AlertTriangleIcon size={15} />
            <b>{copy.nsRiskTitle}</b>
            <span>{copy.rollbackAvailable}</span>
          </div>
          <span className="batch-edit-risk-body">{copy.nsRiskBody}</span>
          <div className="batch-edit-risk-ack">
            <Checkbox checked={acknowledged} onChange={() => setAcknowledged((value) => !value)} label={fill(copy.nsAcknowledge, { count })} />
          </div>
        </div>
      </div>
    </Dialog>
  );
}

const recordPlaceholders: Readonly<Record<DnsRecordType, string>> = {
  A: "185.199.108.153",
  AAAA: "2606:50c0:8000::153",
  CNAME: "target.example.com",
  TXT: "atom-verify=8f2a…",
  MX: "10 mail.example.com",
};

/** DNS record edit: provider-handled, immediate, and the "caution" tier only when routing changes. */
export function DnsRecordDialog({ locale, open, targets, onClose, onSubmit }: DialogBaseProps & { readonly onSubmit: (change: DnsRecordChange) => void }) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [type, setType] = useState<DnsRecordType>("TXT");
  const [host, setHost] = useState("@");
  const [value, setValue] = useState("");
  const [ttl, setTtl] = useState<DnsRecordTtl>("Auto");
  if (!open) return null;

  const count = formatNumber(locale, targets.length);
  const impact = recordRoutingImpact(type);
  const hostValid = isRecordHost(host);
  const valid = hostValid && value.trim() !== "" && value.length <= 2_048;

  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(copy.recordsDialogTitle, { count })}
      width={560}
      footer={(
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant="primary" disabled={!valid} onClick={() => onSubmit({ type, host: host.trim().toLowerCase(), value: value.trim(), ttl })}>{fill(copy.submitN, { count })}</Button>
        </>
      )}
    >
      <div className="batch-edit">
        <div className="batch-edit-handled"><span className="gd-t-label">{copy.handledBy}</span><span className="gd-t-body-2">{copy.recordsHandledBy}</span></div>
        <div className="batch-edit-row batch-edit-row--end">
          <Select
            label={copy.recordType}
            options={dnsRecordTypes.map((item) => item)}
            value={type}
            onChange={(event) => { const next = dnsRecordTypes.find((item) => item === event.currentTarget.value); if (next !== undefined) setType(next); }}
          />
          <Input label={copy.recordHost} mono placeholder={copy.recordHostPlaceholder} value={host} onChange={(event) => setHost(event.currentTarget.value)} {...(hostValid ? {} : { error: copy.invalidRecordHost })} />
          <Select
            label={copy.recordTtl}
            options={dnsRecordTtls.map((item) => item)}
            value={ttl}
            onChange={(event) => { const next = dnsRecordTtls.find((item) => item === event.currentTarget.value); if (next !== undefined) setTtl(next); }}
          />
        </div>
        <Input label={fill(copy.recordValue, { type })} mono placeholder={recordPlaceholders[type]} value={value} onChange={(event) => setValue(event.currentTarget.value)} />
        {impact === null ? null : (
          <div className="batch-edit-caution">
            <AlertTriangleIcon size={14} />
            {impact === "mail" ? copy.recordMailWarning : fill(copy.recordRoutingWarning, { type })}
          </div>
        )}
        <span className="gd-t-meta">{copy.recordsNote}</span>
      </div>
    </Dialog>
  );
}

/** Listing: choose platforms and an optional uniform BIN; safe to retry. */
export function ListingDialog({ locale, open, targets, platforms, onClose, onSubmit }: DialogBaseProps & {
  readonly platforms: readonly string[];
  readonly onSubmit: (change: ListingChange) => void;
}) {
  const copy = getPresentationCopy(locale, "batchOperation");
  const [selected, setSelected] = useState<readonly string[]>(() => platforms.slice(0, 1));
  const [price, setPrice] = useState("");
  if (!open) return null;

  const count = formatNumber(locale, targets.length);
  const amount = price.trim() === "" ? null : parseTargetPriceInput(price);
  const priceInvalid = price.trim() !== "" && amount === null;
  const toggle = (platform: string) => setSelected((current) => current.includes(platform) ? current.filter((item) => item !== platform) : [...current, platform]);

  return (
    <Dialog
      open
      onClose={onClose}
      title={fill(copy.listDialogTitle, { count })}
      width={480}
      footer={(
        <>
          <Button onClick={onClose}>{copy.cancel}</Button>
          <Button variant="primary" disabled={selected.length === 0 || priceInvalid} onClick={() => onSubmit({ platforms: selected, price: amount })}>{fill(copy.listCount, { count })}</Button>
        </>
      )}
    >
      <div className="batch-edit">
        <div className="batch-edit-stack">
          <span className="gd-t-label">{copy.listPlatforms}</span>
          <div className="batch-edit-platforms" role="group" aria-label={copy.listPlatforms}>
            {platforms.map((platform) => (
              <button key={platform} type="button" aria-pressed={selected.includes(platform)} onClick={() => toggle(platform)}>{platform}</button>
            ))}
          </div>
        </div>
        <div className="batch-edit-row batch-edit-row--end">
          <Input label={copy.uniformBin} mono prefix="$" placeholder="0.00" value={price} onChange={(event) => setPrice(event.currentTarget.value)} {...(priceInvalid ? { error: copy.invalidAmount } : {})} />
          <span className="gd-t-body-2 batch-edit-hint">{copy.uniformBinHint}</span>
        </div>
        <span className="gd-t-meta">{copy.listNote}</span>
      </div>
    </Dialog>
  );
}

/** Batch delist: danger tier, exact count in the action, safe to retry. */
export function DelistDialog({ locale, open, targets, onClose, onSubmit }: DialogBaseProps & { readonly onSubmit: () => void }) {
  const copy = getPresentationCopy(locale, "batchOperation");
  if (!open) return null;
  const count = formatNumber(locale, targets.length);
  return (
    <Dialog
      open
      danger
      onClose={onClose}
      title={fill(copy.delistTitle, { count })}
      width={440}
      footer={<><Button onClick={onClose}>{copy.cancel}</Button><Button variant="danger" onClick={onSubmit}>{fill(copy.delistCount, { count })}</Button></>}
    >
      <p className="gd-t-body">{fill(copy.delistBody, { count })}</p>
    </Dialog>
  );
}
