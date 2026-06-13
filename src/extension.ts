import * as vscode from "vscode";
import { OpenCodeCli } from "./OpenCodeCli";
import { OpenCodeViewProvider } from "./OpenCodeViewProvider";

let outputChannel: vscode.OutputChannel;
let cli: OpenCodeCli;

export async function activate(context: vscode.ExtensionContext) {
  outputChannel = vscode.window.createOutputChannel("OpenCode Chat");
  OpenCodeCli.setOutputChannel(outputChannel);
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("[OpenCode Chat] Extension activating...");

  cli = new OpenCodeCli();

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

  const provider = new OpenCodeViewProvider(context.extensionUri, cli);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      OpenCodeViewProvider.viewType,
      provider,
      { webviewOptions: { retainContextWhenHidden: true } }
    )
  );

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
  if (outputChannel) outputChannel.appendLine("[OpenCode Chat] Deactivating - stopping server");
  if (cli) cli.stop();
}
