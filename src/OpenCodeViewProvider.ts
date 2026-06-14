import * as vscode from "vscode";
import * as path from "path";
import { OpenCodeCli } from "./OpenCodeCli";
import { JsonLogger } from "./JsonLogger";

export class OpenCodeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "opencode-chat.chatView";

  private view: vscode.WebviewView | undefined;
  private isInstalled = false;
  private opencodeVersion = "";
  private cli: OpenCodeCli;

  constructor(extensionUri: vscode.Uri, cli: OpenCodeCli) {
    this.cli = cli;
    this.extensionUri = extensionUri;
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
      try { this.opencodeVersion = await this.cli.getVersion(); } catch { this.opencodeVersion = ""; }
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

    // Intercept postMessage to log every outgoing webview message
    if (JsonLogger.isEnabled()) {
      const originalPost = webviewView.webview.postMessage.bind(webviewView.webview);
      (webviewView.webview as unknown as { postMessage: typeof originalPost }).postMessage =
        ((msg: unknown) => {
          try { JsonLogger.log("webview-out", msg); } catch {}
          return originalPost(msg as Parameters<typeof originalPost>[0]);
        }) as typeof originalPost;
    }

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
            const pattern = (message.pattern as string) || "*";
            const exclude = (message.exclude as string) || "**/node_modules/**,**/.git/**";
            const maxResults = (message.maxResults as number) || 50;
            const files = await vscode.workspace.findFiles(pattern, `{${exclude}}`, maxResults);
            const paths = files.map(f => f.fsPath);
            this.view.webview.postMessage({ type: "files", files: paths });
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
    this.view.webview.postMessage({ type: "state", isInstalled: this.isInstalled, opencodeVersion: this.opencodeVersion, defaultModel, defaultAgent });
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

  private async refreshModels(): Promise<void> {
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
        if ((event as any).type !== "sessionID") {
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
