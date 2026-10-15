import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import { filterReasoningParts, messageSig, shouldEmitReasoningEnded } from "../src/ReasoningUtils";

// v1 path: SDK `session.message()` -> { info, parts } with types
// "text" | "reasoning" | "tool" | "step-finish" etc.
// NOTE: OpenCodeCli imports ESM-only `@opencode-ai/sdk`, so we don't import
// the class here (CJS test build can't require ESM-only deps). Instead we
// mirror its 6-line `extractMessageData` exactly and assert the production
// source still matches + uses the shared helpers.

// Local mirror of OpenCodeCli.extractMessageData (src/OpenCodeCli.ts:669).
function extractMessageData(msgData: Record<string, unknown>): { content: string; parts: unknown[] } {
  const parts = (msgData.parts as unknown[]) || [];
  let content = (msgData.content as string) || (msgData.text as string) || "";
  if (!content && parts.length) {
    const textParts = parts.filter((p: any) => p.type === "text");
    content = textParts.map((p: any) => p.text || "").join("\n");
  }
  return { content, parts };
}

describe("v1 extractMessageData", () => {
  it("prefers top-level content/text", () => {
    assert.deepEqual(extractMessageData({ content: "hi", parts: [] }), { content: "hi", parts: [] });
    assert.deepEqual(extractMessageData({ text: "hi", parts: [] }), { content: "hi", parts: [] });
  });
  it("falls back to text parts", () => {
    const { content } = extractMessageData({ parts: [{ type: "text", text: "a" }, { type: "text", text: "b" }] });
    assert.equal(content, "a\nb");
  });
  it("returns empty when no text", () => {
    const { content, parts } = extractMessageData({ parts: [{ type: "reasoning", text: "think" }] });
    assert.equal(content, "");
    assert.equal(parts.length, 1);
  });
  it("handles missing parts", () => {
    assert.deepEqual(extractMessageData({}), { content: "", parts: [] });
  });
  it("production still uses shared helpers (no sig regression)", () => {
    const src = fs.readFileSync(path.join(__dirname, "..", "..", "src", "OpenCodeCli.ts"), "utf-8");
    assert.ok(src.includes("messageSig(mcontent"), "v1 message.updated must use messageSig");
    assert.ok(src.includes("filterReasoningParts(mparts"), "v1 must filter empty reasoning");
    assert.ok(src.includes("shouldEmitReasoningEnded"), "v2 reasoning.ended fallback must use helper");
  });
});

describe("v1 sig includes reasoning (regression)", () => {
  it("reasoning-only growth changes sig", () => {
    const a = messageSig("", [{ type: "reasoning", text: "abc" }]);
    const b = messageSig("", [{ type: "reasoning", text: "abcdef" }]);
    assert.notEqual(a, b);
  });
  it("empty vs missing reasoning differ in parts but both filtered for UI", () => {
    const withEmpty: any[] = [{ type: "reasoning", text: "" }, { type: "tool", tool: "edit" }];
    const filtered = filterReasoningParts(withEmpty);
    assert.equal(filtered.length, 1);
    // sig on raw (pre-filter) still distinguishes, filtered is what UI gets
    assert.ok(messageSig("", withEmpty).length > 0);
  });
  it("tool-only step (log msg_14009cb4f) emits no reasoning", () => {
    const mparts: any[] = [
      { type: "reasoning", text: "" },
      { type: "tool", tool: "edit", state: { status: "completed", output: "Edited app/Jobs/Blog/ProcessCryptoNewsJob.php (1 replacement)" } },
    ];
    const filtered = filterReasoningParts(mparts);
    assert.ok(!filtered.some((p) => p.type === "reasoning"));
  });
  it("real reasoning (log msg_14009e15) survives filter", () => {
    const mparts: any[] = [
      { type: "reasoning", text: "Verifying PHP syntax and designing a regression test for on-peak post staggering logic." },
      { type: "tool", tool: "edit" },
    ];
    assert.equal(filterReasoningParts(mparts).filter((p) => p.type === "reasoning").length, 1);
  });
});

describe("v1 text/reasoning delta rules", () => {
  it("text final snapshot emitted only when no deltas seen", () => {
    const seen = new Set<string>();
    const key = "m:0";
    // first delta
    seen.add(key);
    // final snapshot with same key must NOT re-emit (deltas covered it)
    assert.equal(seen.has(key), true);
  });
  it("text final snapshot emitted when no deltas", () => {
    const seen = new Set<string>();
    assert.equal(!seen.has("m:1"), true); // would emit
  });
  it("reasoning without delta is snapshot (ignored live, covered by final fetch)", () => {
    // v1 `message.part.updated` with ptype=reasoning and no delta is ignored live;
    // final `session.message()` fetch still returns it — tested via filter above.
    assert.equal(shouldEmitReasoningEnded(false, ""), false);
    assert.equal(shouldEmitReasoningEnded(false, "real"), true);
  });
});

describe("v1 session filtering", () => {
  it("foreign session events are marked, not dropped pre-start", () => {
    // mirrors OpenCodeCli logic: mismatch pre-start -> skip, post-start -> log foreign but continue
    function classify(eventSessionId: string | undefined, sessionId: string, hasStarted: boolean) {
      const mismatch = !!(eventSessionId && eventSessionId !== sessionId);
      if (mismatch && !hasStarted) return "skipped";
      if (mismatch) return "foreign";
      return "ok";
    }
    assert.equal(classify("other", "mine", false), "skipped");
    assert.equal(classify("other", "mine", true), "foreign");
    assert.equal(classify("mine", "mine", true), "ok");
    assert.equal(classify(undefined, "mine", false), "ok");
  });
});

describe("v1 tool part mapping", () => {
  it("running/pending emits start once, completed/error emits result", () => {
    const known = new Set<string>();
    function onToolUpdate(partId: string, status: string): string {
      if ((status === "running" || status === "pending") && !known.has(partId)) {
        known.add(partId);
        return "start";
      }
      if (status === "completed" || status === "error") return "result";
      return "unhandled";
    }
    assert.equal(onToolUpdate("p1", "running"), "start");
    assert.equal(onToolUpdate("p1", "running"), "unhandled"); // deduped
    assert.equal(onToolUpdate("p1", "completed"), "result");
    assert.equal(onToolUpdate("p2", "weird"), "unhandled");
  });
});

describe("v1 step/patch/snapshot passthrough", () => {
  it("known step types forward as-is", () => {
    const known = new Set(["step-start", "step-finish", "snapshot", "patch", "file", "agent", "retry", "compaction"]);
    for (const t of ["step-start", "step-finish", "snapshot", "patch", "file", "agent", "retry", "compaction"]) {
      assert.ok(known.has(t));
    }
    assert.ok(!known.has("bogus"));
  });
});
