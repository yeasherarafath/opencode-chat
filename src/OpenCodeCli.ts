import { execFile, spawn, ChildProcess } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

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
  input?: string;
  output?: string;
  data?: unknown;
  [key: string]: unknown;
}

function isWindows(): boolean {
  return process.platform === "win32";
}

export class OpenCodeCli {
  private runningProcess: ChildProcess | null = null;
  private cliPath: string;
  private resolved = false;
  private static outputChannel: import("vscode").OutputChannel | null = null;

  static setOutputChannel(ch: import("vscode").OutputChannel): void {
    OpenCodeCli.outputChannel = ch;
  }

  private log(msg: string): void {
    if (OpenCodeCli.outputChannel) {
      OpenCodeCli.outputChannel.appendLine(`[OpenCodeCli] ${msg}`);
    }
  }

  constructor(cliPath = "opencode") {
    this.cliPath = cliPath;
    this.log(`constructor: cliPath="${cliPath}"`);
  }

  private async resolveBinary(): Promise<string> {
    this.log(`resolveBinary: start, cliPath="${this.cliPath}", resolved=${this.resolved}`);
    if (this.resolved) return this.cliPath;

    if (fs.existsSync(this.cliPath)) {
      this.log(`resolveBinary: direct path exists: "${this.cliPath}"`);
      this.resolved = true;
      return this.cliPath;
    }
    this.log(`resolveBinary: direct path not found: "${this.cliPath}"`);

    this.log(`resolveBinary: PATH=${process.env.PATH || "(empty)"}`);

    let allResults: string[] = [];
    try {
      this.log(`resolveBinary: running "where ${this.cliPath}"`);
      allResults = await this.lookupBinary(this.cliPath);
      this.log(`resolveBinary: "where" results: [${allResults.join(", ")}]`);
    } catch (e) {
      this.log(`resolveBinary: "where ${this.cliPath}" failed: ${e}`);
    }
    if (allResults.length === 0 && isWindows()) {
      try {
        this.log(`resolveBinary: running "where ${this.cliPath}.cmd"`);
        allResults = await this.lookupBinary(`${this.cliPath}.cmd`);
        this.log(`resolveBinary: "where .cmd" results: [${allResults.join(", ")}]`);
      } catch (e) {
        this.log(`resolveBinary: "where ${this.cliPath}.cmd" failed: ${e}`);
      }
    }

    if (isWindows()) {
      const cmd = allResults.find((p) => /\.cmd$/i.test(p));
      if (cmd) { this.log(`resolveBinary: picked .cmd: "${cmd}"`); this.cliPath = cmd; this.resolved = true; return this.cliPath; }
      const exe = allResults.find((p) => /\.exe$/i.test(p));
      if (exe) { this.log(`resolveBinary: picked .exe: "${exe}"`); this.cliPath = exe; this.resolved = true; return this.cliPath; }
      const noExt = allResults.find((p) => fs.existsSync(p));
      if (noExt) { this.log(`resolveBinary: picked extensionless: "${noExt}"`); this.cliPath = noExt; this.resolved = true; return this.cliPath; }
    } else {
      const found = allResults.find((p) => fs.existsSync(p));
      if (found) { this.log(`resolveBinary: picked: "${found}"`); this.cliPath = found; this.resolved = true; return this.cliPath; }
    }

    this.log(`resolveBinary: "where" returned nothing useful, trying npm global fallback`);
    const fallback = this.getNpmGlobalPath();
    this.log(`resolveBinary: npm global fallback="${fallback}"`);
    if (fallback && fs.existsSync(fallback)) {
      this.log(`resolveBinary: using npm global fallback: "${fallback}"`);
      this.cliPath = fallback;
      this.resolved = true;
    }

    this.log(`resolveBinary: final cliPath="${this.cliPath}", resolved=${this.resolved}`);
    return this.cliPath;
  }

  private lookupBinary(name: string): Promise<string[]> {
    const lookupCmd = isWindows() ? "where" : "which";
    return new Promise((resolve, reject) => {
      execFile(lookupCmd, [name], { timeout: 5000 }, (err, stdout) => {
        if (err) reject(err);
        else resolve(stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean));
      });
    });
  }

  private getNpmGlobalPath(): string | null {
    try {
      const npmRoot = isWindows()
        ? path.join(os.homedir(), "AppData", "Roaming", "npm")
        : path.join(os.homedir(), ".npm", "bin");
      this.log(`getNpmGlobalPath: npmRoot="${npmRoot}"`);
      if (isWindows()) {
        const cmdPath = path.join(npmRoot, "opencode.cmd");
        this.log(`getNpmGlobalPath: checking "${cmdPath}" exists=${fs.existsSync(cmdPath)}`);
        if (fs.existsSync(cmdPath)) return cmdPath;
      }
      const binPath = path.join(npmRoot, "opencode");
      this.log(`getNpmGlobalPath: checking "${binPath}" exists=${fs.existsSync(binPath)}`);
      if (fs.existsSync(binPath)) return binPath;
    } catch (e) {
      this.log(`getNpmGlobalPath: error: ${e}`);
    }
    return null;
  }

  async checkInstall(): Promise<boolean> {
    try {
      this.log(`checkInstall: resolving binary...`);
      await this.resolveBinary();
      this.log(`checkInstall: resolved to "${this.cliPath}", checking version...`);
      const ver = await this.getVersion();
      this.log(`checkInstall: version="${ver}", install OK`);
      return true;
    } catch (e) {
      this.log(`checkInstall: FAILED: ${e}`);
      return false;
    }
  }

  async getVersion(): Promise<string> {
    this.log(`getVersion: running "${this.cliPath} --version" (shell=${isWindows()})`);
    return new Promise((resolve, reject) => {
      execFile(this.cliPath, ["--version"], { timeout: 5000, shell: isWindows() }, (error: Error | null, stdout: string) => {
        if (error) {
          this.log(`getVersion: execFile error: ${error.message}`);
          reject(new Error(`version check: ${error.message}`));
        } else {
          this.log(`getVersion: stdout="${stdout.trim()}"`);
          resolve(stdout.trim());
        }
      });
    });
  }

  getInstallUrl(): string {
    return "https://opencode.ai/install";
  }

  async listSessions(maxCount = 50): Promise<SessionInfo[]> {
    return new Promise((resolve, reject) => {
      execFile(
        this.cliPath,
        ["session", "list", "--format", "json", "--max-count", String(maxCount)],
        { maxBuffer: 10 * 1024 * 1024, timeout: 30000, shell: isWindows() },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(new Error(`list sessions failed: ${error.message}`));
            return;
          }
          try {
            const parsed = JSON.parse(stdout);
            const sessions = Array.isArray(parsed) ? parsed : parsed.sessions ?? parsed.data ?? [];
            resolve(sessions);
          } catch {
            resolve([]);
          }
        }
      );
    });
  }

  async deleteSession(id: string): Promise<void> {
    return new Promise((resolve, reject) => {
      execFile(this.cliPath, ["session", "delete", id], { timeout: 15000, shell: isWindows() }, (error: Error | null) => {
        if (error) reject(new Error(`delete session: ${error.message}`));
        else resolve();
      });
    });
  }

  async exportSession(id: string): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      execFile(
        this.cliPath,
        ["export", id],
        { maxBuffer: 50 * 1024 * 1024, timeout: 30000, shell: isWindows() },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(new Error(`export session: ${error.message}`));
            return;
          }
          try {
            resolve(JSON.parse(stdout));
          } catch {
            reject(new Error("parse session export failed"));
          }
        }
      );
    });
  }

  async listModels(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      execFile(this.cliPath, ["models"], { maxBuffer: 10 * 1024 * 1024, timeout: 30000, shell: isWindows() }, (error: Error | null, stdout: string) => {
        if (error) {
          reject(new Error(`list models: ${error.message}`));
          return;
        }
        const models = stdout
          .split("\n")
          .map((l: string) => l.trim())
          .filter((l: string) => l.length > 0 && !l.startsWith("No") && !l.startsWith("Provider") && l.includes("/"));
        resolve(models);
      });
    });
  }

  async listAgents(): Promise<string[]> {
    return new Promise((resolve, reject) => {
      execFile(this.cliPath, ["agent", "list"], { maxBuffer: 10 * 1024 * 1024, timeout: 15000, shell: isWindows() }, (error: Error | null, stdout: string) => {
        if (error) {
          reject(new Error(`list agents: ${error.message}`));
          return;
        }
        const agents = stdout
          .split("\n")
          .map((l: string) => l.trim())
          .filter((l: string) => {
            if (!l || l.startsWith("[") || l.startsWith("]") || l.startsWith("{") || l.startsWith("}")) return false;
            return /^[\w-]+/.test(l);
          })
          .map((l: string) => l.split(/\s+/)[0]);
        resolve(agents);
      });
    });
  }

  runPrompt(
    prompt: string,
    options: { sessionId?: string; model?: string; agent?: string; variant?: string } = {},
    onEvent: (event: CliEvent) => void,
    onError: (error: Error) => void,
    onExit: (code: number | null) => void
  ): void {
    const args: string[] = ["run", "--format", "json"];
    if (options.sessionId) {
      args.push("--session", options.sessionId);
    }
    if (options.model) {
      args.push("--model", options.model);
    }
    if (options.agent) {
      args.push("--agent", options.agent);
    }
    if (options.variant) {
      args.push("--variant", options.variant);
    }
    args.push(prompt);

    this.log(`runPrompt: spawning "${this.cliPath}" with args=[${args.join(", ")}], prompt="${prompt.slice(0, 80)}..." shell=${isWindows()}`);

    // stdio: close stdin (ignore) so the CLI doesn't hang waiting for more input
    const proc = spawn(this.cliPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      shell: isWindows(),
    });

    this.runningProcess = proc;
    this.log("runPrompt: spawned, pid=" + proc.pid);

    let buffer = "";
    let chunkCount = 0;

    proc.stdout.on("data", (chunk: Buffer) => {
      chunkCount++;
      const text = chunk.toString();
      this.log(`runPrompt: stdout data #${chunkCount} len=${text.length} text="${text.slice(0, 200)}"`);
      buffer += text;
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const evt = JSON.parse(trimmed);
          this.log(`runPrompt: parsed event type=${evt.type}`);
          onEvent(evt as CliEvent);
        } catch (e) {
          this.log(`runPrompt: non-JSON line: "${trimmed.slice(0, 100)}"`);
          onEvent({ type: "text", content: trimmed });
        }
      }
    });

    proc.stderr.on("data", (chunk: Buffer) => {
      const text = chunk.toString().trim();
      this.log(`runPrompt: stderr data: "${text.slice(0, 200)}"`);
      if (text) {
        onEvent({ type: "stderr", content: text });
      }
    });

    proc.on("error", (err: Error) => {
      this.log(`runPrompt: process error: ${err.message}`);
      this.runningProcess = null;
      onError(err);
    });

    proc.on("exit", (code: number | null) => {
      this.log(`runPrompt: process exit code=${code}, bufferRemaining="${buffer.trim().slice(0, 100)}"`);
      this.runningProcess = null;
      if (buffer.trim()) {
        try {
          const evt = JSON.parse(buffer.trim());
          this.log(`runPrompt: parsed final buffer as event type=${evt.type}`);
          onEvent(evt as CliEvent);
        } catch {
          this.log(`runPrompt: final buffer not JSON, sending as text`);
          onEvent({ type: "text", content: buffer.trim() });
        }
      }
      onExit(code);
    });
  }

  async runCliCommand(args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(this.cliPath, args, { maxBuffer: 10 * 1024 * 1024, timeout: 30000, shell: isWindows() }, (error: Error | null, stdout: string, stderr: string) => {
        if (error) {
          reject(new Error(stderr.trim() || error.message));
          return;
        }
        resolve(stdout.trim());
      });
    });
  }

  abort(): void {
    if (this.runningProcess) {
      try {
        this.runningProcess.kill("SIGTERM");
      } catch {
        this.runningProcess.kill("SIGKILL");
      }
      this.runningProcess = null;
    }
  }

  isRunning(): boolean {
    return this.runningProcess !== null;
  }
}
