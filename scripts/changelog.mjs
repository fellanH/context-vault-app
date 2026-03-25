#!/usr/bin/env node

/**
 * Add a changelog entry and optionally deploy.
 *
 * Usage:
 *   node scripts/changelog.mjs <version> <title> <bullet1> [bullet2] ...
 *   node scripts/changelog.mjs --deploy <version> <title> <bullet1> ...
 *
 * Examples:
 *   node scripts/changelog.mjs "1.1.0" "Search Improvements" "Faster semantic search" "New filter options"
 *   node scripts/changelog.mjs --deploy "1.1.0" "Search Improvements" "Faster semantic search"
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "..");
const changelogPath = resolve(root, "src/data/changelog.json");

const args = process.argv.slice(2);
let deploy = false;

if (args[0] === "--deploy") {
  deploy = true;
  args.shift();
}

const [version, title, ...bullets] = args;

if (!version || !title || bullets.length === 0) {
  console.error("Usage: node scripts/changelog.mjs [--deploy] <version> <title> <bullet1> [bullet2] ...");
  console.error('Example: node scripts/changelog.mjs "1.1.0" "Search Improvements" "Faster search" "New filters"');
  process.exit(1);
}

// Read existing changelog
const changelog = JSON.parse(readFileSync(changelogPath, "utf8"));

// Check for duplicate version
if (changelog.some((e) => e.version === version)) {
  console.error(`Version ${version} already exists in changelog. Bump the version or edit manually.`);
  process.exit(1);
}

// Prepend new entry
const entry = {
  version,
  date: new Date().toISOString().split("T")[0],
  title,
  bullets,
};

changelog.unshift(entry);
writeFileSync(changelogPath, JSON.stringify(changelog, null, 2) + "\n");

console.log(`\n  Added v${version}: ${title}`);
console.log(`  ${bullets.length} bullet(s), dated ${entry.date}\n`);

if (deploy) {
  console.log("  Committing and deploying...\n");
  execSync(`git add src/data/changelog.json`, { cwd: root, stdio: "inherit" });
  execSync(`git commit -m "changelog: v${version} — ${title}"`, { cwd: root, stdio: "inherit" });
  execSync(`git push origin main`, { cwd: root, stdio: "inherit" });
  execSync(`npm run deploy`, { cwd: root, stdio: "inherit" });
  console.log(`\n  v${version} deployed.\n`);
} else {
  console.log("  Run with --deploy to commit + deploy in one step.");
  console.log("  Or: git add src/data/changelog.json && git commit && npm run deploy\n");
}
