import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import {
  JOB_RUNTIME_TABLES,
  JOBS_PERSISTENCE_INPUT_PATHS,
  POSTGRES_JOBS_TEST_NAMES,
  digestInputs,
  jobsPersistenceReportPassesPolicy,
} from "./collect-jobs-persistence-report.mjs";

const root = resolve(import.meta.dirname, "..");
const read = (path) => readFileSync(resolve(root, path), "utf8");
const hashes = JOBS_PERSISTENCE_INPUT_PATHS.map((path) => ({ path, sha256: createHash("sha256").update(read(path)).digest("hex") }));
const replayAudit = [{
  outcome: "requeued", authorizationKind: "admin_action", generation: 1, authorizationDigestBytes: 32,
  requestedAt: "2026-08-20T08:00:00.000Z", decidedAt: "2026-08-20T08:00:00.001Z",
}];
const report = {
  schemaVersion: 1, slice: "jobs-persistence", passed: true, closesGate: false,
  repository: { commit: "a".repeat(40), dirty: false },
  database: {
    serverVersion: "18.6", roles: [{ name:"gooddealer_cloud_app",superuser:false,bypassRls:false },{ name:"gooddealer_cloud_owner",superuser:false,bypassRls:false }],
    rowLevelSecurity: JOB_RUNTIME_TABLES.map((table)=>({table,enabled:true,forced:true})),
    migration: [{id:"202608200012-job-runtime",owner:"job-runtime",checksum:"b".repeat(64)}],
    structuralConstraints: [
      {table:"job_runtime_attempts",primary_keys:1,unique_constraints:1,foreign_keys:1},
      {table:"job_runtime_jobs",primary_keys:1,unique_constraints:1,foreign_keys:0},
      {table:"job_runtime_partition_leases",primary_keys:1,unique_constraints:0,foreign_keys:1},
      {table:"job_runtime_quarantine_events",primary_keys:1,unique_constraints:1,foreign_keys:1},
      {table:"job_runtime_replay_events",primary_keys:1,unique_constraints:0,foreign_keys:1},
    ],
    replayAudit,
  },
  tests:{postgres:{file:"test/postgres/job-runtime-persistence.test.ts",success:true,total:POSTGRES_JOBS_TEST_NAMES.length,passed:POSTGRES_JOBS_TEST_NAMES.length,failed:0,names:POSTGRES_JOBS_TEST_NAMES}},
  productionSurfaces:{publicBusinessRoutes:1,adminBusinessRoutes:0,periodicJobs:0,jobApplicationPorts:0,productionJobKinds:0,scheduler:"DenyingPeriodicScheduler",schedulerCalls:0,entrypointRuntimeImports:0,tauriCommands:[]},
  gates:{"R0-09":"In Progress"},inputs:hashes,inputSetDigest:digestInputs(hashes),
};

test("jobs persistence policy accepts the complete qualified observation",()=>assert.equal(jobsPersistenceReportPassesPolicy(report),true));
test("jobs persistence policy rejects fabricated qualification, roles, RLS, migration, tests, hashes, surfaces, and Gate closure",()=>{
  const mutations=[
    {...report,database:{...report.database,serverVersion:"18.5"}},
    {...report,database:{...report.database,roles:[{...report.database.roles[0],superuser:true},report.database.roles[1]]}},
    {...report,database:{...report.database,rowLevelSecurity:report.database.rowLevelSecurity.slice(1)}},
    {...report,database:{...report.database,migration:[]}},
    {...report,tests:{postgres:{...report.tests.postgres,total:POSTGRES_JOBS_TEST_NAMES.length-1}}},
    {...report,tests:{postgres:{...report.tests.postgres,names:[...POSTGRES_JOBS_TEST_NAMES.slice(0,-1),POSTGRES_JOBS_TEST_NAMES[0]]}}},
    {...report,inputs:hashes.slice(1)},
    {...report,productionSurfaces:{...report.productionSurfaces,publicBusinessRoutes:-1}},
    {...report,productionSurfaces:{...report.productionSurfaces,periodicJobs:1}},
    {...report,productionSurfaces:{...report.productionSurfaces,productionJobKinds:1}},
    {...report,gates:{"R0-09":"Closed"}}, {...report,closesGate:true}, {...report,repository:{...report.repository,dirty:true}},
  ];
  for(const mutation of mutations) assert.equal(jobsPersistenceReportPassesPolicy(mutation),false);
});
test("jobs persistence policy rejects every replay audit field when singly mutated",()=>{
  const event=replayAudit[0];
  const mutations={
    outcome:"authorization_rejected",
    authorizationKind:"system_policy",
    generation:2,
    authorizationDigestBytes:31,
    requestedAt:"2026-08-20T08:00:00.002Z",
    decidedAt:"not-a-timestamp",
  };
  for(const [field,value] of Object.entries(mutations)) {
    const mutation={...report,database:{...report.database,replayAudit:[{...event,[field]:value}]}};
    assert.equal(jobsPersistenceReportPassesPolicy(mutation),false,field);
  }
  assert.equal(jobsPersistenceReportPassesPolicy({...report,database:{...report.database,replayAudit:[]}}),false,"event count");
  assert.equal(jobsPersistenceReportPassesPolicy({...report,database:{...report.database,replayAudit:[{...event,extra:true}]}}),false,"unknown field");
});
test("workflow and collector are pinned, fail closed, and bind every required source",()=>{
  const workflow=read(".github/workflows/wp4-jobs-persistence.yml"); const collector=read("scripts/collect-jobs-persistence-report.mjs"); const manifest=JSON.parse(read("package.json"));
  assert.match(workflow,/image: postgres:18\.6/u); assert.match(workflow,/NOSUPERUSER NOBYPASSRLS/u); assert.match(workflow,/evidence:wp4:jobs-persistence/u);
  assert.equal(manifest.scripts["evidence:wp4:jobs-persistence"],"node scripts/collect-jobs-persistence-report.mjs");
  assert.match(collector,/unqualified diagnostic mode cannot produce/u); assert.match(collector,/repository\?\.dirty === false/u);
  for(const path of JOBS_PERSISTENCE_INPUT_PATHS) assert.match(collector,new RegExp(path.replace(/[.*+?^${}()|[\]\\]/gu,"\\$&"),"u"));
});
