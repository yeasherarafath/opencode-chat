import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterReasoningParts,
  contentFromParts,
  stripThinkTags,
  mergeThinkIntoReasoning,
} from "../src/ReasoningUtils";

// Mirrors src/webview/app.ts logic:
// - appendMessageDOM skips reasoning with empty trim
// - session-loaded + message.complete strip <think>, merge, filter empty,
//   build content fallback, preserve non-empty streaming reasoning
// - response-end pushes streamingReasoning only when trim() non-empty

function cleanSessionLoadedParts(rawParts: any[]) {
  const extracted: string[] = [];
  const cleaned = rawParts.map((p: any) => {
    if ((p.type === "text" || p.type === "content") && typeof p.text === "string") {
      const { cleaned: c, extracted: e } = stripThinkTags(p.text);
      extracted.push(...e);
      return { ...p, text: c.trim() };
    }
    return p;
  });
  let parts: any[] = mergeThinkIntoReasoning(cleaned, extracted);
  parts = filterReasoningParts(parts);
  return parts;
}

describe("webview session-loaded cleaning", () => {
  it("drops empty reasoning (tool-only step)", () => {
    const parts = cleanSessionLoadedParts([
      { type: "reasoning", text: "" },
      { type: "tool", tool: "edit" },
    ]);
    assert.ok(!parts.some((p) => p.type === "reasoning"));
  });
  it("keeps real reasoning", () => {
    const parts = cleanSessionLoadedParts([
      { type: "reasoning", text: "Verifying PHP syntax and designing a regression test." },
    ]);
    assert.equal(parts.filter((p) => p.type === "reasoning").length, 1);
  });
  it("extracts <think> into reasoning, drops empty combined", () => {
    const withThink = cleanSessionLoadedParts([{ type: "text", text: "hi <think>  </think>" }]);
    assert.ok(!withThink.some((p) => p.type === "reasoning"));
    const withReal = cleanSessionLoadedParts([{ type: "text", text: "hi <think>thought</think>" }]);
    assert.ok(withReal.some((p) => p.type === "reasoning" && p.text === "thought"));
  });
  it("content fallback ignores empty reasoning", () => {
    const c = contentFromParts([
      { type: "reasoning", text: "" },
      { type: "text", text: "done" },
    ]);
    assert.equal(c, "done");
  });
  it("regression: log preview had 14 empty / 23 real — only real render", () => {
    const fakePreview = [
      ...Array.from({ length: 14 }, () => ({ type: "reasoning", text: "" })),
      ...Array.from({ length: 23 }, (_, i) => ({ type: "reasoning", text: `thought ${i}` })),
    ];
    assert.equal(filterReasoningParts(fakePreview).length, 23);
  });
});

describe("webview message.complete cleaning", () => {
  it("streaming reasoning preserved only when final lacks non-empty reasoning", () => {
    function preserve(finalParts: any[], streaming: string) {
      const hasReal = (finalParts || []).some((p: any) => p.type === "reasoning" && String(p.text || "").trim());
      if (streaming.trim() && !hasReal) return [...(finalParts || []), { type: "reasoning", text: streaming }];
      return finalParts;
    }
    assert.equal(preserve([], "live think").length, 1);
    assert.equal(preserve([{ type: "reasoning", text: "" }], "live").length, 2); // empty final doesn't count, streaming added
    assert.equal(preserve([{ type: "reasoning", text: "final" }], "live").length, 1);
    assert.equal(preserve([], "   ").length, 0);
  });
});

describe("webview response-end", () => {
  it("pushes streamingReasoning only when trim() non-empty", () => {
    function endParts(streamingParts: any[], streamingReasoning: string) {
      const parts = [...streamingParts];
      if (streamingReasoning.trim()) parts.push({ type: "reasoning", text: streamingReasoning });
      return parts;
    }
    assert.equal(endParts([], "").length, 0);
    assert.equal(endParts([], "  ").length, 0);
    assert.equal(endParts([], "think").length, 1);
  });
});

describe("webview render skip (appendMessageDOM)", () => {
  it("skips card when trim() empty", () => {
    function shouldRender(part: any) {
      if (part.type !== "reasoning") return true;
      return String(part.text || "").trim().length > 0;
    }
    assert.equal(shouldRender({ type: "reasoning", text: "" }), false);
    assert.equal(shouldRender({ type: "reasoning", text: "  " }), false);
    assert.equal(shouldRender({ type: "reasoning", text: "x" }), true);
    assert.equal(shouldRender({ type: "text", text: "" }), true); // text handled separately
  });
  it("renders v1/v2 tool type (edit) — regression for missing file card", () => {
    function rendersToolCard(part: any) {
      // mirrors fixed condition: tool_use || tool-call || tool
      return part.type === "tool_use" || part.type === "tool-call" || part.type === "tool";
    }
    assert.equal(rendersToolCard({ type: "tool", tool: "edit" }), true);
    assert.equal(rendersToolCard({ type: "tool_use", tool: "edit" }), true);
    assert.equal(rendersToolCard({ type: "reasoning" }), false);
  });
  it("surfaces metadata.files as visible file links", () => {
    function visibleFiles(meta: any) {
      const files = meta?.files as Array<string | { file?: string; path?: string; name?: string }> | undefined;
      if (!Array.isArray(files)) return [];
      return files
        .map((f) => (typeof f === "string" ? f : f.file || f.path || (f as any).name || ""))
        .filter(Boolean)
        .filter((fp) => !/[\\/]logs[\\/]opencode-chat[\\/]/i.test(fp));
    }
    assert.deepEqual(visibleFiles({ files: [{ file: "app/Jobs/x.php" }] }), ["app/Jobs/x.php"]);
    assert.deepEqual(visibleFiles({ files: ["a.php", ""] }), ["a.php"]);
    assert.deepEqual(visibleFiles({}), []);
    assert.deepEqual(visibleFiles(null), []);
  });
});
