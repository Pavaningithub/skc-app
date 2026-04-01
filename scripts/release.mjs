#!/usr/bin/env node
/**
 * Release script — bumps package.json version, commits, tags, and pushes.
 * Usage:  node scripts/release.mjs patch|minor|major
 *
 * The pushed semver tag (e.g. v1.6.9) triggers the CI/CD deploy workflow
 * which builds, deploys to Vercel production, and creates a GitHub Release.
 */

import { readFileSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '../package.json');

const bumpType = process.argv[2];
if (!['patch', 'minor', 'major'].includes(bumpType)) {
  console.error('Usage: node scripts/release.mjs patch|minor|major');
  process.exit(1);
}

// Read current version
const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'));
const [major, minor, patch] = pkg.version.split('.').map(Number);

let newVersion;
if (bumpType === 'major') newVersion = `${major + 1}.0.0`;
else if (bumpType === 'minor') newVersion = `${major}.${minor + 1}.0`;
else newVersion = `${major}.${minor}.${patch + 1}`;

const tag = `v${newVersion}`;

// Update package.json
pkg.version = newVersion;
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n', 'utf-8');
console.log(`Bumped version: ${pkg.version.replace(newVersion, '')}${newVersion} → ${tag}`);

// Git commit, tag, and push
try {
  execSync(`git add package.json`, { stdio: 'inherit' });
  execSync(`git commit -m "chore: release ${tag}"`, { stdio: 'inherit' });
  execSync(`git tag ${tag}`, { stdio: 'inherit' });
  execSync(`git push --follow-tags`, { stdio: 'inherit' });
  console.log(`\n✅ Released ${tag} — CI/CD will build and deploy to production.`);
} catch (err) {
  console.error('\n❌ Git operation failed:', err.message);
  process.exit(1);
}
