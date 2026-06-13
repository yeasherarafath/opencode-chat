import * as vscode from "vscode";
import { OpenCodeCli } from "./OpenCodeCli";

export class OpenCodeViewProvider implements vscode.WebviewViewProvider {
  static readonly viewType = "opencode-chat.chatView";

  private view: vscode.WebviewView | undefined;
  private isInstalled = false;
  private opencodeVersion = "";
  private cli: OpenCodeCli;
  private extensionUri: vscode.Uri;

  constructor(extensionUri: vscode.Uri, cli: OpenCodeCli) {
    this.extensionUri = extensionUri;
    this.cli = cli;
  }

  private log(msg: string): void {
    console.log(`[OpenCodeViewProvider] ${msg}`);
  }

  async initialize(): Promise<void> {
    this.log("initialize() start");
    try {
      this.isInstalled = await this.cli.checkInstall();
      this.log(`initialize() checkInstall done, isInstalled=${this.isInstalled}`);
    } catch (e) {
      this.log(`initialize() checkInstall threw: ${e}`);
      this.isInstalled = false;
    }
    if (this.isInstalled) {
      try {
        this.opencodeVersion = await this.cli.getVersion();
        this.log(`initialize() version=${this.opencodeVersion}`);
      } catch (e) {
        this.log(`initialize() getVersion threw: ${e}`);
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

    webviewView.webview.onDidReceiveMessage((msg) => {
      this.log(`onDidReceiveMessage: type=${msg.type}`);
      this.handleMessage(msg).catch((e) => this.log(`handleMessage error: ${e}`));
    });

    webviewView.onDidChangeVisibility(() => {
      this.log(`onDidChangeVisibility: visible=${webviewView.visible}`);
      if (webviewView.visible) {
        this.sendInitialState().catch((e) => this.log(`sendInitialState(onVisible) error: ${e}`));
      }
    });
  }

  private async handleMessage(message: Record<string, unknown>): Promise<void> {
    if (!this.view) { this.log("handleMessage: no view, returning"); return; }
    const type = message.type as string;
    this.log(`handleMessage: ${type}`);

    try {
      switch (type) {
        case "ready": {
          this.log("handleMessage: ready -> sendInitialState");
          try { await this.sendInitialState(); } catch (e) { this.log(`sendInitialState error: ${e}`); }
          // pre-fetch workspace file list for @ mentions
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
          this.sendMessage(
            message.text as string,
            message.sessionId as string | undefined,
            message.model as string | undefined,
            message.agent as string | undefined,
            message.variant as string | undefined
          );
          break;
        }
        case "abort":
          this.log("handleMessage: abort");
          this.cli.abort();
          this.view.webview.postMessage({ type: "aborted" });
          break;
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
        case "answer-question": {
          this.log(`handleMessage: answer-question answer="${(message.answer as string || "").slice(0, 80)}"`);
          // answer is inserted into the input textarea on the webview side
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
    this.log(`sendInitialState: posting state isInstalled=${this.isInstalled} version=${this.opencodeVersion}`);
    this.view.webview.postMessage({ type: "state", isInstalled: this.isInstalled, opencodeVersion: this.opencodeVersion });
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
    variant?: string
  ): void {
    if (!this.view) { this.log("sendMessage: no view, skip"); return; }
    this.log(`sendMessage: text="${text.slice(0, 50)}..." sessionId=${sessionId ?? "new"} model=${model ?? "default"} agent=${agent ?? "default"} variant=${variant ?? "none"}`);

    const opts: { sessionId?: string; model?: string; agent?: string; variant?: string } = {};
    if (sessionId) opts.sessionId = sessionId;
    if (model) opts.model = model;
    if (agent) opts.agent = agent;
    if (variant) opts.variant = variant;

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
          this.log(`sendMessage: captured new sessionId=${sid}`);
          try { this.view?.webview.postMessage({ type: "session-id", sessionId: sid }); }
          catch (e) { this.log(`sendMessage: session-id postMessage error: ${e}`); }
        }
        try { this.view?.webview.postMessage({ type: "response-chunk", event }); }
        catch (e) { this.log(`sendMessage: onEvent postMessage error: ${e}`); }
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

    const nonce = this.getNonce();
    const csp = webview.cspSource;

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${csp} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>OpenCode Chat</title>
<style nonce="${nonce}">
/* ===== Material Design Dark Palette (chat.html) ===== */
:root {
  --bg: #131313;
  --surface: #202020;
  --surface-low: #1b1b1c;
  --surface-lowest: #0e0e0e;
  --surface-high: #2a2a2a;
  --surface-highest: #353535;
  --text: #e5e2e1;
  --text-variant: #c2c6d6;
  --primary: #adc6ff;
  --primary-container: #4d8eff;
  --primary-fixed-dim: #adc6ff;
  --secondary: #c0c1ff;
  --secondary-container: #3131c0;
  --tertiary: #ffb786;
  --tertiary-container: #df7412;
  --outline: #8c909f;
  --outline-variant: #424754;
  --error: #ffb4ab;
  --error-container: #93000a;
  --on-primary: #002e6a;
  --on-secondary: #1000a9;
  --on-surface: #e5e2e1;
  --on-surface-variant: #c2c6d6;
  --surface-container: #202020;
  --surface-container-high: #2a2a2a;
  --surface-container-highest: #353535;
  --surface-container-low: #1b1b1c;
  --surface-container-lowest: #0e0e0e;
  --surface-bright: #393939;
  --surface-dim: #131313;
  --radius-sm: 2px;
  --radius-default: 4px;
  --radius-md: 6px;
  --radius-lg: 8px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius-full: 12px;
  --font-ui: Inter, system-ui, -apple-system, sans-serif;
  --font-code: 'JetBrains Mono', var(--vscode-editor-font-family, monospace);
  --font-label: 500 11px/16px var(--font-ui);
  --font-body: 400 13px/20px var(--font-ui);
  --font-body-sm: 400 12px/18px var(--font-ui);
  --font-headline: 600 16px/24px var(--font-ui);
}

* { margin: 0; padding: 0; box-sizing: border-box; }
body {
  font: var(--font-body);
  color: var(--on-surface);
  background: var(--surface-dim);
  overflow: hidden;
  -webkit-font-smoothing: antialiased;
  scrollbar-width: thin;
  scrollbar-color: var(--surface-container-highest) transparent;
}
::-webkit-scrollbar { width: 4px; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb { background: var(--surface-container-highest); border-radius: 10px; }

#root { display: flex; flex-direction: column; height: 100vh; }

/* ===== Header (TopAppBar) ===== */
.header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 0 12px; height: 44px; flex-shrink: 0;
  background: var(--surface-container-low);
  border-bottom: 1px solid var(--outline-variant);
}
.header-left { display: flex; align-items: center; gap: 8px; }
.header-left .brand { font: var(--font-headline); font-weight: 700; color: var(--on-surface); }
.header-left .version { font: var(--font-label); color: var(--on-surface-variant); opacity: .6; align-self: flex-end; margin-bottom: 1px; }
.header-right { display: flex; align-items: center; gap: 4px; }
.header-btn {
  display: flex; align-items: center; gap: 4px;
  background: none; border: none; cursor: pointer;
  font: var(--font-label); color: var(--on-surface-variant);
  padding: 4px 8px; border-radius: var(--radius-sm);
  transition: all .15s; white-space: nowrap;
}
.header-btn:hover { color: var(--primary); background: rgba(255,255,255,.04); }
.header-btn .icon { font-size: 16px; }
.header-btn .arrow { font-size: 10px; }

/* ===== Agent Mode Bar ===== */
.agent-bar {
  display: flex; flex-direction: column; gap: 6px; padding: 8px 10px;
  background: var(--surface-container);
  border-bottom: 1px solid var(--outline-variant);
  flex-shrink: 0;
}
.agent-bar-top {
  display: flex; align-items: center; justify-content: space-between; padding: 0 2px;
}
.agent-bar-label {
  font: var(--font-label); color: var(--on-surface-variant);
  display: flex; align-items: center; gap: 4px; text-transform: uppercase; letter-spacing: .04em;
}
.agent-bar-label .icon { font-size: 14px; }
.new-chat-btn {
  display: flex; align-items: center; gap: 4px;
  font: var(--font-label); color: var(--primary);
  background: rgba(173, 198, 255, .1);
  border: none; padding: 3px 10px; border-radius: 9999px; cursor: pointer;
  transition: all .15s;
}
.new-chat-btn:hover { background: rgba(173, 198, 255, .2); }
.new-chat-btn .icon { font-size: 14px; }
.agent-segmented {
  display: flex; gap: 4px; padding: 3px; border-radius: var(--radius-lg);
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  overflow-x: auto; scrollbar-width: none;
  -ms-overflow-style: none;
}
.agent-segmented::-webkit-scrollbar { display: none; }
.agent-seg-btn {
  flex-shrink: 0; display: flex; align-items: center; justify-content: center; gap: 4px;
  font: var(--font-label); color: var(--on-surface-variant);
  background: none; border: none; padding: 5px 10px; border-radius: var(--radius-md);
  cursor: pointer; transition: all .15s; white-space: nowrap;
}
.agent-seg-btn:hover { color: var(--primary); }
.agent-seg-btn.active {
  background: var(--secondary-container); color: #fff;
}
.agent-seg-btn .icon { font-size: 14px; }

/* ===== Model Picker ===== */
.model-picker, .variant-popup { position: relative; display: inline-block; vertical-align: middle; }
.model-picker.hidden, .variant-popup.hidden { display: none; }
.model-input {
  background: transparent; color: var(--on-surface);
  border: 1px solid var(--outline-variant); padding: 4px 10px;
  font-size: 11px; font-weight: 500; width: 140px;
  border-radius: 9999px; outline: none; vertical-align: middle;
  font-family: var(--font-ui); transition: border-color .15s;
}
.model-input::placeholder { color: var(--on-surface-variant); opacity: .6; }
.model-input:focus { border-color: var(--primary-container); }
.model-dropdown {
  position: absolute; bottom: calc(100% + 4px); left: 0;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); max-height: 260px; overflow-y: auto;
  min-width: 200px; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}
.model-dropdown.hidden { display: none; }
.model-opt {
  padding: 7px 12px; font-size: 12px; cursor: pointer;
  border-bottom: 1px solid var(--outline-variant);
  font-family: var(--font-ui); transition: background .1s;
}
.model-opt:last-child { border-bottom: none; }
.model-opt:hover { background: rgba(173, 198, 255, .08); }
.model-opt.on { background: rgba(173, 198, 255, .12); color: var(--primary); }
.model-opt.dim { color: var(--on-surface-variant); opacity: .6; cursor: default; }

/* ===== Model Popup (with search + provider groups) ===== */
.model-popup {
  position: absolute; bottom: calc(100% + 4px); left: 0;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); min-width: 220px; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
  display: flex; flex-direction: column;
}
.model-popup.hidden { display: none; }
.model-popup-search {
  background: var(--surface-container-lowest);
  border: none; border-bottom: 1px solid var(--outline-variant);
  color: var(--on-surface); padding: 6px 8px; font-size: 11px;
  font-family: var(--font-ui); outline: none; border-radius: var(--radius-md) var(--radius-md) 0 0;
}
.model-popup-search::placeholder { color: var(--on-surface-variant); opacity: .6; }
.model-popup-list { max-height: 200px; overflow-y: auto; }
.model-popup-group {
  padding: 4px 8px; font-size: 10px; font-weight: 600; text-transform: uppercase;
  color: var(--on-surface-variant); opacity: .7; letter-spacing: .04em;
  background: rgba(0,0,0,.1);
}
.model-popup-opt {
  padding: 5px 12px; font-size: 11px; cursor: pointer;
  font-family: var(--font-ui); transition: background .1s;
}
.model-popup-opt:hover { background: rgba(173, 198, 255, .08); }
.model-popup-opt.on { background: rgba(173, 198, 255, .12); color: var(--primary); }
.model-popup-opt.dim { color: var(--on-surface-variant); opacity: .6; cursor: default; }

/* ===== Variant Popup ===== */
.variant-popup {
  position: absolute; bottom: 100%; left: 0; margin-bottom: 4px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); min-width: 120px; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}
.variant-opt {
  padding: 6px 12px; font-size: 12px; cursor: pointer;
  font-family: var(--font-ui); transition: background .1s;
  text-transform: capitalize;
}
.variant-opt:first-child { border-radius: var(--radius-md) var(--radius-md) 0 0; }
.variant-opt:last-child { border-radius: 0 0 var(--radius-md) var(--radius-md); }
.variant-opt:hover { background: rgba(173, 198, 255, .08); }
.variant-opt.on { background: rgba(173, 198, 255, .12); color: var(--primary); }

/* ===== Sessions Panel (chat-list.html style) ===== */
.sessions-panel {
  background: var(--surface-dim);
  border-bottom: 1px solid var(--outline-variant);
  max-height: 280px; overflow-y: auto; flex-shrink: 0;
}
.sessions-panel.hidden { display: none; }
.session-group { padding: 4px 0; }
.session-group-header {
  font: var(--font-label); color: var(--outline);
  text-transform: uppercase; letter-spacing: .08em;
  padding: 6px 14px 4px; font-size: 10px;
}
.session-item {
  display: flex; align-items: flex-start; gap: 10px;
  padding: 8px 12px; cursor: pointer; font-size: 12px;
  font-family: var(--font-ui); transition: background .1s;
  border-radius: var(--radius-default); margin: 1px 6px;
  position: relative;
}
.session-item:hover { background: rgba(255,255,255,.03); }
.session-item.active { background: rgba(173, 198, 255, .08); }
.session-icon {
  flex-shrink: 0; width: 32px; height: 32px;
  border-radius: var(--radius-md);
  background: rgba(173, 198, 255, .12);
  display: flex; align-items: center; justify-content: center;
  font-size: 14px; color: var(--primary);
}
.session-body { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.session-row { display: flex; justify-content: space-between; align-items: center; gap: 8px; }
.session-item .title {
  flex: 1; overflow: hidden; text-overflow: ellipsis;
  white-space: nowrap; font-weight: 500; color: var(--on-surface);
  font-size: 12px;
}
.session-item .time {
  font: var(--font-label); font-size: 10px;
  color: var(--outline); white-space: nowrap; flex-shrink: 0;
}
.session-item .preview {
  font: var(--font-body-sm); color: var(--on-surface-variant);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  opacity: .7;
}
.session-item .del-btn, .session-item .rename-btn {
  background: none; border: none; cursor: pointer;
  font-size: 12px; opacity: 0; padding: 3px 5px;
  border-radius: var(--radius-sm); transition: all .15s;
  position: absolute; right: 8px;
}
.session-item .del-btn { color: var(--error); bottom: 4px; }
.session-item .rename-btn { color: var(--on-surface-variant); top: 4px; }
.session-item:hover .del-btn, .session-item:hover .rename-btn { opacity: .5; }
.session-item .del-btn:hover, .session-item .rename-btn:hover { opacity: 1; }
.session-item.dim { opacity: .5; cursor: default; justify-content: center; padding: 20px; }
.session-search {
  flex-shrink: 0; background: var(--surface-dim);
  border: 1px solid var(--outline-variant);
  margin: 6px 8px; padding: 6px 10px; font-size: 12px;
  border-radius: var(--radius-sm); outline: none; color: var(--on-surface);
  font-family: var(--font-ui); display: block; width: calc(100% - 16px);
}
.session-search.hidden { display: none; }
.session-search:focus { border-color: var(--primary-container); }
.session-search::placeholder { color: var(--on-surface-variant); opacity: .6; }
.rename-input {
  flex: 1; background: transparent; color: var(--on-surface);
  border: 1px solid var(--primary-container);
  padding: 2px 6px; font-size: 12px; border-radius: var(--radius-sm);
  outline: none; font-family: var(--font-ui);
}

/* ===== @ Menu ===== */
.at-menu {
  position: absolute; bottom: 100%; left: 12px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); max-height: 240px; overflow-y: auto;
  min-width: 240px; z-index: 100;
  box-shadow: 0 8px 24px rgba(0,0,0,.5);
}
.at-menu.hidden { display: none; }
.at-menu .item {
  padding: 8px 12px; cursor: pointer; font-size: 12px;
  border-bottom: 1px solid var(--outline-variant);
  font-family: var(--font-ui); transition: background .1s;
}
.at-menu .item:last-child { border-bottom: none; }
.at-menu .item:hover { background: rgba(173, 198, 255, .08); }
.at-menu .item .cmd { font-weight: 600; font-size: 12px; }
.at-menu .item .desc { font-size: 11px; color: var(--on-surface-variant); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; margin-top: 1px; }

/* ===== Question Card (ai-chat-with-question.html) ===== */
.question-card {
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-xl); padding: 16px; margin-top: 8px;
  display: flex; flex-direction: column; gap: 14px;
}
.question-card .q-section {
  display: flex; flex-direction: column; gap: 8px;
}
.question-card .q-label {
  font: var(--font-label); text-transform: uppercase;
  letter-spacing: .04em; color: var(--on-surface);
}
.question-card .q-pills {
  display: flex; flex-wrap: wrap; gap: 8px;
}
.question-card .q-pill {
  display: inline-block; text-align: center;
  background: transparent; color: var(--on-surface-variant);
  border: 1px solid var(--outline-variant);
  padding: 4px 14px; border-radius: 9999px; cursor: pointer;
  font: var(--font-label); font-family: var(--font-ui);
  transition: all .15s;
}
.question-card .q-pill:hover { border-color: var(--primary); color: var(--primary); }
.question-card .q-pill.active {
  background: rgba(173, 198, 255, .1); color: var(--primary); border-color: var(--primary);
}
.question-card .q-chk {
  display: flex; align-items: center; gap: 8px;
  cursor: pointer; padding: 4px 0;
  font: var(--font-body-sm); color: var(--on-surface-variant);
  transition: color .15s;
}
.question-card .q-chk:hover { color: var(--primary); }
.question-card .q-chk-box {
  width: 16px; height: 16px; border-radius: var(--radius-sm);
  border: 1px solid var(--outline-variant);
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; transition: all .15s;
}
.question-card .q-chk-box.checked { background: var(--primary-container); border-color: var(--primary-container); }
.question-card .q-chk-box .icon { font-size: 10px; color: var(--on-primary); display: none; }
.question-card .q-chk-box.checked .icon { display: inline; }
.question-card .q-input {
  width: 100%; background: var(--surface-container-lowest);
  color: var(--on-surface); border: 1px solid var(--outline-variant);
  padding: 8px 10px; font: var(--font-body-sm);
  border-radius: var(--radius-lg); outline: none;
  font-family: var(--font-ui); transition: border-color .15s;
  resize: none;
}
.question-card .q-input:focus { border-color: var(--primary-container); }
.question-card .q-input::placeholder { color: var(--on-surface-variant); opacity: .6; }
.question-card .q-submit {
  width: 100%; background: var(--primary); color: var(--on-primary);
  border: none; padding: 10px; font: var(--font-label); font-weight: 700;
  border-radius: var(--radius-lg); cursor: pointer;
  font-family: var(--font-ui); transition: all .15s;
  box-shadow: 0 4px 12px rgba(173, 198, 255, .15);
}
.question-card .q-submit:hover { background: rgba(173, 198, 255, .85); }
.question-card .q-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px; }

/* ===== Task Card (chat-with-to-do.html) ===== */
.task-card {
  background: var(--surface-container-low);
  border: 1px solid rgba(66, 71, 84, .2);
  border-radius: var(--radius-xl); overflow: hidden;
  margin-top: 4px; box-shadow: 0 4px 16px rgba(0,0,0,.2);
}
.task-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 12px; cursor: pointer;
  transition: background .15s;
}
.task-header:hover { background: var(--surface-container-high); }
.task-header-left {
  display: flex; align-items: center; gap: 12px;
}
.task-icon-container {
  width: 32px; height: 32px; border-radius: 4px;
  background: rgba(173, 198, 255, .1);
  display: flex; align-items: center; justify-content: center;
}
.task-icon-container .icon { font-size: 16px; color: var(--primary); }
.task-icon-container.working .icon { animation: task-pulse 1.5s ease-in-out infinite; }
@keyframes task-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: .4; }
}
.task-title-section { display: flex; flex-direction: column; }
.task-title {
  font: var(--font-label-md); font-weight: 700;
  color: var(--on-surface); text-transform: uppercase;
  letter-spacing: .03em;
}
.task-subtitle {
  font-size: 10px; color: rgba(194, 198, 214, .6);
}
.task-chevron {
  color: var(--on-surface-variant); font-size: 16px;
  transition: transform .2s;
}
.task-chevron.open { transform: rotate(180deg); }
.task-body {
  border-top: 1px solid rgba(66, 71, 84, .1);
  padding: 12px; display: flex; flex-direction: column; gap: 12px;
}
.task-body.hidden { display: none; }
.task-item {
  display: flex; align-items: center; gap: 12px;
  padding: 8px; border-radius: var(--radius-lg);
}
.task-item.pending {
  border: 1px solid rgba(66, 71, 84, .3);
  background: var(--surface-container-lowest);
}
.task-item.working {
  border: 1px solid rgba(173, 198, 255, .3);
  background: rgba(173, 198, 255, .05);
}
.task-item.done { opacity: .5; }
.task-item-icon {
  width: 20px; height: 20px; border-radius: 4px;
  display: flex; align-items: center; justify-content: center;
  flex-shrink: 0; font-size: 12px; transition: all .3s;
}
.task-item-icon.unchecked {
  border: 1px solid var(--outline-variant);
  color: transparent;
}
.task-item-icon.checked {
  background: var(--primary);
  color: var(--on-primary);
}
.task-item-icon.pulsing {
  position: relative;
}
.task-item-icon.pulsing::before {
  content: ''; position: absolute;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--primary); animation: ping 1.5s ease-in-out infinite;
}
.task-item-icon.pulsing::after {
  content: ''; position: relative;
  width: 8px; height: 8px; border-radius: 50%;
  background: var(--primary);
}
@keyframes ping {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(2); opacity: 0; }
}
.task-item-label {
  flex: 1; font: var(--font-body-sm); color: var(--on-surface-variant);
}
.task-item-label.done { text-decoration: line-through; }
.task-item-label.active { color: var(--on-surface); font-weight: 500; }
.task-item-badge {
  font-size: 10px; padding: 2px 6px; border-radius: 9999px;
  text-transform: uppercase; font-weight: 700; letter-spacing: .03em;
  margin-left: auto;
}
.task-item-badge.pending {
  background: var(--surface-variant);
  color: var(--on-surface-variant);
}
.task-item-badge.working {
  background: var(--primary);
  color: var(--on-primary);
}
.task-item-badge.done {
  background: var(--surface-container-high);
  color: var(--on-surface-variant);
}
.task-item-badge.error {
  background: rgba(255, 180, 171, .1);
  color: var(--error);
}
.task-output {
  background: var(--surface-container-lowest);
  border: 1px solid rgba(66, 71, 84, .15);
  border-radius: var(--radius-sm); padding: 6px 8px;
  font: var(--font-code); font-size: 11px; color: var(--text-variant);
  max-height: 80px; overflow-y: auto; white-space: pre-wrap; word-break: break-all;
  margin-top: 6px;
}
.task-error { font-size: 11px; color: var(--error); margin-top: 4px; }
.step-finish {
  font-size: 10px; color: var(--on-surface-variant); opacity: .5;
  padding: 4px 0; text-align: center; letter-spacing: .02em;
}
.task-inline {
  display: flex; align-items: center; gap: 6px;
  font-size: 12px; padding: 3px 8px; margin: 2px 0;
  border-radius: var(--radius-sm);
  background: var(--surface-container-low);
}
.task-inline .dot {
  width: 6px; height: 6px; border-radius: 50%;
  flex-shrink: 0; background: var(--primary);
  animation: task-pulse 1.5s ease-in-out infinite;
}
.task-inline.done { opacity: .6; }
.task-inline.done .dot { animation: none; background: var(--on-surface-variant); }

/* ===== Thinking Card (ai-chat-generation.html) ===== */
.thinking-card {
  display: flex; align-items: center; gap: 8px;
  padding: 8px 12px;
  font: var(--font-body-md); color: var(--primary-fixed-dim);
  background: var(--surface-container-low);
  border: 1px solid rgba(66, 71, 84, .2);
  border-radius: var(--radius-lg);
}
.thinking-card .spinner {
  width: 16px; height: 16px; flex-shrink: 0;
  border: 2px solid var(--outline-variant);
  border-top-color: var(--primary-container);
  border-radius: 50%;
  animation: spin .7s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: .7; } }
.animate-pulse { animation: pulse 2s cubic-bezier(.4,0,.6,1) infinite; }

/* ===== Chat Area ===== */
.chat-area {
  flex: 1; overflow-y: auto; padding: 24px 12px;
  display: flex; flex-direction: column; gap: 20px;
  overflow-x: hidden; scroll-behavior: smooth;
}
.chat-area .empty {
  color: var(--on-surface-variant); text-align: center;
  padding: 48px 20px; font: var(--font-body);
  opacity: .8;
}
.chat-area .empty .cmd-hint { margin-top: 10px; font: var(--font-body-sm); opacity: .6; }

/* ===== Messages ===== */
.msg { display: flex; gap: 12px; max-width: 100%; word-wrap: break-word; animation: fadeIn .2s ease; }
@keyframes fadeIn { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: translateY(0); } }

/* Avatars */
.msg .avatar-wrap { flex-shrink: 0; margin-top: 2px; }
.msg .avatar {
  width: 32px; height: 32px; border-radius: 4px;
  flex-shrink: 0; display: flex; align-items: center;
  justify-content: center; font-size: 16px; margin-top: 2px;
}
.msg.assistant .avatar {
  background: rgba(173, 198, 255, .15);
  border: 1px solid rgba(173, 198, 255, .2);
  color: var(--primary);
}
.msg.user .avatar {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--surface-container-highest);
  color: var(--on-surface-variant);
}

/* Bubble */
.msg .bubble { flex: 1; min-width: 0; }
.msg .bubble-wrap { min-width: 0; }
.msg.assistant .bubble-wrap { max-width: 90%; }
.msg.user .bubble-wrap { max-width: 85%; display: flex; flex-direction: column; align-items: flex-end; }
.msg .bubble .role-label {
  font: var(--font-label); margin-bottom: 6px; color: var(--on-surface-variant);
  display: flex; align-items: center; gap: 4px;
}
.msg .bubble .role-label .name { font-weight: 700; color: var(--on-surface); }
.msg .bubble .role-label .time { opacity: .6; }

/* AI bubble content */
.msg.assistant .bubble .text,
.msg.assistant .bubble .tool-call,
.msg.assistant .bubble .tool-result {
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); padding: 10px 12px;
}
.msg.assistant .bubble .text { margin-top: 0; }

/* User bubble */
.msg.user { flex-direction: row-reverse; }
.msg.user .bubble .role-label { justify-content: flex-end; }
.msg.user .bubble .role-label .name { font-weight: 700; color: var(--on-surface); }
.msg.user .bubble .text {
  background: var(--surface-container-high);
  border: 1px solid var(--outline-variant);
  padding: 10px 14px;
  border-radius: 16px; border-top-right-radius: 0;
  font: var(--font-body); color: var(--on-surface);
}

.msg.assistant.streaming .bubble { border-color: var(--primary-container); }

.msg .tool-call { margin-top: 8px; }
.msg .tool-call .tool-name { font-weight: 600; color: var(--primary); font: var(--font-body-sm); }
.msg .tool-call .tool-input {
  font-family: var(--font-code); font-size: 11px; margin-top: 4px;
  white-space: pre-wrap; color: var(--on-surface-variant);
}
.msg .tool-result { margin-top: 8px; }
.msg .tool-result-content {
  font-size: 12px; max-height: 200px; overflow-y: auto;
  white-space: pre-wrap; color: var(--on-surface-variant);
}
.msg .error-msg { color: var(--error); font-size: 12px; padding: 4px 0; }
.msg-actions {
  display: flex; align-items: center; justify-content: flex-end; gap: 4px;
  margin-top: 2px; opacity: .4; transition: opacity .15s;
}
.group:hover .msg-actions { opacity: 1; }
.msg-action {
  width: 24px; height: 24px; display: flex; align-items: center;
  justify-content: center; background: transparent; border: none;
  cursor: pointer; color: var(--on-surface-variant); font-size: 12px;
  border-radius: var(--radius-sm); transition: all .15s; padding: 0;
}
.msg-action:hover { background: var(--surface-variant); color: var(--on-surface); }

/* ===== Reasoning Accordion (ai-chat-with-question.html) ===== */
.reasoning {
  background: var(--surface-container-low);
  border-left: 2px solid var(--primary-container);
  border-radius: 0 var(--radius-lg) var(--radius-lg) 0;
  padding: 8px; margin-top: 8px;
  cursor: pointer; transition: background .15s;
}
.reasoning:hover { background: var(--surface-container-high); }
.reasoning-header {
  display: flex; align-items: center; justify-content: space-between;
}
.reasoning-header-left {
  display: flex; align-items: center; gap: 8px;
  color: var(--primary-fixed-dim);
  font: var(--font-label-md);
}
.reasoning-header-left .icon { font-size: 14px; }
.reasoning-chevron {
  font-size: 14px; color: var(--on-surface-variant);
  transition: transform .2s;
}
.reasoning-chevron.open { transform: rotate(180deg); }
.reasoning-body {
  padding-top: 4px; margin-top: 4px;
  border-top: 1px solid rgba(66, 71, 84, .1);
  color: var(--on-surface-variant);
  font: var(--font-body-sm); line-height: 1.625;
  display: none;
}
.reasoning-body.open { display: block; }

/* ===== Markdown ===== */
.msg .bubble .text .md p { margin: 6px 0; }
.msg .bubble .text .md p:first-child { margin-top: 0; }
.msg .bubble .text .md p:last-child { margin-bottom: 0; }
.msg .bubble .text .md code {
  background: rgba(255,255,255,.06); padding: 1px 5px;
  border-radius: 3px; font-family: var(--font-code); font-size: 12px;
  color: var(--primary);
}
.msg .bubble .text .md strong { font-weight: 600; }
.msg .bubble .text .md em { font-style: italic; }
.msg .bubble .text .md h1,
.msg .bubble .text .md h2,
.msg .bubble .text .md h3,
.msg .bubble .text .md h4,
.msg .bubble .text .md h5,
.msg .bubble .text .md h6 { margin: 10px 0 4px; font-weight: 600; color: var(--on-surface); }
.msg .bubble .text .md h1 { font-size: 16px; }
.msg .bubble .text .md h2 { font-size: 15px; }
.msg .bubble .text .md h3 { font-size: 14px; }
.msg .bubble .text .md h4 { font-size: 13px; }
.msg .bubble .text .md ul,
.msg .bubble .text .md ol { margin: 4px 0; padding-left: 20px; }
.msg .bubble .text .md li { margin: 2px 0; }
.msg .bubble .text .md a { color: var(--primary); text-decoration: underline; }
.msg .bubble .text .md hr { margin: 12px 0; border: none; border-top: 1px solid var(--outline-variant); }
.msg .bubble .text .md table.md-table {
  width: 100%; border-collapse: collapse;
  margin: 8px 0; font-size: 12px;
  background: var(--surface-container-lowest);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); overflow: hidden;
}
.msg .bubble .text .md table.md-table th,
.msg .bubble .text .md table.md-table td {
  padding: 6px 10px; text-align: left;
  border-bottom: 1px solid var(--outline-variant);
}
.msg .bubble .text .md table.md-table th {
  background: var(--surface-container-high);
  font-weight: 600; color: var(--on-surface);
  font: var(--font-label); text-transform: uppercase; font-size: 10px;
  letter-spacing: .04em;
}
.msg .bubble .text .md table.md-table td {
  color: var(--on-surface-variant);
}
.msg .bubble .text .md table.md-table tr:last-child td {
  border-bottom: none;
}

/* ===== Code Blocks ===== */
.msg .bubble .text .md pre.code-block {
  background: var(--surface-lowest);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); margin: 8px 0;
  overflow: hidden; position: relative;
}
.msg .bubble .text .md pre.code-block .code-header {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 12px; background: var(--surface-container-high);
  border-bottom: 1px solid var(--outline-variant);
}
.msg .bubble .text .md pre.code-block .code-header .code-lang {
  color: var(--on-surface-variant); font-family: var(--font-ui);
  font: var(--font-body-sm); font-weight: 500;
}
.msg .bubble .text .md pre.code-block .code-header .copy-btn {
  display: flex; align-items: center; gap: 4px;
  background: transparent; color: var(--on-surface-variant);
  border: none; padding: 2px 8px; font: var(--font-label);
  border-radius: var(--radius-sm); cursor: pointer;
  font-family: var(--font-ui); transition: all .15s;
}
.msg .bubble .text .md pre.code-block .code-header .copy-btn:hover {
  background: rgba(173, 198, 255, .12); color: var(--primary);
}
.msg .bubble .text .md pre.code-block code {
  display: block; padding: 12px 14px;
  font-family: var(--font-code); font-size: 12px;
  line-height: 1.7; white-space: pre; overflow-x: auto;
  tab-size: 2; color: var(--on-surface);
}
/* Syntax highlighting */
.msg .bubble .text .md pre.code-block code .hl-keyword { color: #c0c1ff; }
.msg .bubble .text .md pre.code-block code .hl-func { color: #adc6ff; }
.msg .bubble .text .md pre.code-block code .hl-string { color: #df7412; }
.msg .bubble .text .md pre.code-block code .hl-comment { color: #8c909f; font-style: italic; }
.msg .bubble .text .md pre.code-block code .hl-number { color: #ffb786; }
.msg .bubble .text .md pre.code-block code .hl-prop { color: #4d8eff; }

/* ===== Input Container (Glass-blur floating) ===== */
.input-container {
  position: relative; z-index: 30; flex-shrink: 0;
  padding: 8px 12px 10px;
  backdrop-filter: blur(8px);
  background: rgba(19, 19, 19, .85);
  border-top: 1px solid var(--outline-variant);
}
.input-inner {
  max-width: 800px; margin: 0 auto;
  background: var(--surface-container-highest);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-xl); overflow: hidden;
  transition: border-color .15s, box-shadow .15s;
}
.input-inner:focus-within {
  border-color: var(--primary-container);
  box-shadow: 0 0 0 1px rgba(77, 142, 255, .2);
}
.input-toolbar {
  display: flex; align-items: center; gap: 6px;
  padding: 6px 12px;
  border-bottom: 1px solid var(--outline-variant);
}
.input-pill {
  display: flex; align-items: center; gap: 4px;
  font: var(--font-label); color: var(--on-surface-variant);
  background: var(--surface-container-high);
  border: 1px solid var(--outline-variant);
  padding: 3px 8px; border-radius: 9999px; cursor: pointer;
  transition: all .15s;
}
.input-pill:hover { border-color: var(--primary); color: var(--primary); }
.input-pill .icon { font-size: 12px; }

.input-main {
  display: flex; align-items: flex-end;
}
.input-main textarea {
  flex: 1; background: transparent; color: var(--on-surface);
  border: none; padding: 10px 14px; resize: none;
  font: var(--font-body); min-height: 40px; max-height: 140px;
  outline: none; line-height: 1.5;
}
.input-main textarea::placeholder { color: var(--on-surface-variant); opacity: .5; }

.input-footer {
  display: flex; align-items: center; justify-content: space-between;
  padding: 6px 10px;
  border-top: 1px solid var(--outline-variant);
}
.input-footer-left { display: flex; align-items: center; gap: 2px; }
.input-footer-btn {
  background: none; border: none; cursor: pointer;
  color: var(--on-surface-variant); padding: 4px;
  border-radius: var(--radius-sm); transition: all .15s;
  display: flex; align-items: center; justify-content: center;
}
.input-footer-btn:hover { color: var(--primary); background: rgba(255,255,255,.04); }
.input-footer-btn .icon { font-size: 18px; }
.input-footer-sep { width: 1px; height: 14px; background: var(--outline-variant); margin: 0 4px; }
.token-badge {
  display: flex; align-items: center; gap: 4px;
  font: var(--font-label); color: var(--tertiary);
  background: var(--surface-container-high);
  padding: 2px 8px; border-radius: 9999px;
  border: 1px solid var(--outline-variant);
}
.token-badge .icon { font-size: 11px; }
.send-btn {
  width: 32px; height: 32px; border-radius: 50%;
  background: var(--primary-container); color: var(--on-primary);
  border: none; cursor: pointer; display: flex; align-items: center;
  justify-content: center; transition: all .15s;
}
.send-btn:hover { transform: scale(1.05); }
.send-btn:active { transform: scale(.95); }
.send-btn .icon { font-size: 18px; }

/* ===== Abort / Danger Buttons ===== */
.input-actions { display: flex; gap: 4px; align-items: center; }
.abort-btn {
  width: 32px; height: 32px; border-radius: 50%;
  background: transparent; color: var(--error);
  border: 1px solid var(--error); cursor: pointer;
  display: flex; align-items: center; justify-content: center;
  transition: all .15s; font-size: 14px;
}
.abort-btn:hover { background: rgba(255, 180, 171, .1); }

/* ===== Install View ===== */
.install-view {
  display: flex; flex-direction: column;
  align-items: center; justify-content: center;
  height: 100vh; padding: 32px; text-align: center; gap: 20px;
}
.install-view h2 { font: var(--font-headline); }
.install-view p { font: var(--font-body); color: var(--on-surface-variant); max-width: 280px; }
.install-view button {
  background: var(--primary-container); color: var(--on-primary);
  border: none; padding: 10px 24px; cursor: pointer;
  font-size: 14px; font-weight: 500; border-radius: var(--radius-md);
  font-family: var(--font-ui); transition: background .15s;
}
.install-view button:hover { background: #3d7ae8; }

/* ===== Status Bar ===== */
.status-bar {
  display: flex; align-items: center; gap: 6px;
  padding: 3px 12px; font: var(--font-label);
  color: var(--on-surface-variant);
  border-top: 1px solid var(--outline-variant);
  flex-shrink: 0;
}
.status-bar .dot { width: 6px; height: 6px; border-radius: 50%; flex-shrink: 0; }
.status-bar .dot.ready { background: #22c55e; }
.status-bar .dot.busy { background: #eab308; }
.status-bar .dot.error { background: #ef4444; }
.status-bar .info-btn {
  background: none; border: none; color: var(--on-surface-variant);
  cursor: pointer; font-size: 14px; padding: 0 4px; line-height: 1;
  transition: color .15s;
}
.status-bar .info-btn:hover { color: var(--on-surface); }

/* ===== Slash / Command Menu ===== */
.slash-menu {
  position: absolute; bottom: 100%; left: 12px;
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-md); max-height: 260px; overflow-y: auto;
  min-width: 220px; box-shadow: 0 8px 24px rgba(0,0,0,.5);
  z-index: 100; margin-bottom: 4px;
}
.slash-menu.hidden { display: none; }
.slash-menu .item {
  padding: 8px 12px; cursor: pointer; font-size: 12px;
  border-bottom: 1px solid var(--outline-variant);
  font-family: var(--font-ui); transition: background .1s;
}
.slash-menu .item:last-child { border-bottom: none; }
.slash-menu .item:hover { background: rgba(173, 198, 255, .08); }
.slash-menu .item .cmd { font-weight: 600; }
.slash-menu .item .desc { font-size: 11px; color: var(--on-surface-variant); margin-top: 1px; }
.slash-menu .item.selected { background: rgba(173, 198, 255, .12); color: var(--primary); }

/* ===== Overlay / Modal ===== */
.overlay {
  position: fixed; top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,.5); z-index: 200;
  display: flex; align-items: center; justify-content: center;
  backdrop-filter: blur(4px);
}
.overlay.hidden { display: none; }
.overlay .modal {
  background: var(--surface-container-low);
  border: 1px solid var(--outline-variant);
  border-radius: var(--radius-lg); padding: 20px;
  min-width: 280px; max-width: 340px;
  box-shadow: 0 16px 40px rgba(0,0,0,.5);
}
.overlay .modal h3 { font: var(--font-headline); margin-bottom: 16px; }
.overlay .modal .row {
  display: flex; justify-content: space-between;
  padding: 6px 0; font-size: 12px;
  border-bottom: 1px solid var(--outline-variant);
  font-family: var(--font-ui);
}
.overlay .modal .row:last-child { border-bottom: none; }
.overlay .modal .row .label { color: var(--on-surface-variant); }
.overlay .modal .row .value {
  font-weight: 500; text-align: right; max-width: 180px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  color: var(--on-surface);
}
.overlay .modal .close-btn {
  margin-top: 16px; width: 100%;
  background: transparent; color: var(--on-surface);
  border: 1px solid var(--outline-variant); padding: 8px;
  cursor: pointer; border-radius: var(--radius-sm);
  font-size: 12px; font-weight: 500; font-family: var(--font-ui);
  transition: all .15s;
}
.overlay .modal .close-btn:hover {
  background: rgba(173, 198, 255, .08);
  border-color: var(--primary); color: var(--primary);
}
</style>
</head>
<body>
<div id="root"></div>
<script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }

  private getNonce(): string {
    let t = "";
    const p = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) t += p.charAt(Math.floor(Math.random() * p.length));
    return t;
  }
}
