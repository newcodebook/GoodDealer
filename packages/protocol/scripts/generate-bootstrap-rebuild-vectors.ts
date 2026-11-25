// Rebuild corpus: fixed business examples plus derived checkpoint-state v3 final digests.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { computeWorkspaceCheckpointEntityDigests, encodeCheckpointEntityDigestsInput } from "../src/workspace/index";
const fixture = {
  "schemaVersion": 1,
  "workspaceId": "workspace-fixture-1",
  "workspaceSchemaVersion": 1,
  "targetServerRevision": 4,
  "checkpointDescriptor": {
    "schemaVersion": 3,
    "checkpointId": "checkpoint-fixture-1",
    "workspaceId": "workspace-fixture-1",
    "workspaceSchemaVersion": 1,
    "throughServerRevision": 2,
    "checkpointDigest": "lehBmG8nsPKJC1oYNrwWgLUCph8kiXw5IqF6-oQY1ts"
  },
  "checkpointSnapshot": {
    "schemaVersion": 2,
    "workspaceId": "workspace-fixture-1",
    "workspaceSchemaVersion": 1,
    "throughServerRevision": 2,
    "state": {
      "assets": [
        {
          "entityId": "a.test",
          "note": "checkpoint note",
          "portfolioId": "portfolio-1",
          "tags": [
            "listed"
          ],
          "targetPrice": {
            "currency": "USD",
            "amount": "1000"
          },
          "entityGeneration": 1
        },
        {
          "entityId": "b.test",
          "note": null,
          "portfolioId": null,
          "tags": [],
          "targetPrice": null,
          "entityGeneration": 1
        }
      ],
      "tombstones": [
        {
          "entityId": "c.test",
          "entityGeneration": 1,
          "deletedServerRevision": 1,
          "deletedAt": "2026-01-01T00:00:00Z"
        }
      ]
    }
  },
  "pages": [
    {
      "cursor": null,
      "page": {
        "schemaVersion": 3,
        "workspaceId": "workspace-fixture-1",
        "fromServerRevisionExclusive": 2,
        "throughServerRevisionInclusive": 4,
        "mutations": [
          {
            "schemaVersion": 3,
            "mutationId": "mutation-3",
            "workspaceId": "workspace-fixture-1",
            "workspaceSchemaVersion": 1,
            "entityType": "domain_asset",
            "entityId": "a.test",
            "entityGeneration": 1,
            "baseServerRevision": 2,
            "changedFields": [
              {
                "fieldPath": "note",
                "value": "rebuilt note"
              },
              {
                "fieldPath": "tags",
                "value": [
                  "priority",
                  "sale"
                ]
              }
            ],
            "sourceDeviceId": "device-source-1",
            "activeLeaseEpoch": 11,
            "deviceMutationSequence": 3,
            "serverRevision": 3,
            "operationKind": "upsert"
          }
        ],
        "returnedThroughServerRevision": 3,
        "nextCursor": "after-3",
        "pageDigest": "AEfl97H1wHMDfoScgqD45kYE-PTlVkhVvy_KY3Uw0aU"
      }
    },
    {
      "cursor": "after-3",
      "page": {
        "schemaVersion": 3,
        "workspaceId": "workspace-fixture-1",
        "fromServerRevisionExclusive": 3,
        "throughServerRevisionInclusive": 4,
        "mutations": [
          {
            "schemaVersion": 3,
            "mutationId": "mutation-4",
            "workspaceId": "workspace-fixture-1",
            "workspaceSchemaVersion": 1,
            "entityType": "domain_asset",
            "entityId": "b.test",
            "entityGeneration": 1,
            "baseServerRevision": 2,
            "changedFields": [
              {
                "fieldPath": "portfolioId",
                "value": "portfolio-2"
              },
              {
                "fieldPath": "targetPrice",
                "value": {
                  "currency": "USD",
                  "amount": "2500"
                }
              }
            ],
            "sourceDeviceId": "device-source-1",
            "activeLeaseEpoch": 11,
            "deviceMutationSequence": 4,
            "serverRevision": 4,
            "operationKind": "upsert"
          }
        ],
        "returnedThroughServerRevision": 4,
        "nextCursor": null,
        "pageDigest": "B29Q1vwIcbcNcNXYIpFDz0f-ct4cuF8exoXl5Xx4LCU"
      }
    }
  ],
  "expected": {
    "projection": [
      {
        "entityId": "a.test",
        "note": "rebuilt note",
        "portfolioId": "portfolio-1",
        "tags": [
          "priority",
          "sale"
        ],
        "targetPrice": {
          "currency": "USD",
          "amount": "1000"
        }
      },
      {
        "entityId": "b.test",
        "note": null,
        "portfolioId": "portfolio-2",
        "tags": [],
        "targetPrice": {
          "currency": "USD",
          "amount": "2500"
        }
      }
    ]
  }
};
const hash = async (bytes: Uint8Array) => createHash("sha256").update(bytes).digest();
const entityDigests = await computeWorkspaceCheckpointEntityDigests({
  assets: fixture.expected.projection.map(row => ({ ...row, entityGeneration: 1 })),
  tombstones: fixture.checkpointSnapshot.state.tombstones,
}, hash);
const digest = createHash("sha256").update(encodeCheckpointEntityDigestsInput(entityDigests)).digest("base64url");
await writeFile(new URL("../test-vectors/bootstrap-rebuild/domain-asset-v1.json", import.meta.url), JSON.stringify({
  ...fixture, expected: { ...fixture.expected, entityDigests, digest },
}, null, 2) + "\n");
