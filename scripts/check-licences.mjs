#!/usr/bin/env node
/**
 * Licence gate — ARCHITECTURE.md §1.6.
 *
 * Fails the build when any installed package carries a denied licence, and when any package
 * reachable from a "shipped root" (code that can reach a client's site) carries a licence
 * outside the strict MIT/Apache/BSD/MPL set.
 *
 * An unresolvable or missing licence is treated as denied: "if a package's licence is unclear,
 * do not add it".
 */
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const policy = JSON.parse(readFileSync(join(root, 'licence-policy.json'), 'utf8'));

/** @param {string} p */
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
};

/** Collect every package manifest pnpm has materialised under node_modules/.pnpm. */
function collectInstalled() {
  /** @type {Map<string, {name:string, version:string, license:string|null, deps:Record<string,string>, dir:string}>} */
  const out = new Map();
  const store = join(root, 'node_modules', '.pnpm');
  if (!existsSync(store)) return out;
  for (const entry of readdirSync(store)) {
    const nm = join(store, entry, 'node_modules');
    if (!existsSync(nm)) continue;
    for (const pkgDir of readdirSync(nm)) {
      const dirs = pkgDir.startsWith('@')
        ? readdirSync(join(nm, pkgDir)).map((s) => join(pkgDir, s))
        : [pkgDir];
      for (const d of dirs) {
        const full = join(nm, d);
        if (!statSync(full).isDirectory()) continue;
        const pkg = readJson(join(full, 'package.json'));
        if (!pkg?.name || !pkg.version) continue;
        const key = `${pkg.name}@${pkg.version}`;
        if (out.has(key)) continue;
        out.set(key, {
          name: pkg.name,
          version: pkg.version,
          license: normaliseLicense(pkg),
          deps: { ...(pkg.dependencies ?? {}) },
          dir: full,
        });
      }
    }
  }
  return out;
}

/** @param {any} pkg */
function normaliseLicense(pkg) {
  if (typeof pkg.license === 'string') return pkg.license;
  if (pkg.license && typeof pkg.license === 'object' && typeof pkg.license.type === 'string') {
    return pkg.license.type;
  }
  if (Array.isArray(pkg.licenses) && pkg.licenses[0]?.type) return pkg.licenses[0].type;
  return null;
}

/** SPDX expressions: accept when EVERY disjunct-free term is allowed, or ANY branch of an OR is. */
function licenceAllowed(expr, allowed) {
  if (!expr) return false;
  const cleaned = expr.replace(/[()]/g, ' ').trim();
  if (/\bOR\b/i.test(cleaned)) {
    return cleaned.split(/\bOR\b/i).some((branch) => licenceAllowed(branch.trim(), allowed));
  }
  if (/\bAND\b/i.test(cleaned)) {
    return cleaned.split(/\bAND\b/i).every((branch) => licenceAllowed(branch.trim(), allowed));
  }
  return allowed.includes(cleaned);
}

function licenceDenied(expr) {
  if (!expr) return true; // unknown === unclear === denied
  return policy.denied.some((d) =>
    new RegExp(`\\b${d.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}`, 'i').test(expr),
  );
}

function workspacePackages() {
  const dir = join(root, 'packages');
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((d) => readJson(join(dir, d, 'package.json')))
    .filter(Boolean);
}

function main() {
  const installed = collectInstalled();
  const byName = new Map();
  for (const rec of installed.values()) {
    if (!byName.has(rec.name)) byName.set(rec.name, []);
    byName.get(rec.name).push(rec);
  }

  // Transitive prod closure of the shipped roots.
  const shipped = new Set();
  const seedNames = [];
  for (const ws of workspacePackages()) {
    if (policy.shippedRoots.includes(ws.name)) {
      seedNames.push(...Object.keys(ws.dependencies ?? {}));
    }
  }
  const queue = [...seedNames];
  while (queue.length) {
    const name = queue.shift();
    for (const rec of byName.get(name) ?? []) {
      const key = `${rec.name}@${rec.version}`;
      if (shipped.has(key)) continue;
      shipped.add(key);
      queue.push(...Object.keys(rec.deps));
    }
  }

  const allowedToolchain = [...policy.allowedShipped, ...policy.allowedToolchainExtra];
  /** @type {string[]} */
  const fatal = [];
  /** @type {string[]} */
  const shippedViolations = [];

  for (const [key, rec] of installed) {
    if (policy.exceptions[key]) continue;
    const lic = rec.license;
    if (licenceDenied(lic)) {
      fatal.push(`${key}: "${lic ?? 'UNKNOWN'}" is denied by policy (§1.6)`);
      continue;
    }
    const isShipped = shipped.has(key);
    const allowList = isShipped ? policy.allowedShipped : allowedToolchain;
    if (!licenceAllowed(lic, allowList)) {
      const msg = `${key}: "${lic}" not in ${isShipped ? 'shipped' : 'toolchain'} allowlist`;
      if (isShipped) shippedViolations.push(msg);
      else fatal.push(msg);
    }
  }

  const problems = [...fatal, ...shippedViolations];
  if (problems.length > 0) {
    console.error('Licence policy violations (ARCHITECTURE.md §1.6):');
    for (const p of problems) console.error(`  - ${p}`);
    console.error(
      '\nAdd nothing to licence-policy.json exceptions without a human decision; record the question in BLOCKED.md.',
    );
    process.exit(1);
  }

  console.log(
    `licences ok — ${installed.size} package(s) checked, ${shipped.size} in the shipped closure`,
  );
}

main();
