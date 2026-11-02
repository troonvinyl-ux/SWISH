#!/usr/bin/env node
/**
 * Validate SWISH's evidence-based production readiness register.
 * This is deliberately read-only: it never edits readiness statuses.
 */
import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const registerPath = path.join(root, 'docs/SWISH_FOUNDATION_MASTER_REGISTER.json');
const nichePath = path.join(root, 'niche-modules.json');
const errors = [];
const fail = (message) => errors.push(message);
const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

let register;
let nicheRegistry;
try { register = readJson(registerPath); } catch (error) {
  console.error(`FAIL: cannot parse ${registerPath}: ${error.message}`);
  process.exit(1);
}
try { nicheRegistry = readJson(nichePath); } catch (error) {
  console.error(`FAIL: cannot parse ${nichePath}: ${error.message}`);
  process.exit(1);
}

const allowedStatuses = new Set(register.statuses ?? []);
if (!allowedStatuses.size) fail('register.statuses must declare the allowed status vocabulary');
if (register.schemaVersion !== 1) fail('unsupported or missing schemaVersion');
if (!Array.isArray(register.stages) || register.stages.length === 0) fail('register must contain at least one stage');

const stageIds = new Set();
const taskIds = new Set();
for (const stage of register.stages ?? []) {
  if (!stage.id || stageIds.has(stage.id)) fail(`stage has a missing or duplicate id: ${stage.id ?? '(missing)'}`);
  stageIds.add(stage.id);
  if (!allowedStatuses.has(stage.status)) fail(`stage ${stage.id} has unsupported status "${stage.status}"`);
  if (!Array.isArray(stage.tasks)) {
    fail(`stage ${stage.id} must contain a tasks array`);
    continue;
  }
  for (const task of stage.tasks) {
    if (!task.id || taskIds.has(task.id)) fail(`task has a missing or duplicate id: ${task.id ?? '(missing)'}`);
    taskIds.add(task.id);
    if (!allowedStatuses.has(task.status)) fail(`task ${task.id} has unsupported status "${task.status}"`);
    if (task.status === 'VERIFIED' && (typeof task.evidence !== 'string' || !task.evidence.trim())) {
      fail(`task ${task.id} is VERIFIED but has no evidence reference`);
    }
    if (task.status === 'VERIFIED' && /\b(todo|tbd|pending|not verified)\b/i.test(task.evidence ?? '')) {
      fail(`task ${task.id} is VERIFIED but its evidence appears unresolved`);
    }
  }
}

const requiredRules = [
  'noRebuild',
  'noNewDatabase',
  'noNewAuth',
  'preserveExistingEbayArchitecture',
  'verifyBeforeComplete',
  'failedWorkRemainsOpen',
  'stalePullRequestsMustBeRechecked',
  'productionRequiresDeviceAndDeploymentEvidence',
];
for (const rule of requiredRules) {
  if (register.rules?.[rule] !== true) fail(`mandatory programme rule ${rule} must remain true`);
}

const products = nicheRegistry?.products;
if (!products || typeof products !== 'object' || Array.isArray(products)) {
  fail('niche-modules.json must expose a products object');
} else {
  const nicheIds = Object.keys(products);
  if (nicheIds.length !== 10) fail(`expected 10 registered niches, found ${nicheIds.length}`);
  for (const id of nicheIds) {
    const niche = products[id];
    if (!niche?.name || !niche?.entry) fail(`niche ${id} is missing its name or entry route`);
  }
}

const areas = register.nicheCertification?.requiredAreas;
if (!Array.isArray(areas) || areas.length < 15 || areas.some((area) => typeof area !== 'string' || !area.trim())) {
  fail('nicheCertification.requiredAreas must contain at least 15 complete non-empty certification areas');
}
if (!areas?.includes('google-play-store-compliance')) {
  fail('nicheCertification.requiredAreas must include google-play-store-compliance');
}
if (!register.stages?.find((stage) => stage.id === 'S7')?.tasks?.some((task) => task.id === 'S7-07')) {
  fail('stage S7 must track Google Play release readiness as task S7-07');
}

if (errors.length) {
  console.error('SWISH production register validation FAILED');
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

const tasks = (register.stages ?? []).flatMap((stage) => stage.tasks ?? []);
const counts = tasks.reduce((result, task) => {
  result[task.status] = (result[task.status] ?? 0) + 1;
  return result;
}, {});
console.log('SWISH production register validation PASSED');
console.log(`Stages: ${register.stages.length} | Tasks: ${tasks.length} | Niches: ${Object.keys(products).length}`);
console.log(`Task statuses: ${Object.entries(counts).map(([status, count]) => `${status}=${count}`).join(', ')}`);
console.log('Verified tasks require explicit evidence. No readiness statuses were modified.');
