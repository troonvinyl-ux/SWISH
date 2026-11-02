#!/usr/bin/env node
/** Read-only validation. Never promotes programme or niche acceptance statuses. */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const errors = [];
const fail = message => errors.push(message);
const object = value => !!value && typeof value === 'object' && !Array.isArray(value);
const text = value => typeof value === 'string' && value.trim().length > 0;
const evidence = value => text(value) && !/\b(todo|tbd|pending|not verified)\b/i.test(value);
const statuses = ['NOT STARTED', 'IN PROGRESS', 'IMPLEMENTED', 'TESTING', 'VERIFIED', 'BLOCKED'];
const readJson = name => JSON.parse(fs.readFileSync(path.join(root, name), 'utf8'));
let register;
let nicheRegistry;
try {
  register = readJson('docs/SWISH_FOUNDATION_MASTER_REGISTER.json');
  nicheRegistry = readJson('niche-modules.json');
} catch (error) {
  console.error(`SWISH production register validation FAILED: ${error.message}`);
  process.exit(1);
}
if (!object(register)) {
  console.error('SWISH production register validation FAILED: register must be a JSON object');
  process.exit(1);
}
if (register.schemaVersion !== 1) fail('unsupported or missing schemaVersion');
if (!text(register.programme) || !text(register.repository) || !text(register.defaultBranch)) fail('programme, repository and defaultBranch are required');
if (!Array.isArray(register.statuses) || statuses.some(status => !register.statuses.includes(status))) fail('register.statuses must include the complete status vocabulary');
const stages = Array.isArray(register.stages) ? register.stages : [];
if (stages.length !== 7) fail('register must contain exactly seven stages');
const stageIds = new Set();
const taskIds = new Set();
for (const stage of stages) {
  if (!object(stage)) { fail('stage must be an object'); continue; }
  if (!text(stage.id) || stageIds.has(stage.id)) fail('stage has a missing or duplicate id');
  stageIds.add(stage.id);
  if (!text(stage.name) || !text(stage.goal) || !statuses.includes(stage.status)) fail(`invalid stage ${stage.id}`);
  if (!Array.isArray(stage.tasks) || stage.tasks.length === 0) { fail(`stage ${stage.id} requires a non-empty tasks array`); continue; }
  for (const task of stage.tasks) {
    if (!object(task)) { fail('task must be an object'); continue; }
    if (!text(task.id) || taskIds.has(task.id)) fail('task has a missing or duplicate id');
    taskIds.add(task.id);
    if (!text(task.title) || !statuses.includes(task.status)) fail(`invalid task ${task.id}`);
    if (task.status === 'VERIFIED' && !evidence(task.evidence)) fail(`task ${task.id} is VERIFIED without resolved evidence`);
  }
  if (stage.status === 'VERIFIED' && stage.tasks.some(task => !object(task) || task.status !== 'VERIFIED' || !evidence(task.evidence))) fail(`stage ${stage.id} is VERIFIED with unfinished tasks`);
}
for (let index = 1; index <= 7; index++) if (!stageIds.has(`S${index}`)) fail(`missing stage S${index}`);
if (!taskIds.has('S7-07')) fail('stage S7 must track Google Play readiness as S7-07');
for (const rule of ['noRebuild', 'noNewDatabase', 'noNewAuth', 'preserveExistingEbayArchitecture', 'verifyBeforeComplete', 'failedWorkRemainsOpen', 'stalePullRequestsMustBeRechecked', 'productionRequiresDeviceAndDeploymentEvidence']) {
  if (!object(register.rules) || register.rules[rule] !== true) fail(`mandatory programme rule ${rule} must remain true`);
}
const products = object(nicheRegistry) && object(nicheRegistry.products) ? nicheRegistry.products : {};
const nicheIds = Object.keys(products);
if (nicheIds.length !== 10) fail(`expected 10 registered niches, found ${nicheIds.length}`);
for (const [id, niche] of Object.entries(products)) {
  if (!object(niche) || niche.id !== id || !text(niche.name) || !text(niche.entry)) fail(`niche ${id} has invalid identity, name or entry route`);
}
if (!Array.isArray(register.knownReleaseRisks) || register.knownReleaseRisks.some(risk => !text(risk))) fail('knownReleaseRisks must be a string array');
const certification = object(register.nicheCertification) ? register.nicheCertification : {};
if (certification.source !== 'niche-modules.json') fail('certification source must be niche-modules.json');
const areas = Array.isArray(certification.requiredAreas) ? certification.requiredAreas : [];
if (areas.length < 15 || areas.some(area => !text(area)) || new Set(areas).size !== areas.length) fail('certification requires at least 15 distinct non-empty areas');
if (!areas.includes('google-play-store-compliance')) fail('certification must include google-play-store-compliance');
if (certification.records !== undefined && !object(certification.records)) fail('certification records must be an object');
for (const [nicheId, records] of Object.entries(object(certification.records) ? certification.records : {})) {
  if (!nicheIds.includes(nicheId) || !object(records)) { fail(`invalid certification niche ${nicheId}`); continue; }
  for (const [area, record] of Object.entries(records)) {
    if (!areas.includes(area) || !object(record) || !statuses.includes(record.status)) { fail(`invalid certification area ${nicheId}/${area}`); continue; }
    if (record.status === 'VERIFIED' && (!evidence(record.evidence) || typeof record.commitSha !== 'string' || !/^[a-f0-9]{40}$/i.test(record.commitSha) || !text(record.verifiedAt) || !Number.isFinite(Date.parse(record.verifiedAt)) || Date.parse(record.verifiedAt) > Date.now())) fail(`certification ${nicheId}/${area} needs resolved evidence, full tested commit SHA and past verification timestamp`);
  }
}
if (errors.length) {
  console.error('SWISH production register validation FAILED');
  errors.forEach(error => console.error(`- ${error}`));
  process.exit(1);
}
const tasks = stages.flatMap(stage => stage.tasks);
const counts = tasks.reduce((result, task) => { result[task.status] = (result[task.status] ?? 0) + 1; return result; }, {});
console.log('SWISH production register validation PASSED');
console.log(`Stages: ${stages.length} | Tasks: ${tasks.length} | Niches: ${nicheIds.length} | Required niche gates: ${nicheIds.length * areas.length}`);
console.log(`Task statuses: ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ')}`);
console.log('Validation of register structure is not production certification. No statuses were modified.');
