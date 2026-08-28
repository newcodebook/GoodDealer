export const copyDecisionIds = [
  "leaseSigner",
  "executionDeviceQuota",
  "accountCredentialTrust",
  "sunsetPlacement",
] as const;

export type CopyDecisionId = (typeof copyDecisionIds)[number];

/** Root-approved docs authority for the four former brand conflicts. */
export const resolvedCopyDecisions = {
  leaseSigner: {
    status: "resolved",
    namespace: "activation",
    key: "leaseSigner",
  },
  executionDeviceQuota: {
    status: "resolved",
    namespace: "signIn",
    key: "deviceQuota",
  },
  accountCredentialTrust: {
    status: "resolved",
    namespace: "signIn",
    key: "accountCredentialTrust",
  },
  sunsetPlacement: {
    status: "resolved",
    contract: "capability",
    namespace: "runtimeMode",
    key: "localContinuationPlacement",
  },
} as const;
