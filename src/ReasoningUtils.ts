// Shared pure helpers for reasoning / text event handling (v1 + v2 + webview).
// Extracted so the filtering rules have a single source of truth and can be
// unit-tested without a server, DOM, or VS Code host.
//
// Background: opencode creates 0-length `reasoning` parts for tool-only steps
// (e.g. `Edited tests/Feature/CryptoNewsSocialStaggerTest.php`). Rendering
// those produces blank "Reasoned for ..." cards. All entry points must drop
// empty reasoning and include reasoning length in change-detection sigs.

export interface PartLike {
  type?: string;
  text?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

export function isNonEmptyReasoningText(text: unknown): boolean {
  return String(text ?? "").trim().length > 0;
}

export function isNonEmptyReasoningPart(part: PartLike | null | undefined): boolean {
  if (!part || part.type !== "reasoning") return false;
  return isNonEmptyReasoningText(part.text);
}

/** Drop empty reasoning blocks, keep everything else (including empty text). */
export function filterReasoningParts<T extends PartLike>(parts: T[] | undefined | null): T[] {
  if (!parts || !parts.length) return [];
  return parts.filter((p) => p.type !== "reasoning" || isNonEmptyReasoningText((p as PartLike).text));
}

export function reasoningTextLength(parts: PartLike[] | undefined | null): number {
  if (!parts) return 0;
  let total = 0;
  for (const p of parts) {
    if (p?.type === "reasoning") {
      total += String(p.text ?? "").length;
    }
  }
  return total;
}

/**
 * Change-detection signature for assistant messages.
 * Must include reasoning length — `${content.length}:${parts.length}` alone
 * misses reasoning-only growth and causes real thinking to be skipped as
 * "unchanged".
 */
export function messageSig(content: string, parts: PartLike[] | undefined | null): string {
  const c = content ?? "";
  const list = parts ?? [];
  return `${c.length}:${list.length}:${reasoningTextLength(list)}`;
}

export function shouldEmitReasoningDelta(delta: unknown): boolean {
  return !!delta;
}

export function shouldEmitReasoningEnded(seenKey: boolean, text: unknown): boolean {
  return !seenKey && isNonEmptyReasoningText(text);
}

export function shouldEmitTextEnded(seenKey: boolean, text: unknown): boolean {
  return !seenKey && !!text;
}

/** Format token counts like the CLI ("569.4k tokens"). Round half up on the
 * decimal to avoid binary-float toFixed artifacts (587350 → "587.4k",
 * where toFixed(1) can yield "587.3k"). */
export function formatTokens(tokens: number): string {
  if (tokens >= 1000) return (Math.round(tokens / 100) / 10).toFixed(1) + "k tokens";
  return Math.round(tokens) + " tokens";
}

/** Total tokens for v1/v2 shapes: prefer `total`, else input+output+reasoning. */
export function tokensTotal(t: Record<string, unknown> | undefined | null): number {
  if (!t) return 0;
  if (typeof (t as any).total === "number" && (t as any).total > 0) return (t as any).total as number;
  const input = typeof (t as any).input === "number" ? (t as any).input as number : 0;
  const output = typeof (t as any).output === "number" ? (t as any).output as number : 0;
  const reasoning = typeof (t as any).reasoning === "number" ? (t as any).reasoning as number : 0;
  return input + output + reasoning;
}

/**
 * Current-context tokens as the CLI shows them ("569.4k (54%)" = share of
 * window). Verified against a real export (ses_ebff13c67ffea3BvZAFwSfsJIW):
 * session lifetime was input 1205584 + output 114219 + reasoning 62365
 * (≈1.38M, what the header wrongly showed as 1352.8k) while the last
 * request carried input 550 + cache.read 586609 (≈587k ≈ CLI 569.4k +
 * drift). Session-level cache.read is lifetime-cumulative (167M here) so
 * session totals must NOT be used — take the latest request's
 * input + cache.read.
 */
export function contextTokens(t: Record<string, unknown> | undefined | null): number {
  if (!t) return 0;
  const input = typeof (t as any).input === "number" ? (t as any).input as number : 0;
  const cache = (t as any).cache as Record<string, unknown> | undefined;
  const read = cache && typeof cache.read === "number" ? (cache.read as number) : 0;
  return input + read;
}

const THINK_RE = /<think>([\s\S]*?)<\/think>/g;

/** Remove `<think>…</think>` blocks, returning cleaned text + extracted blocks. */
export function stripThinkTags(text: string): { cleaned: string; extracted: string[] } {
  const extracted: string[] = [];
  if (!text) return { cleaned: "", extracted };
  const cleaned = text.replace(THINK_RE, (_m: string, c: string) => {
    extracted.push(c);
    return "";
  });
  return { cleaned, extracted };
}

/**
 * Merge extracted `<think>` blocks into a parts list as reasoning.
 * Empty combined blocks are ignored (no blank cards).
 */
export function mergeThinkIntoReasoning<T extends PartLike>(parts: T[], extracted: string[]): T[] {
  const combined = (extracted ?? []).join("\n\n").trim();
  if (!combined) return parts;
  const existing = (parts as PartLike[]).find((p) => p.type === "reasoning") as T | undefined;
  if (existing) {
    const prev = String((existing as PartLike).text ?? "");
    (existing as PartLike).text = prev ? prev + "\n\n" + combined : combined;
    return parts;
  }
  return [...parts, { type: "reasoning", text: combined } as T];
}

/** Build fallback display text from parts, ignoring empty entries. */
export function contentFromParts(parts: PartLike[] | undefined | null): string {
  if (!parts) return "";
  return parts
    .filter(
      (p) =>
        p.type === "text" ||
        p.type === "content" ||
        (p.type === "reasoning" && isNonEmptyReasoningText(p.text)),
    )
    .map((p) => String(p.text ?? p.content ?? ""))
    .filter((t) => t.trim().length > 0)
    .join("\n");
}

/** Truncate long tool payloads for UI (edit newString can be a whole file). */
export function truncateText(text: string, max = 1000): string {
  if (!text) return "";
  if (text.length <= max) return text;
  // Avoid mid-word cuts like "JS…": back off to a newline/space boundary.
  let cut = text.slice(0, max);
  const nl = cut.lastIndexOf("\n");
  const sp = cut.lastIndexOf(" ");
  const boundary = Math.max(nl, sp);
  if (boundary > max * 0.6) cut = cut.slice(0, boundary);
  return cut + `\n… (+${text.length - max} more chars)`;
}

/** Case-insensitive occurrence offsets of query in text (for find-highlight). */
export function findQueryHits(text: string, query: string): number[] {
  const hits: number[] = [];
  if (!text || !query) return hits;
  const tl = text.toLowerCase();
  const q = query.toLowerCase();
  let i = tl.indexOf(q);
  while (i >= 0) {
    hits.push(i);
    i = tl.indexOf(q, i + q.length);
  }
  return hits;
}

/** Pretty-print JSON tool output (e.g. execute results) — raw text otherwise. */
export function prettyJsonOutput(text: string): string {
  try {
    return JSON.stringify(JSON.parse(text), null, 1);
  } catch {
    return text;
  }
}

/** Truncate code-ish output by lines (reads better than char cuts). */
export function truncateLines(text: string, maxLines = 30, maxChars = 2000): string {
  if (!text) return "";
  const lines = String(text).split("\n");
  let out = lines;
  let cutLines = 0;
  if (lines.length > maxLines) {
    out = lines.slice(0, maxLines);
    cutLines = lines.length - maxLines;
  }
  let joined = out.join("\n");
  if (joined.length > maxChars) {
    joined = truncateText(joined, maxChars);
    return joined;
  }
  return cutLines > 0 ? joined + `\n… (+${cutLines} more lines)` : joined;
}

/** Summarize edit/write tool input without dumping whole file bodies. */
export function summarizeToolInput(tool: string, input: Record<string, unknown> | undefined | null): string {
  if (!input) return "";
  try {
    // For edit/write, show path + sizes instead of full newString/oldString.
    if (tool === "edit" || tool === "write") {
      const path = String((input as any).path || (input as any).file || "");
      const ns = String((input as any).newString ?? (input as any).content ?? "");
      const os = String((input as any).oldString ?? "");
      const bits: string[] = [];
      if (path) bits.push(`path: ${path}`);
      if (ns) bits.push(`new: ${ns.length} chars`);
      if (os) bits.push(`old: ${os.length} chars`);
      // Still include full JSON truncated so nothing is lost when expanded.
      const full = JSON.stringify(input, null, 2);
      return (bits.length ? bits.join(" · ") + "\n" : "") + truncateText(full, 2000);
    }
    // Read-only tools: one-line summary is enough (Output already has
    // "Read src/webview/app.ts:1013-1047"). Skip the full JSON dump.
    if (tool === "read") {
      const p = String((input as any).path || "");
      const off = (input as any).offset as number | undefined;
      const lim = (input as any).limit as number | undefined;
      if (p && typeof off === "number") {
        const end = typeof lim === "number" ? off + lim : off;
        return `${p}:${off}-${end}`;
      }
      if (p) return p;
    }
    if (tool === "grep" || tool === "search") {
      const pat = String((input as any).pattern || (input as any).query || "");
      const p = String((input as any).path || "");
      return [pat && `"${truncateText(pat, 120)}"`, p && `in ${p}`].filter(Boolean).join(" ");
    }
    if (tool === "glob") {
      const pat = String((input as any).pattern || "");
      const p = String((input as any).path || "");
      return [pat, p && `in ${p}`].filter(Boolean).join(" ");
    }
    if (tool === "shell") {
      const cmd = String((input as any).command || "");
      if (cmd) return "$ " + truncateText(cmd, 300);
    }
    if (tool === "execute") {
      const code = String((input as any).code || "");
      const first = code.split("\n").map((s) => s.trim()).find((s) => s.length) || "";
      return truncateText(first, 160) + (code.length > 200 ? `  ·  ${code.length} chars` : "");
    }
    return truncateText(JSON.stringify(input, null, 2), 2000);
  } catch {
    return truncateText(String(input), 2000);
  }
}

export interface NormalizedPatchFile {
  file: string;
  patch?: string;
  status?: string;
  additions?: number;
  deletions?: number;
}

/** Normalize patch/file entries (string[] or objects with patch text). */
export function normalizePatchFiles(raw: unknown): NormalizedPatchFile[] {
  if (!raw || !Array.isArray(raw)) return [];
  const out: NormalizedPatchFile[] = [];
  for (const f of raw as Array<string | Record<string, unknown>>) {
    if (typeof f === "string") {
      if (f.trim()) out.push({ file: f });
    } else if (f && typeof f === "object") {
      const file = String((f as any).file || (f as any).path || (f as any).name || "").trim();
      if (!file) continue;
      out.push({
        file,
        patch: typeof (f as any).patch === "string" ? (f as any).patch as string : undefined,
        status: typeof (f as any).status === "string" ? (f as any).status as string : undefined,
        additions: typeof (f as any).additions === "number" ? (f as any).additions as number : undefined,
        deletions: typeof (f as any).deletions === "number" ? (f as any).deletions as number : undefined,
      });
    }
  }
  return out;
}

export type DiffLineKind = "header" | "hunk" | "add" | "del" | "ctx";

/** Classify a unified-diff line for formatting. */
export function classifyDiffLine(line: string): DiffLineKind {
  if (line.startsWith("Index:") || line.startsWith("--- ") || line.startsWith("+++ ")) return "header";
  if (line.startsWith("@@")) return "hunk";
  if (line.startsWith("+") && !line.startsWith("+++")) return "add";
  if (line.startsWith("-") && !line.startsWith("---")) return "del";
  return "ctx";
}

/** Split patch text into lines, capped for UI (default 200). */
export function diffLines(patch: string | undefined | null, maxLines = 200): { lines: string[]; truncated: number } {
  if (!patch) return { lines: [], truncated: 0 };
  const all = String(patch).split("\n");
  // Drop trailing empty line from final newline.
  if (all.length && all[all.length - 1] === "") all.pop();
  if (all.length <= maxLines) return { lines: all, truncated: 0 };
  return { lines: all.slice(0, maxLines), truncated: all.length - maxLines };
}

export interface DiffRow {
  kind: DiffLineKind;
  text: string;
  oldNo: number | null;
  newNo: number | null;
}

/** Parse a unified diff into rows with old/new line numbers (GitHub-style). */
export function parseUnifiedDiff(patch: string | undefined | null, maxRows = 200): { rows: DiffRow[]; truncated: number } {
  if (!patch) return { rows: [], truncated: 0 };
  const raw = String(patch).split("\n");
  if (raw.length && raw[raw.length - 1] === "") raw.pop();
  const rows: DiffRow[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of raw) {
    if (rows.length >= maxRows) break;
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      inHunk = true;
      rows.push({ kind: "hunk", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (!inHunk) {
      rows.push({ kind: "header", text: line, oldNo: null, newNo: null });
      continue;
    }
    if (line.startsWith("+") && !line.startsWith("+++")) {
      rows.push({ kind: "add", text: line, oldNo: null, newNo: newNo++ });
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      rows.push({ kind: "del", text: line, oldNo: oldNo++, newNo: null });
    } else {
      const text = line.startsWith(" ") ? line : line;
      rows.push({ kind: "ctx", text, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  const total = raw.length;
  return { rows, truncated: total > rows.length ? total - rows.length : 0 };
}
