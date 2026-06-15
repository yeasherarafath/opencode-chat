/**
 * release.js — Fully CLI-driven release script.
 *
 * The marketplace requires strict numeric semver (e.g. 0.2.0, 1.0.0).
 * Use "preview": true in package.json to mark pre-release versions.
 *
 * Usage:
 *   node release.js                         # patch bump (0.2.0 -> 0.2.1)
 *   node release.js minor                   # 0.3.0
 *   node release.js major                   # 1.0.0
 *   node release.js 0.3.0                   # explicit version
 *   node release.js --dry-run               # preview only, no changes
 *   node release.js --force                 # bypass branch check
 *
 * All flags/args are positional:
 *   node release.js [version|bump] [--dry-run] [--force]
 */

const { execSync, spawnSync } = require("child_process");
const { readFileSync, writeFileSync, existsSync, mkdirSync } = require("fs");
const path = require("path");

const PKG_PATH = path.join(__dirname, "package.json");
const TAG_PREFIX = "v";
const args = process.argv.slice(2);
const BUMP = args.find(a => /^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(a) || /^(patch|minor|major|beta)$/.test(a)) || "patch";
const DRY_RUN = args.includes("--dry-run");
const FORCE = args.includes("--force");

function sh(cmd) {
  console.log("  $ " + cmd);
  const r = spawnSync(cmd, [], { stdio: "inherit", shell: true, windowsHide: true });
  if (r.error) throw r.error;
  if (r.status !== 0) throw new Error(`exit code ${r.status}`);
  return r.stdout ? r.stdout.toString().trim() : "";
}

function shOut(cmd) {
  const r = spawnSync(cmd, [], { stdio: "pipe", shell: true, windowsHide: true });
  if (r.error) throw r.error;
  return r.stdout ? r.stdout.toString().trim() : "";
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

function exec(cmd) {
  if (DRY_RUN) { console.log("  ~ " + cmd); return ""; }
  return sh(cmd);
}

function resolveVersion(bump) {
  const pkg = readPkg();
  const current = pkg.version;
  const m = current.match(/^(\d+)\.(\d+)\.(\d+)(?:-beta\.(\d+))?$/);

  function core(a, b, c) { return [a, b, c].join("."); }

  let next;
  if (/^\d+\.\d+\.\d+(-beta\.\d+)?$/.test(bump)) {
    next = bump;
  } else if (bump === "major") {
    next = core(+m[1] + 1, 0, 0);
  } else if (bump === "minor") {
    next = core(m[1], +m[2] + 1, 0);
  } else if (bump === "beta") {
    if (m[4] !== undefined) {
      next = `${core(m[1], m[2], m[3])}-beta.${+m[4] + 1}`;
    } else {
      next = `${current}-beta.0`;
    }
  } else {
    next = core(m[1], m[2], +m[3] + 1);
  }
  return { current, next };
}

function main() {
  const BRANCH = shOut("git branch --show-current");

  console.log("\n  === OpenCode Chat Release ===\n");

  // -- Safety: clean working tree
  const status = shOut("git status --porcelain");
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

  const existing = shOut("git tag --list").split("\n");
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
  if (next.includes("-beta")) {
    pkg.preview = true;
  } else {
    delete pkg.preview;
  }
  if (!DRY_RUN) {
    writePkg(pkg);
    console.log(`  Wrote package.json: ${current} -> ${next} (preview: ${!!pkg.preview})`);
  }

  // -- 2. Build
  console.log("  [2/5] Build...");
  try {
    exec("npm run build");
  } catch (e) {
    if (!DRY_RUN) {
      pkg.version = current;
      writePkg(pkg);
    }
    bail("Build failed: " + (e.message || e) + ". Version reverted.");
  }

  // -- 3. Package VSIX
  console.log("  [3/5] Package VSIX...");
  const releaseDir = path.join(__dirname, "release");
  if (!existsSync(releaseDir)) mkdirSync(releaseDir, { recursive: true });
  const vsixName = `${pkg.name}-${next}.vsix`;
  const vsixPath = path.join(releaseDir, vsixName);
  try {
    exec(`npx vsce package --out "${vsixPath}"`);
  } catch (e) {
    if (!DRY_RUN) {
      pkg.version = current;
      writePkg(pkg);
    }
    bail("vsce packaging failed: " + (e.message || e) + ". Version reverted.");
  }

  // -- 4. Commit & tag
  console.log("  [4/5] Commit & tag...");
  exec(`git add package.json`);
  exec(`git commit -m "chore: release v${next}"`);
  exec(`git tag "${tag}"`);

  // -- 5. Push & GitHub release
  console.log("  [5/5] Push & GitHub release...");
  const remote = shOut("git remote");
  if (remote) {
    exec(`git push origin ${BRANCH} --tags`);
  } else {
    console.log("  No remote — skipping push.");
  }

  let releaseUrl = "";
  try {
    exec(`gh release create "${tag}" "${vsixPath}" --title "v${next}" --generate-notes`);
    console.log(`  \u2713 GitHub release created: ${tag}`);
  } catch {
    try {
      const remoteUrl = shOut("git remote get-url origin");
      const repo = remoteUrl.match(/[:/]([^/]+\/[^/.]+)(\.git)?$/)?.[1] || "your-repo";
      releaseUrl = `https://github.com/${repo}/releases/new?tag=${tag}`;
    } catch { /* no remote */ }
    console.log("  ! WARNING: gh CLI unavailable — VSIX not attached to release.");
    console.log(`  ! File saved locally: ${vsixPath}`);
    console.log(`  ! Upload manually${releaseUrl ? ': ' + releaseUrl : ' to GitHub Releases'}`);
  }

  console.log(`\n  Done: v${current} -> v${next} (${tag})\n`);
}

main();
