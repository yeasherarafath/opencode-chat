# Release v0.2.5

**Date:** 2026-06-16

## What's New

### Generate Commit Messages
A new `OpenCode: Generate Commit Message` command has been added to the SCM title bar. This feature uses OpenCode AI to analyze your staged (or unstaged) changes and generate a conventional commit message automatically.

- Click the commit icon in the Source Control title bar
- Shows progress notification while generating
- Automatically populates the Git commit input box
- Falls back to clipboard if SCM integration is unavailable

### Enhanced Session Display
- Current session name now appears in the status bar
- Extension version visible in the session state modal
- Better handling of long session names with text truncation

### Improved `<think>` Tag Processing
Messages containing `<think>` tags are now properly cleaned and extracted into dedicated reasoning sections, providing a clearer view of both the reasoning process and the final response.

## Bug Fixes & Improvements

- Added optional `slug` property to Session and SessionInfo interfaces
- Pass extension version to OpenCodeViewProvider for improved state management
- Updated README to clarify compatibility with VS Code-compatible editors
- Status bar overflow handling for long session names

## Commits

- `7a484be` feat: show progress notification while generating commit message
- `2741287` feat(scm): add generate commit message command
- `98cbbc9` feat: add optional slug property to Session and SessionInfo interfaces
- `6bea940` feat: enhance message processing by cleaning and extracting content from 'think' tags
- `a0d7cdf` feat: pass extension version to OpenCodeViewProvider and update state management in webview
- `5dcba56` feat: update README to clarify compatibility with VS Code-compatible editors

## Installation

### VS Code Marketplace
```bash
code --install-extension YasirArafat.opencode-ai-chat
```

### Manual VSIX
Download the `.vsix` file from [GitHub Releases](https://github.com/yeasherarafath/opencode-chat/releases/tag/v0.2.5) and install via:
```bash
code --install-extension opencode-ai-chat-0.2.5.vsix
```

## Full Changelog
See [CHANGELOG.md](./CHANGELOG.md) for complete version history.
