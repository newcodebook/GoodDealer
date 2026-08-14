import type { ReactNode } from "react";

import "./tabs.css";

export interface TabItem {
  key: string;
  label: ReactNode;
  /** Mono count pill. */
  count?: number;
}

export interface TabsProps {
  items: TabItem[];
  active: string;
  onChange?: (key: string) => void;
}

export function Tabs({ items = [], active, onChange }: TabsProps) {
  return (
    <div className="gd-tabs" role="tablist">
      {items.map((item) => (
        <button
          key={item.key}
          role="tab"
          aria-selected={active === item.key}
          className={active === item.key ? "gd-tab gd-tab--active" : "gd-tab"}
          onClick={() => onChange && onChange(item.key)}
        >
          {item.label}
          {item.count != null && <span className="gd-tab-count">{item.count}</span>}
        </button>
      ))}
    </div>
  );
}
