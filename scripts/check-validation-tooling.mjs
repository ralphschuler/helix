#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const failures = [];
const rootPackage = JSON.parse(readFileSync('package.json', 'utf8'));

function fail(message) {
  failures.push(message);
}

function requireFile(filePath) {
  if (!existsSync(filePath)) {
    fail(`missing required file: ${filePath}`);
    return false;
  }

  return true;
}

function workspacePackagePaths() {
  const packagePaths = [];

  for (const pattern of rootPackage.workspaces ?? []) {
    if (!pattern.endsWith('/*')) {
      fail(`unsupported workspace pattern: ${pattern}`);
      continue;
    }

    const root = pattern.slice(0, -2);
    if (!existsSync(root)) {
      fail(`missing workspace root: ${root}`);
      continue;
    }

    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;

      const packagePath = path.join(root, entry.name, 'package.json');
      if (existsSync(packagePath)) {
        packagePaths.push(packagePath);
      }
    }
  }

  return packagePaths.sort();
}

function requireScript(packageJson, packagePath, name, expectedFragment) {
  const script = packageJson.scripts?.[name];

  if (!script) {
    fail(`${packagePath} missing ${name} script`);
    return;
  }

  if (/node\s+-e|console\.log\(|^echo\b/.test(script)) {
    fail(`${packagePath} ${name} script is still a placeholder: ${script}`);
  }

  if (!script.includes(expectedFragment)) {
    fail(`${packagePath} ${name} script must include ${expectedFragment}: ${script}`);
  }
}

function requireCiCorepackSafety() {
  const workflowPath = '.github/workflows/ci.yml';
  if (!requireFile(workflowPath)) return;

  const workflow = readFileSync(workflowPath, 'utf8');
  const packageManager = rootPackage.packageManager ?? '';
  if (!packageManager.startsWith('yarn@')) return;

  const corepackIndex = workflow.indexOf('corepack enable');
  if (corepackIndex === -1) {
    fail(`${workflowPath} must enable Corepack before running Yarn ${packageManager}`);
  }

  const firstYarnRunIndex = workflow.search(/run:\s*yarn\b/);
  if (firstYarnRunIndex !== -1 && corepackIndex > firstYarnRunIndex) {
    fail(`${workflowPath} must run corepack enable before the first yarn command`);
  }

  const yarnCacheIndex = workflow.search(/cache:\s*['"]?yarn['"]?\s*(?:$|#)/m);
  if (yarnCacheIndex !== -1 && (corepackIndex === -1 || yarnCacheIndex < corepackIndex)) {
    fail(`${workflowPath} setup-node cache: yarn runs before Corepack; remove the cache option or enable Corepack before setup-node`);
  }
}

function requireRootScript(name, expectedFragment) {
  const script = rootPackage.scripts?.[name];

  if (!script) {
    fail(`package.json missing ${name} script`);
    return;
  }

  if (/node\s+-e|console\.log\(|^echo\b/.test(script)) {
    fail(`package.json ${name} script is still a placeholder: ${script}`);
  }

  if (!script.includes(expectedFragment)) {
    fail(`package.json ${name} script must include ${expectedFragment}: ${script}`);
  }
}

function requireInfraSmokeTooling() {
  const workflowPath = '.github/workflows/ci.yml';
  requireRootScript('infra:smoke', 'scripts/infra-smoke.mjs');
  requireFile('docker-compose.yml');
  requireFile('.env.example');
  requireFile('scripts/infra-smoke.mjs');

  if (!existsSync(workflowPath)) return;
  const workflow = readFileSync(workflowPath, 'utf8');
  for (const snippet of ['docker compose up -d', 'yarn infra:smoke', 'docker compose down']) {
    if (!workflow.includes(snippet)) {
      fail(`${workflowPath} must include ${snippet} for service-backed smoke validation`);
    }
  }
}

function requireControlPlaneTopology() {
  requireFile('apps/control-plane/package.json');

  if (existsSync('apps/ops-console/package.json')) {
    fail('apps/ops-console must not be an active v1 workspace; /admin lives in apps/control-plane');
  }

  if (!requireFile('README.md')) return;
  const readme = readFileSync('README.md', 'utf8');
  if (!readme.includes('`apps/control-plane`') || !readme.includes('/admin')) {
    fail('README.md must document /admin as part of apps/control-plane');
  }
}

requireFile('tsconfig.base.json');
requireFile('eslint.config.js');
requireFile('vitest.config.ts');
requireCiCorepackSafety();
requireInfraSmokeTooling();
requireControlPlaneTopology();

const packages = workspacePackagePaths();
if (packages.length === 0) {
  fail('no workspace packages found');
}

let testFiles = 0;

for (const packagePath of packages) {
  const packageJson = JSON.parse(readFileSync(packagePath, 'utf8'));
  const workspaceDir = path.dirname(packagePath);

  requireScript(packageJson, packagePath, 'check', 'tsc --noEmit -p tsconfig.json');
  requireScript(packageJson, packagePath, 'test', 'vitest run --passWithNoTests');
  requireScript(packageJson, packagePath, 'lint', 'eslint . --max-warnings 0');

  if (packageJson.type !== 'module') {
    fail(`${packagePath} must set type: module for ESM validation`);
  }

  requireFile(path.join(workspaceDir, 'tsconfig.json'));
  requireFile(path.join(workspaceDir, 'src/index.ts'));

  if (existsSync(path.join(workspaceDir, 'src/index.test.ts'))) {
    testFiles += 1;
  }
}

if (testFiles === 0) {
  fail('expected at least one workspace smoke test at src/index.test.ts');
}

if (failures.length > 0) {
  console.error('tooling:check failed');
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exit(1);
}

console.log('tooling:check passed');
