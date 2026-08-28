import type { CSSProperties, ReactNode } from "react";
import "./app-shell.css";
export interface AppShellProps { navigation: ReactNode; toolbar?: ReactNode; banner?: ReactNode; status?: ReactNode; commandMenu?: ReactNode; children?: ReactNode; style?: CSSProperties }
export function AppShell({ navigation, toolbar, banner, status, commandMenu, children, style }: AppShellProps) { return <div className="gd-appshell" style={style}><div className="gd-appshell-mainrow">{navigation}<div className="gd-appshell-column">{toolbar}{banner}<main className="gd-appshell-content">{children}</main></div></div>{status}{commandMenu}</div>; }
