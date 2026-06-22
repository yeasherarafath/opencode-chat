# Change Log

All notable changes to the OpenCode Chat extension are documented here.

## [0.3.0] - 2026-06-22

### Added
- **Session Import / Export** — single context-aware icon in the header (Download when a session is selected = export, Upload when no session = import). Export opens a JSON viewer with Save / Copy / Close. Import opens a file picker and loads the JSON into a read-only viewer.
- **Import → create server session** — selecting a JSON file creates a new session on the opencode server using the imported title and adds it to the session list, with a success toast.
- **Open Web GUI** — Globe icon opens the opencode web UI in a custom editor tab. A localhost auth-injecting proxy (`AuthProxy`) sits between the webview and the opencode server, transparently adding the Basic auth header so the web UI loads without manual login.
- **AuthProxy** — new module that proxies HTTP requests + WebSocket upgrades to the opencode server, injecting `Authorization: Basic` on every forwarded request/upgrade.
- **JSON viewer modal** — modal that renders any JSON blob (export or import) with Save-to-file and Copy-to-clipboard actions. Uses `navigator.clipboard` directly from the webview.
- **New slash command** — `/import` opens the import file picker.
- **Provider / Diff modal scroll** — added `.modal` and `.modal-body` CSS so long provider and diff lists scroll inside a fixed-height modal instead of overflowing the viewport.
- **`createSession(title)` public API** on `OpenCodeCli` — lets the extension create a new server session via the SDK (used by the import flow).

### Changed
- **Export flow** — uses the SDK (`cli.exportSession`) instead of the `opencode export` CLI subcommand, so the modal actually receives the session JSON (the CLI only printed a status line, which was the cause of the earlier "export not working" bug).
- **Import flow** — no longer attempts `opencode import` against the opencode server (the CLI rejected the SDK's export format with a schema error). The JSON is read directly from disk and shown in the viewer; a new empty session with the imported title is created and added to the list.
- **`runCliCommand`** — switched from `child_process.execFile` to `cross-spawn` and added `ensureExecutableExtension`, so Windows `.cmd` / `.bat` shims resolve correctly (fixed `spawn … ENOENT` on `opencode import`).
- **Modal layout** — JSON viewer modal uses `position: fixed` with `height: 60vh` and `window.innerHeight`-measured dimensions so the footer (Save / Copy / Close) is always fully visible regardless of sidebar size.
- **Import behavior** — no longer auto-switches to the newly created session, so the session list stays visible after import.
- **Header cleanup** — removed the redundant "Chat Sessions ▼/▲" text toggle; the Clock (History) button is now the sole session-panel toggle.
- **Session list actions** — removed the Share button (share was only ever a CLI-side passthrough and is not part of the sidebar flow).

### Fixed
- Export modal now actually shows the session JSON (was receiving the CLI's status line, not the data).
- Copy button in the JSON viewer now works (was posting `{type:"copy-text"}` to a non-existent handler; now uses `navigator.clipboard.writeText`).
- Windows: `opencode` binary detection now resolves `.cmd` / `.bat` shims under the user's `AppData\Roaming\npm` (was returning the extensionless path and failing with `ENOENT`).
- JSON viewer modal no longer gets clipped at the bottom in short sidebars.

## [0.2.5] - 2026-06-16

### Added
- Generate commit message command (`OpenCode: Generate Commit Message`) in SCM title bar
- Progress notification while generating commit message
- Optional `slug` property to Session and SessionInfo interfaces
- Extension version display in session state modal
- Current session name shown in status bar

### Changed
- Enhanced message processing to clean and extract content from `<think>` tags into reasoning sections
- Pass extension version to OpenCodeViewProvider for improved state management
- Status bar truncation for long session names
- Updated README to clarify compatibility with VS Code-compatible editors

## [0.2.4] - 2026-06-15

### Added
- Badges for Visual Studio Marketplace and Open VSX in README
- CI and publish workflows for automated builds and releases
- Support beta versioning in release script

### Changed
- Improved `<think>` block rendering with DOM-safe placeholders
- Enhanced `<think>` block handling in streaming content
- Expanded README with detailed features and benefits
- Updated README and configuration for new features and improvements

## [0.2.3] - 2026-06-14

### Changed
- Updated README and configuration for new features and improvements

## [0.2.2] - 2026-06-14

### Changed
- Updated chat image in media directory
- Removed logo credit section from README.md

## [0.2.1] - 2026-06-14

### Changed
- Updated README and configuration for new features and improvements

## [0.2.0] - 2026-06-14

### Changed
- Updated branding and release notes

## [0.2.0-beta.3] - 2026-06-14

### Added
- `<think>` tag rendering in markdown — collapsible reasoning accordion for server-reasoned content
- Session auto-fetch with SSE subscription (instant) and polling fallback
- JSON event logger for debugging SSE, CLI, and webview messages
- File attachment chips with file picker dialog (`@` menu)
- Session search/filter by title with keyword highlighting
- Question card support for interactive tool questions
- Slash commands menu (`/help`, `/diff`, `/fork`, `/share`, `/sessions`, etc.)
- Diff viewer modal for session file changes
- Server health check with automatic restart on failure
- Patch file display with clickable file links
- Pure mode option (`opencode-chat.pureMode`) to reduce subprocess count
- Cleanup on deactivate option to kill orphaned server processes
- Refresh models command

### Fixed
- Session error now shows real API error message instead of generic "Session error"
- Model dropdown now hides immediately after selection
- Variant dropdown opens/closes correctly with consistent positioning
- Reasoning text preserved in fallback message when `message` event is missed
- Session-loaded content includes reasoning text in message body
- Inline code with HTML-like content (`<think>`, `<code>`) properly escaped
- Markdown tables, lists, code blocks render correctly via `marked` parser

### Changed
- Replaced custom markdown parser with `marked` library for proper GFM support
- Updated `@opencode-ai/sdk` to v1.17.6
- Improved version detection and server startup logic
- Enhanced streaming with part-based message rendering

## [0.1.0] - 2026-06-13

### Added
- Full chat UI in VS Code sidebar with streaming responses
- Agent mode selector (Plan, Build, Review, and custom agents)
- Searchable model picker grouped by provider
- Effort variant selection (Balanced, High, Max, Minimal, Medium, Low)
- Session management with time-based grouping (Today, Yesterday, Earlier)
  - Create, rename, share, fork, summarize, and delete sessions
  - Search/filter sessions by title
- Slash commands (`/help`, `/diff`, `/fork`, `/share`, `/review`, `/sessions`, `/skills`, `/mcps`, etc.)
- File attachment via `@` menu and file picker dialog
- Inline syntax highlighting for code blocks with copy button
- Full markdown rendering (tables, lists, headings, code blocks, links, formatting)
- Diff viewer modal showing file changes with add/delete stats
- Provider management modal (view API keys, model counts)
- Session export to JSON
- Abort button to stop running responses
- Automatic session refresh on response completion
- Status bar with connection state indicator
- Session state info modal
- Dark theme matching VS Code aesthetics
- Custom Tailwind CSS design system with Material-inspired tokens
- CSP-secured webview with nonce-based script loading

### Fixed
- Graceful handling when opencode CLI is not installed (install prompt)
- Auto-detection of opencode binary across Windows, macOS, and Linux
- Fallback server connection strategies for unreliable startup
- SSE stream error recovery
- File attachment error handling for missing or unreadable files

### Changed
- Switched from `createOpencode` to manual server spawn for better cross-platform compatibility
- Improved binary resolution with platform-specific PATH lookup
- Enhanced webview messaging protocol for better state synchronization
