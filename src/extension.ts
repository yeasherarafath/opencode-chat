import * as vscode from "vscode";
import * as path from "path";
import { OpenCodeCli } from "./OpenCodeCli";
import { OpenCodeViewProvider } from "./OpenCodeViewProvider";
import { JsonLogger } from "./JsonLogger";

let outputChannel: vscode.OutputChannel;
let cli: OpenCodeCli;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("OpenCode Chat");
  OpenCodeCli.setOutputChannel(outputChannel);
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("[OpenCode Chat] Extension activating...");

  cli = new OpenCodeCli();

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
  if (workspaceRoot) cli.setCwd(workspaceRoot);

  const cfg = vscode.workspace.getConfiguration("opencode-chat");
  const configPath = cfg.get<string>("cliPath") || "";
  if (configPath) {
    cli.setBinaryPath(configPath);
  }
  const srvPort = cfg.get<number>("serverPort");
  if (srvPort) cli.setServerPort(srvPort);
  const srvHost = cfg.get<string>("serverHostname");
  if (srvHost) cli.setServerHostname(srvHost);
  const srvTimeout = cfg.get<number>("serverTimeout");
  if (srvTimeout) cli.setServerTimeout(srvTimeout);

  const pureMode = cfg.get<boolean>("pureMode", false);
  cli.setPureMode(pureMode);

  // ----- JsonLogger setup (opt-in NDJSON debug capture; off by default) -----
  try {
    const enabled = !!cfg.get<boolean>("enableJsonLogs", false);
    let dir = cfg.get<string>("jsonLogsPath") || "";
    if (!dir) {
      if (workspaceRoot) dir = path.join(workspaceRoot, "logs", "opencode-chat");
      else dir = path.join(context.globalStorageUri.fsPath, "logs");
    } else if (!path.isAbsolute(dir) && workspaceRoot) {
      dir = path.join(workspaceRoot, dir);
    }
    JsonLogger.init({ enabled, dir, outputChannel });
    outputChannel.appendLine(`[OpenCode Chat] JsonLogger enabled=${enabled} dir=${dir}`);
  } catch (e) {
    outputChannel.appendLine(`[OpenCode Chat] JsonLogger init error: ${e}`);
  }

  const provider = new OpenCodeViewProvider(context.extensionUri, cli);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OpenCodeViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );
  context.subscriptions.push({ dispose: () => provider.dispose() });

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.openChat", () => {
      vscode.commands.executeCommand("workbench.view.extension.opencode-chat");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.newSession", () => {
      provider.newSession();
      vscode.commands.executeCommand("workbench.view.extension.opencode-chat");
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.refreshModels", () => {
      provider.newSession();
    })
  );

  await provider.initialize();
}

export function deactivate() {
  const cfg = vscode.workspace.getConfiguration("opencode-chat");
  const cleanup = cfg.get<boolean>("cleanupOnDeactivate", true);
  if (outputChannel) outputChannel.appendLine(`[OpenCode Chat] Deactivating - stopping server (cleanup=${cleanup})`);
  try { JsonLogger.flush(); } catch {}
  try { JsonLogger.dispose(); } catch {}
  if (cli) {
    if (cleanup) {
      cli.stop();
    } else {
      // detach: let the server keep running for other windows
      cli.detach();
    }
  }
}
