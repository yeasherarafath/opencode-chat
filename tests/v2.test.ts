import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDir,
  toolOutputText,
  convertAssistant,
  convertMessages,
  sessionToV1,
  V2Api,
} from "../src/OpenCodeV2";
import { filterReasoningParts, messageSig } from "../src/ReasoningUtils";

describe("v2 normalizeDir", () => {
  it("uppercases Windows drive letter", () => {
    assert.equal(normalizeDir("c:/Users/x"), "C:/Users/x");
    assert.equal(normalizeDir("C:/Users/x"), "C:/Users/x");
    assert.equal(normalizeDir("/home/x"), "/home/x");
    assert.equal(normalizeDir(""), "");
  });
});

describe("v2 toolOutputText", () => {
  it("handles string passthrough", () => {
    assert.equal(toolOutputText("hi"), "hi");
  });
  it("handles non-array non-string", () => {
    assert.equal(toolOutputText(null), "");
    assert.equal(toolOutputText(undefined), "");
    assert.equal(toolOutputText(123), "");
  });
  it("joins text items", () => {
    assert.equal(toolOutputText([{ type: "text", text: "a" }, { type: "text", text: "b" }]), "a\nb");
  });
  it("formats file items", () => {
    assert.equal(toolOutputText([{ type: "file", name: "x.png" }]), "[file] x.png");
  });
  it("skips unknown items", () => {
    assert.equal(toolOutputText([{ type: "other" }]), "");
  });
  it("handles edit tool output (Edited ...)", () => {
    // real log: edit tool returns string "Edited app/... (1 replacement)"
    assert.equal(toolOutputText("Edited tests/Feature/CryptoNewsSocialStaggerTest.php (1 replacement)"), "Edited tests/Feature/CryptoNewsSocialStaggerTest.php (1 replacement)");
  });
});

describe("v2 convertAssistant", () => {
  const sid = "ses_1";
  it("keeps text parts", () => {
    const { parts } = convertAssistant({ id: "m1", content: [{ type: "text", text: "hi" }] }, sid);
    assert.equal(parts.filter((p: any) => p.type === "text").length, 1);
  });
  it("skips empty reasoning (tool-only step regression)", () => {
    const { parts } = convertAssistant(
      { id: "m1", content: [{ type: "reasoning", text: "" }, { type: "tool", id: "t1", name: "edit", state: { status: "completed", input: {}, content: "Edited x" } }] },
      sid,
    );
    assert.ok(!parts.some((p: any) => p.type === "reasoning"));
    assert.ok(parts.some((p: any) => p.type === "tool"));
  });
  it("skips whitespace-only reasoning", () => {
    const { parts } = convertAssistant({ id: "m1", content: [{ type: "reasoning", text: "   " }] }, sid);
    assert.ok(!parts.some((p: any) => p.type === "reasoning"));
  });
  it("keeps real reasoning (log example)", () => {
    const { parts } = convertAssistant(
      { id: "m1", content: [{ type: "reasoning", text: "Verifying PHP syntax and designing a regression test for on-peak post staggering logic." }] },
      sid,
    );
    assert.equal(parts.filter((p: any) => p.type === "reasoning").length, 1);
  });
  it("maps tool states", () => {
    for (const status of ["streaming", "running", "error", "completed"]) {
      const { parts } = convertAssistant(
        { id: "m1", content: [{ type: "tool", id: "t1", name: "edit", state: { status, input: {}, content: [{ type: "text", text: "out" }] }, time: {} }] },
        sid,
      );
      const tool: any = parts.find((p: any) => p.type === "tool");
      assert.ok(tool, `tool for ${status}`);
      assert.ok((tool.state as any).status);
    }
  });
  it("adds step-finish when finish/tokens present", () => {
    const { parts } = convertAssistant({ id: "m1", content: [], finish: "tool-calls", tokens: { input: 1 } }, sid);
    assert.ok(parts.some((p: any) => p.type === "step-finish"));
  });
  it("maps error to info.error", () => {
    const { info } = convertAssistant({ id: "m1", content: [], error: { type: "x", message: "boom" } }, sid);
    assert.ok(info.error);
  });
  it("sig changes on reasoning-only growth", () => {
    const a = convertAssistant({ id: "m1", content: [{ type: "reasoning", text: "abc" }] }, sid);
    const b = convertAssistant({ id: "m1", content: [{ type: "reasoning", text: "abcdef" }] }, sid);
    const contentA = "";
    const sigA = messageSig(contentA, a.parts as any);
    const sigB = messageSig(contentA, b.parts as any);
    assert.notEqual(sigA, sigB);
  });
});

describe("v2 convertMessages", () => {
  it("converts user", () => {
    const out = convertMessages([{ type: "user", id: "u1", text: "hi" }], "s");
    assert.equal(out[0].info.role, "user");
  });
  it("converts assistant via convertAssistant", () => {
    const out = convertMessages([{ type: "assistant", id: "a1", content: [{ type: "text", text: "hi" }] }], "s");
    assert.equal(out[0].info.role, "assistant");
  });
  it("converts shell with command+output", () => {
    const out = convertMessages([{ type: "shell", id: "s1", command: "php -l x.php", output: { output: "No syntax errors" } }], "s");
    assert.equal(out.length, 1);
    assert.match(String((out[0].parts[0] as any).text), /php -l/);
  });
  it("drops unknown/bookkeeping types", () => {
    const out = convertMessages([{ type: "idle", id: "x" }, { type: "model-switched", id: "y" }], "s");
    assert.equal(out.length, 0);
  });
  it("filters empty reasoning from assistant list", () => {
    const out = convertMessages([{ type: "assistant", id: "a1", content: [{ type: "reasoning", text: "" }] }], "s");
    assert.ok(!out[0].parts.some((p: any) => p.type === "reasoning"));
  });
});

describe("v2 sessionToV1", () => {
  it("defaults title, maps directory", () => {
    const v1: any = sessionToV1({ id: "s", projectID: "p", time: { created: 1, updated: 2 }, location: { directory: "c:/x" } } as any);
    assert.equal(v1.title, "New session");
    assert.equal(v1.directory, "c:/x");
  });
  it("keeps title when present", () => {
    const v1: any = sessionToV1({ id: "s", title: "t", projectID: "p", time: { created: 1, updated: 2 } } as any);
    assert.equal(v1.title, "t");
  });
});

describe("v2 V2Api.request", () => {
  const origFetch = (globalThis as any).fetch;
  afterEach(() => { (globalThis as any).fetch = origFetch; });

  function mockFetch(handler: (url: URL, init: any) => any) {
    (globalThis as any).fetch = async (url: any, init: any) => handler(new URL(String(url)), init);
  }
  function jsonRes(data: any, ok = true, status = 200) {
    return { ok, status, headers: { get: () => "application/json" }, text: async () => (typeof data === "string" ? data : JSON.stringify(data)) };
  }

  it("sends auth + json headers, parses JSON", async () => {
    let seen: any = {};
    mockFetch((url, init) => { seen = { url: String(url), init }; return jsonRes({ data: 1 }); });
    const api = new V2Api("http://127.0.0.1:1", "Basic abc", "");
    const out = await api.request("POST", "/api/x", { a: 1 }, { q: "hi" });
    assert.equal((out as any).data, 1);
    assert.match(seen.url, /q=hi/);
    assert.equal(seen.init.headers.Authorization, "Basic abc");
  });
  it("omits empty query values", async () => {
    let seenUrl = "";
    mockFetch((url) => { seenUrl = String(url); return jsonRes({ data: [] }); });
    const api = new V2Api("http://127.0.0.1:1", "", "");
    await api.request("GET", "/api/session", undefined, { limit: 100, cursor: "", directory: undefined });
    assert.match(seenUrl, /limit=100/);
    assert.ok(!seenUrl.includes("cursor="));
  });
  it("throws with server message on !ok", async () => {
    mockFetch(() => jsonRes({ message: "boom" }, false, 500));
    const api = new V2Api("http://127.0.0.1:1", "", "");
    await assert.rejects(() => api.request("GET", "/api/x"), /boom/);
  });
  it("returns undefined on empty body", async () => {
    mockFetch(() => ({ ok: true, status: 200, headers: { get: () => "application/json" }, text: async () => "" }));
    const api = new V2Api("http://127.0.0.1:1", "", "");
    assert.equal(await api.request("GET", "/api/x"), undefined);
  });
  it("listSessions / getSession / createSession", async () => {
    mockFetch((url) => {
      const p = url.pathname;
      if (p === "/api/session" && url.searchParams.get("limit")) return jsonRes({ data: [{ id: "s1" }] });
      if (p === "/api/session/s1") return jsonRes({ data: { id: "s1" } });
      if (p === "/api/session") return jsonRes({ data: { id: "new" } });
      return jsonRes({});
    });
    const api = new V2Api("http://127.0.0.1:1", "", "c:/w");
    assert.equal((await api.listSessions())[0].id, "s1");
    assert.equal((await api.getSession("s1")).id, "s1");
    assert.equal((await api.createSession()).id, "new");
  });
  it("listMessages paginates", async () => {
    let calls = 0;
    mockFetch(() => { calls++; return calls === 1 ? jsonRes({ data: new Array(200).fill({ id: "m" }), cursor: { next: "c2" } }) : jsonRes({ data: [{ id: "last" }] }); });
    const api = new V2Api("http://127.0.0.1:1", "", "");
    const all = await api.listMessages("s");
    assert.equal(all.length, 201);
  });
  it("listMessages omits order when cursor set (400 regression)", async () => {
    const urls: string[] = [];
    let calls = 0;
    mockFetch((url) => {
      urls.push(String(url));
      calls++;
      return calls === 1 ? jsonRes({ data: new Array(200).fill({ id: "m" }), cursor: { next: "c2" } }) : jsonRes({ data: [] });
    });
    const api = new V2Api("http://127.0.0.1:1", "", "");
    await api.listMessages("s");
    assert.match(urls[0], /order=asc/);
    assert.match(urls[1], /cursor=c2/);
    assert.ok(!urls[1].includes("order="), "cursor page must not send order (server 400)");
  });
  it("events parses SSE frames, skips malformed", async () => {
    const enc = new TextEncoder();
    const frames = `data: {"type":"session.text.delta","data":{"delta":"hi"}}\n\n` + `data: not-json\n\n` + `data: {"type":"session.reasoning.delta","data":{"delta":"think"}}\n\n`;
    const bytes = enc.encode(frames);
    let i = 0;
    mockFetch(() => ({
      ok: true, status: 200,
      body: { getReader: () => ({ read: async () => (i++ === 0 ? { value: bytes, done: false } : { value: undefined, done: true }), cancel: async () => {} }) },
    }));
    const api = new V2Api("http://127.0.0.1:1", "", "");
    const ac = new AbortController();
    const got: any[] = [];
    for await (const ev of api.events(ac.signal)) got.push(ev);
    assert.equal(got.length, 2);
    assert.equal(got[0].type, "session.text.delta");
  });
});

describe("v2 filter integration", () => {
  it("end-to-end: empty reasoning never reaches UI parts", () => {
    const { parts } = convertAssistant({ id: "m", content: [{ type: "reasoning", text: "" }, { type: "text", text: "done" }] }, "s");
    assert.deepEqual(filterReasoningParts(parts as any).filter((p: any) => p.type === "reasoning"), []);
  });
  it("preserves file/patch parts so updated-file card renders", () => {
    const { parts } = convertAssistant(
      { id: "m", content: [{ type: "text", text: "done" }, { type: "file", filename: "a.php", url: "file://a" }, { type: "patch", files: ["a.php"], hash: "abc123" }] },
      "s",
    );
    assert.ok(parts.some((p: any) => p.type === "file"));
    assert.ok(parts.some((p: any) => p.type === "patch"));
  });
  it("tool metadata.files survives convertTool", () => {
    const { parts } = convertAssistant(
      { id: "m", content: [{ type: "tool", id: "t1", name: "edit", state: { status: "completed", input: { path: "a.php" }, content: "Edited a.php", metadata: { files: [{ file: "a.php" }] } } }] },
      "s",
    );
    const tool: any = parts.find((p: any) => p.type === "tool");
    assert.ok(tool);
    assert.equal((tool.state as any).metadata.files[0].file, "a.php");
  });
});
