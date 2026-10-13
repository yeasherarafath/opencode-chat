// Client + adapters for the opencode v2 server API (`/api/*`).
// v2 replaced the v1 REST surface wholesale; this module translates v2 data
// into the v1 shapes the rest of the extension (and the webview) already use.

export interface V2Event {
  type: string;
  data: Record<string, any>;
  location?: { directory?: string };
}

export interface V2Session {
  id: string;
  title?: string;
  slug?: string;
  projectID: string;
  parentID?: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  cost?: number;
  tokens?: Record<string, unknown>;
  time: { created: number; updated: number; idle?: number };
  location?: { directory: string };
  [key: string]: unknown;
}

// Windows drive letters may differ in case between VS Code and opencode.
export function normalizeDir(dir: string): string {
  return dir.replace(/^([a-z]):/, (_m, d: string) => d.toUpperCase() + ":");
}

export class V2Api {
  constructor(
    private baseUrl: string,
    private authHeader: string,
    private directory: string
  ) {}

  private headers(json = false): Record<string, string> {
    const h: Record<string, string> = {};
    if (this.authHeader) h.Authorization = this.authHeader;
    if (json) h["Content-Type"] = "application/json";
    return h;
  }

  async request<T = any>(method: string, path: string, body?: unknown, query?: Record<string, string | number | undefined>): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(query || {})) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    const res = await fetch(url, {
      method,
      headers: this.headers(body !== undefined),
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    if (!res.ok) {
      let msg = text.slice(0, 300);
      try { msg = JSON.parse(text).message || msg; } catch {}
      throw new Error(`${method} ${path} failed (${res.status}): ${msg}`);
    }
    if (!text) return undefined as T;
    return JSON.parse(text) as T;
  }

  get dir(): string {
    return this.directory ? normalizeDir(this.directory) : "";
  }

  async listSessions(limit = 100): Promise<V2Session[]> {
    const res = await this.request<{ data: V2Session[] }>("GET", "/api/session", undefined, { limit, directory: this.dir });
    return res.data ?? [];
  }

  async getSession(id: string): Promise<V2Session> {
    return (await this.request<{ data: V2Session }>("GET", `/api/session/${id}`)).data;
  }

  async createSession(): Promise<V2Session> {
    const body = this.dir ? { location: { directory: this.dir } } : {};
    return (await this.request<{ data: V2Session }>("POST", "/api/session", body)).data;
  }

  async listMessages(sessionId: string): Promise<any[]> {
    const all: any[] = [];
    let cursor: string | undefined;
    const limit = 200;
    for (let page = 0; page < 50; page++) {
      const res = await this.request<{ data: any[]; cursor?: { next?: string | null } }>(
        "GET", `/api/session/${sessionId}/message`, undefined, { order: "asc", limit, cursor }
      );
      const data = res.data ?? [];
      all.push(...data);
      cursor = res.cursor?.next ?? undefined;
      if (data.length < limit || !cursor) break;
    }
    return all;
  }

  async getMessage(sessionId: string, messageId: string): Promise<any> {
    return (await this.request<{ data: any }>("GET", `/api/session/${sessionId}/message/${messageId}`)).data;
  }

  // Streams /api/event. Aborting `signal` ends the stream.
  async *events(signal: AbortSignal): AsyncGenerator<V2Event> {
    const res = await fetch(this.baseUrl + "/api/event", { headers: this.headers(), signal });
    if (!res.ok || !res.body) throw new Error(`GET /api/event failed (${res.status})`);
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
      while (!signal.aborted) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buf.search(/\r?\n\r?\n/)) >= 0) {
          const chunk = buf.slice(0, idx);
          buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
          const data = chunk
            .split(/\r?\n/)
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).replace(/^ /, ""))
            .join("\n");
          if (!data) continue;
          try {
            const ev = JSON.parse(data) as V2Event;
            if (ev && typeof ev.type === "string") yield { ...ev, data: ev.data || {} };
          } catch {
            // ignore malformed frame
          }
        }
      }
    } finally {
      try { await reader.cancel(); } catch {}
    }
  }
}

// Answers pending permission requests and forms (e.g. the question tool) for a
// session through native VS Code prompts. `handled` dedupes across events.
export async function resolvePendingInteractions(api: V2Api, sessionId: string, handled: Set<string>): Promise<void> {
  const vscode = await import("vscode");

  const perms = (await api.request<{ data: any[] }>("GET", `/api/session/${sessionId}/permission`).catch(() => ({ data: [] }))).data ?? [];
  for (const p of perms) {
    if (!p?.id || handled.has(p.id)) continue;
    handled.add(p.id);
    const what = [p.action, (p.resources || []).join(", ")].filter(Boolean).join(": ");
    const choice = await vscode.window.showWarningMessage(
      `OpenCode requests permission — ${what}`,
      { modal: true, detail: p.message || undefined },
      "Allow once",
      "Always allow",
      "Reject"
    );
    const decision = choice === "Allow once" ? "once" : choice === "Always allow" ? "always" : "reject";
    await api.request("POST", `/api/session/${sessionId}/permission/${p.id}/reply`, { decision }).catch(() => {});
  }

  const forms = (await api.request<{ data: any[] }>("GET", `/api/session/${sessionId}/form`).catch(() => ({ data: [] }))).data ?? [];
  for (const f of forms) {
    if (!f?.id || handled.has(f.id)) continue;
    handled.add(f.id);
    const answer: Record<string, unknown> = {};
    let cancelled = false;
    for (const field of f.fields || []) {
      if (field.hidden) continue;
      if (Array.isArray(field.when) && !field.when.every((w: any) => (w.op === "neq") !== (answer[w.key] === w.value))) continue;
      const title = [f.title, field.title || field.key].filter(Boolean).join(" — ");
      let value: unknown;
      if (field.type === "external") {
        if (field.url) await vscode.env.openExternal(vscode.Uri.parse(field.url));
        continue;
      } else if (field.type === "boolean") {
        const pick = await vscode.window.showQuickPick(["Yes", "No"], { title, placeHolder: field.description, ignoreFocusOut: true });
        value = pick === undefined ? undefined : pick === "Yes";
      } else if (field.type === "multiselect") {
        const items = (field.options || []).map((o: any) => ({ label: o.label, description: o.description, value: o.value }));
        const picks = await vscode.window.showQuickPick(items, { title, placeHolder: field.description, canPickMany: true, ignoreFocusOut: true }) as any[] | undefined;
        value = picks?.map((p) => p.value);
      } else if (field.type === "string" && Array.isArray(field.options) && field.options.length) {
        const items: any[] = field.options.map((o: any) => ({ label: o.label, description: o.description, value: o.value }));
        if (field.custom) items.push({ label: "Other…", value: undefined, custom: true });
        const pick = await vscode.window.showQuickPick(items, { title, placeHolder: field.description, ignoreFocusOut: true }) as any;
        value = pick?.custom ? await vscode.window.showInputBox({ title, ignoreFocusOut: true }) : pick?.value;
      } else {
        const numeric = field.type === "number" || field.type === "integer";
        const raw = await vscode.window.showInputBox({
          title,
          prompt: field.description,
          placeHolder: field.placeholder,
          value: field.default !== undefined ? String(field.default) : undefined,
          ignoreFocusOut: true,
          validateInput: numeric ? (v) => (v === "" || isNaN(Number(v)) ? "Enter a number" : undefined) : undefined,
        });
        value = raw === undefined ? undefined : numeric ? Number(raw) : raw;
      }
      if (value === undefined) {
        if (field.required) { cancelled = true; break; }
        continue;
      }
      answer[field.key] = value;
    }
    if (cancelled) await api.request("DELETE", `/api/session/${sessionId}/form/${f.id}`).catch(() => {});
    else await api.request("POST", `/api/session/${sessionId}/form/${f.id}/reply`, { answer }).catch(() => {});
  }
}

export function toolOutputText(content: unknown): string {
  if (!Array.isArray(content)) return typeof content === "string" ? content : "";
  return content
    .map((c: any) => (c?.type === "text" ? c.text : c?.type === "file" ? `[file] ${c.name || c.uri || ""}` : ""))
    .filter(Boolean)
    .join("\n");
}

// v2 tool content item -> v1 ToolPart
function convertTool(t: any, messageId: string, sessionId: string): Record<string, unknown> {
  const st = t.state || {};
  const time = { start: t.time?.ran ?? t.time?.created ?? 0, end: t.time?.completed ?? t.time?.ran ?? t.time?.created ?? 0 };
  let state: Record<string, unknown>;
  if (st.status === "streaming") {
    state = { status: "pending", input: {}, raw: typeof st.input === "string" ? st.input : "" };
  } else if (st.status === "running") {
    state = { status: "running", input: st.input || {}, metadata: st.metadata, time: { start: time.start } };
  } else if (st.status === "error") {
    state = { status: "error", input: st.input || {}, error: st.error?.message || toolOutputText(st.content) || "Tool error", metadata: st.metadata, time };
  } else {
    state = { status: "completed", input: st.input || {}, output: toolOutputText(st.content), title: t.name, metadata: st.metadata, time };
  }
  return { id: t.id, sessionID: sessionId, messageID: messageId, type: "tool", callID: t.id, tool: t.name, state, input: state.input };
}

// v2 assistant message -> v1 { info, parts }
export function convertAssistant(m: any, sessionId: string): { info: Record<string, unknown>; parts: Record<string, unknown>[] } {
  const parts: Record<string, unknown>[] = [];
  (m.content || []).forEach((c: any, i: number) => {
    const id = `${m.id}-${i}`;
    if (c.type === "text") parts.push({ id, sessionID: sessionId, messageID: m.id, type: "text", text: c.text || "" });
    else if (c.type === "reasoning") parts.push({ id, sessionID: sessionId, messageID: m.id, type: "reasoning", text: c.text || "", time: c.time });
    else if (c.type === "tool") parts.push(convertTool(c, m.id, sessionId));
  });
  if (m.finish || m.tokens) {
    parts.push({ id: `${m.id}-finish`, sessionID: sessionId, messageID: m.id, type: "step-finish", reason: m.finish || "", cost: m.cost || 0, tokens: m.tokens });
  }
  const info: Record<string, unknown> = {
    id: m.id,
    sessionID: sessionId,
    role: "assistant",
    time: m.time,
    modelID: m.model?.id,
    providerID: m.model?.providerID,
    mode: m.agent,
    agent: m.agent,
    cost: m.cost || 0,
    tokens: m.tokens,
    finish: m.finish,
  };
  if (m.error) info.error = { name: m.error.type, data: { message: m.error.message } };
  return { info, parts };
}

// v2 message list -> v1 [{ info, parts }]; drops v2-only bookkeeping entries
// (model-switched, agent-switched, idle, ...).
export function convertMessages(messages: any[], sessionId: string): Array<{ info: Record<string, unknown>; parts: Record<string, unknown>[] }> {
  const out: Array<{ info: Record<string, unknown>; parts: Record<string, unknown>[] }> = [];
  for (const m of messages) {
    if (m.type === "user") {
      out.push({
        info: { id: m.id, sessionID: sessionId, role: "user", time: m.time },
        parts: [{ id: `${m.id}-0`, sessionID: sessionId, messageID: m.id, type: "text", text: m.text || "" }],
      });
    } else if (m.type === "assistant") {
      out.push(convertAssistant(m, sessionId));
    } else if (m.type === "shell") {
      const text = [m.command && `$ ${m.command}`, m.output?.output].filter(Boolean).join("\n");
      if (text) {
        out.push({
          info: { id: m.id, sessionID: sessionId, role: "user", time: m.time },
          parts: [{ id: `${m.id}-0`, sessionID: sessionId, messageID: m.id, type: "text", text }],
        });
      }
    }
  }
  return out;
}

export function sessionToV1(s: V2Session): Record<string, unknown> {
  return {
    ...s,
    title: s.title || "New session",
    directory: s.location?.directory,
    time: s.time,
  };
}
