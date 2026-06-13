import { createOpencode, createOpencodeClient } from "@opencode-ai/sdk";

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

  static setOutputChannel(ch: import("vscode").OutputChannel): void {
    OpenCodeCli.outputChannel = ch;
  }

  setBinaryPath(p: string): void {
    this.binaryPath = p || "opencode";
  }

  private log(msg: string): void {
    if (OpenCodeCli.outputChannel) {
      OpenCodeCli.outputChannel.appendLine(`[OpenCodeCli] ${msg}`);
    }
  }

  private async resolveBinary(): Promise<string | null> {
    const { execFile } = await import("child_process");
    const candidates = [this.binaryPath];
    if (this.binaryPath === "opencode") {
      candidates.push("opencode.exe", "opencode.cmd");
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
    return null;
  }

  async start(): Promise<boolean> {
    // strategy 1: try createOpencode (uses cross-spawn)
    try {
      this.log("start: trying createOpencode");
      const { client, server } = await createOpencode({ timeout: 15000 });
      this.client = client as import("@opencode-ai/sdk/client").OpencodeClient;
      this.serverInstance = server;
      this.serverUrl = server.url;
      this.log(`start: createOpencode OK at ${this.serverUrl}`);
      return true;
    } catch (e) {
      this.log(`start: createOpencode FAILED: ${e}`);
    }

    // strategy 2: spawn serve manually with found binary
    try {
      const bin = this.binaryPath !== "opencode" ? this.binaryPath : null;
      const resolved = bin || await this.resolveBinary();
      if (resolved) {
        this.log(`start: trying manual spawn with ${resolved}`);
        const { execFile } = await import("child_process");
        const port = 4096 + Math.floor(Math.random() * 1000);
        const proc = execFile(resolved, ["serve", "--hostname=127.0.0.1", `--port=${port}`]);
        const url = await new Promise<string>((resolve, reject) => {
          let output = "";
          const timeout = setTimeout(() => reject(new Error("Server start timeout")), 15000);
          const onData = (chunk: Buffer) => {
            output += chunk.toString();
            const m = output.match(/on\s+(https?:\/\/[^\s]+)/);
            if (m) { clearTimeout(timeout); resolve(m[1]); }
          };
          proc.stdout?.on("data", onData);
          proc.stderr?.on("data", onData);
          proc.on("exit", (code) => { clearTimeout(timeout); reject(new Error(`exit ${code}: ${output.slice(0, 200)}`)); });
          proc.on("error", (err) => { clearTimeout(timeout); reject(err); });
        });
        this.serverUrl = url;
        this.serverInstance = { url, close: () => { proc.kill(); proc.stdio?.forEach((s: any) => s?.destroy?.()); } };
        this.client = createOpencodeClient({ baseUrl: url }) as import("@opencode-ai/sdk/client").OpencodeClient;
        this.log(`start: manual spawn OK at ${url}`);
        return true;
      }
    } catch (e) {
      this.log(`start: manual spawn FAILED: ${e}`);
    }

    // strategy 3: connect to an already-running server on default port
    try {
      this.log("start: trying existing server at 127.0.0.1:4096");
      const res = await fetch("http://127.0.0.1:4096/health");
      if (res.ok) {
        this.serverUrl = "http://127.0.0.1:4096";
        this.client = createOpencodeClient({ baseUrl: this.serverUrl }) as import("@opencode-ai/sdk/client").OpencodeClient;
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
    this.serverInstance?.close();
    this.serverInstance = null;
    this.client = null;
    this.serverUrl = "";
  }

  async checkInstall(): Promise<boolean> {
    const resolved = await this.resolveBinary();
    return resolved !== null;
  }

  async getVersion(): Promise<string> {
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
      const result = await this.client!.config.providers();
      const data = result.data;
      if (!data) return [];
      const models: string[] = [];
      for (const provider of data.providers) {
        const m = provider.models;
        if (m) {
          for (const key of Object.keys(m)) {
            const model = m[key];
            if (model.id) {
              models.push(`${provider.id}/${model.id}`);
            }
          }
        }
      }
      return models;
    } catch (e) {
      this.log(`listModels error: ${e}`);
      return [];
    }
  }

  async getProviderInfo(): Promise<Array<{ id: string; name: string; key?: string; modelCount: number }>> {
    try {
      const result = await this.client!.config.providers();
      const data = result.data;
      if (!data) return [];
      return data.providers.map(p => ({
        id: p.id,
        name: p.name,
        key: p.key,
        modelCount: Object.keys(p.models || {}).length,
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
    options: { sessionId?: string; model?: string; agent?: string; variant?: string } = {},
    onEvent: (event: CliEvent) => void,
    onError: (error: Error) => void,
    onExit: (code: number | null) => void
  ): Promise<void> {
    this.sseAbortFlag = false;
    this.sseIterator = null;

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

      await this.client!.session.promptAsync({
        path: { id: sessionId },
        body: {
          parts: [{ type: "text" as const, text: prompt }],
          ...(model ? { model } : {}),
          ...(options.agent ? { agent: options.agent } : {}),
        },
      });

      let hasStarted = false;

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
            if (st === "running" || st === "pending") {
              onEvent({ type: "tool-start", name: toolName, input: state?.input || {}, id: part?.id as string });
            } else if (st === "completed") {
              onEvent({ type: "tool-result", name: toolName, output: state?.output as string, content: state?.output as string, id: part?.id as string });
            } else if (st === "error") {
              onEvent({ type: "tool-result", name: toolName, output: state?.error as string, content: state?.error as string, id: part?.id as string });
            }
          } else if (delta) {
            onEvent({ type: "text", content: delta });
          }
        } else if (etype === "message.updated") {
          hasStarted = true;
          const info = props.info as Record<string, unknown> | undefined;
          if (info?.role === "assistant") {
            onEvent({ type: "message", info, role: "assistant" });
          }
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
      execFile("opencode", args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000 }, (err, stdout, stderr) => {
        if (err) reject(new Error(stderr.trim() || err.message));
        else resolve(stdout.trim());
      });
    });
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
