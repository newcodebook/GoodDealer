import {
  Check,
  ChevronLeft,
  ChevronRight,
  Coins,
  Copy,
  ExternalLink,
  FileText,
  Globe,
  History,
  Inbox,
  LifeBuoy,
  ListChecks,
  Monitor,
  Pause,
  Play,
  RefreshCw,
  Search,
  Settings,
  Shield,
  ShieldAlert,
  TriangleAlert,
  Upload,
  X,
  type LucideIcon,
} from "lucide-react";
import type { ReactNode, SVGProps } from "react";

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children" | "ref"> { size?: number | string; title?: string }
type IconComponent = (props: IconProps) => ReactNode;

/**
 * Functional icons are Lucide (brand ICONOGRAPHY), drawn at the UI kit's 15px / 1.7 stroke and
 * colored by the surrounding text role. Consumers import only these named wrappers from the package
 * root, so the icon vocabulary stays curated and Lucide never becomes a direct app dependency.
 */
function brandIcon(Glyph: LucideIcon): IconComponent {
  return function Icon({ size = 15, title, ...props }: IconProps) {
    return (
      <Glyph size={size} strokeWidth={1.7} role={title ? "img" : undefined} aria-hidden={title ? undefined : true} {...props}>
        {title ? <title>{title}</title> : null}
      </Glyph>
    );
  };
}

export const AlertTriangleIcon = brandIcon(TriangleAlert);
export const CheckIcon = brandIcon(Check);
export const ChevronLeftIcon = brandIcon(ChevronLeft);
export const ChevronRightIcon = brandIcon(ChevronRight);
export const CoinsIcon = brandIcon(Coins);
export const CopyIcon = brandIcon(Copy);
export const ExternalLinkIcon = brandIcon(ExternalLink);
export const FileTextIcon = brandIcon(FileText);
export const GlobeIcon = brandIcon(Globe);
export const HistoryIcon = brandIcon(History);
export const InboxIcon = brandIcon(Inbox);
export const LifeBuoyIcon = brandIcon(LifeBuoy);
export const ListChecksIcon = brandIcon(ListChecks);
export const MonitorIcon = brandIcon(Monitor);
export const PauseIcon = brandIcon(Pause);
export const PlayIcon = brandIcon(Play);
export const RefreshCwIcon = brandIcon(RefreshCw);
export const SearchIcon = brandIcon(Search);
export const SettingsIcon = brandIcon(Settings);
export const ShieldAlertIcon = brandIcon(ShieldAlert);
export const ShieldIcon = brandIcon(Shield);
export const UploadIcon = brandIcon(Upload);
export const XIcon = brandIcon(X);
