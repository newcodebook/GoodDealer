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
