import * as fs from "fs";
import * as path from "path";
import type { OutputChannel } from "vscode";

type Category = "sse-event" | "cli-event" | "webview-in" | "webview-out" | "error" | "meta";

interface LogEntry {
  ts: string;
  cat: Category;
  payload: unknown;
}

interface InitOpts {
  enabled: boolean;
  dir: string;
  outputChannel?: OutputChannel | null;
  maxFileSize?: number;
  maxFiles?: number;
  maxPayloadBytes?: number;
}

const DEFAULT_MAX_FILE_SIZE = 5 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5;
const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

export class JsonLogger {
  private static enabled = false;
  private static dir = "";
  private static outputChannel: OutputChannel | null = null;
  private static maxFileSize = DEFAULT_MAX_FILE_SIZE;
  private static maxFiles = DEFAULT_MAX_FILES;
  private static maxPayloadBytes = DEFAULT_MAX_PAYLOAD_BYTES;
  private static queue: string[] = [];
  private static writing = false;
  private static failures = 0;
  private static currentFile = "";

  static init(opts: InitOpts): void {
    JsonLogger.enabled = !!opts.enabled;
    JsonLogger.dir = opts.dir || "";
    JsonLogger.outputChannel = opts.outputChannel || null;
    JsonLogger.maxFileSize = opts.maxFileSize || DEFAULT_MAX_FILE_SIZE;
    JsonLogger.maxFiles = opts.maxFiles || DEFAULT_MAX_FILES;
    JsonLogger.maxPayloadBytes = opts.maxPayloadBytes || DEFAULT_MAX_PAYLOAD_BYTES;
    JsonLogger.failures = 0;
    JsonLogger.queue = [];
    JsonLogger.writing = false;
    if (!JsonLogger.enabled) return;
    try {
      fs.mkdirSync(JsonLogger.dir, { recursive: true });
      JsonLogger.currentFile = JsonLogger.resolveFilePath();
      JsonLogger.notify(`enabled, dir=${JsonLogger.dir}`);
      JsonLogger.log("meta", { event: "logger-init", dir: JsonLogger.dir, file: JsonLogger.currentFile });
    } catch (e) {
      JsonLogger.enabled = false;
      JsonLogger.notify(`init failed: ${e}`);
    }
  }

  static isEnabled(): boolean {
    return JsonLogger.enabled;
  }

  static getDir(): string {
    return JsonLogger.dir;
  }

  static log(cat: Category, payload: unknown): void {
    if (!JsonLogger.enabled) return;
    try {
      const entry: LogEntry = {
        ts: new Date().toISOString(),
        cat,
        payload: JsonLogger.maybeTruncate(payload),
      };
      const line = JSON.stringify(entry) + "\n";
      JsonLogger.queue.push(line);
      void JsonLogger.drain();
    } catch (e) {
      JsonLogger.handleFailure(`log encode failed: ${e}`);
    }
  }

  static async flush(): Promise<void> {
    if (!JsonLogger.enabled) return;
    await JsonLogger.drain();
  }

  static dispose(): void {
    JsonLogger.enabled = false;
    JsonLogger.queue = [];
    JsonLogger.writing = false;
    JsonLogger.outputChannel = null;
  }

  private static resolveFilePath(): string {
    const today = new Date().toISOString().slice(0, 10);
    return path.join(JsonLogger.dir, `opencode-chat-${today}.ndjson`);
  }

  private static async drain(): Promise<void> {
    if (JsonLogger.writing) return;
    JsonLogger.writing = true;
    try {
      while (JsonLogger.queue.length && JsonLogger.enabled) {
        const file = JsonLogger.resolveFilePath();
        if (file !== JsonLogger.currentFile) JsonLogger.currentFile = file;
        await JsonLogger.rotateIfNeeded(file);
        const chunk = JsonLogger.queue.splice(0, JsonLogger.queue.length).join("");
        await fs.promises.appendFile(file, chunk, "utf-8");
      }
      JsonLogger.failures = 0;
    } catch (e) {
      JsonLogger.handleFailure(`write failed: ${e}`);
    } finally {
      JsonLogger.writing = false;
    }
  }

  private static async rotateIfNeeded(file: string): Promise<void> {
    try {
      const st = await fs.promises.stat(file);
      if (st.size < JsonLogger.maxFileSize) return;
    } catch {
      return;
    }
    try {
      for (let i = JsonLogger.maxFiles - 1; i >= 1; i--) {
        const src = `${file}.${i}`;
        const dst = `${file}.${i + 1}`;
        try { await fs.promises.rename(src, dst); } catch {}
      }
      try { await fs.promises.rename(file, `${file}.1`); } catch {}
      const overflow = `${file}.${JsonLogger.maxFiles + 1}`;
      try { await fs.promises.unlink(overflow); } catch {}
    } catch (e) {
      JsonLogger.handleFailure(`rotate failed: ${e}`);
    }
  }

  private static maybeTruncate(payload: unknown): unknown {
    try {
      const raw = JSON.stringify(payload);
      if (!raw || raw.length <= JsonLogger.maxPayloadBytes) return payload;
      return {
        __truncated: true,
        size: raw.length,
        preview: raw.slice(0, JsonLogger.maxPayloadBytes),
      };
    } catch {
      return { __serializeError: true, type: typeof payload };
    }
  }

  private static handleFailure(msg: string): void {
    JsonLogger.failures += 1;
    JsonLogger.notify(msg);
    if (JsonLogger.failures >= 2) {
      JsonLogger.enabled = false;
      JsonLogger.notify("disabling JsonLogger after repeated failures");
    }
  }

  private static notify(msg: string): void {
    if (JsonLogger.outputChannel) {
      try { JsonLogger.outputChannel.appendLine(`[JsonLogger] ${msg}`); } catch {}
    }
  }
}
