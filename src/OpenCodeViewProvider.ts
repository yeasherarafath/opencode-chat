import * as vscode from "vscode";
import * as path from "path";
import { OpenCodeCli } from "./OpenCodeCli";
import { JsonLogger } from "./JsonLogger";
import { AuthProxy } from "./AuthProxy";

export class OpenCodeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "opencode-chat.chatView";

  private view: vscode.WebviewView | undefined;
  private isInstalled = false;
  private opencodeVersion = "";
  private extensionVersion = "";
  private cli: OpenCodeCli;
  private authProxy = new AuthProxy();
  private openWebGuiPanel: vscode.WebviewPanel | undefined;

  constructor(extensionUri: vscode.Uri, cli: OpenCodeCli, extensionVersion: string) {
    this.cli = cli;
    this.extensionUri = extensionUri;
    this.extensionVersion = extensionVersion;
  }

  private log(msg: string): void {
    console.log(`[OpenCodeViewProvider] ${msg}`);
  }

  async initialize(): Promise<void> {
    this.log("initialize() start");
    // try start() first — uses createOpencode (cross-spawn) which handles PATH better
    try {
      const started = await this.cli.start();
      this.log(`initialize() start done, started=${started}`);
      if (started) this.isInstalled = true;
    } catch (e) {
      this.log(`initialize() start threw: ${e}`);
    }
    // fallback: check if binary exists at all
    if (!this.isInstalled) {
      try {
        this.isInstalled = await this.cli.checkInstall();
        this.log(`initialize() checkInstall done, isInstalled=${this.isInstalled}`);
      } catch (e) {
        this.log(`initialize() checkInstall threw: ${e}`);
      }
    }
    if (this.isInstalled) {
      try {
        this.opencodeVersion = await this.cli.getVersion();
      } catch {
        this.opencodeVersion = "";
      }
    }
    this.log("initialize() calling sendInitialState");
    try {
      await this.sendInitialState();
    } catch (e) {
      this.log(`initialize() sendInitialState threw: ${e}`);
    }
    if (!this.isInstalled) {
      this.log("initialize() showing install error message");
      try {
        const action = await vscode.window.showErrorMessage(
          "OpenCode Chat requires the opencode CLI. Install it to continue.",
          "Install OpenCode"
        );
        if (action === "Install OpenCode") {
          vscode.env.openExternal(vscode.Uri.parse(this.cli.getInstallUrl()));
        }
      } catch (e) {
        this.log(`initialize() error dialog threw: ${e}`);
      }
    }
    this.configChangeSub = vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration("opencode-chat.autoFetchSessions") ||
          e.affectsConfiguration("opencode-chat.autoFetchIntervalMs")) {
        this.log("initialize: config changed, restarting autoFetch");
        this.startAutoFetch();
      }
    });
    this.startAutoFetch();
    this.log("initialize() done");
  }

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ): void {
    this.log("resolveWebviewView() called");
    this.view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist")],
    };

    webviewView.webview.html = this.getHtml(webviewView.webview);
    this.log("resolveWebviewView() HTML set");

    // Intercept postMessage to log every outgoing webview message via JsonLogger.
    // JsonLogger.log() internally no-ops when disabled, so wrapping unconditionally
    // is safe and lets the user toggle logging without reloading the webview.
    const originalPost = webviewView.webview.postMessage.bind(webviewView.webview);
    (webviewView.webview as unknown as { postMessage: typeof originalPost }).postMessage =
      ((msg: unknown) => {
        try { JsonLogger.log("webview-out", msg); } catch {}
        return originalPost(msg as Parameters<typeof originalPost>[0]);
      }) as typeof originalPost;

    webviewView.webview.onDidReceiveMessage((msg) => {
      try { JsonLogger.log("webview-in", msg); } catch {}
      this.log(`onDidReceiveMessage: type=${msg.type}`);
      this.handleMessage(msg).catch((e) => this.log(`handleMessage error: ${e}`));
    });

    this.activeEditorSub = vscode.window.onDidChangeActiveTextEditor((editor) => {
      const path = editor?.document.uri.fsPath || "";
      try { this.view?.webview.postMessage({ type: "active-file", path }); } catch {}
    });
    webviewView.onDidChangeVisibility(() => {
      this.log(`onDidChangeVisibility: visible=${webviewView.visible}`);
      if (webviewView.visible) {
        this.sendInitialState().catch((e) => this.log(`sendInitialState(onVisible) error: ${e}`));
      }
    });
  }

  private extensionUri: vscode.Uri = vscode.Uri.file("");
  private currentSessionId: string | undefined;
  private activeEditorSub: vscode.Disposable | null = null;

  // --- Auto-fetch lifecycle ---
  private autoFetchAbort: AbortController | null = null;
  private autoFetchDebounce: NodeJS.Timeout | null = null;
  private autoFetchConfigSub: vscode.Disposable | null = null;
  private configChangeSub: vscode.Disposable | null = null;

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    if (!this.view) { this.log("handleMessage: no view, returning"); return; }
    const type = message.type as string;
    this.log(`handleMessage: ${type}`);

    try {
      switch (type) {
        case "ready": {
          this.log("handleMessage: ready -> sendInitialState");
          try {
            const editor = vscode.window.activeTextEditor;
            if (editor) this.view.webview.postMessage({ type: "active-file", path: editor.document.uri.fsPath });
          } catch {}
          try { await this.sendInitialState(); } catch (e) { this.log(`sendInitialState error: ${e}`); }
          try {
            const files = await vscode.workspace.findFiles("**/*", "{**/node_modules/**,**/.git/**}", 200);
            this.view.webview.postMessage({ type: "files", files: files.map(f => f.fsPath) });
          } catch (e) { this.log(`pre-fetch files error: ${e}`); }
          break;
        }
        case "new-session":
          this.view.webview.postMessage({ type: "new-session-ready" });
          break;
        case "delete-session": {
          this.log(`handleMessage: delete-session id=${message.sessionId}`);
          try {
            await this.cli.deleteSession(message.sessionId as string);
            this.refreshSessions().catch((e) => this.log(`refreshSessions error: ${e}`));
          } catch (e) {
            this.log(`deleteSession error: ${e}`);
            this.view.webview.postMessage({ type: "error", message: `Delete failed: ${e}` });
          }
          break;
        }
        case "rename-session": {
          this.log(`handleMessage: rename-session id=${message.sessionId} title="${message.title}"`);
          try {
            await this.cli.renameSession(message.sessionId as string, message.title as string);
            this.refreshSessions().catch((e) => this.log(`refreshSessions after rename error: ${e}`));
          } catch (e) {
            this.log(`renameSession error: ${e}`);
          }
          break;
        }
        case "load-messages": {
          this.log(`handleMessage: load-messages id=${message.sessionId}`);
          try {
            await this.loadSessionMessages(message.sessionId as string);
          } catch (e) {
            this.log(`loadSessionMessages error: ${e}`);
          }
          break;
        }
        case "send-message": {
          this.log(`handleMessage: send-message text="${(message.text as string || "").slice(0, 50)}..."`);
          this.currentSessionId = message.sessionId as string | undefined;
          this.sendMessage(
            message.text as string,
            message.sessionId as string | undefined,
            message.model as string | undefined,
            message.agent as string | undefined,
            message.variant as string | undefined,
            message.files as string[] | undefined
          );
          break;
        }
        case "abort": {
          this.log("handleMessage: abort");
          const sid = this.currentSessionId;
          if (sid) {
            await this.cli.abortSession(sid);
          }
          this.view.webview.postMessage({ type: "aborted" });
          break;
        }
        case "refresh-sessions":
          await this.refreshSessions().catch((e) => this.log(`refreshSessions error: ${e}`));
          break;
        case "refresh-models":
          await this.refreshModels().catch((e) => this.log(`refreshModels error: ${e}`));
          break;
        case "update-model": {
          const model = message.model as string;
          if (model) {
            const cfg = vscode.workspace.getConfiguration("opencode-chat");
            await cfg.update("defaultModel", model, vscode.ConfigurationTarget.Global);
          }
          break;
        }
        case "install":
          this.log("handleMessage: install");
          vscode.env.openExternal(vscode.Uri.parse(this.cli.getInstallUrl()));
          break;
        case "request-state":
          await this.sendStateInfo().catch((e) => this.log(`sendStateInfo error: ${e}`));
          break;
        case "run-cli": {
          this.log(`handleMessage: run-cli command="${message.command}"`);
          await this.runCliCommand(message.command as string).catch((e) => this.log(`runCliCommand error: ${e}`));
          break;
        }
        case "export-to-file": {
          this.log(`handleMessage: export-to-file id=${message.sessionId}`);
          await this.exportToFile(message.sessionId as string).catch((e) => this.log(`exportToFile error: ${e}`));
          break;
        }
        case "session-export": {
          const sid = message.sessionId as string;
          this.log(`handleMessage: session-export id=${sid}`);
          if (!sid) {
            this.view?.webview.postMessage({ type: "session-import-error", message: "No session selected." });
            break;
          }
          try {
            const data = await this.cli.exportSession(sid);
            const json = JSON.stringify(data, null, 2);
            this.view?.webview.postMessage({ type: "session-export-data", sessionId: sid, json });
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log(`session-export error: ${msg}`);
            this.view?.webview.postMessage({ type: "session-import-error", message: msg });
          }
          break;
        }
        case "session-import": {
          this.log("handleMessage: session-import");
          const picked = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: false,
            canSelectMany: false,
            title: "Import session from JSON file",
            filters: { "Session JSON": ["json"] },
          });
          if (!picked || !picked[0]) { this.log("session-import: cancelled"); break; }
          const filePath = picked[0].fsPath;
          try {
            const text = await require("fs").promises.readFile(filePath, "utf-8");
            this.view?.webview.postMessage({ type: "session-import-data", json: text });
            try {
              const parsed = JSON.parse(text);
              const title = (typeof parsed?.title === "string" && parsed.title) || "Imported session";
              const newSession = await this.cli.createSession(title);
              this.log(`session-import: created new session ${newSession.id} from imported title`);
              await this.refreshSessions();
              this.view?.webview.postMessage({ type: "session-created", session: newSession });
              vscode.window.showInformationMessage(`Session imported as "${title}" and added to list`);
            } catch (createErr) {
              const msg = createErr instanceof Error ? createErr.message : String(createErr);
              this.log(`session-import create failed: ${msg}`);
              vscode.window.showWarningMessage(`Session loaded, but failed to add to list: ${msg}`);
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log(`session-import error: ${msg}`);
            this.view?.webview.postMessage({ type: "session-import-error", message: msg });
          }
          break;
        }
        case "open-web-gui": {
          this.log("handleMessage: open-web-gui");
          try {
            const healthy = await this.cli.ensureServerHealthy();
            if (!healthy) {
              vscode.window.showErrorMessage("OpenCode server is not reachable. Try sending a message to start it.");
              break;
            }
            const targetUrl = this.cli.getServerUrl();
            const password = this.cli.getServerPassword();
            if (!targetUrl || !password) {
              vscode.window.showErrorMessage("OpenCode server URL or password is not available.");
              break;
            }
            const proxyUrl = await this.authProxy.start(targetUrl, "opencode", password);
            this.log(`open-web-gui: proxy=${proxyUrl} target=${targetUrl}`);

            const proxyUri = vscode.Uri.parse(proxyUrl);
            const panel = vscode.window.createWebviewPanel(
              "opencodeWebGui",
              "OpenCode Web GUI",
              vscode.ViewColumn.Active,
              {
                enableScripts: true,
                retainContextWhenHidden: true,
                localResourceRoots: [proxyUri],
              }
            );
            panel.iconPath = vscode.Uri.joinPath(this.extensionUri, "media", "icon.png");
            panel.webview.html = this.buildWebGuiHtml(proxyUrl);
            panel.webview.onDidReceiveMessage((msg) => {
              if (msg && msg.type === "navigate" && typeof msg.url === "string") {
                panel.webview.html = this.buildWebGuiHtml(msg.url);
              }
            });
            this.openWebGuiPanel = panel;
            panel.onDidDispose(() => {
              if (this.openWebGuiPanel === panel) this.openWebGuiPanel = undefined;
            });
          } catch (e) {
            this.log(`open-web-gui error: ${e}`);
            vscode.window.showErrorMessage(`Open web GUI failed: ${e}`);
          }
          break;
        }
        case "save-json": {
          const json = (message.json as string) ?? "";
          const defaultName = (message.defaultName as string) || "session.json";
          this.log(`handleMessage: save-json len=${json.length} defaultName=${defaultName}`);
          try {
            const target = await vscode.window.showSaveDialog({
              title: "Save session JSON",
              defaultUri: vscode.Uri.file(defaultName),
              filters: { "JSON": ["json"] },
            });
            if (!target) { this.log("save-json: cancelled"); break; }
            await require("fs").promises.writeFile(target.fsPath, json, "utf-8");
            vscode.window.showInformationMessage(`Saved to ${target.fsPath}`);
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log(`save-json error: ${msg}`);
            vscode.window.showErrorMessage(`Save failed: ${msg}`);
          }
          break;
        }
        case "open-file": {
          this.log(`handleMessage: open-file path=${message.path}`);
          this.openFile(message.path as string);
          break;
        }
        case "open-diff":
          this.openDiff();
          break;
        case "open-editor":
          this.openEditor();
          break;
        case "get-files": {
          this.log("handleMessage: get-files");
          try {
            const rawQuery = (message.query as string) || "";
            const escapeGlob = (s: string) => s.replace(/[\\/*?[\]{}!()@+]/g, "");
            const q = escapeGlob(rawQuery).trim();
            // when query present, narrow to files whose name contains the query;
            // otherwise list everything (up to maxResults) for browse mode.
            const pattern = (message.pattern as string)
              || (q ? `**/*${q}*` : "**/*");
            const exclude =
              (message.exclude as string)
              || "**/node_modules/**,**/.git/**,**/dist/**,**/build/**,**/out/**,**/.next/**,**/.nuxt/**,**/.cache/**,**/.turbo/**,**/.parcel-cache/**,**/coverage/**,**/.idea/**,**/.vscode-test/**,**/logs/**,**/vendor/**,**/*.lock,**/*.log";
            const maxResults = (message.maxResults as number) || 2000;
            const files = await vscode.workspace.findFiles(pattern, `{${exclude}}`, maxResults);
            const paths = files.map(f => f.fsPath);
            this.log(`get-files: pattern=${pattern} query="${rawQuery}" → ${paths.length} files`);
            this.view.webview.postMessage({ type: "files", files: paths, query: rawQuery });
          } catch (e) {
            this.log(`get-files error: ${e}`);
            this.view.webview.postMessage({ type: "files", files: [] });
          }
          break;
        }
        case "show-file-picker": {
          this.log("handleMessage: show-file-picker");
          const opts: vscode.OpenDialogOptions = {
            canSelectMany: false,
            openLabel: "Attach",
            filters: { "All Files": ["*"] },
          };
          const uris = await vscode.window.showOpenDialog(opts);
          if (uris && uris.length > 0) {
            this.view.webview.postMessage({ type: "file-picked", path: uris[0].fsPath });
          }
          break;
        }
        case "share-session": {
          this.log(`handleMessage: share-session id=${message.sessionId}`);
          try {
            const url = await this.cli.shareSession(message.sessionId as string);
            await vscode.env.clipboard.writeText(url);
            vscode.window.showInformationMessage("Share URL copied to clipboard");
          } catch (e) {
            this.log(`shareSession error: ${e}`);
            vscode.window.showErrorMessage(`Share failed: ${e}`);
          }
          break;
        }
        case "fork-session": {
          this.log(`handleMessage: fork-session id=${message.sessionId} messageID=${message.messageID}`);
          try {
            const newSession = await this.cli.forkSession(message.sessionId as string, message.messageID as string | undefined);
            this.view.webview.postMessage({ type: "session-created", session: newSession });
            this.refreshSessions().catch((e) => this.log(`refreshSessions after fork error: ${e}`));
          } catch (e) {
            this.log(`forkSession error: ${e}`);
            vscode.window.showErrorMessage(`Fork failed: ${e}`);
          }
          break;
        }
        case "summarize-session": {
          this.log(`handleMessage: summarize-session id=${message.sessionId}`);
          try {
            const ok = await this.cli.summarizeSession(message.sessionId as string, message.providerID as string, message.modelID as string);
            if (ok) {
              this.view.webview.postMessage({ type: "session-summarized", sessionId: message.sessionId });
              this.refreshSessions().catch((e) => this.log(`refreshSessions after summarize error: ${e}`));
            }
          } catch (e) {
            this.log(`summarizeSession error: ${e}`);
            vscode.window.showErrorMessage(`Summarize failed: ${e}`);
          }
          break;
        }
        case "get-session-diff": {
          this.log(`handleMessage: get-session-diff id=${message.sessionId}`);
          try {
            const diff = await this.cli.getSessionDiff(message.sessionId as string);
            this.view.webview.postMessage({ type: "session-diff", diff, sessionId: message.sessionId });
          } catch (e) {
            this.log(`getSessionDiff error: ${e}`);
            this.view.webview.postMessage({ type: "session-diff", diff: [], sessionId: message.sessionId });
          }
          break;
        }
        case "get-providers": {
          this.log("handleMessage: get-providers");
          try {
            const providers = await this.cli.getProviderInfo();
            this.view.webview.postMessage({ type: "providers", providers });
          } catch (e) {
            this.log(`getProviderInfo error: ${e}`);
          }
          break;
        }
        case "answer-question": {
          this.log(`handleMessage: answer-question answer="${(message.answer as string || "").slice(0, 80)}"`);
          break;
        }
        default:
          this.log(`handleMessage: unknown type="${type}"`);
      }
    } catch (e) {
      this.log(`handleMessage UNCAUGHT: ${e}`);
    }
  }

  private async sendInitialState(): Promise<void> {
    if (!this.view) { this.log("sendInitialState: no view, skip"); return; }
    const cfg = vscode.workspace.getConfiguration("opencode-chat");
    const defaultModel = cfg.get<string>("defaultModel") || "";
    const defaultAgent = cfg.get<string>("defaultAgent") || "";
    this.log(`sendInitialState: posting state isInstalled=${this.isInstalled} version=${this.opencodeVersion}`);
    this.view.webview.postMessage({ type: "state", isInstalled: this.isInstalled, opencodeVersion: this.opencodeVersion, extensionVersion: this.extensionVersion, defaultModel, defaultAgent });
    if (!this.isInstalled) { this.log("sendInitialState: not installed, skip refresh"); return; }
    this.log("sendInitialState: refreshing sessions/models/agents");
    try {
      await Promise.all([this.refreshSessions(), this.refreshModels(), this.refreshAgents()]);
      this.log("sendInitialState: refresh done");
    } catch (e) {
      this.log(`sendInitialState: refresh failed: ${e}`);
    }
  }

  private async sendStateInfo(): Promise<void> {
    if (!this.view) { this.log("sendStateInfo: no view, skip"); return; }
    this.log("sendStateInfo");
    let sessions: unknown[] = [];
    try {
      sessions = await this.cli.listSessions();
      this.log(`sendStateInfo: got ${sessions.length} sessions`);
    } catch (e) {
      this.log(`sendStateInfo: listSessions error: ${e}`);
    }
    try {
      this.view.webview.postMessage({
        type: "state-info",
        isInstalled: this.isInstalled,
        opencodeVersion: this.opencodeVersion,
        extensionVersion: this.extensionVersion,
        sessionCount: sessions.length,
      });
    } catch (e) {
      this.log(`sendStateInfo: postMessage error: ${e}`);
    }
  }

  private async refreshSessions(): Promise<void> {
    if (!this.view) { this.log("refreshSessions: no view, skip"); return; }
    this.log("refreshSessions");
    try {
      const sessions = await this.cli.listSessions();
      this.log(`refreshSessions: got ${sessions.length} sessions`);
      this.view.webview.postMessage({ type: "sessions", sessions });
    } catch (e) {
      this.log(`refreshSessions error: ${e}`);
      try { this.view.webview.postMessage({ type: "sessions", sessions: [] }); } catch {}
    }
  }

  async refreshModels(): Promise<void> {
    if (!this.view) { this.log("refreshModels: no view, skip"); return; }
    this.log("refreshModels");
    try {
      const models = await this.cli.listModels();
      this.log(`refreshModels: got ${models.length} models`);
      this.view.webview.postMessage({ type: "models", models });
    } catch (e) {
      this.log(`refreshModels error: ${e}`);
      try { this.view.webview.postMessage({ type: "models", models: [] }); } catch {}
    }
  }

  private async refreshAgents(): Promise<void> {
    if (!this.view) { this.log("refreshAgents: no view, skip"); return; }
    this.log("refreshAgents");
    try {
      const agents = await this.cli.listAgents();
      this.log(`refreshAgents: got ${agents.length} agents`);
      this.view.webview.postMessage({ type: "agents", agents });
    } catch (e) {
      this.log(`refreshAgents error: ${e}`);
      try { this.view.webview.postMessage({ type: "agents", agents: [] }); } catch {}
    }
  }

  private async loadSessionMessages(sessionId: string): Promise<void> {
    if (!this.view) { this.log("loadSessionMessages: no view, skip"); return; }
    this.log(`loadSessionMessages: id=${sessionId}`);
    try {
      const data = await this.cli.exportSession(sessionId);
      const messages = (data as any).messages ?? [];
      this.log(`loadSessionMessages: got ${messages.length} messages`);
      this.view.webview.postMessage({
        type: "session-loaded",
        sessionId,
        messages,
        session: data,
      });
    } catch (e) {
      this.log(`loadSessionMessages error: ${e}`);
      try { this.view.webview.postMessage({ type: "session-loaded", sessionId, messages: [] }); } catch {}
    }
  }

  private sendMessage(
    text: string,
    sessionId?: string,
    model?: string,
    agent?: string,
    variant?: string,
    files?: string[]
  ): void {
    if (!this.view) { this.log("sendMessage: no view, skip"); return; }
    this.log(`sendMessage: text="${text.slice(0, 50)}..." sessionId=${sessionId ?? "new"} model=${model ?? "default"} agent=${agent ?? "default"} variant=${variant ?? "none"} files=${files?.length ?? 0}`);

    const opts: { sessionId?: string; model?: string; agent?: string; variant?: string; files?: string[] } = {};
    if (sessionId) opts.sessionId = sessionId;
    if (model) opts.model = model;
    if (agent) opts.agent = agent;
    if (variant) opts.variant = variant;
    if (files?.length) opts.files = files;

    try {
      this.view.webview.postMessage({ type: "response-start" });
    } catch (e) {
      this.log(`sendMessage: postMessage response-start error: ${e}`);
    }

    let capturedSessionId = sessionId;
    this.cli.runPrompt(
      text,
      opts,
      (event) => {
        const sid = (event as any).sessionID;
        if (sid && sid !== capturedSessionId) {
          capturedSessionId = sid;
          this.currentSessionId = sid;
          this.log(`sendMessage: captured new sessionId=${sid}`);
          try { this.view?.webview.postMessage({ type: "session-id", sessionId: sid }); }
          catch (e) { this.log(`sendMessage: session-id postMessage error: ${e}`); }
        }
        const etype = String((event as any).type ?? "");
        if (etype !== "sessionID") {
          try { this.view?.webview.postMessage({ type: "response-chunk", event }); }
          catch (e) { this.log(`sendMessage: onEvent postMessage error: ${e}`); }
        }
      },
      (error) => {
        this.log(`sendMessage: onError: ${error.message}`);
        try { this.view?.webview.postMessage({ type: "response-error", message: error.message }); }
        catch (e) { this.log(`sendMessage: onError postMessage error: ${e}`); }
      },
      (code) => {
        this.log(`sendMessage: onExit code=${code}`);
        try { this.view?.webview.postMessage({ type: "response-end" }); }
        catch (e) { this.log(`sendMessage: onExit postMessage error: ${e}`); }
        this.refreshSessions().catch((e) => this.log(`sendMessage: refreshSessions after exit error: ${e}`));
      }
    );
  }

  private async runCliCommand(command: string): Promise<void> {
    if (!this.view) { this.log("runCliCommand: no view, skip"); return; }
    this.log(`runCliCommand: command="${command}"`);
    const parts = command.split(/\s+/).filter(Boolean);
    if (parts.length === 0) { this.log("runCliCommand: empty parts"); return; }
    try {
      const result = await this.cli.runCliCommand(parts);
      this.log(`runCliCommand: result length=${result.length}`);
      this.view.webview.postMessage({ type: "cli-result", command, result });
    } catch (e) {
      this.log(`runCliCommand error: ${e}`);
      try { this.view.webview.postMessage({ type: "cli-result", command, result: String(e) }); } catch {}
    }
  }

  private async exportToFile(sessionId: string): Promise<void> {
    if (!sessionId) {
      vscode.window.showErrorMessage("No session selected to export.");
      return;
    }
    try {
      const data = await this.cli.exportSession(sessionId);
      const doc = await vscode.workspace.openTextDocument({
        content: JSON.stringify(data, null, 2),
        language: "json",
      });
      await vscode.window.showTextDocument(doc);
    } catch (e) {
      vscode.window.showErrorMessage(`Export failed: ${e}`);
    }
  }

  private openFile(filePath: string): void {
    try {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
      const normalized = (filePath || "").replace(/\\/g, "/").replace(/^\.\/+/, "");
      const isWinAbs = /^[A-Za-z]:\//.test(normalized);
      const isUnixAbs = normalized.startsWith("/");
      const isAbsolute = isWinAbs || isUnixAbs || path.isAbsolute(filePath);
      let uri: vscode.Uri;
      if (isAbsolute) {
        uri = vscode.Uri.file(filePath);
      } else if (workspaceRoot) {
        uri = vscode.Uri.joinPath(workspaceRoot, normalized);
      } else {
        uri = vscode.Uri.file(filePath);
      }
      this.log(`openFile: ${filePath} -> ${uri.fsPath}`);
      vscode.commands.executeCommand("vscode.open", uri);
    } catch (e) {
      this.log(`openFile error: ${e}`);
    }
  }

  private openDiff(): void {
    vscode.commands.executeCommand("workbench.view.scm");
  }

  private openEditor(): void {
    const editor = vscode.window.activeTextEditor;
    if (editor) {
      vscode.commands.executeCommand("workbench.action.focusActiveEditorGroup");
    } else {
      vscode.commands.executeCommand("workbench.action.files.newUntitledFile");
    }
  }

  newSession(): void {
    this.view?.webview.postMessage({ type: "new-session-ready" });
  }

  // --- Auto-fetch: start SSE subscription or polling fallback ---
  // Reads config from opencode-chat.autoFetchSessions + autoFetchIntervalMs.
  // Cancels any existing subscription first. Safe to call repeatedly.
  startAutoFetch(): void {
    this.stopAutoFetch();
    const cfg = vscode.workspace.getConfiguration("opencode-chat");
    const enabled = cfg.get<boolean>("autoFetchSessions", true);
    if (!enabled) { this.log("startAutoFetch: disabled by config"); return; }
    const intervalMs = cfg.get<number>("autoFetchIntervalMs", 0);
    if (!this.isInstalled) { this.log("startAutoFetch: CLI not installed, skip"); return; }

    const ac = new AbortController();
    this.autoFetchAbort = ac;
    const fire = () => this.debouncedRefreshSessions();
    this.log(`startAutoFetch: mode=${intervalMs > 0 ? "poll:" + intervalMs + "ms" : "sse"}`);

    if (intervalMs > 0) {
      this.cli.pollSessions(intervalMs, fire, ac.signal).catch((e) =>
        this.log(`autoFetch poll exited: ${e}`)
      );
    } else {
      const loop = async (): Promise<void> => {
        let backoff = 1000;
        while (!ac.signal.aborted) {
          try {
            await this.cli.subscribeGlobalEvents(fire, ac.signal);
            // clean exit (signal aborted) → bail
            if (ac.signal.aborted) break;
            this.log("autoFetch SSE ended without error, reconnecting in 1s");
            await new Promise((r) => setTimeout(r, 1000));
            backoff = 1000;
          } catch (e) {
            if (ac.signal.aborted) break;
            this.log(`autoFetch SSE error: ${e}; retry in ${backoff}ms`);
            await new Promise((r) => setTimeout(r, backoff));
            backoff = Math.min(backoff * 2, 30000);
          }
        }
      };
      loop().catch((e) => this.log(`autoFetch SSE loop crashed: ${e}`));
    }
  }

  stopAutoFetch(): void {
    if (this.autoFetchAbort) {
      this.log("stopAutoFetch: aborting");
      this.autoFetchAbort.abort();
      this.autoFetchAbort = null;
    }
    if (this.autoFetchDebounce) {
      clearTimeout(this.autoFetchDebounce);
      this.autoFetchDebounce = null;
    }
  }

  // Coalesce burst events (e.g. CLI bulk-import) into one refresh + webview post.
  private debouncedRefreshSessions(): void {
    if (this.autoFetchDebounce) return;
    this.autoFetchDebounce = setTimeout(() => {
      this.autoFetchDebounce = null;
      this.refreshSessions().catch((e) => this.log(`autoFetch refresh error: ${e}`));
    }, 250);
  }

  // Public: tear down everything. Called from extension deactivate().
  dispose(): void {
    this.stopAutoFetch();
    this.autoFetchConfigSub?.dispose();
    this.configChangeSub?.dispose();
    this.activeEditorSub?.dispose();
    this.authProxy.stop();
  }

  private buildWebGuiHtml(proxyUrl: string): string {
    const escaped = proxyUrl.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; frame-src http://127.0.0.1:* ws://127.0.0.1:*; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src http: https: data:; font-src http: https: data:; connect-src http://127.0.0.1:* ws://127.0.0.1:*;">
<title>OpenCode Web GUI</title>
<style>
  html, body { margin: 0; padding: 0; height: 100%; width: 100%; overflow: hidden; background: var(--vscode-editor-background, #1e1e1e); }
  #toolbar { display: flex; align-items: center; gap: 6px; padding: 4px 8px; background: var(--vscode-titleBar-activeBackground, #2d2d2d); color: var(--vscode-titleBar-activeForeground, #ccc); font: 12px var(--vscode-font-family, sans-serif); border-bottom: 1px solid var(--vscode-widget-border, #444); }
  #toolbar button { background: transparent; color: inherit; border: 1px solid transparent; padding: 2px 8px; cursor: pointer; border-radius: 2px; font: inherit; }
  #toolbar button:hover { background: rgba(255,255,255,0.08); border-color: rgba(255,255,255,0.12); }
  #url { flex: 1; min-width: 0; background: var(--vscode-input-background, #1e1e1e); color: var(--vscode-input-foreground, #ccc); border: 1px solid var(--vscode-input-border, #444); padding: 2px 6px; font: inherit; border-radius: 2px; }
  iframe { width: 100%; height: calc(100% - 28px); border: none; display: block; }
</style>
</head>
<body>
<div id="toolbar">
  <button id="back" title="Back">◀</button>
  <button id="forward" title="Forward">▶</button>
  <button id="reload" title="Reload">⟳</button>
  <input id="url" type="text" value="${escaped}" />
  <button id="go" title="Go">Go</button>
</div>
<iframe id="frame" src="${escaped}"></iframe>
<script>
  const vscode = acquireVsCodeApi();
  const frame = document.getElementById('frame');
  const urlInput = document.getElementById('url');
  document.getElementById('reload').onclick = () => { frame.src = frame.src; };
  document.getElementById('back').onclick = () => { history.back(); };
  document.getElementById('forward').onclick = () => { history.forward(); };
  document.getElementById('go').onclick = () => { const u = urlInput.value.trim(); if (u) frame.src = u; };
  urlInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { const u = urlInput.value.trim(); if (u) frame.src = u; } });
  let lastUrl = frame.src;
  setInterval(() => { try { const cur = frame.contentWindow.location.href; if (cur && cur !== lastUrl && cur !== 'about:blank') { lastUrl = cur; urlInput.value = cur; vscode.postMessage({ type: 'navigate', url: cur }); } } catch (_) {} }, 500);
</script>
</body>
</html>`;
  }

  private getHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.js")
    );
    const cssUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview.css")
    );

    const nonce = this.getNonce();
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<link rel="stylesheet" nonce="${nonce}" href="${cssUri}">
<title>OpenCode Chat</title>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 64; i++) {
      text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
  }
}
