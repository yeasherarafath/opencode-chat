import { createOpencodeClient } from "@opencode-ai/sdk";
import { execFile, execFileSync, exec } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import spawn_ from "cross-spawn";
import { JsonLogger } from "./JsonLogger";
const spawn: (cmd: string, args: string[], opts?: any) => any = spawn_ as any;

interface Session {
  id: string;
  title: string;
  slug?: string;
  projectID: string;
  directory: string;
  parentID?: string;
  time: { created: number; updated: number };
  share?: { url: string };
}

interface TextPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "text";
  text: string;
}

interface ReasoningPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "reasoning";
  text: string;
}

interface ToolPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "tool";
  callID: string;
  tool: string;
  state:
    | { status: "pending"; input: Record<string, unknown>; raw: string }
    | { status: "running"; input: Record<string, unknown>; title?: string; time: { start: number } }
    | { status: "completed"; input: Record<string, unknown>; output: string; title: string; time: { start: number; end: number } }
    | { status: "error"; input: Record<string, unknown>; error: string; time: { start: number; end: number } };
}

interface StepFinishPart {
  id: string;
  sessionID: string;
  messageID: string;
  type: "step-finish";
  reason: string;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}

type Part = TextPart | ReasoningPart | ToolPart | StepFinishPart | { type: string; [key: string]: unknown };

interface AssistantMessage {
  id: string;
  sessionID: string;
  role: "assistant";
  time: { created: number; completed?: number };
  parentID: string;
  modelID: string;
  providerID: string;
  mode: string;
  cost: number;
  tokens: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
}

interface FileDiff {
  file: string;
  before: string;
  after: string;
  additions: number;
  deletions: number;
}

export interface SessionInfo {
  id: string;
  title: string;
  slug?: string;
  created_at: string;
  updated_at: string;
  message_count?: number;
}

export interface CliEvent {
  type: string;
  content?: string;
  name?: string;
  input?: unknown;
  output?: string;
  data?: unknown;
  [key: string]: unknown;
}

function sessionToInfo(s: Session): SessionInfo {
  return {
    id: s.id,
    title: s.title,
    slug: s.slug,
    created_at: new Date(s.time.created).toISOString(),
    updated_at: new Date(s.time.updated).toISOString(),
  };
}

export class OpenCodeCli {
  private client: import("@opencode-ai/sdk/client").OpencodeClient | null = null;
  private serverInstance: { url: string; close(): void } | null = null;
  private serverUrl: string = "";
  private static outputChannel: import("vscode").OutputChannel | null = null;
  private sseAbortFlag = false;
  private sseIterator: AsyncIterator<unknown> | null = null;
  private binaryPath = "opencode";
  private serverPort = 4096;
  private serverHostname = "127.0.0.1";
  private serverTimeout = 15000;
  private pureMode = false;
  private serverProc: { pid: number; kill(): void } | null = null;
  private serverPassword = "";
  private cwd = "";
  private modelsCache: { data: string[]; ts: number } | null = null;
  private agentsCache: { data: string[]; ts: number } | null = null;
  private readonly CACHE_TTL = 60000;
  private startingPromise: Promise<boolean> | null = null;

  static setOutputChannel(ch: import("vscode").OutputChannel): void {
    OpenCodeCli.outputChannel = ch;
  }

  setBinaryPath(p: string): void {
    this.binaryPath = p || "opencode";
  }

  setServerPort(p: number): void {
    this.serverPort = p > 0 ? p : 4096;
  }

  setServerHostname(h: string): void {
    this.serverHostname = h || "127.0.0.1";
  }

  setServerTimeout(t: number): void {
    this.serverTimeout = t > 0 ? t : 15000;
  }

  setPureMode(enabled: boolean): void {
    this.pureMode = enabled;
  }

  setCwd(dir: string): void {
    this.cwd = dir;
  }

  private log(msg: string): void {
    if (OpenCodeCli.outputChannel) {
      OpenCodeCli.outputChannel.appendLine(`[OpenCodeCli] ${msg}`);
    }
  }

  private async resolveBinary(): Promise<string | null> {
    this.log(`resolveBinary: PATH=${process.env.PATH || "(empty)"}`);
    this.log(`resolveBinary: binaryPath=${this.binaryPath}`);
    const candidates: string[] = [this.binaryPath];

    if (this.binaryPath === "opencode") {
      const npmDir = path.join(os.homedir(), "AppData", "Roaming", "npm");
      const localNpmDir = path.join(os.homedir(), "AppData", "Local", "npm");
      const isWin = os.platform() === "win32";
      if (isWin) {
        candidates.push(
          path.join(npmDir, "opencode.cmd"),
          path.join(npmDir, "opencode.exe"),
          path.join(npmDir, "opencode.bat"),
          path.join(localNpmDir, "opencode.cmd"),
          path.join(localNpmDir, "opencode.exe"),
          path.join(localNpmDir, "opencode.bat"),
        );
      }
      candidates.push(
        "opencode.exe",
        "opencode.cmd",
        "opencode",
        path.join(npmDir, "opencode"),
        path.join(localNpmDir, "opencode"),
      );
    }

    for (const bin of candidates) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(bin, ["--v"], { timeout: 3000 }, (err) => {
            if (err) reject(err);
            else resolve();
          });
        });
        this.binaryPath = bin;
        return bin;
      } catch {
        // try next
      }
    }

    // fallback: use shell to resolve PATH (cmd /c on Windows, sh -c on Unix)
    try {
      const isWin = os.platform() === "win32";
      const shell = isWin ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
      const flag = isWin ? "/c" : "-c";
      const output = await new Promise<string>((resolve, reject) => {
        execFile(shell, [flag, isWin ? "where opencode" : "which opencode"], { timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim().split("\n")[0].trim());
        });
      });
      if (output && !output.includes("Could not find") && !output.includes("not found")) {
        const resolved = this.ensureExecutableExtension(output.trim());
        this.log(`resolveBinary: shell found binary at ${resolved}`);
        this.binaryPath = resolved;
        return resolved;
      }
    } catch {
      this.log("resolveBinary: shell lookup failed");
    }

    return null;
  }

  async start(): Promise<boolean> {
    if (this.startingPromise) {
      this.log("start: concurrent call detected, waiting for existing start...");
      return this.startingPromise;
    }
    this.startingPromise = this.startImpl();
    try {
      return await this.startingPromise;
    } finally {
      this.startingPromise = null;
    }
  }

  private async startImpl(): Promise<boolean> {
    const hostname = this.serverHostname;
    const port = this.serverPort;
    const timeout = this.serverTimeout;

    // strategy 1: spawn serve manually via cross-spawn
    this.serverPassword = Math.random().toString(36).slice(2, 10);
    const serverPassword = this.serverPassword;
    const binary = this.binaryPath !== "opencode" ? this.binaryPath : await this.resolveBinary();
    if (binary) {
      try {
        this.log(`start: trying manual spawn with ${binary} serve`);
        const args = ["serve", `--hostname=${hostname}`, `--port=0`, `--print-logs`, `--log-level=DEBUG`];
        if (this.pureMode) args.push("--pure");
        const proc = spawn(binary, args, {
          stdio: "pipe",
          cwd: this.cwd || process.cwd(),
          env: { ...process.env, OPENCODE_SERVER_PASSWORD: serverPassword },
        });
        this.serverProc = { pid: proc.pid as number, kill: () => proc.kill() };
        proc.on("exit", () => { this.serverProc = null; });
        let stdoutBuf = "";
        let stderrBuf = "";
        const serverUrl = await new Promise<string>((resolve, reject) => {
          const t = setTimeout(() => {
            reject(new Error(`Timeout waiting for server after ${timeout}ms`));
          }, timeout);
          const onStdout = (chunk: any) => {
            stdoutBuf += chunk.toString();
            const m = stdoutBuf.match(/opencode server listening on (https?:\/\/[^\s]+)/);
            if (m) { clearTimeout(t); resolve(m[1]); }
          };
          const onStderr = (chunk: any) => { stderrBuf += chunk.toString(); };
          proc.stdout?.on("data", onStdout);
          proc.stderr?.on("data", onStderr);
          proc.on("exit", (code: any) => {
            clearTimeout(t);
            this.log(`spawn stderr: ${stderrBuf.slice(0, 500)}`);
            reject(new Error(`exit ${code}`));
          });
          proc.on("error", (err: any) => { clearTimeout(t); reject(err); });
        });
        this.serverUrl = serverUrl;
        this.serverInstance = { url: serverUrl, close: () => { proc.kill(); (proc as any).stdio?.forEach((s: any) => s?.destroy?.()); } };
        const basicAuth = `Basic ${Buffer.from(`opencode:${serverPassword}`).toString("base64")}`;
        this.client = createOpencodeClient({
          baseUrl: serverUrl,
          headers: { Authorization: basicAuth },
        }) as import("@opencode-ai/sdk/client").OpencodeClient;
        this.log(`start: manual spawn OK at ${serverUrl}`);
        return true;
      } catch (e) {
        this.log(`start: manual spawn with serve FAILED: ${e}`);
      }
    }

    // strategy 3: connect to an already-running server
    try {
      const url = `http://${hostname}:${port}`;
      this.log(`start: trying existing server at ${url}`);
      const pwd = this.serverPassword;
      const authHeader = pwd ? `Basic ${Buffer.from(`opencode:${pwd}`).toString("base64")}` : "";
      const init: RequestInit & { headers?: Record<string, string> } = {};
      if (authHeader) init.headers = { Authorization: authHeader };
      const res = await fetch(`${url}/health`, init);
      if (res.ok) {
        this.serverUrl = url;
        const opts: Record<string, unknown> = { baseUrl: url };
        if (authHeader) opts.headers = { Authorization: authHeader };
        this.client = createOpencodeClient(opts) as import("@opencode-ai/sdk/client").OpencodeClient;
        this.log("start: connected to existing server");
        return true;
      }
    } catch {
      this.log("start: no existing server found");
    }

    this.log("start: all strategies FAILED");
    return false;
  }

  stop(): void {
    this.log("stop: closing server");
    this.serverInstance = null;
    this.client = null;
    this.serverUrl = "";
    this.serverPassword = "";

    // tree-kill the server process (kills children like MCP, LSP too)
    if (this.serverProc) {
      const pid = this.serverProc.pid;
      if (os.platform() === "win32") {
        try { execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)]); } catch { /* ignore */ }
      } else {
        try { process.kill(-pid, "SIGTERM"); } catch { /* ignore */ }
      }
      this.serverProc = null;
    }
  }

  async checkInstall(): Promise<boolean> {
    const resolved = await this.resolveBinary();
    return resolved !== null;
  }

  /**
   * Verify the opencode server is reachable. If health check fails or no
   * client exists, tear down stale state and re-run start() to spawn a new
   * server. Returns true when a working client is available.
   */
  async ensureServerHealthy(): Promise<boolean> {
    const probe = async (): Promise<boolean> => {
      if (!this.client || !this.serverUrl) return false;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 2000);
        try {
          // include auth in probe so 401 doesn't kill a healthy server
          const pwd = this.serverPassword;
          const headers = pwd ? { Authorization: `Basic ${Buffer.from(`opencode:${pwd}`).toString("base64")}` } : {};
          const res = await fetch(`${this.serverUrl}/health`, { signal: controller.signal, headers });
          return res.ok;
        } finally {
          clearTimeout(timer);
        }
      } catch {
        return false;
      }
    };
    if (await probe()) return true;
    this.log("ensureServerHealthy: server unreachable, attempting restart");
    JsonLogger.log("meta", { event: "ensureServerHealthy-restart" });
    // tear down stale references without killing (process may already be dead)
    this.client = null;
    this.serverUrl = "";
    this.serverInstance = null;
    if (this.serverProc) {
      const pid = this.serverProc.pid;
      if (os.platform() === "win32") {
        try { execFileSync("taskkill", ["/F", "/T", "/PID", String(pid)]); } catch {}
      } else {
        try { process.kill(-pid, "SIGTERM"); } catch {}
      }
      this.serverProc = null;
    }
    try {
      const started = await this.start();
      const reachable = started && (await probe());
      JsonLogger.log("meta", { event: "ensureServerHealthy-restart-done", started, reachable });
      return reachable;
    } catch (e) {
      JsonLogger.log("error", { source: "ensureServerHealthy", error: String(e) });
      return false;
    }
  }

  async getVersion(): Promise<string> {
    // 1. Try binary --v via shell (mirrors what user runs in terminal)
    const shell = os.platform() === "win32" ? process.env.COMSPEC || "cmd.exe" : "/bin/sh";
    const shellFlag = os.platform() === "win32" ? "/c" : "-c";
    try {
      const version = await new Promise<string>((resolve, reject) => {
        exec(`"${this.binaryPath}" --v`, { shell, timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else resolve(stdout.trim().replace(/^v/i, "").replace(/^opencode[\/\s]/i, ""));
        });
      });
      this.log(`getVersion: from shell = "${version}"`);
      if (version) return version;
    } catch {
      this.log("getVersion: shell exec failed, trying execFile");
    }

    // 2. Try resolved binary via execFile (fallback)
    const binPath = this.binaryPath !== "opencode" ? this.binaryPath : await this.resolveBinary().catch(() => null);
    if (binPath) {
      try {
        const version = await new Promise<string>((resolve, reject) => {
          execFile(binPath, ["--v"], { timeout: 5000 }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim().replace(/^v/i, "").replace(/^opencode[\/\s]/i, ""));
          });
        });
        this.log(`getVersion: from execFile ${binPath} = "${version}"`);
        if (version) return version;
      } catch {
        this.log("getVersion: execFile --v failed");
      }
    }

    // 3. Fallback: try server health endpoints
    if (this.serverUrl) {
      try {
        const res = await fetch(`${this.serverUrl}/global/health`);
        if (res.ok) {
          const data = await res.json() as { version?: string };
          if (data.version) return data.version.replace(/^v/i, "").replace(/^opencode[\/\s]/i, "");
        }
      } catch {
        this.log("getVersion: server health fetch failed");
      }
      try {
        const res = await fetch(`${this.serverUrl}/health`);
        if (res.ok) {
          const data = await res.json() as { version?: string };
          if (data.version) return data.version.replace(/^v/i, "").replace(/^opencode[\/\s]/i, "");
        }
      } catch {
        this.log("getVersion: fallback health fetch failed");
      }
    }

    this.log("getVersion: all methods failed, returning empty");
    return "";
  }

  getInstallUrl(): string {
    return "https://opencode.ai/install";
  }

  getServerUrl(): string {
    return this.serverUrl;
  }

  getServerPassword(): string {
    return this.serverPassword;
  }

  async listSessions(maxCount = 50): Promise<SessionInfo[]> {
    const result = await this.client!.session.list();
    const sessions: Session[] = result.data ?? [];
    return sessions.map(sessionToInfo);
  }

  async deleteSession(id: string): Promise<void> {
    await this.client!.session.delete({ path: { id } });
  }

  async renameSession(id: string, title: string): Promise<void> {
    await this.client!.session.update({ path: { id }, body: { title } });
  }

  async shareSession(id: string): Promise<string> {
    const result = await this.client!.session.share({ path: { id } });
    const session: Session = result.data!;
    const url = session.share?.url;
    if (!url) throw new Error("Share URL not returned");
    return url;
  }

  async forkSession(id: string, messageID?: string): Promise<SessionInfo> {
    const result = await this.client!.session.fork({
      path: { id },
      ...(messageID ? { body: { messageID } } : {}),
    });
    const session: Session = result.data!;
    return sessionToInfo(session);
  }

  async createSession(title?: string): Promise<SessionInfo> {
    if (!this.client) throw new Error("OpenCode client not initialized");
    const result = await this.client.session.create({
      body: { title: (title || "Imported session").slice(0, 80) },
    });
    return sessionToInfo(result.data!);
  }

  async summarizeSession(id: string, providerID: string, modelID: string): Promise<boolean> {
    const result = await this.client!.session.summarize({
      path: { id },
      body: { providerID, modelID },
    });
    return result.data === true;
  }

  async getSessionDiff(id: string): Promise<FileDiff[]> {
    const result = await this.client!.session.diff({ path: { id } });
    return result.data ?? [];
  }

  async exportSession(id: string): Promise<Record<string, unknown>> {
    const [sessionResult, msgsResult] = await Promise.all([
      this.client!.session.get({ path: { id } }),
      this.client!.session.messages({ path: { id } }),
    ]);
    const session: Session = sessionResult.data!;
    const messages = msgsResult.data ?? [];
    return { ...session, messages };
  }

  // Extract text content from session.message() API response.
  // The SDK returns { info: Message, parts: Part[] } — content is inside parts, not top-level.
  private extractMessageData(msgData: Record<string, unknown>): { content: string; parts: unknown[] } {
    const parts = (msgData.parts as unknown[]) || [];
    let content = (msgData.content as string) || (msgData.text as string) || "";
    if (!content && parts.length) {
      const textParts = parts.filter((p: any) => p.type === "text");
      content = textParts.map((p: any) => p.text || "").join("\n");
    }
    return { content, parts };
  }

  // --- Auto-fetch: SSE subscription to /global/event ---
  // Emits session.created/updated/deleted from any opencode client (CLI/TUI/webview).
  // `signal` cancels the loop. Reconnect with backoff is the caller's job.
  async subscribeGlobalEvents(
    onEvent: (e: { type: "session.created" | "session.updated" | "session.deleted"; info: SessionInfo }) => void,
    signal: AbortSignal
  ): Promise<void> {
    if (!this.client) {
      this.log("subscribeGlobalEvents: client is null, attempting reconnect...");
      try { await this.ensureServerHealthy(); } catch {}
      if (!this.client) { this.log("subscribeGlobalEvents: reconnect failed, returning"); return; }
    }
    const events = await this.client.global.event();
    const iterator = events.stream[Symbol.asyncIterator]();
    try {
      while (!signal.aborted) {
        let next: IteratorResult<unknown, unknown>;
        try {
          next = await iterator.next();
        } catch (e) {
          this.log(`subscribeGlobalEvents: stream error: ${e}`);
          throw e;
        }
        if (next.done) break;
        const ev = next.value as { directory?: string; payload?: { type?: string; properties?: { info?: Session } } };
        const type = ev?.payload?.type;
        if (type !== "session.created" && type !== "session.updated" && type !== "session.deleted") continue;
        const info = ev?.payload?.properties?.info;
        if (!info?.id) continue;
        onEvent({ type, info: sessionToInfo(info) });
      }
    } finally {
      try { await (iterator as { return?: (v?: unknown) => Promise<unknown> }).return?.(undefined); } catch {}
    }
  }

  // --- Auto-fetch: polling fallback ---
  // Calls listSessions() every `intervalMs`; invokes `onUpdate` only when
  // the id-set differs from the previous fetch. signal cancels the loop.
  async pollSessions(
    intervalMs: number,
    onUpdate: (sessions: SessionInfo[]) => void,
    signal: AbortSignal
  ): Promise<void> {
    if (intervalMs <= 0) return;
    const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
    let prevIds = "";
    let reconnectAttempts = 0;
    while (!signal.aborted) {
      if (!this.client) {
        if (reconnectAttempts === 0) this.log("pollSessions: client is null, attempting reconnect...");
        try { await this.ensureServerHealthy(); } catch {}
        reconnectAttempts++;
      }
      try {
        const sessions = await this.listSessions();
        reconnectAttempts = 0;
        const ids = sessions.map((s) => s.id + ":" + s.updated_at).join("|");
        if (ids !== prevIds) {
          prevIds = ids;
          onUpdate(sessions);
        }
      } catch (e) {
        this.log(`pollSessions: listSessions error: ${e}`);
      }
      await sleep(intervalMs);
    }
  }

  async listModels(forceRefresh = false): Promise<string[]> {
    try {
      if (!forceRefresh && this.modelsCache && Date.now() - this.modelsCache.ts < this.CACHE_TTL) {
        return this.modelsCache.data;
      }
      if (!this.client) { this.log("listModels: client is null, attempting reconnect..."); try { await this.ensureServerHealthy(); } catch {} if (!this.client) return []; }
      const result: any = await this.client.config.providers();
      const data: any = result.data;
      const error: any = result.error;
      this.log(`listModels: serverUrl=${this.serverUrl}, status=${result.response?.status}, data=${typeof data}, error=${typeof error !== "undefined"}`);
      if (error) this.log(`listModels: error=${JSON.stringify(error).slice(0, 500)}`);
      if (!data) {
        // try direct fetch with auth to the actual server URL
        if (this.serverUrl) {
          try {
            const pwd = this.serverPassword;
            const auth = pwd ? `Basic ${Buffer.from(`opencode:${pwd}`).toString("base64")}` : "";
            const raw = await fetch(`${this.serverUrl}/config/providers`, { headers: auth ? { Authorization: auth } : {} });
            const text = await raw.text();
            this.log(`listModels: direct fetch status=${raw.status}, body=${text.slice(0, 800)}`);
          } catch (e2) {
            this.log(`listModels: direct fetch failed: ${e2}`);
          }
        }
        return [];
      }
      // data can be { providers: [...] } or direct array
      const providers: any[] = Array.isArray(data) ? data : (data.providers ?? []);
      this.log(`listModels: ${providers.length} providers`);
      const models: string[] = [];
      for (const provider of providers) {
        const m = provider.models;
        if (m && typeof m === "object") {
          for (const key of Object.keys(m)) {
            const model = m[key];
            if (model && model.id) {
              models.push(`${provider.id}/${model.id}`);
            }
          }
        } else {
          this.log(`listModels: provider ${provider.id} has no models (type=${typeof m})`);
        }
      }
      this.log(`listModels: returning ${models.length} models`);
      this.modelsCache = { data: models, ts: Date.now() };
      return models;
    } catch (e) {
      this.log(`listModels error: ${e}`);
      return [];
    }
  }

  async getProviderInfo(): Promise<Array<{ id: string; name: string; key?: string; modelCount: number }>> {
    try {
      if (!this.client) { this.log("getProviderInfo: client is null, attempting reconnect..."); try { await this.ensureServerHealthy(); } catch {} if (!this.client) return []; }
      const result = await this.client.config.providers();
      const data: any = result.data;
      const error: any = result.error;
      this.log(`getProviderInfo: serverUrl=${this.serverUrl}, status=${result.response?.status}, data=${typeof data}, error=${typeof error !== "undefined"}`);
      if (error) this.log(`getProviderInfo: error=${JSON.stringify(error).slice(0, 500)}`);
      if (!data) { this.log("getProviderInfo: data is null/undefined"); return []; }
      const providers: any[] = Array.isArray(data) ? data : (data.providers ?? []);
      this.log(`getProviderInfo: ${providers.length} providers raw`);
      const info = providers.map(p => ({
        id: p.id,
        name: p.name,
        key: p.key,
        modelCount: p.models ? Object.keys(p.models).length : 0,
      }));
      this.log(`getProviderInfo: returning ${info.length} providers`);
      return info;
    } catch (e) {
      this.log(`getProviderInfo error: ${e}`);
      return [];
    }
  }

  async listAgents(forceRefresh = false): Promise<string[]> {
    try {
      if (!forceRefresh && this.agentsCache && Date.now() - this.agentsCache.ts < this.CACHE_TTL) {
        return this.agentsCache.data;
      }
      if (!this.client) { this.log("listAgents: client is null"); return []; }
      const result = await this.client.app.agents();
      const agents = result.data ?? [];
      const names = agents.map((a: { name: string }) => a.name);
      this.agentsCache = { data: names, ts: Date.now() };
      return names;
    } catch (e) {
      this.log(`listAgents error: ${e}`);
      return [];
    }
  }

  async runPrompt(
    prompt: string,
    options: { sessionId?: string; model?: string; agent?: string; variant?: string; files?: string[] } = {},
    onEvent: (event: CliEvent) => void,
    onError: (error: Error) => void,
    onExit: (code: number | null) => void
  ): Promise<void> {
    this.sseAbortFlag = false;
    this.sseIterator = null;
    let knownMessageIds = new Set<string>();
    const emit = (ev: CliEvent) => {
      try { JsonLogger.log("cli-event", ev); } catch {}
      onEvent(ev);
    };

    JsonLogger.log("meta", {
      event: "runPrompt-start",
      promptPreview: prompt.slice(0, 200),
      promptLen: prompt.length,
      options: {
        sessionId: options.sessionId,
        model: options.model,
        agent: options.agent,
        variant: options.variant,
        fileCount: options.files?.length || 0,
      },
    });

    // Verify (and if necessary, restart) the opencode server before any API call
    const healthy = await this.ensureServerHealthy();
    if (!healthy) {
      const errMsg = "OpenCode server is not reachable. Please check that opencode is installed and try again.";
      this.log(`runPrompt: ${errMsg}`);
      JsonLogger.log("error", { source: "runPrompt", error: errMsg, recoverable: false });
      onError(new Error(errMsg));
      JsonLogger.log("meta", { event: "runPrompt-exit", code: 1 });
      onExit(1);
      return;
    }

    try {
      let sessionId = options.sessionId;

      if (!sessionId) {
        const createResult = await this.client!.session.create({
          body: { title: prompt.slice(0, 80) },
        });
        sessionId = createResult.data!.id;
        emit({ type: "sessionID", sessionID: sessionId });
      }

      let model: { providerID: string; modelID: string } | undefined;
      if (options.model && options.model.includes("/")) {
        const [providerID, modelID] = options.model.split("/", 2);
        model = { providerID, modelID };
      }

      const events = await this.client!.event.subscribe();
      const iterator = events.stream[Symbol.asyncIterator]();
      this.sseIterator = iterator;

      // build parts: text + file attachments
      const parts: any[] = [
        { type: "text" as const, text: prompt },
      ];
      if (options.files && options.files.length) {
        for (const fp of options.files) {
          try {
            const raw = await fs.promises.readFile(fp, "utf-8");
            const fname = fp.split(/[\\/]/).pop() || fp;
            parts.push({
              type: "text" as const,
              text: `\n\nFile: ${fname}\n\`\`\`\n${raw}\n\`\`\`\n`,
            });
            this.log(`runPrompt: attached file ${fp} (${raw.length} chars)`);
          } catch (e) {
            this.log(`runPrompt: failed to read file ${fp}: ${e}`);
          }
        }
      }

      // Start SSE connection BEFORE promptAsync to avoid losing events
      let pendingSseEvent = iterator.next();

      await this.client!.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts,
          ...(model ? { model } : {}),
          ...(options.agent ? { agent: options.agent } : {}),
        },
      });

      let hasStarted = false;
      const knownToolPartIds = new Set<string>();
      const textPartsSeenDelta = new Set<string>();
      const pendingEmptyMsgIds = new Set<string>();
      const lastMessageSig = new Map<string, string>();

      while (!this.sseAbortFlag) {
        let result: IteratorResult<unknown>;
        try {
          result = await pendingSseEvent;
          pendingSseEvent = iterator.next();
        } catch {
          if (hasStarted) break;
          throw new Error("SSE stream error");
        }
        if (result.done) break;
        if (this.sseAbortFlag) break;

        const event = result.value as Record<string, unknown>;
        const props = (event.properties || {}) as Record<string, unknown>;

        JsonLogger.log("sse-event", { etype: event.type, properties: props });

        const eventSessionId: string | undefined =
          (props.part as Record<string, unknown>)?.sessionID as string ||
          (props.info as Record<string, unknown>)?.sessionID as string ||
          props.sessionID as string;

        const sessionMismatch = !!(eventSessionId && eventSessionId !== sessionId);
        if (sessionMismatch && !hasStarted) {
          JsonLogger.log("sse-skipped", { reason: "session-mismatch-prestart", etype: event.type, eventSessionId, sessionId });
          continue;
        }
        if (sessionMismatch) {
          JsonLogger.log("sse-foreign-session", { etype: event.type, eventSessionId, sessionId });
        }

        const etype = event.type as string;

        if (etype === "message.part.updated") {
          hasStarted = true;
          const part = props.part as Record<string, unknown> | undefined;
          const delta = props.delta as string | undefined;
          const ptype = part?.type as string;
          const partId = part?.id as string;

          if (ptype === "tool") {
            const state = part?.state as Record<string, unknown> | undefined;
            const toolName = part?.tool as string;
            const st = state?.status as string;
            if ((st === "running" || st === "pending") && partId && !knownToolPartIds.has(partId)) {
              knownToolPartIds.add(partId);
              emit({ type: "tool-start", name: toolName, input: state?.input || {}, id: partId });
            } else if (st === "completed") {
              emit({ type: "tool-result", name: toolName, output: state?.output as string, content: state?.output as string, id: part?.id as string });
            } else if (st === "error") {
              emit({ type: "tool-result", name: toolName, output: state?.error as string, content: state?.error as string, id: part?.id as string });
            } else {
              JsonLogger.log("sse-part-unhandled-tool-state", { partId, toolName, status: st, part });
            }
          } else if (ptype === "reasoning") {
            if (delta) {
              emit({ type: "reasoning", text: delta });
            }
            // text-only reasoning update without delta = full state snapshot; ignore (deltas already cover live render)
          } else if (ptype === "text") {
            // text part lifecycle:
            //   1. created with empty text + time.start  → scaffold (silent)
            //   2. delta arrives via this updated event  → stream
            //   3. final snapshot with text + time.end   → ignore (deltas already covered it)
            // We never need raw-part for text — it's covered by deltas.
            const text = (part as any)?.text as string | undefined;
            const time = (part as any)?.time as { start?: number; end?: number } | undefined;
            if (delta) {
              emit({ type: "text", content: delta });
            } else if (text && time?.end && partId) {
              // final text snapshot; track so we can emit if no deltas were seen
              if (!textPartsSeenDelta.has(partId)) {
                emit({ type: "text", content: text });
                textPartsSeenDelta.add(partId);
              }
            }
            // empty scaffold = no-op
          } else if (ptype === "step-start" || ptype === "step-finish" || ptype === "snapshot" || ptype === "patch" || ptype === "file" || ptype === "agent" || ptype === "retry" || ptype === "compaction") {
            emit({ type: ptype, part });
          } else if (delta) {
            // unknown ptype but has a delta payload — forward as text best-effort
            emit({ type: "text", content: delta });
          } else {
            JsonLogger.log("sse-part-unhandled", { ptype, part, props });
            emit({ type: "raw-part", ptype, part: part as any });
          }
        } else if (etype === "message.part.delta") {
          // dedicated streaming delta channel — the server emits these for text /
          // reasoning incrementally. Without handling them we drop the live stream.
          hasStarted = true;
          const field = props.field as string;
          const delta = props.delta as string;
          const partId = props.partID as string;
          if (delta) {
            if (field === "text") {
              if (partId) textPartsSeenDelta.add(partId);
              emit({ type: "text", content: delta });
            } else if (field === "reasoning") {
              emit({ type: "reasoning", text: delta });
            } else {
              JsonLogger.log("sse-part-unhandled", { source: "message.part.delta", field, props });
              emit({ type: "text", content: delta });
            }
          }
          } else if (etype === "message.updated") {
          hasStarted = true;
          const info = props.info as Record<string, unknown> | undefined;
          if (info?.role === "assistant") {
            const msgId = info?.id as string;
            if (!msgId) { continue; }
            let mcontent = "";
            let mparts: unknown[] = [];
            try {
              const msgResult = await this.client!.session.message({ path: { id: sessionId, messageID: msgId } });
              const msgData = msgResult.data as Record<string, unknown> | undefined;
              if (msgData) {
                const extracted = this.extractMessageData(msgData);
                mcontent = extracted.content;
                mparts = extracted.parts;
              }
            } catch (e) {
              this.log(`message.updated: fetch msg ${msgId} failed: ${e}`);
              JsonLogger.log("error", { source: "message.updated.fetch", msgId, error: String(e) });
            }
            const sig = `${mcontent.length}:${mparts.length}`;
            const prevSig = lastMessageSig.get(msgId);
            if (mcontent || mparts.length) {
              if (prevSig !== sig) {
                lastMessageSig.set(msgId, sig);
                knownMessageIds.add(msgId);
                emit({ type: "message", info, role: "assistant", parts: mparts, content: mcontent, id: msgId });
              } else {
                JsonLogger.log("sse-skipped", { reason: "message-unchanged", msgId, sig });
              }
            } else if (!knownMessageIds.has(msgId)) {
              pendingEmptyMsgIds.add(msgId);
              this.log(`message.updated ${msgId}: deferred (empty content, ${mparts.length} parts)`);
            }
          } else {
            JsonLogger.log("sse-skipped", { reason: "non-assistant-message.updated", etype, info });
          }
          continue;
        } else if (etype === "session.status") {
          const status = props.status as Record<string, unknown> | undefined;
          JsonLogger.log("sse-session-status", { status, hasStarted });
          if (status?.type === "idle" && hasStarted) {
            break;
          }
        } else if (etype === "message.removed" || etype === "session.error") {
          const errMsg = (props.message as string) || ((props.error as any)?.data?.message as string) || "Session error";
          JsonLogger.log("error", { source: "session.error", error: errMsg, properties: props });
          onError(new Error(errMsg));
          break;
        } else if (
          etype === "server.heartbeat"
          || etype === "server.connected"
          || etype === "session.next.agent.switched"
          || etype === "session.updated"
          || etype === "session.diff"
          || etype === "installation.updated"
          || etype === "permission.updated"
          || etype === "permission.replied"
          || etype === "lsp.client.diagnostics"
          || etype === "ide.installed"
          || etype === "file.edited"
        ) {
          // benign signals — log but never forward to webview as raw-event (avoids UI noise)
          JsonLogger.log("sse-ignored", { etype, properties: props });
        } else {
          JsonLogger.log("sse-unhandled-event", { etype, properties: props });
          emit({ type: "raw-event", etype, properties: props as any });
        }
      }

      // Final fetch pass: refresh every assistant message we've seen so the
      // webview gets the latest content/parts (server may finalize text after idle).
      // Use exponential backoff to give the server time to populate the message.
      const finalMsgIds = new Set<string>([...knownMessageIds, ...pendingEmptyMsgIds]);
      if (finalMsgIds.size > 0) {
        this.log(`SSE loop done, refreshing ${finalMsgIds.size} assistant messages...`);
        for (const msgId of finalMsgIds) {
          for (let retry = 0; retry < 6; retry++) {
            try {
              if (retry > 0) await new Promise(r => setTimeout(r, 300 * (retry + 1)));
              const msgResult = await this.client!.session.message({ path: { id: sessionId, messageID: msgId } });
              const msgData = msgResult.data as Record<string, unknown> | undefined;
              if (msgData) {
                const { content, parts } = this.extractMessageData(msgData);
                const sig = `${content.length}:${parts.length}`;
                if ((content || parts.length) && lastMessageSig.get(msgId) !== sig) {
                  lastMessageSig.set(msgId, sig);
                  emit({ type: "message", info: msgData, role: "assistant", parts, content, id: msgId });
                  this.log(`message ${msgId}: final fetch emitted (content=${content.length}, parts=${parts.length})`);
                  break;
                }
                if (content || parts.length) break;
              }
            } catch (e) {
              this.log(`message ${msgId}: final fetch retry ${retry + 1} failed: ${e}`);
              JsonLogger.log("error", { source: "final-fetch", msgId, retry, error: String(e) });
            }
          }
        }
      }

      JsonLogger.log("meta", { event: "runPrompt-exit", code: 0 });
      onExit(0);
    } catch (e) {
      this.log(`runPrompt error: ${e}`);
      JsonLogger.log("error", { source: "runPrompt", error: String(e), stack: (e as Error)?.stack });
      onError(e instanceof Error ? e : new Error(String(e)));
      JsonLogger.log("meta", { event: "runPrompt-exit", code: 1 });
      onExit(1);
    } finally {
      this.sseIterator = null;
      this.sseAbortFlag = false;
    }
  }

  async runCliCommand(args: string[]): Promise<string> {
    JsonLogger.log("meta", { event: "runCliCommand-start", args });
    const binary = this.binaryPath !== "opencode" ? this.binaryPath : await this.resolveBinary();
    if (!binary) {
      throw new Error("opencode binary not found. Set 'opencode-chat.cliPath' in settings or ensure 'opencode' is on PATH.");
    }
    const finalBinary = this.ensureExecutableExtension(binary);
    return new Promise((resolve, reject) => {
      const child = spawn_(finalBinary, args, { cwd: this.cwd || process.cwd() });
      let stdout = "";
      let stderr = "";
      const timer = setTimeout(() => {
        child.kill();
        reject(new Error(`opencode ${args.join(" ")} timed out after 30000ms`));
      }, 30000);
      child.stdout?.on("data", (d: Buffer) => { stdout += d.toString(); });
      child.stderr?.on("data", (d: Buffer) => { stderr += d.toString(); });
      child.on("error", (e: Error) => {
        clearTimeout(timer);
        JsonLogger.log("error", { source: "runCliCommand", args, error: e.message, stderr: stderr.slice(0, 2000) });
        reject(new Error(stderr.trim() || e.message));
      });
      child.on("close", (code: number | null) => {
        clearTimeout(timer);
        if (code !== 0) {
          JsonLogger.log("error", { source: "runCliCommand", args, code, stderr: stderr.slice(0, 2000) });
          reject(new Error(stderr.trim() || `opencode exited with code ${code}`));
        } else {
          JsonLogger.log("meta", { event: "runCliCommand-done", args, stdoutLen: stdout.length });
          resolve(stdout.trim());
        }
      });
    });
  }

  private ensureExecutableExtension(bin: string): string {
    if (os.platform() !== "win32") return bin;
    if (/\.(exe|cmd|bat)$/i.test(bin)) return bin;
    if (fs.existsSync(bin + ".cmd")) return bin + ".cmd";
    if (fs.existsSync(bin + ".exe")) return bin + ".exe";
    if (fs.existsSync(bin + ".bat")) return bin + ".bat";
    return bin;
  }

  async generateCommitMessage(diff: string): Promise<string> {
    const prompt = `Write a one-line conventional commit message for these changes (format: type(scope): description, e.g. "feat: add login"). Output ONLY the commit message, nothing else:\n${diff}`;

    const healthy = await this.ensureServerHealthy();
    if (!healthy) throw new Error("OpenCode server is not reachable");

    const createResult = await this.client!.session.create({
      body: { title: "commit" },
    });
    const sessionId = createResult.data!.id;

    try {
      await this.client!.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text" as const, text: prompt }],
        },
      });

      // Poll for the assistant response
      let response = "";
      const deadline = Date.now() + 60000;
      while (Date.now() < deadline && !response) {
        await new Promise((r) => setTimeout(r, 2000));
        try {
          const msgsResult = await this.client!.session.messages({ path: { id: sessionId } });
          const msgs = (msgsResult.data ?? []) as Record<string, unknown>[];
          for (let i = msgs.length - 1; i >= 0; i--) {
            const info = msgs[i].info as Record<string, unknown> | undefined;
            const msgId = (info?.id ?? msgs[i].id) as string;
            const msgParts = (msgs[i].parts ?? []) as Record<string, unknown>[];
            if (!msgId) continue;
            // Parts may already contain the text directly
            const inlineText = msgParts
              .filter((p) => p.type === "text")
              .map((p) => p.text as string).join("").trim();
            if (inlineText) {
              const inlineRole = info?.role as string;
              if (inlineRole === "assistant") { response = inlineText; break; }
            }
            // Also try fetching full message detail
            try {
              const detail = await this.client!.session.message({ path: { id: sessionId, messageID: msgId } });
              const data = detail.data as Record<string, unknown> | undefined;
              if (!data) { this.log(`generateCommitMessage: detail[${i}] no data`); continue; }
              const parts = (data.parts ?? []) as Record<string, unknown>[];
              const textParts = parts.filter((p) => p.type === "text");
              const role = (data.role ?? info?.role) as string;
              const text = textParts.map((p) => p.text as string).join("").trim()
                || (data.content as string)?.trim()
                || (data.text as string)?.trim() || "";
              if (role === "assistant" && text) { response = text; break; }
            } catch (e) {
              this.log(`generateCommitMessage: detail[${i}] error: ${e}`);
            }
          }
        } catch (e) {
          this.log(`generateCommitMessage: poll error: ${e}`);
        }
      }

      // Strip thinking blocks then take first line
      if (response) {
        const cleaned = response.replace(/<(think|Thought|thinking)[\s\S]*?<\/(think|Thought|thinking)>/g, "").trim();
        response = cleaned || response.replace(/^<(think|Thought|thinking)[\s\S]*$/im, "").trim();
        response = response || "";
      }

      const result = (response || "").split("\n")[0].trim();
      this.log(`generateCommitMessage: returning "${result}"`);
      return result;
    } finally {
      try { await this.client!.session.delete({ path: { id: sessionId } }); } catch {}
    }
  }

  clearCaches(): void {
    this.modelsCache = null;
    this.agentsCache = null;
  }

  detach(): void {
    this.log("detach: releasing server without killing");
    JsonLogger.log("meta", { event: "detach" });
    this.serverInstance = null;
    this.client = null;
    this.serverUrl = "";
    this.serverProc = null;
  }

  isRunning(): boolean {
    return this.client !== null;
  }

  async abort(): Promise<void> {
    JsonLogger.log("meta", { event: "abort" });
    this.sseAbortFlag = true;
    if (this.sseIterator) {
      try {
        await this.sseIterator.return?.();
      } catch {
        // ignore
      }
      this.sseIterator = null;
    }
  }

  async abortSession(sessionId: string): Promise<void> {
    JsonLogger.log("meta", { event: "abortSession-start", sessionId });
    this.sseAbortFlag = true;
    if (this.sseIterator) {
      try {
        await this.sseIterator.return?.();
      } catch {
        // ignore
      }
      this.sseIterator = null;
    }
    try {
      await this.client!.session.abort({ path: { id: sessionId } });
      this.log(`abortSession: aborted ${sessionId}`);
      JsonLogger.log("meta", { event: "abortSession-done", sessionId });
    } catch (e) {
      this.log(`abortSession error: ${e}`);
      JsonLogger.log("error", { source: "abortSession", sessionId, error: String(e) });
    }
  }
}
