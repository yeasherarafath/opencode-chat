import { createOpencodeClient } from "@opencode-ai/sdk";
import { execFile } from "child_process";
import * as path from "path";
import * as fs from "fs";
import * as os from "os";
import spawn_ from "cross-spawn";
const spawn: (cmd: string, args: string[], opts?: any) => any = spawn_ as any;

interface Session {
  id: string;
  title: string;
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
  private cwd = "";

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

    // add common platform-specific names
    if (this.binaryPath === "opencode") {
      candidates.push("opencode.exe", "opencode.cmd");
      // try npm global paths (common issue on Windows)
      const npmDir = path.join(os.homedir(), "AppData", "Roaming", "npm");
      candidates.push(
        path.join(npmDir, "opencode"),
        path.join(npmDir, "opencode.cmd"),
        path.join(npmDir, "opencode.exe"),
      );
      // also check LOCALAPPDATA
      const localNpmDir = path.join(os.homedir(), "AppData", "Local", "npm");
      candidates.push(
        path.join(localNpmDir, "opencode"),
        path.join(localNpmDir, "opencode.cmd"),
        path.join(localNpmDir, "opencode.exe"),
      );
    }

    for (const bin of candidates) {
      try {
        await new Promise<void>((resolve, reject) => {
          execFile(bin, ["--version"], { timeout: 3000 }, (err) => {
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
        const p = output.trim();
        this.log(`resolveBinary: shell found binary at ${p}`);
        this.binaryPath = p;
        return p;
      }
    } catch {
      this.log("resolveBinary: shell lookup failed");
    }

    return null;
  }

  async start(): Promise<boolean> {
    const hostname = this.serverHostname;
    const port = this.serverPort;
    const timeout = this.serverTimeout;

    // strategy 1: spawn serve manually via cross-spawn
    const serverPassword = Math.random().toString(36).slice(2, 10);
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
      const res = await fetch(`${url}/health`);
      if (res.ok) {
        this.serverUrl = url;
        this.client = createOpencodeClient({ baseUrl: url }) as import("@opencode-ai/sdk/client").OpencodeClient;
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

    // tree-kill the server process (kills children like MCP, LSP too)
    if (this.serverProc) {
      const pid = this.serverProc.pid;
      if (os.platform() === "win32") {
        try { execFile("taskkill", ["/F", "/T", "/PID", String(pid)]); } catch { /* ignore */ }
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

  async getVersion(): Promise<string> {
    if (this.binaryPath) {
      try {
        return await new Promise<string>((resolve, reject) => {
          execFile(this.binaryPath!, ["--version"], { timeout: 5000 }, (err, stdout) => {
            if (err) reject(err);
            else resolve(stdout.trim());
          });
        });
      } catch {
        // fall through to server check
      }
    }
    if (!this.serverUrl) return "sdk";
    try {
      const res = await fetch(`${this.serverUrl}/health`);
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        return (data.version as string) || "sdk";
      }
    } catch {
      // fall through
    }
    return "sdk";
  }

  getInstallUrl(): string {
    return "https://opencode.ai/install";
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

  async listModels(): Promise<string[]> {
    try {
      if (!this.client) { this.log("listModels: client is null"); return []; }
      const result: any = await this.client.config.providers();
      const data: any = result.data;
      const error: any = result.error;
      this.log(`listModels: typeof data=${typeof data}, error=${typeof error !== "undefined"}, response status=${result.response?.status}`);
      if (error) this.log(`listModels: error=${JSON.stringify(error).slice(0, 300)}`);
      if (!data) {
        // try fetching directly to debug
        try {
          const raw = await fetch(`http://${this.serverHostname}:${this.serverPort}/config/providers`);
          const text = await raw.text();
          this.log(`listModels: raw fetch status=${raw.status}, body=${text.slice(0, 500)}`);
        } catch (e2) {
          this.log(`listModels: raw fetch also failed: ${e2}`);
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
      return models;
    } catch (e) {
      this.log(`listModels error: ${e}`);
      return [];
    }
  }

  async getProviderInfo(): Promise<Array<{ id: string; name: string; key?: string; modelCount: number }>> {
    try {
      if (!this.client) { this.log("getProviderInfo: client is null"); return []; }
      const result = await this.client.config.providers();
      const data: any = result.data;
      if (!data) return [];
      const providers: any[] = Array.isArray(data) ? data : (data.providers ?? []);
      return providers.map(p => ({
        id: p.id,
        name: p.name,
        key: p.key,
        modelCount: p.models ? Object.keys(p.models).length : 0,
      }));
    } catch (e) {
      this.log(`getProviderInfo error: ${e}`);
      return [];
    }
  }

  async listAgents(): Promise<string[]> {
    try {
      const result = await this.client!.app.agents();
      const agents = result.data ?? [];
      return agents.map((a: { name: string }) => a.name);
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

    try {
      let sessionId = options.sessionId;

      if (!sessionId) {
        const createResult = await this.client!.session.create({
          body: { title: prompt.slice(0, 80) },
        });
        sessionId = createResult.data!.id;
        onEvent({ type: "sessionID", sessionID: sessionId });
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

      while (!this.sseAbortFlag) {
        let result: IteratorResult<unknown>;
        try {
          result = await iterator.next();
        } catch {
          if (hasStarted) break;
          throw new Error("SSE stream error");
        }
        if (result.done) break;
        if (this.sseAbortFlag) break;

        const event = result.value as Record<string, unknown>;
        const props = (event.properties || {}) as Record<string, unknown>;

        const eventSessionId: string | undefined =
          (props.part as Record<string, unknown>)?.sessionID as string ||
          (props.info as Record<string, unknown>)?.sessionID as string ||
          props.sessionID as string;

        if (eventSessionId !== sessionId) {
          if (!hasStarted) continue;
        }

        const etype = event.type as string;

        if (etype === "message.part.updated") {
          hasStarted = true;
          const part = props.part as Record<string, unknown> | undefined;
          const delta = props.delta as string | undefined;
          const ptype = part?.type as string;

          if (ptype === "tool") {
            const state = part?.state as Record<string, unknown> | undefined;
            const toolName = part?.tool as string;
            const st = state?.status as string;
            const partId = part?.id as string;
            if ((st === "running" || st === "pending") && partId && !knownToolPartIds.has(partId)) {
              knownToolPartIds.add(partId);
              onEvent({ type: "tool-start", name: toolName, input: state?.input || {}, id: partId });
            } else if (st === "completed") {
              onEvent({ type: "tool-result", name: toolName, output: state?.output as string, content: state?.output as string, id: part?.id as string });
            } else if (st === "error") {
              onEvent({ type: "tool-result", name: toolName, output: state?.error as string, content: state?.error as string, id: part?.id as string });
            }
          } else if (ptype === "reasoning" && delta) {
            onEvent({ type: "reasoning", text: delta });
          } else if (delta) {
            onEvent({ type: "text", content: delta });
          }
        } else if (etype === "message.updated") {
          hasStarted = true;
          const info = props.info as Record<string, unknown> | undefined;
          if (info?.role === "assistant") {
            const msgId = info?.id as string;
            if (!msgId || knownMessageIds.has(msgId)) { continue; }
            knownMessageIds.add(msgId);
            let mcontent = "";
            let mparts: unknown[] = [];
            if (msgId) {
              try {
                const msgResult = await this.client!.session.message({ path: { id: sessionId, messageID: msgId } });
                const msgData = msgResult.data as Record<string, unknown> | undefined;
                if (msgData) {
                  mcontent = (msgData.content as string) || (msgData.text as string) || "";
                  mparts = (msgData.parts as unknown[]) || [];
                }
              } catch (e) {
                this.log(`message.updated: fetch msg ${msgId} failed: ${e}`);
              }
            }
            onEvent({ type: "message", info, role: "assistant", parts: mparts, content: mcontent });
          }
          continue;
        } else if (etype === "session.status") {
          const status = props.status as Record<string, unknown> | undefined;
          if (status?.type === "idle" && hasStarted) {
            break;
          }
        } else if (etype === "message.removed" || etype === "session.error") {
          onEvent({ type: "error", message: (props.message as string) || "Session error" });
          break;
        }
      }

      onExit(0);
    } catch (e) {
      this.log(`runPrompt error: ${e}`);
      onError(e instanceof Error ? e : new Error(String(e)));
      onExit(1);
    } finally {
      this.sseIterator = null;
      this.sseAbortFlag = false;
    }
  }

  async runCliCommand(args: string[]): Promise<string> {
    const { execFile } = await import("child_process");
    return new Promise((resolve, reject) => {
      execFile("opencode", args, { cwd: this.cwd || process.cwd(), maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      });
    });
  }

  detach(): void {
    this.log("detach: releasing server without killing");
    this.serverInstance = null;
    this.client = null;
    this.serverUrl = "";
    this.serverProc = null;
  }

  isRunning(): boolean {
    return this.client !== null;
  }

  async abort(): Promise<void> {
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
    } catch (e) {
      this.log(`abortSession error: ${e}`);
    }
  }
}
