import * as vscode from "vscode";
import { OpenCodeCli } from "./OpenCodeCli";
import { OpenCodeViewProvider } from "./OpenCodeViewProvider";

export async function activate(context: vscode.ExtensionContext) {
  const outputChannel = vscode.window.createOutputChannel("OpenCode Chat");
  OpenCodeCli.setOutputChannel(outputChannel);
  context.subscriptions.push(outputChannel);
  outputChannel.appendLine("[OpenCode Chat] Extension activating...");

  const configPath = vscode.workspace.getConfiguration().get<string>("opencode-chat.cliPath", "");
  outputChannel.appendLine(`[OpenCode Chat] Config opencode-chat.cliPath="${configPath}"`);
  const cli = new OpenCodeCli(configPath || undefined);

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

export function deactivate() {}
