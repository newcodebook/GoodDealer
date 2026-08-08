/**
 * The core GoodDealer data table — financial-grade (Kraken/Carbon direction):
 * three densities, sticky 11px caps header, right-aligned tabular-num columns,
 * tri-state row selection, restrained 1px row rules, hover = one panel step up.
 */
export interface TableColumn<Row = any> {
  key: string;
  label?: React.ReactNode;
  /** Right-align + JetBrains Mono + tabular-nums (prices, counts, dates) */
  numeric?: boolean;
  align?: "left" | "right" | "center";
  width?: number | string;
  /** Muted secondary color for the whole column */
  muted?: boolean;
  sortable?: boolean;
  render?: (row: Row, index: number) => React.ReactNode;
}
export interface TableProps<Row = any> {
  columns: TableColumn<Row>[];
  rows: Row[];
  /** Property name or fn giving each row a stable key. Default "id" */
  rowKey?: string | ((row: Row) => string);
  /** 32 / 40 / 48px rows. Default "regular" */
  density?: "compact" | "regular" | "spacious";
  selectable?: boolean;
  /** Controlled selection: array of row keys */
  selected?: Array<string | number>;
  onSelectionChange?: (keys: Array<string | number>) => void;
  sortKey?: string;
  sortDir?: "asc" | "desc";
  onSort?: (key: string, dir: "asc" | "desc") => void;
  onRowClick?: (row: Row) => void;
  hover?: boolean;
  /** Scroll container height; header stays sticky */
  maxHeight?: number | string;
  /** Sticky footer strip (totals, pagination) */
  footer?: React.ReactNode;
  emptyText?: string;
}
export declare function Table<Row = any>(props: TableProps<Row>): JSX.Element;
