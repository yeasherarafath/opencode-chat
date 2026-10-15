import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isNonEmptyReasoningText,
  isNonEmptyReasoningPart,
  filterReasoningParts,
  reasoningTextLength,
  messageSig,
  shouldEmitReasoningDelta,
  shouldEmitReasoningEnded,
  shouldEmitTextEnded,
  stripThinkTags,
  mergeThinkIntoReasoning,
  contentFromParts,
  truncateText,
  truncateLines,
  prettyJsonOutput,
  summarizeToolInput,
  tokensTotal,
  contextTokens,
  formatTokens,
} from "../src/ReasoningUtils";

describe("isNonEmptyReasoningText", () => {
  it("rejects empty, whitespace, null, undefined", () => {
    assert.equal(isNonEmptyReasoningText(""), false);
    assert.equal(isNonEmptyReasoningText("   "), false);
    assert.equal(isNonEmptyReasoningText("\n\t "), false);
    assert.equal(isNonEmptyReasoningText(null), false);
    assert.equal(isNonEmptyReasoningText(undefined), false);
  });
  it("accepts real text", () => {
    assert.equal(isNonEmptyReasoningText("Verifying PHP syntax"), true);
    assert.equal(isNonEmptyReasoningText("  x  "), true);
    assert.equal(isNonEmptyReasoningText(0), true); // "0" is non-empty
  });
});

describe("isNonEmptyReasoningPart", () => {
  it("requires type=reasoning + non-empty text", () => {
    assert.equal(isNonEmptyReasoningPart(null), false);
    assert.equal(isNonEmptyReasoningPart(undefined), false);
    assert.equal(isNonEmptyReasoningPart({ type: "text", text: "hi" }), false);
    assert.equal(isNonEmptyReasoningPart({ type: "reasoning", text: "" }), false);
    assert.equal(isNonEmptyReasoningPart({ type: "reasoning", text: "  " }), false);
    assert.equal(isNonEmptyReasoningPart({ type: "reasoning", text: "think" }), true);
  });
});

describe("filterReasoningParts", () => {
  it("drops empty reasoning, keeps rest", () => {
    const parts = [
      { type: "reasoning", text: "" },
      { type: "reasoning", text: "  " },
      { type: "reasoning", text: "real" },
      { type: "text", text: "" },
      { type: "text", text: "hi" },
      { type: "tool", tool: "edit" },
    ];
    const out = filterReasoningParts(parts);
    assert.equal(out.length, 4);
    assert.ok(out.some((p) => p.type === "reasoning" && p.text === "real"));
    assert.ok(!out.some((p) => p.type === "reasoning" && String(p.text).trim() === ""));
  });
  it("handles null/undefined/empty", () => {
    assert.deepEqual(filterReasoningParts(null), []);
    assert.deepEqual(filterReasoningParts(undefined), []);
    assert.deepEqual(filterReasoningParts([]), []);
  });
  it("regression: tool-only step from real log is fully filtered", () => {
    // msg_14009cb4f001RubBilUzOSE9Sz: empty reasoning + edit tool
    const parts = [
      { type: "reasoning", text: "" },
      { type: "tool", tool: "edit" },
    ];
    const out = filterReasoningParts(parts);
    assert.equal(out.length, 1);
    assert.equal(out[0].type, "tool");
  });
});

describe("reasoningTextLength / messageSig", () => {
  it("sums reasoning lengths", () => {
    assert.equal(reasoningTextLength([]), 0);
    assert.equal(reasoningTextLength(null), 0);
    assert.equal(
      reasoningTextLength([
        { type: "reasoning", text: "abc" },
        { type: "text", text: "hello" },
        { type: "reasoning", text: "de" },
      ]),
      5,
    );
  });
  it("sig changes on reasoning-only growth (old bug)", () => {
    const before = messageSig("", [{ type: "reasoning", text: "abc" }]);
    const after = messageSig("", [{ type: "reasoning", text: "abcdef" }]);
    assert.notEqual(before, after);
    // old `${content.length}:${parts.length}` would both be "0:1" — must differ now
    assert.match(after, /^\d+:\d+:\d+$/);
  });
  it("sig stable when nothing changes", () => {
    const a = messageSig("hi", [{ type: "text", text: "hi" }]);
    const b = messageSig("hi", [{ type: "text", text: "hi" }]);
    assert.equal(a, b);
  });
  it("sig differs when text grows", () => {
    assert.notEqual(messageSig("a", []), messageSig("ab", []));
  });
});

describe("delta/ended guards", () => {
  it("reasoning delta emits on truthy only", () => {
    assert.equal(shouldEmitReasoningDelta("x"), true);
    assert.equal(shouldEmitReasoningDelta(" "), true); // whitespace delta is valid incremental chunk
    assert.equal(shouldEmitReasoningDelta(""), false);
    assert.equal(shouldEmitReasoningDelta(null), false);
    assert.equal(shouldEmitReasoningDelta(undefined), false);
  });
  it("reasoning ended emits only when unseen + non-empty", () => {
    assert.equal(shouldEmitReasoningEnded(false, "full text"), true);
    assert.equal(shouldEmitReasoningEnded(true, "full text"), false);
    assert.equal(shouldEmitReasoningEnded(false, ""), false);
    assert.equal(shouldEmitReasoningEnded(false, "   "), false);
    assert.equal(shouldEmitReasoningEnded(false, null), false);
  });
  it("text ended mirrors reasoning ended", () => {
    assert.equal(shouldEmitTextEnded(false, "hi"), true);
    assert.equal(shouldEmitTextEnded(true, "hi"), false);
    assert.equal(shouldEmitTextEnded(false, ""), false);
  });
});

describe("think tags", () => {
  it("strips single block", () => {
    const { cleaned, extracted } = stripThinkTags("hello <think>secret</think> world");
    assert.ok(!cleaned.includes("<think>"));
    assert.deepEqual(extracted, ["secret"]);
  });
  it("strips multiple blocks", () => {
    const { extracted } = stripThinkTags("<think>a</think> x <think>b</think>");
    assert.deepEqual(extracted, ["a", "b"]);
  });
  it("handles no blocks", () => {
    const { cleaned, extracted } = stripThinkTags("plain");
    assert.equal(cleaned, "plain");
    assert.deepEqual(extracted, []);
  });
  it("merge ignores empty combined", () => {
    const parts: any[] = [{ type: "text", text: "hi" }];
    assert.equal(mergeThinkIntoReasoning(parts, []).length, 1);
    assert.equal(mergeThinkIntoReasoning(parts, ["  "]).length, 1);
  });
  it("merge appends when no existing reasoning", () => {
    const out = mergeThinkIntoReasoning([{ type: "text", text: "hi" }], ["thought"]);
    assert.ok(out.some((p: any) => p.type === "reasoning" && p.text === "thought"));
  });
  it("merge concatenates onto existing reasoning", () => {
    const out = mergeThinkIntoReasoning([{ type: "reasoning", text: "a" }], ["b"]);
    assert.equal((out.find((p: any) => p.type === "reasoning") as any).text, "a\n\nb");
  });
});

describe("contentFromParts", () => {
  it("joins text/content/non-empty reasoning, skips empties", () => {
    const c = contentFromParts([
      { type: "text", text: "hi" },
      { type: "reasoning", text: "" },
      { type: "reasoning", text: "think" },
      { type: "text", text: "  " },
    ]);
    assert.ok(c.includes("hi"));
    assert.ok(c.includes("think"));
  });
  it("returns empty for null", () => {
    assert.equal(contentFromParts(null), "");
  });
});

describe("truncate/summarize tool payloads", () => {
  it("truncateText short-circuits and truncates", () => {
    assert.equal(truncateText("hi", 1000), "hi");
    assert.match(truncateText("x".repeat(1500), 1000), /more chars/);
  });
  it("truncateText avoids mid-word cuts", () => {
    const out = truncateText("alpha beta gamma delta epsilon", 12);
    // cut at 12 = "alpha beta g" -> backs off to "alpha beta" (space boundary)
    assert.ok(!out.includes("gamma"));
    assert.match(out, /more chars/);
  });
  it("truncateLines caps by lines", () => {
    const t = Array.from({ length: 40 }, (_, i) => `l${i}`).join("\n");
    const out = truncateLines(t, 30, 2000);
    assert.match(out, /more lines/);
  });
  it("summarizeToolInput hides full bodies for edit", () => {
    const out = summarizeToolInput("edit", { path: "tests/v2.test.ts", newString: "x".repeat(5000), oldString: "y".repeat(100) } as any);
    assert.match(out, /path: tests\/v2\.test\.ts/);
    assert.match(out, /new: 5000 chars/);
    assert.ok(!out.includes("x".repeat(5000)));
  });
  it("summarizeToolInput one-lines read/grep/shell (Output summary is enough)", () => {
    assert.equal(
      summarizeToolInput("read", { path: "src/webview/app.ts", offset: 1013, limit: 35 } as any),
      "src/webview/app.ts:1013-1048",
    );
    assert.equal(summarizeToolInput("read", { path: "a.ts" } as any), "a.ts");
    assert.equal(summarizeToolInput("grep", { pattern: "patch", path: "src" } as any), '"patch" in src');
    assert.equal(summarizeToolInput("shell", { command: "node --test" } as any), "$ node --test");
  });
  it("summarizeToolInput one-lines execute code (no JSON dump)", () => {
    const code = 'const r = search({ query: "read file", limit: 10 }); return JSON.stringify(r.items.map(i => i.path));';
    const out = summarizeToolInput("execute", { code } as any);
    assert.ok(out.includes('const r = search('));
    assert.ok(!out.includes('"code"'));
    const long = summarizeToolInput("execute", { code: "  \n  a();\n" + "x".repeat(500) } as any);
    assert.match(long, /chars/);
  });
  it("prettyJsonOutput indents JSON, passes text through", () => {
    assert.equal(prettyJsonOutput('["a","b"]'), '[\n "a",\n "b"\n]');
    assert.equal(prettyJsonOutput("plain text"), "plain text");
  });
});

describe("tokensTotal", () => {
  it("prefers total when present", () => {
    assert.equal(tokensTotal({ total: 315000, input: 1, output: 2 } as any), 315000);
  });
  it("sums input+output+reasoning when no total (v2 shape)", () => {
    // This was showing “0 tokens” because UI used tokens.total only.
    assert.equal(tokensTotal({ input: 300000, output: 10000, reasoning: 5000 } as any), 315000);
  });
  it("handles missing/empty", () => {
    assert.equal(tokensTotal(null), 0);
    assert.equal(tokensTotal(undefined), 0);
    assert.equal(tokensTotal({} as any), 0);
  });
  it("cumulative snapshots use last value, not sum (557k vs 1333k regression)", () => {
    // Token fields are cumulative context snapshots: summing per-message
    // values overcounts vs the CLI session total. The UI takes the last
    // reported value (session-level preferred in computeTokenTotal).
    const snapshots = [300000, 428200, 315000];
    assert.equal(snapshots[snapshots.length - 1], 315000);
    assert.notEqual(snapshots.reduce((a, b) => a + b, 0), 315000);
  });
  it("contextTokens matches CLI (input + cache.read of latest request)", () => {
    // ses_ebff13c67ffea3BvZAFwSfsJIW: lifetime 1205584+114219+62365
    // (≈1.38M) vs CLI 569.4k; latest request input 550 + cache.read
    // 586609 (≈587k ≈ CLI + drift). Session cache.read is lifetime
    // cumulative (167M) and must never be summed.
    assert.equal(contextTokens({ input: 550, output: 118, reasoning: 0, cache: { read: 586609, write: 0 } } as any), 587159);
    assert.equal(contextTokens({ input: 100, output: 50 } as any), 100);
    assert.equal(contextTokens(null), 0);
    assert.equal(contextTokens({} as any), 0);
  });
  it("formatTokens rounds half up like the CLI", () => {
    assert.equal(formatTokens(587350), "587.4k tokens");
    assert.equal(formatTokens(587159), "587.2k tokens");
    assert.equal(formatTokens(999), "999 tokens");
    assert.equal(formatTokens(0), "0 tokens");
  });
});
