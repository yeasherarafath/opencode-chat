import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizePatchFiles, classifyDiffLine, diffLines } from "../src/ReasoningUtils";
import { parseUnifiedDiff } from "../src/ReasoningUtils";

describe("patch-format: normalizePatchFiles", () => {
  it("accepts string list", () => {
    assert.deepEqual(normalizePatchFiles(["a.php", "  ", "b.ts"]), [
      { file: "a.php" },
      { file: "b.ts" },
    ]);
  });
  it("accepts objects with patch + stats", () => {
    const out = normalizePatchFiles([
      { file: "tests/v2.test.ts", patch: "Index: tests/v2.test.ts\n+x", status: "modified", additions: 17, deletions: 0 },
    ]);
    assert.equal(out[0].file, "tests/v2.test.ts");
    assert.equal(out[0].additions, 17);
    assert.ok(out[0].patch!.includes("+x"));
  });
  it("drops empties, handles null", () => {
    assert.deepEqual(normalizePatchFiles(null), []);
    assert.deepEqual(normalizePatchFiles([]), []);
    assert.deepEqual(normalizePatchFiles([{ file: "" }]), []);
  });
});

describe("patch-format: classifyDiffLine", () => {
  it("classifies headers, hunks, adds, dels, context", () => {
    assert.equal(classifyDiffLine("Index: a.php"), "header");
    assert.equal(classifyDiffLine("--- a.php"), "header");
    assert.equal(classifyDiffLine("+++ b.php"), "header");
    assert.equal(classifyDiffLine("@@ -1,2 +1,3 @@"), "hunk");
    assert.equal(classifyDiffLine("+added"), "add");
    assert.equal(classifyDiffLine("-removed"), "del");
    assert.equal(classifyDiffLine(" context"), "ctx");
  });
});

describe("patch-format: diffLines", () => {
  it("splits and caps at 200 with truncated count", () => {
    const patch = Array.from({ length: 250 }, (_, i) => `+line${i}`).join("\n") + "\n";
    const { lines, truncated } = diffLines(patch);
    assert.equal(lines.length, 200);
    assert.equal(truncated, 50);
  });
  it("respects custom maxLines", () => {
    const { lines, truncated } = diffLines("+a\n+b\n+c\n", 2);
    assert.deepEqual(lines, ["+a", "+b"]);
    assert.equal(truncated, 1);
  });
  it("returns all when under cap, drops final newline", () => {
    const { lines, truncated } = diffLines("+a\n-b\n");
    assert.deepEqual(lines, ["+a", "-b"]);
    assert.equal(truncated, 0);
  });
  it("handles empty", () => {
    assert.deepEqual(diffLines(null), { lines: [], truncated: 0 });
    assert.deepEqual(diffLines(""), { lines: [], truncated: 0 });
  });
});

describe("patch-format: parseUnifiedDiff", () => {
  it("numbers hunks old/new sides", () => {
    const { rows, truncated } = parseUnifiedDiff("@@ -10,3 +20,4 @@\n ctx\n-del\n+add1\n+add2");
    assert.equal(truncated, 0);
    assert.deepEqual(rows[0], { kind: "hunk", text: "@@ -10,3 +20,4 @@", oldNo: null, newNo: null });
    assert.deepEqual(rows[1], { kind: "ctx", text: " ctx", oldNo: 10, newNo: 20 });
    assert.deepEqual(rows[2], { kind: "del", text: "-del", oldNo: 11, newNo: null });
    assert.deepEqual(rows[3], { kind: "add", text: "+add1", oldNo: null, newNo: 21 });
    assert.deepEqual(rows[4], { kind: "add", text: "+add2", oldNo: null, newNo: 22 });
  });
  it("keeps pre-hunk headers unnumbered, caps rows", () => {
    const { rows, truncated } = parseUnifiedDiff("Index: a.php\n@@ -1 +1 @@\n-x", 2);
    assert.equal(rows.length, 2);
    assert.equal(rows[0].kind, "header");
    assert.equal(truncated, 1);
  });
  it("handles empty", () => {
    assert.deepEqual(parseUnifiedDiff(null), { rows: [], truncated: 0 });
  });
});
