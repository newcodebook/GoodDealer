import type { CSSProperties, ReactNode } from "react";

import "./tag.css";
export interface TagProps { color?: string; onRemove?: () => void; removeLabel?: string; children?: ReactNode; style?: CSSProperties }
export function Tag({ color, children, onRemove, removeLabel = "Remove", style }: TagProps) { return <span className="gd-tag" style={style}>{color ? <span className="gd-tag-dot" style={{ background: color }} /> : null}{children}{onRemove ? <button type="button" className="gd-tag-x" onClick={onRemove} aria-label={removeLabel}>×</button> : null}</span>; }
