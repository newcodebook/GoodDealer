import type { CSSProperties, ReactNode } from "react";
import "./banner.css";
export type BannerTone = "sync" | "gold" | "success" | "warning" | "danger" | "neutral";
export interface BannerProps { tone?: BannerTone; icon?: ReactNode; title?: ReactNode; actions?: ReactNode; children?: ReactNode; style?: CSSProperties; role?: "status" | "alert" }
export function Banner({ tone = "neutral", icon, title, actions, children, style, role = tone === "danger" ? "alert" : "status" }: BannerProps) { return <div className={`gd-banner gd-banner--${tone}`} style={style} role={role}>{icon ? <span className="gd-banner-icon">{icon}</span> : null}<div className="gd-banner-copy">{title ? <strong>{title}</strong> : null}{children ? <span>{children}</span> : null}</div>{actions ? <div className="gd-banner-actions">{actions}</div> : null}</div>; }
export interface CalloutProps extends BannerProps { compact?: boolean }
export function Callout({ compact, ...props }: CalloutProps) { return <Banner {...props} style={{ ...props.style }} />; }
