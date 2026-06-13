# OpenCode Chat

A full-featured chat UI for the [OpenCode](https://opencode.ai) AI coding agent, built as a VS Code sidebar extension.

## Features

- **Chat UI** — Full conversational interface in the VS Code sidebar
- **Session Management** — View, switch, and delete chat sessions
- **Model Selection** — Switch between any configured provider/model
- **Command Support** — Use slash commands (/, /help, /editor, etc.)
- **Streaming Responses** — See AI responses in real-time
- **New Chat** — Start fresh conversations instantly
- **Abort** — Stop running responses

## Prerequisites

This extension requires the [opencode CLI](https://opencode.ai/install) to be installed and available on your PATH.

## Usage

1. Click the OpenCode icon in the activity bar
2. If opencode is not installed, click "Install OpenCode"
3. Start chatting! Type a message and press Enter

### Commands

| Command | Description |
|---|---|
| `OpenCode Chat: Focus Sidebar` | Open the chat sidebar |
| `OpenCode Chat: New Session` | Start a new conversation |
| `OpenCode Chat: Refresh Models` | Refresh the model list |

### Slash Commands

Type `/` in the input to see available commands. Common commands:
- `/help` — Show help
- `/editor` — Open in editor

## Development

```bash
# Install dependencies
npm install

# Build extension + webview
npm run build

# Watch mode
npm run watch

# Package VSIX
npm run package
```

Press `F5` in VS Code to launch a debug instance with the extension loaded.

## Architecture

```
src/
  extension.ts              # Entry point
  OpenCodeCli.ts            # CLI subprocess wrapper
  OpenCodeViewProvider.ts   # Webview provider
  webview/
    app.ts                  # Chat UI (Vanilla TS)
```

The extension spawns `opencode` CLI commands as subprocesses. No HTTP server needed.

## License

MIT
