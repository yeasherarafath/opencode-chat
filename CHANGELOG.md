# Change Log

All notable changes to the OpenCode Chat extension are documented here.

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
