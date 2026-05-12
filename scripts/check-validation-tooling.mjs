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

requireFile('tsconfig.base.json');
requireFile('eslint.config.js');
requireFile('vitest.config.ts');

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
