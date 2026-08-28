import { repositoryTopology, repositoryTopologyErrors } from "./repository-topology-policy.mjs";

const errors = repositoryTopologyErrors();

if (errors.length > 0) {
  console.error(errors.join("\n"));
  process.exit(1);
}

console.log(`repository topology policy passed (${repositoryTopology.length} catalogued units)`);
