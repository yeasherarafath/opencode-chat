/**
 * release.js — Fully CLI-driven release script.
 *
 * Usage:
 *   node release.js                         # patch bump (0.1.0 -> 0.1.1)
 *   node release.js minor                   # 0.2.0
 *   node release.js major                   # 1.0.0
 *   node release.js 0.2.0                   # explicit version
 *   node release.js --dry-run               # preview only, no changes
 *   node release.js --force                 # bypass branch check
 *
 * All flags/args are positional:
 *   node release.js [version] [--dry-run] [--force]
 */

const { execSync } = require("child_process");
const { readFileSync, writeFileSync } = require("fs");
const path = require("path");

const PKG_PATH = path.join(__dirname, "package.json");
const TAG_PREFIX = "v";
const args = process.argv.slice(2);
const BUMP = args.find(a => /^[\d.]+$|^patch$|^minor$|^major$/.test(a)) || "patch";
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");

function run(cmd, opts = {}) {
  const write = opts.write !== false;
  const label = write && DRY_RUN ? "  ~ " : "  $ ";
  if (write && DRY_RUN) { console.log(label + cmd); return ""; }
  console.log(label + cmd);
  return execSync(cmd, { encoding: "utf8", stdio: opts.silent ? "pipe" : "inherit", ...opts }).trim();
}

function bail(msg) {
  console.error("\n  ERROR: " + msg + "\n");
  process.exit(1);
}

function readPkg() {
  return JSON.parse(readFileSync(PKG_PATH, "utf8"));
}

function writePkg(pkg) {
  writeFileSync(PKG_PATH, JSON.stringify(pkg, null, 2) + "\n");
}

function resolveVersion(bump) {
  const pkg = readPkg();
  const current = pkg.version;
  const parts = current.split(".").map(Number);

  let next;
  if (/^\d+\.\d+\.\d+$/.test(bump)) {
    next = bump;
  } else if (bump === "major") {
    next = [parts[0] + 1, 0, 0].join(".");
  } else if (bump === "minor") {
    next = [parts[0], parts[1] + 1, 0].join(".");
  } else {
    next = [parts[0], parts[1], parts[2] + 1].join(".");
  }
  return { current, next };
}

function main() {
  const BRANCH = run("git branch --show-current", { silent: true });

  console.log("\n  === OpenCode Chat Release ===\n");

  // -- Safety: clean working tree
  const status = run("git status --porcelain", { silent: true });
  if (status) {
    bail(`Working tree has uncommitted changes:\n${status.replace(/^/gm, "    ")}`);
  }

  // -- Safety: branch (bypass with --force)
  if (!FORCE && BRANCH !== "main" && BRANCH !== "master") {
    bail(`Releases must be on main/master (current: ${BRANCH}). Use --force to bypass.`);
  }

  // -- Version
  const { current, next } = resolveVersion(BUMP);
  const tag = TAG_PREFIX + next;

  const existing = run("git tag --list", { silent: true }).split("\n");
  if (existing.includes(tag)) {
    bail(`Tag "${tag}" already exists.`);
  }

  console.log(`  Version: ${current} -> ${next}`);
  console.log(`  Tag:     ${tag}`);
  console.log(`  Branch:  ${BRANCH}`);
  if (DRY_RUN) console.log("\n  *** DRY RUN — no changes will be made ***\n");

  // -- 1. Update package.json
  console.log("\n  [1/5] Update version...");
  const pkg = readPkg();
  pkg.version = next;
  if (!DRY_RUN) writePkg(pkg);

  // -- 2. Build
  console.log("  [2/5] Build...");
  try {
    run("npm run build");
  } catch {
    if (!DRY_RUN) {
      pkg.version = current;
      writePkg(pkg);
    }
    bail("Build failed. Version reverted.");
  }

  // -- 3. Package VSIX
  console.log("  [3/5] Package VSIX...");
  const vsixName = `${pkg.name}-${next}.vsix`;
  const vsixPath = path.join(__dirname, vsixName);
  try {
    run(`npx vsce package --out "${vsixPath}"`);
  } catch {
    if (!DRY_RUN) {
      pkg.version = current;
      writePkg(pkg);
    }
    bail("vsce packaging failed. Version reverted.");
  }

  // -- 4. Commit & tag
  console.log("  [4/5] Commit & tag...");
  run(`git add package.json`);
  run(`git commit -m "chore: release v${next}"`);
  run(`git tag "${tag}"`);

  // -- 5. Push & GitHub release
  console.log("  [5/5] Push & GitHub release...");
  const remote = run("git remote", { silent: true });
  if (remote) {
    run(`git push origin ${BRANCH} --tags`);
  } else {
    console.log("  No remote — skipping push.");
  }

  try {
    run(`gh release create "${tag}" "${vsixPath}" --title "v${next}" --generate-notes`);
  } catch {
    console.log("  gh CLI unavailable — skipping GitHub release.");
  }

  console.log(`\n  Done: v${current} -> v${next} (${tag})\n`);
}

main();
