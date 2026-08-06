import React from "react";
/** Table pagination — range readout, page-size select, windowed page numbers. Mono-tabular, hairline. */
export interface PaginationProps {
  /** Current 1-based page. */
  page?: number;
  /** Rows per page. */
  pageSize?: number;
  /** Total row count across all pages. */
  total?: number;
  /** Called with the next 1-based page. */
  onPageChange?: (page: number) => void;
  /** Called with the next page size. */
  onPageSizeChange?: (size: number) => void;
  /** Page-size options. Default [10,25,50,100]. */
  pageSizes?: number[];
  /** Optional right-aligned mono note (e.g. a running total). */
  note?: React.ReactNode;
  style?: React.CSSProperties;
}
export function Pagination(props: PaginationProps): JSX.Element;
