import type {
  ExecutionEvidenceIngestResponse,
  ExecutionEvidenceReceiptsResponse,
} from "@gooddealer/protocol/execution-events";
import type { PublicPrincipal } from "./public-session";

/** Each stream has its own owner; transport never supplies tenant or device selectors. */
export interface ExecutionEvidenceApplicationPort {
  ingest(value: unknown, principal: PublicPrincipal): Promise<ExecutionEvidenceIngestResponse | null>;
  receipts(value: unknown, principal: PublicPrincipal): Promise<ExecutionEvidenceReceiptsResponse | null>;
}
