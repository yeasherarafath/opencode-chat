import * as vscode from "vscode";
import * as path from "path";
import { exec } from "child_process";
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

  const extVersion = context.extension.packageJSON.version || "0.0.0";
  const provider = new OpenCodeViewProvider(context.extensionUri, cli, extVersion);

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

  context.subscriptions.push(
    vscode.commands.registerCommand("opencode-chat.generateCommitMessage", async () => {
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
      if (!workspaceRoot) {
        vscode.window.showErrorMessage("OpenCode: No workspace folder open");
        return;
      }

      const execCmd = (cmd: string): Promise<string> =>
        new Promise((resolve, reject) => {
          exec(cmd, { cwd: workspaceRoot, maxBuffer: 10 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error(stderr.trim() || err.message));
            else resolve(stdout);
          });
        });

      let diff: string;
      try {
        diff = await execCmd("git diff --cached");
        if (!diff.trim()) diff = await execCmd("git diff");
        if (!diff.trim()) {
          vscode.window.showInformationMessage("OpenCode: No changes detected");
          return;
        }
      } catch (e) {
        vscode.window.showErrorMessage(`OpenCode: Failed to get git diff: ${e}`);
        return;
      }

      const commitMessage = await (async () => {
        outputChannel.appendLine("[OpenCode] Generating commit message...");
        try {
          const msg = await cli.generateCommitMessage(diff);
          outputChannel.appendLine(`[OpenCode] Generated: "${msg}"`);
          return msg;
        } catch (e) {
          outputChannel.appendLine(`[OpenCode] Generation failed: ${e}`);
          throw e;
        }
      })();

      // Focus SCM view to ensure input box is live
      try {
        await vscode.commands.executeCommand("workbench.view.scm");
        await new Promise((r) => setTimeout(r, 100));
      } catch {}

      let set = false;
      try {
        const gitExt = vscode.extensions.getExtension("vscode.git");
        if (gitExt) {
          if (!gitExt.isActive) await gitExt.activate();
          const api = gitExt.exports.getAPI(1);
          const repo = api.getRepository(vscode.Uri.file(workspaceRoot));
          if (repo) {
            repo.inputBox.value = commitMessage;
            set = repo.inputBox.value === commitMessage;
            outputChannel.appendLine(`[OpenCode] Set via git extension API, verified=${set}`);
          } else {
            outputChannel.appendLine("[OpenCode] No git repository found");
          }
        } else {
          outputChannel.appendLine("[OpenCode] Git extension not active");
        }
      } catch (e) {
        outputChannel.appendLine(`[OpenCode] git API failed: ${e}`);
      }

      if (!set) {
        try {
          const input = vscode.scm.inputBox;
          if (input) {
            input.value = commitMessage;
            set = true;
            outputChannel.appendLine("[OpenCode] Set via vscode.scm.inputBox");
          } else {
            outputChannel.appendLine("[OpenCode] vscode.scm.inputBox is undefined");
          }
        } catch (e) {
          outputChannel.appendLine(`[OpenCode] scm.inputBox failed: ${e}`);
        }
      }

      if (!set) {
        await vscode.env.clipboard.writeText(commitMessage);
        vscode.window.showInformationMessage("OpenCode: Commit message copied to clipboard!");
      } else {
        vscode.window.showInformationMessage("OpenCode: Commit message generated!");
      }
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
