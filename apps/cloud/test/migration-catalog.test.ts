import { createHash } from "node:crypto";
import { globSync, readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { buildMigrationCatalog } from "../src/db/index";
import { checkedCloudMigrationCatalog, cloudMigrations } from "../src/db/migrations";
import { serverAuditSubstrateMigration } from "../src/modules/audit/migrations/202608200013-server-audit-substrate";
import { accountDefaultWorkspaceMigration } from "../src/modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";
import { commercialEntitlementsMigration } from "../src/modules/licensing/migrations/202608200015-commercial-entitlements";
import { desktopRefreshIdempotencyMigration } from "../src/modules/identity/migrations/202608200016-desktop-refresh-idempotency";
import { desktopLoginAuthorityMigration } from "../src/modules/devices/migrations/202608200017-desktop-login-authority";
import { identityTransactionCapabilityMigration } from "../src/modules/identity/migrations/202608200019-transaction-capability";
import { accountAccessMigration } from "../src/modules/identity/migrations/202609040001-account-access";
import { accountRecoveryMigration } from "../src/modules/identity/migrations/202609210001-account-recovery";
import { commercialEntitlementSnapshotMigration } from "../src/modules/licensing/migrations/202609220001-commercial-entitlement-snapshot";
import { accountDefaultWorkspaceCapabilityPolicyMigration } from "../src/modules/workspace/default-workspace/migrations/202609220002-account-default-workspace-capability-policy";
import { businessReplicaModelMigration } from "../src/modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";
import { workspaceCheckpointV2Migration } from "../src/modules/workspace/checkpoints/migrations/202609150001-workspace-checkpoint-v2";
import { cloudflareDnsObservationMigration } from "../src/modules/workspace/sync/migrations/202609150002-cloudflare-dns-observation";

const expectedCatalog = [
  {
    id: "202608200001-workspace-revisions",
    owner: "workspace/revisions",
    checksum: "327a171011b63aefd6c05f77ea93679133e20cd6e27f1c33fce2979fe260a3d1",
  },
  {
    id: "202608200002-business-replica-model",
    owner: "workspace/state/portfolio",
    checksum: "161d171914c7e394e75fc42ab5f8c43ed1289c754be7bae11084170723c57271",
  },
  {
    id: "202608200003-identity-authentication",
    owner: "identity",
    checksum: "000d8a6a3b01d5c3fa8a1b3c8f38ca3242aba890164d32053364ec80c1cd42e8",
  },
  {
    id: "202608200004-device-control",
    owner: "devices",
    checksum: "a9fe5894b37074ab5d58cab69cbe223ec7cbcc1e01ccdd7c8b0bf4a39a4d6798",
  },
  {
    id: "202608200005-device-cursors",
    owner: "workspace/cursors",
    checksum: "670fed789acd66cd259c7371803a8df26cb10773e41e4a83d62f1e583ae5acfa",
  },
  {
    id: "202608200006-mutation-drain-ledger",
    owner: "workspace/mutations",
    checksum: "80ef0c09a465dd6fff148b56317c362c55844ae9367c8cbb5bf6f30ae119bfe3",
  },
  {
    id: "202608200007-execution-fact-drain-ledger",
    owner: "execution-ledger",
    checksum: "2547680b887a9cca48880ee58a19718f7fa280ac8652bf980a3d7aa29482deab",
  },
  {
    id: "202608200008-workspace-device-audit-drain-ledger",
    owner: "audit",
    checksum: "ffe127b998592e820f99add0cb6a91a2eeecf173b6a7b16b353da9d9f0ff355f",
  },
  {
    id: "202608200009-workspace-mutation-log",
    owner: "workspace/mutations",
    checksum: "c5bf2dedfaa1e5379e6673868db2280af2e0f961d3319118cb0b5bae0efa292f",
  },
  {
    id: "202608200010-workspace-checkpoints",
    owner: "workspace/checkpoints",
    checksum: "a0d4cb3a2cc18c79a7402244dd93ca346f9676afd312db9380439c9c52dbf104",
  },
  {
    id: "202608200011-restore-candidate-foundation",
    owner: "recovery",
    checksum: "d85078febf6f26165d6f33372b2c2a7787b3733fb57b034728d6b494021eab9c",
  },
  {
    id: "202608200012-job-runtime",
    owner: "job-runtime",
    checksum: "6262b57add24c6f2a9c4db689cef1b6de7335e0747e7d73d0f719fdb0a6c24db",
  },
  {
    id: "202608200013-server-audit-substrate",
    owner: "audit",
    checksum: "a4953760e75a3d18442316b70ed28bad87304d14ae27eeba1403b33864787b4c",
  },
  {
    id: "202608200014-account-default-workspace",
    owner: "workspace/default-workspace",
    checksum: "4d0c96c3a4710c7c2a208dcf7143be2f5589c0ee5f6613aa8e2d3d6451f0b204",
  },
  {
    id: "202608200015-commercial-entitlements",
    owner: "licensing",
    checksum: "dc59e2bf2d2b83e1f91fe3aa5ae88caf47533727a600ab8e4f879a89338ae11e",
  },
  {
    id: "202608200016-desktop-refresh-idempotency",
    owner: "identity",
    checksum: "66b78e669063f67d19cd5275192c4553a9a30748dd19241798ad390746e68bd8",
  },
  {
    id: "202608200017-desktop-login-authority",
    owner: "devices",
    checksum: "55547946e980ff9242833797bd1bd14725f6f6b37f7157fd95b320deb2051f3d",
  },
  {
    id: "202608200019-transaction-capability",
    owner: "identity",
    checksum: "5d623459d97102796a8798de744191028a91bd12e2bcea5dc2fc8eb066b6e4b9",
  },
  {
    id: "202609040001-account-access",
    owner: "identity",
    checksum: "7d19d3c69da07802772567b97a903d6f80ea2dd6f3fde50627237035c3d63f47",
  },
  {
    id: "202609140001-sync-v2-ledger",
    owner: "workspace/mutations",
    checksum: "8f2b226b8b86f59042ebc05446339fd07cfd1d3863416ee4073e4766e6114e7e",
  },
  {
    id: "202609150001-workspace-checkpoint-v2",
    owner: "workspace/checkpoints",
    checksum: "72d4faff6b85571f5250278f6fae6405836b3c5ab55b5e4b58adfddb793f8151",
  },
  {
    id: "202609150002-cloudflare-dns-observation",
    owner: "workspace/sync",
    checksum: "36b2b252e011adbf01753de3ece59ea44dd630ae93a5be8e57cdbe1618418f38",
  },
  {
    id: "202609210001-account-recovery",
    owner: "identity",
    checksum: "612ccc2efb56cd36666fd41f235abec3740e52df220bd121d15b0bddf64525b3",
  },
  {
    id: "202609220001-commercial-entitlement-snapshot",
    owner: "licensing",
    checksum: "f78b527a82590eb95c01c56be4c5064a1215561452ae36b36319f865d280baa1",
  },
  {
    id: "202609220002-account-default-workspace-capability-policy",
    owner: "workspace/default-workspace",
    checksum: "e35c43c0daab0ffcb2f5998a9f7287f1e0cf5a46caa4f729274cbe0d3a5c2ecb",
  },
  {
    id: "202611020001-desktop-login-loopback-redirect",
    owner: "devices",
    checksum: "b72bf2909c4bb1bb9352c424aa23b2353598c7d2ff5767d1da947e2c70ede0b7",
  },
  {
    id: "202611020002-desktop-code-loopback-redirect",
    owner: "identity",
    checksum: "1f6a78085fd7080c78c7af7bf9da8f1c87cea17027fd62f0eef65b4932de1947",
  },
  {
    id: "202611130001-drain-proof-schema-version",
    owner: "devices",
    checksum: "e39b9763a756164c352834540f0c3a7ca9ab535dc23a22eef6a4c6d96737be97",
  },
  {
    id: "202611130002-mutation-drain-result-chain",
    owner: "workspace/mutations",
    checksum: "933171c32adbf804bd7421c7e03d3ebfeb7e633d26d532fd15eac91afed82e2b",
  },
  {
    id: "202611130003-mutation-result-ledger",
    owner: "workspace/mutations",
    checksum: "b3f4e735e417403215e7d4df663b35820e866756ebe5e61646c29125bcf18842",
  },
  {
    id: "202611130004-mutation-drain-device-chain",
    owner: "workspace/mutations",
    checksum: "4ebf138104e67ce42e19c69b3c2ddf1fa3717eb2b066d3247d44f7ef13e8578a",
  },
  {
    id: "202611130005-mutation-wire-v3",
    owner: "workspace/mutations",
    checksum: "86dfdb076c3c3656d747eb3c1e56bb2a0bbfd3301885fd9c3fe6472c27ca1aaa",
  },
  {
    id: "202611140001-replica-domain-asset-deletion",
    owner: "workspace/state/portfolio",
    checksum: "827b577aebecdcc322f7d2525b57f42edff08f8b7ac73cd0aeb66625c4a068ca",
  },
  {
    id: "202611140002-replica-entity-generation",
    owner: "workspace/state/portfolio",
    checksum: "0b752f12dd8321d3ab680cfb59b05017977d1295ba0044adf06aabf896b3ee3b",
  },
  {
    id: "202611140003-mutation-generation-mismatch-receipt",
    owner: "workspace/mutations",
    checksum: "5e606fb7595c0f83cdf5c31261ef461446dc39fef80bc898a51f94a24a874bd5",
  },
  {
    id: "202611140004-workspace-checkpoint-state-v3",
    owner: "workspace/checkpoints",
    checksum: "e17416ad0a59000e57f092947acba9484949743b49ee2bf9a4df8bf3388f8119",
  },
  {
    id: "202611140005-mutation-log-generation",
    owner: "workspace/mutations",
    checksum: "3745d9f2df15082d1262e5f37aacd8ab7de8eaaf09681ec275725b24ba3fbabe",
  },
  {
    id: "202611140006-replica-domain-asset-re-add",
    owner: "workspace/state/portfolio",
    checksum: "9a8e64d1d411afabb5f97c64a95aa5af569a533017a8102d170bf14d4d6f1be4",
  },
  {
    id: "202611170001-drain-handoff-target-key",
    owner: "devices",
    checksum: "97074182e9ea72a120a7e74b5eead2e3fa7746e4f314a0fc7170bb2f580cfeab",
  },
  {
    id: "202611170002-drain-proof-admission",
    owner: "devices",
    checksum: "073a7dcf52fe8c5cc16d24d077cff3ec7cecb3c1eb93713f0dc22087e3dd0a9f",
  },
  {
    id: "202611180001-device-self-report",
    owner: "devices",
    checksum: "e31ecb1b93d86472bc31c640cba35f807545fb7127caf9d2818f8027879665b5",
  },
  {
    id: "202611180002-login-lease-allocation-guard",
    owner: "devices",
    checksum: "6bd4a89842ff6605a65d74b22d1404a8eb63261e387fea956df5e16fbe179892",
  },
  { id: "202611190001-execution-context", owner: "devices", checksum: "3c1ff4be4d95aee71b28135136572585507d61d54a67be7405f80189170e91e2" },
  { id: "202611190002-execution-context-capability", owner: "devices", checksum: "6b0ea71d62e768dcbb824c4de2cb85dd824ee7eed8ab9167f852c05179120134" },
  { id: "202611190003-execution-context-device", owner: "identity", checksum: "77ce05dda94bfd97615258c58160621beaf4dc1535b5d6634fc296208f3a76c8" },
  { id: "202611190004-execution-context-envelope-binding", owner: "devices", checksum: "f61be8121b8758dffaef6aeb54a7a9ac7ce9718c81a1ec06a3940fea37940162" },
  { id: "202611190005-execution-context-device-column", owner: "identity", checksum: "0c75fb11c1b99a696a976ec775fa1e7c1bd22b05b6377a12548d268b6eee24f3" },
  { id: "202611190006-security-epoch-end-boundaries", owner: "identity", checksum: "ae8683dce9972e564d88f20fc234f6b82e5ee04482d73c676051dc6af8c0485f" },
  { id: "202611190007-execution-context-key-evidence", owner: "devices", checksum: "af93bbfd3133a1eef060902d95a2e48fc839828c07f4425b59158c4e370b3b62" },
  { id: "202611190008-execution-context-key-read-policy", owner: "devices", checksum: "ec0081779f1f39e596d5436f84f4d14b219392217f9610cbf4028bc1f822ed92" },
  { id: "202611190009-audit-execution-evidence", owner: "audit", checksum: "7992e79914fc460aa3e3bf7625cb45203b5d6f09442ecb018cf382c90e45d418" },
  { id: "202611190010-execution-fact-evidence", owner: "execution-ledger", checksum: "6f99361c008ca5dae4ccbb2bf2a01b6c1560dab7338f09cd46a2580d132c38fd" },
  { id: "202611190011-audit-evidence-event-identity", owner: "audit", checksum: "4108df375fe42327cab8a2290dd37c9ac256fef4769dc342b5f5fcddf1cf204b" },
  { id: "202611190012-fact-evidence-event-identity", owner: "execution-ledger", checksum: "e9374189388c6ce42fee971e010234e889c5dc2a7ef7532a61c68060ec4e3d75" },
  { id: "202611190013-audit-evidence-closed-shape", owner: "audit", checksum: "8d0da29195c0b813429b8b199457176345e008cd85d69276e87e5400aef24a68" },
  { id: "202611190014-fact-evidence-closed-shape", owner: "execution-ledger", checksum: "e45640afc4fbadecaccda39365172682299c65d96f892e57d86a7f8f619d0cea" },
  { id: "202611190015-audit-evidence-payload-projection", owner: "audit", checksum: "4c58ea54bcc83001b04efd99cda9bd57c1e8f2ae12e11f92761707c4d7a7047f" },
  { id: "202611190016-fact-evidence-payload-projection", owner: "execution-ledger", checksum: "bc7cd5025dec78a08653524fe930989bfe282de80f60b02bc3a1924a72090db2" },
  { id: "202611190017-fact-evidence-replay-and-seal", owner: "execution-ledger", checksum: "ab9c7da002ee36ff225849aa86f10d3c4bac71f3407c3778b7633cbbf805d33a" },
  { id: "202611190018-audit-evidence-seal-rollback", owner: "audit", checksum: "ae2378b7a23f7d76518b9de127f60e94cd2b5785f8bd5c31b1798f178d76f7df" },
  { id: "202611190019-switch-request-source-epoch", owner: "devices", checksum: "2756d4719c02635c61fa36a388ff571b260c49694eda23f01d642dd7456bc33f" },
  { id: "202611190020-switch-source-epoch-purpose", owner: "devices", checksum: "b9eff59a18fe34d1f78e0623c4e091bad284144785990580d79e4d95dfd64e4d" },
  { id: "202611190021-mutation-drain-login-allocation", owner: "workspace/mutations", checksum: "7bd11565e28e5d40ed0c15a1009b3ab554823de53a02a1ab7f11fec828b4bc11" },
  { id: "202611190022-target-bootstrap-installation", owner: "devices", checksum: "e0909cf45235bfa0c47c3482ee3d607c5cae88286b154f5d9738f3f4a4b0fc79" },
  { id: "202611190023-bootstrap-checkpoint-capability", owner: "workspace/checkpoints", checksum: "5ad0ce1fbebd981af10c849c4a8368d8bfefa64a05841b2dfacd6c5892cc8de8" },
  { id: "202611190024-bootstrap-checkpoint-policy", owner: "workspace/checkpoints", checksum: "f4993e47239caadfeb860829a8c18294c8fb1eca9fc0a9e455b925ab8e86b27e" },
  { id: "202611190025-desktop-forced-reauth", owner: "identity", checksum: "f44af122b44861e6a6917406870079b1c35fecfeee855957966accc90e51ac85" },
  { id: "202611190026-lease-issued-offline-high-water", owner: "devices", checksum: "26b379ffb97795cb17b8698bbc96ece34c3cd593ecf9b725591c74409487987f" },
  { id: "202611190027-forced-takeover-workflow", owner: "devices", checksum: "7bd536425de39dca30f963645239dd09f243ce28f331fad93d3248afe560524f" },
  { id: "202611190028-forced-intent-cancellation", owner: "devices", checksum: "e9bae6407af605e7a49a4870aa1f237ea43e3b81ecfcfc2e977c1839d43d66bc" },
  { id: "202611190029-forced-intent-capability-policy", owner: "devices", checksum: "04340680166f2536332e5a51779c4f9a5897cb6c355ea919d3d3a267f79adee8" },
  { id: "202611190030-audit-listing-write-evidence", owner: "audit", checksum: "af132ccc8a6274f641c5bb447b434674cee6fa1b3e01388167375e1a1be19987" },
  { id: "202611190031-execution-listing-write-evidence", owner: "execution-ledger", checksum: "f0dd578a49275a3fa4b9fa291093e4c7796b4778d97c7d69370a3189d3a0b2b9" },
  { id: "202611190032-audit-listing-plan-evidence", owner: "audit", checksum: "f6e36b03b01830dac4d245e7da2464c1f9cd6c1630bace77705bec29b02b3fa6" },
  { id: "202611190033-execution-listing-plan-evidence", owner: "execution-ledger", checksum: "c11317d23c580e6406dfb7e0b6b7fb6ddfaeac675f9195f452f7d93dbea532e5" },
  { id: "202611200001-audit-sellerhub-bin-price-evidence", owner: "audit", checksum: "546d0281b34aa089705c69c6ea678cc2ee5bcbab916d75978abcf7a77d9ab662" },
  { id: "202611200002-execution-sellerhub-bin-price-evidence", owner: "execution-ledger", checksum: "4f894d46336bb1d5eb5183c247fc34287a46189da96b14a485e8947422018830" },
] as const;

const expectedMigrationFiles = expectedCatalog.map(
  ({ id, owner }) => `src/modules/${owner}/migrations/${id}.ts`,
).sort();

describe("Cloud migration catalog", () => {
  it("keeps the frozen prefix and terminal account-recovery migration as literal imports rather than discovery", () => {
    const source = readFileSync(new URL("../src/db/migrations.ts", import.meta.url), "utf8")
      .replaceAll("\r\n", "\n");

    expect(source).toContain(
      'import { accountDefaultWorkspaceMigration } from "../modules/workspace/default-workspace/migrations/202608200014-account-default-workspace";',
    );
    expect(source).toContain(
      'import { businessReplicaModelMigration } from "../modules/workspace/state/portfolio/migrations/202608200002-business-replica-model";',
    );
    expect(source).toContain(
      'import { commercialEntitlementsMigration } from "../modules/licensing/migrations/202608200015-commercial-entitlements";',
    );
    expect(source).toContain(
      "  commercialEntitlementsMigration,\n  desktopRefreshIdempotencyMigration,\n"
      + "  desktopLoginAuthorityMigration,\n  identityTransactionCapabilityMigration,\n  accountAccessMigration,\n"
      + "  syncV2LedgerMigration,\n  workspaceCheckpointV2Migration,\n  cloudflareDnsObservationMigration,\n"
      + "  accountRecoveryMigration,\n  commercialEntitlementSnapshotMigration,\n"
      + "  accountDefaultWorkspaceCapabilityPolicyMigration,\n  desktopLoginLoopbackRedirectMigration,\n"
      + "  desktopCodeLoopbackRedirectMigration,\n  drainProofSchemaVersionMigration,\n"
      + "  mutationDrainResultChainMigration,\n  mutationResultLedgerMigration,\n"
      + "  mutationDrainDeviceChainMigration,\n  mutationWireV3Migration,\n  replicaDomainAssetDeletionMigration,\n  replicaEntityGenerationMigration,\n  mutationGenerationMismatchReceiptMigration,\n  workspaceCheckpointStateV3Migration,\n"
      + "  mutationLogGenerationMigration,\n  replicaDomainAssetReAddMigration,\n  drainHandoffTargetKeyMigration,\n  drainProofAdmissionMigration,\n  deviceSelfReportMigration,\n  loginLeaseAllocationGuardMigration,\n  executionContextMigration,\n  executionContextCapabilityMigration,\n  executionContextDeviceMigration,\n  executionContextEnvelopeBindingMigration,\n  executionContextDeviceColumnMigration,\n  securityEpochEndBoundariesMigration,\n  executionContextKeyEvidenceMigration,\n  executionContextKeyReadPolicyMigration,\n  auditExecutionEvidenceMigration,\n  executionFactEvidenceMigration,\n  auditEvidenceEventIdentityMigration,\n  factEvidenceEventIdentityMigration,\n  auditEvidenceClosedShapeMigration,\n  factEvidenceClosedShapeMigration,\n  auditEvidencePayloadProjectionMigration,\n  factEvidencePayloadProjectionMigration,\n  factEvidenceReplayAndSealMigration,\n  auditEvidenceSealRollbackMigration,\n  switchRequestSourceEpochMigration,\n  switchSourceEpochPurposeMigration,\n  mutationDrainLoginAllocationMigration,\n  targetBootstrapInstallationMigration,\n  bootstrapCheckpointCapabilityMigration,\n  bootstrapCheckpointPolicyMigration,\n  desktopForcedReauthenticationMigration,\n  leaseIssuedOfflineHighWaterMigration,\n  forcedTakeoverWorkflowMigration,\n  forcedIntentCancellationMigration,\n  forcedIntentCapabilityPolicyMigration,\n  auditListingWriteEvidenceMigration,\n  executionListingWriteEvidenceMigration,\n  auditListingPlanEvidenceMigration,\n  executionListingPlanEvidenceMigration,\n  auditSellerHubBinPriceEvidenceMigration,\n  executionSellerHubBinPriceEvidenceMigration,\n];",
    );
    expect(source).toContain('import { cloudflareDnsObservationMigration } from "../modules/workspace/sync/migrations/202609150002-cloudflare-dns-observation";');
    expect(source).toContain('import { accountRecoveryMigration } from "../modules/identity/migrations/202609210001-account-recovery";');
    expect(source).not.toMatch(/(?:import\.meta\.glob|readdir|glob\(|import\(|sort\()/u);
  });

  it("preserves the literal ordered migration identity, ownership, and checksums", () => {
    const projection = checkedCloudMigrationCatalog.map(({ id, owner, checksum }) => ({ id, owner, checksum }));
    const expectedM019 = expectedCatalog[19];
    if (expectedM019 === undefined) throw new Error("M019 fixture is unexpectedly absent");

    expect(projection).toEqual(expectedCatalog);
    expect(checkedCloudMigrationCatalog).toHaveLength(77);
    expect(new Set(projection.map(({ id }) => id)).size).toBe(expectedCatalog.length);
    for (const [index, migration] of projection.entries()) {
      if (index > 0) expect(migration.id > projection[index - 1]!.id).toBe(true);
    }
    expect(projection.filter(({ id }) => id === expectedM019.id)).toEqual([expectedM019]);
    expect(projection[12]?.id).toBe("202608200013-server-audit-substrate");
    expect(projection[19]).toEqual(expectedM019);
    expect(projection[20]).toEqual(expectedCatalog[20]);
  });

  it("keeps exactly one owned migration file for each catalog entry", () => {
    const migrationFiles = globSync("src/modules/**/migrations/*.ts", {
      cwd: new URL("../", import.meta.url),
    }).map((file) => file.replaceAll("\\", "/")).sort();

    expect(migrationFiles).toEqual(expectedMigrationFiles);
  });

  it("defines every table once and permits only same-owner forward column evolution", () => {
    const tableDefinitions = new Map<string, { readonly id: string; readonly owner: string }>();
    for (const migration of cloudMigrations) {
      for (const match of migration.sql.matchAll(
        /CREATE TABLE(?: IF NOT EXISTS)?\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)/gu,
      )) {
        const table = match[1]!;
        expect(tableDefinitions.has(table), `${table} is defined by more than one migration`).toBe(false);
        tableDefinitions.set(table, { id: migration.id, owner: migration.owner });
      }
    }

    for (const migration of cloudMigrations) {
      for (const match of migration.sql.matchAll(
        /ALTER TABLE\s+(?:[a-z_][a-z0-9_]*\.)?([a-z_][a-z0-9_]*)\s+ADD COLUMN/gu,
      )) {
        const table = match[1]!;
        const definition = tableDefinitions.get(table);
        expect(definition, `${table} is altered before it is defined`).toBeDefined();
        expect(migration.id >= definition!.id, `${table} is altered before its defining migration`).toBe(true);
        expect(migration.owner, `${table} crosses migration ownership`).toBe(definition!.owner);
      }
    }
  });

  it("matches literal checksum fixtures to the normalized M002/M013–M015 and forward M016–M017/M019 sources", () => {
    const finalSources = [
      businessReplicaModelMigration,
      serverAuditSubstrateMigration,
      accountDefaultWorkspaceMigration,
      commercialEntitlementsMigration,
      desktopRefreshIdempotencyMigration,
      desktopLoginAuthorityMigration,
      identityTransactionCapabilityMigration,
      accountAccessMigration,
      accountRecoveryMigration,
    ];
    const indexes = [1, 12, 13, 14, 15, 16, 17, 18, 22];
    for (const [offset, migration] of finalSources.entries()) {
      expect(createHash("sha256").update(migration.sql, "utf8").digest("hex"))
        .toBe(expectedCatalog[indexes[offset]!]?.checksum);
    }
    expect(createHash("sha256").update(commercialEntitlementSnapshotMigration.sql, "utf8").digest("hex"))
      .toBe(expectedCatalog[23]?.checksum);
    expect(createHash("sha256").update(accountDefaultWorkspaceCapabilityPolicyMigration.sql, "utf8").digest("hex"))
      .toBe(expectedCatalog[24]?.checksum);
  });

  it("keeps the durable M003 and M004 prefix byte-identical while evolving through M016 and M017", () => {
    expect(expectedCatalog[2]?.checksum)
      .toBe("000d8a6a3b01d5c3fa8a1b3c8f38ca3242aba890164d32053364ec80c1cd42e8");
    expect(expectedCatalog[3]?.checksum)
      .toBe("a9fe5894b37074ab5d58cab69cbe223ec7cbcc1e01ccdd7c8b0bf4a39a4d6798");
    expect(desktopRefreshIdempotencyMigration.sql).toContain("CREATE TABLE identity_desktop_authorization_codes");
    expect(desktopLoginAuthorityMigration.sql).toContain("CREATE TABLE device_login_challenges");
    expect(desktopLoginAuthorityMigration.sql).toContain("release_reason = 'lease_verifier_upgrade'");
    expect(desktopLoginAuthorityMigration.sql).toContain("device_active_leases_held_verified_wire");
  });

  it("uses M015 as the normalized greenfield commercial baseline without compatibility migration", () => {
    expect(commercialEntitlementsMigration.sql).toContain("commercial_provider_slots");
    expect(commercialEntitlementsMigration.sql).toContain("commercial_authorities");
    expect(commercialEntitlementsMigration.sql).not.toContain("licensing_commercial_purchases");
  });

  it("rebuilds the checked global catalog from the ordered migration inventory", () => {
    expect(buildMigrationCatalog(cloudMigrations)).toEqual(checkedCloudMigrationCatalog);
  });

  it("keeps the checkpoint wire-version change append-only", () => {
    expect(workspaceCheckpointV2Migration.sql).toContain("DROP CONSTRAINT workspace_checkpoints_schema_version_check");
    expect(workspaceCheckpointV2Migration.sql).toContain("CHECK (schema_version IN (1, 2))");
  });

  it("matches the Cloudflare observation migration checksum", () => {
    expect(createHash("sha256").update(cloudflareDnsObservationMigration.sql, "utf8").digest("hex"))
      .toBe(expectedCatalog[21]?.checksum);
  });

  it("rejects duplicates, order drift, invalid ids, and empty SQL before database access", () => {
    const migration = { id: "202608200001-first", owner: "module/a", sql: "SELECT 1" };
    expect(() => buildMigrationCatalog([migration, migration])).toThrow("duplicate migration id");
    expect(() => buildMigrationCatalog([
      { ...migration, id: "202608200002-second" },
      migration,
    ])).toThrow("not globally increasing");
    expect(() => buildMigrationCatalog([{ ...migration, id: "not-ordered" }])).toThrow("invalid migration id");
    expect(() => buildMigrationCatalog([{ ...migration, sql: " " }])).toThrow("incomplete");
  });
});
