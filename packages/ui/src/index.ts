// Public API of @gooddealer/ui. Keep this the only import surface consumers use —
// no deep imports into src/components/** or src/tokens/** from outside this package.
// The token layer's CSS is imported separately, once, at the host app root:
//   import "@gooddealer/ui/tokens.css";

export { Button } from "./components/button/button";
export type { ButtonProps, ButtonSize, ButtonVariant } from "./components/button/button";

export { IconButton } from "./components/icon-button/icon-button";
export type { IconButtonProps, IconButtonSize, IconButtonVariant } from "./components/icon-button/icon-button";

export { Input } from "./components/input/input";
export type { InputProps, InputSize } from "./components/input/input";

export { Checkbox } from "./components/checkbox/checkbox";
export type { CheckboxProps } from "./components/checkbox/checkbox";

export { Select } from "./components/select/select";
export type { SelectOption, SelectProps, SelectSize } from "./components/select/select";

export { Switch } from "./components/switch/switch";
export type { SwitchProps } from "./components/switch/switch";

export { Tabs } from "./components/tabs/tabs";
export type { TabItem, TabsProps } from "./components/tabs/tabs";

export { StatusBar } from "./components/status-bar/status-bar";
export type { StatusBarProps } from "./components/status-bar/status-bar";

export { Badge } from "./components/badge/badge";
export type { BadgeProps, BadgeTone } from "./components/badge/badge";

export { WindowChrome } from "./components/window-chrome/window-chrome";
export type { WindowChromeProps } from "./components/window-chrome/window-chrome";

export { Dialog, trapDialogKey } from "./components/dialog/dialog";
export type { DialogProps } from "./components/dialog/dialog";
export { Tooltip } from "./components/tooltip/tooltip";
export type { TooltipProps } from "./components/tooltip/tooltip";
export { DiffValue } from "./components/diff-value/diff-value";
export type { DiffValueProps } from "./components/diff-value/diff-value";
export { Money } from "./components/money/money";
export type { MoneyProps, MoneyTone } from "./components/money/money";
export { ProgressBar } from "./components/progress-bar/progress-bar";
export type { ProgressBarProps, ProgressSegment, ProgressTone } from "./components/progress-bar/progress-bar";
export { StatusDot } from "./components/status-dot/status-dot";
export type { StatusDotKind, StatusDotProps } from "./components/status-dot/status-dot";
export { Tag } from "./components/tag/tag";
export type { TagProps } from "./components/tag/tag";
export { KpiStat } from "./components/kpi-stat/kpi-stat";
export type { KpiStatProps, KpiStatTone } from "./components/kpi-stat/kpi-stat";
export { Panel } from "./components/panel/panel";
export type { PanelProps } from "./components/panel/panel";
export { Toolbar } from "./components/toolbar/toolbar";
export type { ToolbarProps } from "./components/toolbar/toolbar";
export { BatchBar } from "./components/batch-bar/batch-bar";
export type { BatchBarProps } from "./components/batch-bar/batch-bar";
export { Pagination, getPageWindow } from "./components/pagination/pagination";
export type { PageWindowItem, PaginationProps } from "./components/pagination/pagination";
export { Table, getVisibleColumns } from "./components/table/table";
export type { TableColumn, TableColumnPriority, TableProps, TableVirtualWindow } from "./components/table/table";
export { EditableCell } from "./components/editable-cell/editable-cell";
export type { EditableCellProps } from "./components/editable-cell/editable-cell";
export { MetricStrip } from "./components/metric-strip/metric-strip";
export type { MetricStripItem, MetricStripProps, MetricTone } from "./components/metric-strip/metric-strip";
export { SegmentedControl } from "./components/segmented-control/segmented-control";
export type { SegmentedControlItem, SegmentedControlProps } from "./components/segmented-control/segmented-control";
export { Stepper } from "./components/stepper/stepper";
export type { StepperItem, StepperProps } from "./components/stepper/stepper";
export { ComparisonValueCard } from "./components/comparison-value-card/comparison-value-card";
export type { ComparisonValueCardProps, ComparisonValueTone } from "./components/comparison-value-card/comparison-value-card";
export { KeyValueList, KeyValueRow } from "./components/key-value-list/key-value-list";
export type { KeyValueListProps, KeyValueRowProps } from "./components/key-value-list/key-value-list";
export { CommandMenu } from "./components/command-menu/command-menu";
export type { CommandMenuItem, CommandMenuProps } from "./components/command-menu/command-menu";
export { AppShell } from "./components/app-shell/app-shell";
export type { AppShellProps } from "./components/app-shell/app-shell";
export { NavigationRail } from "./components/navigation-rail/navigation-rail";
export type { NavigationRailItem, NavigationRailProps, NavigationRailSection, NavigationRailTone } from "./components/navigation-rail/navigation-rail";
export { Banner, Callout } from "./components/banner/banner";
export type { BannerProps, BannerTone, CalloutProps } from "./components/banner/banner";
export {
  AlertTriangleIcon, CheckIcon, ChevronLeftIcon, ChevronRightIcon, CoinsIcon, CopyIcon,
  ExternalLinkIcon, FileTextIcon, GlobeIcon, HistoryIcon, InboxIcon, LifeBuoyIcon,
  ListChecksIcon, MonitorIcon, PauseIcon, PlayIcon, RefreshCwIcon, SearchIcon, SettingsIcon,
  ShieldAlertIcon, ShieldIcon, UploadIcon, XIcon,
} from "./components/icon/icon";
export type { IconProps } from "./components/icon/icon";
