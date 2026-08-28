import {
  repositoryTopology,
  repositoryTopologyInventoryErrors,
} from "./repository-topology-policy.mjs";

const errors = repositoryTopologyInventoryErrors();

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`workspace topology inventory check passed (${repositoryTopology.length} catalogued units)`);
