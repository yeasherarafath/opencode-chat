# OpenCode Chat

A full-featured chat UI for [OpenCode](https://opencode.ai) — the AI coding agent that runs in your terminal — now available as a VS Code sidebar extension.

![Chat interface](media/chat.png)
*Chat with agent modes, model selection, and streaming responses*

![Landing page](media/landing.png)
*Select old chat to continue or start new chat*

## Features

- **Chat UI** — Full conversational interface in the VS Code sidebar with streaming responses
- **Agent Modes** — Switch between agent modes (Plan, Build, Review, etc.) with one click
- **Model Selection** — Searchable model picker grouped by provider
- **Effort Variants** — Choose response effort: Balanced, High, Max, Minimal, Medium, Low
- **Session Management** — View, search, rename, share, fork, summarize, and delete sessions with time-based grouping (Today / Yesterday / Earlier)
- **Slash Commands** — 15+ built-in commands (`/help`, `/diff`, `/fork`, `/share`, `/review`, `/sessions`, `/skills`, `/mcps`, etc.)
- **File Attachment** — Attach workspace files via `@` menu or file picker
- **Code Highlighting** — Built-in syntax highlighting for code blocks with copy button
- **Markdown Rendering** — Full markdown support including tables, lists, headings, code blocks, links, and formatting
- **Diff Viewer** — View session file changes inline with add/delete stats
- **Provider Management** — View configured providers, their API key status, and model counts
- **Session Export** — Export any session as JSON
- **Session State Info** — Modal showing CLI status, version, session IDs, model, agent, and more
- **Abort** — Stop running responses instantly
- **New Chat** — Start fresh conversations with a single click
- **Dark Theme** — Custom dark design that matches VS Code aesthetics

## Requirements

The [opencode CLI](https://opencode.ai/install) must be installed and available on your PATH.

```bash
npm install -g opencode-ai
```

The extension auto-detects the CLI binary. You can also set a custom path in settings:

```
opencode-chat.cliPath
```

## Usage

1. Click the **OpenCode** icon in the activity bar
2. If the CLI is not found, click **Install OpenCode** to open the install page
3. Select an agent mode and model from the toolbar
4. Type a message and press Enter (or click the send button)
5. View responses in real-time with streaming text, reasoning, and tool calls

### Slash Commands

Type `/` in the input to browse available commands:

| Command | Description |
|---|---|
| `/agents` | Switch agent |
| `/compact` | Compact session |
| `/connect` | Connect provider |
| `/copy` | Copy session transcript |
| `/diff` | Open diff viewer |
| `/editor` | Open editor |
| `/exit` | Exit |
| `/export` | Export session transcript |
| `/fork` | Fork session |
| `/help` | Show help |
| `/init` | Initialize project analysis |
| `/mcps` | Manage MCP servers |
| `/review` | Review changes |
| `/sessions` | List and switch sessions |
| `/share` | Share session |
| `/skills` | Manage skills |

### File Attachment

Type `@` in the input to browse and attach workspace files to your message. You can also click the attachment icon in the input toolbar to open a file picker.

### Commands

| Command | Description |
|---|---|
| `OpenCode Chat: Focus Sidebar` | Open the chat sidebar |
| `OpenCode Chat: New Session` | Start a new conversation |
| `OpenCode Chat: Refresh Models` | Refresh the model list |

### Settings

| Setting | Default | Description |
|---|---|---|
| `opencode-chat.cliPath` | `""` | Path to the opencode CLI binary. Leave empty to auto-detect. |
| `opencode-chat.defaultModel` | `""` | Default model ID (e.g. `anthropic/claude-sonnet-4-20250514`). Empty = first available. |
| `opencode-chat.defaultAgent` | `""` | Default agent name (e.g. `plan`, `build`, `review`). Empty = first available. |
| `opencode-chat.serverPort` | `4096` | Port for the opencode server. |
| `opencode-chat.serverHostname` | `127.0.0.1` | Hostname to bind the server to. |
| `opencode-chat.serverTimeout` | `15000` | Max milliseconds to wait for the server to start. |

## Architecture

The extension communicates with the `opencode` CLI by spawning it as a subprocess. No separate HTTP server is needed — the CLI handles all session, prompt, and provider management via its SDK.

```
src/
  extension.ts              # Extension entry point & activation
  OpenCodeCli.ts            # CLI subprocess wrapper & SDK client
  OpenCodeViewProvider.ts   # Webview provider & message handling
  webview/
    app.ts                  # Chat UI (Vanilla TypeScript + Tailwind CSS)
```

The webview is built with vanilla TypeScript and Tailwind CSS — no framework dependencies. Markdown rendering and syntax highlighting are implemented from scratch for a lightweight footprint.

## Development

```bash
# Install dependencies
npm install

# Build extension + webview
npm run build

# Watch mode (auto-rebuild on changes)
npm run watch

# Package VSIX
npm run package
```

Press `F5` in VS Code to launch a debug instance with the extension loaded.

### Build Output

- `dist/extension.js` — Extension main process
- `dist/webview.js` — Webview UI
- `dist/webview.css` — Tailwind-generated styles

## Privacy

This extension runs the opencode CLI locally on your machine. No data is sent to external servers except through the AI providers you configure in the opencode CLI.

## License

MIT
