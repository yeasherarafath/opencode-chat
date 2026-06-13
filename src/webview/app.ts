type VscodeApi = { postMessage(m: unknown): void; getState(): unknown; setState(s: unknown): void };
declare function acquireVsCodeApi(): VscodeApi;

const vscode = acquireVsCodeApi();

function el<K extends keyof HTMLElementTagNameMap>(tag: K, a?: Record<string, string>, c?: (HTMLElement | Text)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (a) for (const [k, v] of Object.entries(a)) {
    if (k === "className") e.className = v;
    else if (k === "innerHTML") e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  if (c) for (const x of c) e.append(x);
  return e;
}
function txt(t: string): Text { return document.createTextNode(t); }

function highlightCode(code: string, lang: string): string {
  const KEYWORDS = "async|await|break|case|catch|class|const|continue|debugger|default|delete|do|else|export|extends|finally|for|from|function|if|import|in|instanceof|let|new|of|return|static|super|switch|this|throw|try|typeof|var|void|while|with|yield|true|false|null|undefined".split("|");

  const lines = code.split("\n");
  const out: string[] = [];
  let inBlockComment = false;

  for (const line of lines) {
    let i = 0;
    let result = "";
    while (i < line.length) {
      // block comment end
      if (inBlockComment) {
        const end = line.indexOf("*/", i);
        if (end === -1) {
          result += esc(line.slice(i));
          break;
        }
        result += '<span class="hl-comment">' + esc(line.slice(i, end + 2)) + "</span>";
        i = end + 2;
        inBlockComment = false;
        continue;
      }
      // block comment start
      if (line[i] === "/" && line[i + 1] === "*") {
        const end = line.indexOf("*/", i + 2);
        if (end === -1) {
          result += '<span class="hl-comment">' + esc(line.slice(i)) + "</span>";
          inBlockComment = true;
          break;
        }
        result += '<span class="hl-comment">' + esc(line.slice(i, end + 2)) + "</span>";
        i = end + 2;
        continue;
      }
      // line comment
      if (line[i] === "/" && line[i + 1] === "/") {
        result += '<span class="hl-comment">' + esc(line.slice(i)) + "</span>";
        break;
      }
      // string single
      if (line[i] === "'" || line[i] === '"') {
        const q = line[i];
        let j = i + 1;
        while (j < line.length && line[j] !== q) {
          if (line[j] === "\\") j++;
          j++;
        }
        if (j < line.length) j++;
        result += '<span class="hl-string">' + esc(line.slice(i, j)) + "</span>";
        i = j;
        continue;
      }
      // template literal
      if (line[i] === "`") {
        let j = i + 1;
        while (j < line.length && line[j] !== "`") {
          if (line[j] === "\\") j++;
          j++;
        }
        if (j < line.length) j++;
        result += '<span class="hl-string">' + esc(line.slice(i, j)) + "</span>";
        i = j;
        continue;
      }
      // numbers
      if (/\d/.test(line[i]) && (i === 0 || /[\s(,=[\]+\-*/%]/.test(line[i - 1]))) {
        let j = i;
        while (j < line.length && /[\d.xXa-fA-F.]/.test(line[j])) j++;
        result += '<span class="hl-number">' + esc(line.slice(i, j)) + "</span>";
        i = j;
        continue;
      }
      // identifier / keyword
      if (/[a-zA-Z_$]/.test(line[i])) {
        let j = i;
        while (j < line.length && /[\w$]/.test(line[j])) j++;
        const word = line.slice(i, j);
        if (KEYWORDS.includes(word)) {
          result += '<span class="hl-keyword">' + word + "</span>";
        } else if (j < line.length && line[j] === "(") {
          result += '<span class="hl-func">' + word + "</span>";
        } else if (j < line.length && line[j] === ".") {
          result += '<span class="hl-prop">' + word + "</span>";
        } else {
          result += esc(word);
        }
        i = j;
        continue;
      }
      // property access (word after .)
      if (line[i] === "." && i + 1 < line.length && /[a-zA-Z_$]/.test(line[i + 1])) {
        let j = i + 1;
        while (j < line.length && /[\w$]/.test(line[j])) j++;
        const prop = line.slice(i + 1, j);
        if (j < line.length && line[j] === "(") {
          result += ".<span class=\"hl-func\">" + prop + "</span>";
        } else {
          result += ".<span class=\"hl-prop\">" + prop + "</span>";
        }
        i = j;
        continue;
      }
      result += esc(line[i]);
      i++;
    }
    out.push(result);
  }
  return out.join("\n");
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(text: string): HTMLElement {
  const root = el("div", { className: "md" });
  // Split into code blocks and non-code sections.
  // Capturing parens keep delimiters in result array.
  const parts = text.split(/(```[\s\S]*?```)/);
  for (const part of parts) {
    if (!part.trim()) continue;
    const codeMatch = part.match(/^```(\w*)\n?([\s\S]*?)```\n?$/);
    if (codeMatch) {
      const lang = codeMatch[1];
      const code = codeMatch[2].replace(/\n$/, "");
      const pre = el("pre", { className: "code-block" });
      const hdr = el("div", { className: "code-header" });
      hdr.appendChild(el("span", { className: "code-lang" }, [txt(lang || "code")]));
      const copyBtn = el("button", { className: "copy-btn" }, [txt("Copy")]);
      copyBtn.onclick = () => {
        navigator.clipboard.writeText(code).then(() => {
          copyBtn.textContent = "Copied!";
          setTimeout(() => { copyBtn.textContent = "Copy"; }, 2000);
        }).catch(() => {});
      };
      hdr.appendChild(copyBtn);
      pre.appendChild(hdr);
      const codeEl = el("code");
      codeEl.innerHTML = highlightCode(code, lang);
      pre.appendChild(codeEl);
      root.appendChild(pre);
    } else {
      renderInline(part, root);
    }
  }
  return root;
}

function renderInline(text: string, root: HTMLElement): void {
  const lines = text.split("\n");
  let p: HTMLElement | null = null;
  let inUl: HTMLElement | null = null;
  let inOl: HTMLElement | null = null;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const html = line
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/\*([^*]+)\*/g, "<em>$1</em>")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');

    // ---- Table ----
    if (line.startsWith("|") && i + 1 < lines.length && /^[\s|:-]+$/.test(lines[i + 1]) && lines[i + 1].includes("---")) {
      const tableRows: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) {
        tableRows.push(lines[i]);
        i++;
      }
      if (tableRows.length >= 2) {
        const table = el("table", { className: "md-table" });
        p = null; inUl = null; inOl = null;
        // header row
        const thead = el("thead");
        const trH = el("tr");
        for (const cell of splitTableRow(tableRows[0])) {
          trH.appendChild(el("th", {}, [txt(inlineFormat(cell.trim()))]));
        }
        thead.appendChild(trH);
        table.appendChild(thead);
        // data rows (skip separator at index 1)
        if (tableRows.length > 2) {
          const tbody = el("tbody");
          for (let r = 2; r < tableRows.length; r++) {
            const trD = el("tr");
            for (const cell of splitTableRow(tableRows[r])) {
              trD.appendChild(el("td", {}, [txt(inlineFormat(cell.trim()))]));
            }
            tbody.appendChild(trD);
          }
          table.appendChild(tbody);
        }
        root.appendChild(table);
      }
      continue;
    }

    if (/^-{3,}\s*$/.test(line)) {
      p = null; inUl = null; inOl = null;
      root.appendChild(el("hr"));
      i++; continue;
    }
    const hMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const level = hMatch[1].length;
      const tag = "h" + Math.min(level, 6);
      p = null; inUl = null; inOl = null;
      const el2 = document.createElement(tag);
      el2.innerHTML = inlineFormat(hMatch[2]);
      root.appendChild(el2);
      i++; continue;
    }
    if (/^(-|\*)\s+(.+)$/.test(line)) {
      if (!inUl) { inUl = el("ul"); root.appendChild(inUl); }
      p = null; inOl = null;
      const li = el("li");
      li.innerHTML = inlineFormat(line.replace(/^(-|\*)\s+/, ""));
      inUl.appendChild(li);
      i++; continue;
    }
    if (/^\d+\.\s+(.+)$/.test(line)) {
      if (!inOl) { inOl = el("ol"); root.appendChild(inOl); }
      p = null; inUl = null;
      const li = el("li");
      li.innerHTML = inlineFormat(line.replace(/^\d+\.\s+/, ""));
      inOl.appendChild(li);
      i++; continue;
    }
    if (line === "") {
      p = null; inUl = null; inOl = null; i++; continue;
    }
    inUl = null; inOl = null;
    if (!p) { p = el("p"); root.appendChild(p); }
    if (p.innerHTML) p.innerHTML += "<br>" + html;
    else p.innerHTML = html;
    i++;
  }
}

function splitTableRow(row: string): string[] {
  const parts: string[] = [];
  let cur = "";
  for (let j = 0; j < row.length; j++) {
    if (row[j] === "|") {
      parts.push(cur);
      cur = "";
    } else {
      cur += row[j];
    }
  }
  // Drop leading empty (before first |) and trailing empty (after last |)
  return parts.slice(1).filter(c => c.trim() !== "");
}

function inlineFormat(s: string): string {
  return s
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

const SLASH_CMDS = [
  { cmd: "/agents", desc: "Switch agent" },
  { cmd: "/compact", desc: "Compact session" },
  { cmd: "/connect", desc: "Connect provider" },
  { cmd: "/copy", desc: "Copy session transcript" },
  { cmd: "/diff", desc: "Open diff viewer" },
  { cmd: "/editor", desc: "Open editor" },
  { cmd: "/exit", desc: "Exit" },
  { cmd: "/export", desc: "Export session transcript" },
  { cmd: "/fork", desc: "Fork session" },
  { cmd: "/help", desc: "Show help" },
  { cmd: "/init", desc: "Initialize project analysis" },
  { cmd: "/mcps", desc: "Manage MCP servers" },
  { cmd: "/review", desc: "Review changes [commit|branch|pr]" },
  { cmd: "/sessions", desc: "List and switch sessions" },
  { cmd: "/share", desc: "Share session" },
  { cmd: "/skills", desc: "Manage skills" },
];

interface Session { id: string; title: string; created_at: string; updated_at: string; message_count?: number }
const VARIANTS = ["", "high", "max", "minimal", "medium", "low"];
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  if (diff < 60000) return "just now";
  if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
  if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface QuestionData {
  questions: Array<Record<string, unknown>>;
  messageID?: string;
  partID?: string;
}

interface Msg { role: string; content: string; parts?: unknown[]; model?: string; time?: number; id?: string }
interface FileDiff { file: string; before: string; after: string; additions: number; deletions: number }
interface ProviderInfo { id: string; name: string; key?: string; modelCount: number }

interface AppState {
  isInstalled: boolean; opencodeVersion: string;
  sessions: Session[]; currentSessionId: string | null;
  messages: Msg[];
  models: string[]; agents: string[]; selectedModel: string; selectedAgent: string; selectedVariant: string;
  isRunning: boolean; showSessions: boolean;
  sessionCount: number;
  sessionFilter: string;
  workspaceFiles: string[];
  pendingQuestion: QuestionData | null;
}

class App {
  private state: AppState = {
    isInstalled: false, opencodeVersion: "",
    sessions: [], currentSessionId: null, messages: [],
    models: [], agents: [], selectedModel: "", selectedAgent: "", selectedVariant: "",
    isRunning: false, showSessions: true, sessionCount: 0, sessionFilter: "", workspaceFiles: [], pendingQuestion: null,
  };

  private root: HTMLElement;
  private sessionsPanel!: HTMLElement;
  private chatArea!: HTMLElement;
  private inputTextarea!: HTMLTextAreaElement;
  private sendBtn!: HTMLButtonElement;
  private abortBtn!: HTMLButtonElement;
  private variantPopup!: HTMLElement;
  private statusDot!: HTMLElement;
  private statusText!: HTMLElement;
  private infoBtn!: HTMLElement;
  private streamingMsgEl: HTMLElement | null = null;
  private streamingContent = "";
  private streamingSaved = false;
  private slashMenuEl!: HTMLElement;
  private sessionSearchInput!: HTMLInputElement;
  private sessionListEl!: HTMLElement;
  private atMenuEl!: HTMLElement;
  private filteredSlash: typeof SLASH_CMDS = [];
  private slashIdx = 0;
  private overlayEl!: HTMLElement;
  private pendingDiffResolve: ((d: FileDiff[]) => void) | null = null;
  private pendingProviderResolve: ((p: ProviderInfo[]) => void) | null = null;

  constructor() {
    this.root = document.getElementById("root")!;
    console.log("[webview] constructor: initial render");
    this.render();
    console.log("[webview] constructor: setting up listener");
    this.listen();
    console.log("[webview] constructor: posting ready");
    vscode.postMessage({ type: "ready" });
    console.log("[webview] constructor: done");
  }

  private render(): void {
    console.log(`[webview] render: isInstalled=${this.state.isInstalled}`);
    this.root.innerHTML = "";
    if (!this.state.isInstalled) { console.log("[webview] render: showing install screen"); this.renderInstall(); return; }
    console.log("[webview] render: showing main UI");
    this.renderMain();
  }

  private renderInstall(): void {
    this.root.appendChild(el("div", { className: "flex flex-col items-center justify-center h-screen px-8 text-center gap-5" }, [
      el("h2", { className: "text-headline" }, [txt("OpenCode CLI Required")]),
      el("p", { className: "text-body text-on-surface-variant max-w-[280px]" }, [txt("Install the opencode CLI to use AI-powered coding assistance.")]),
      el("button", { className: "bg-primary-container text-on-primary border-none px-6 py-2.5 cursor-pointer text-sm font-medium rounded-md font-ui transition-colors duration-150 hover:bg-[#3d7ae8]", id: "install-btn" }, [txt("Install OpenCode")]),
    ]));
    document.getElementById("install-btn")!.onclick = () => vscode.postMessage({ type: "install" });
  }

  private renderMain(): void {
    const header = this.createHeader();
    const agentBar = this.createAgentBar();
    this.sessionsPanel = el("div", { className: "bg-surface-dim border-b border-outline-variant max-h-72 overflow-y-auto shrink-0 hidden" });
    this.sessionsPanel.classList.remove("hidden");
    this.sessionSearchInput = el("input", { className: "shrink-0 bg-surface-dim border border-outline-variant mx-2 my-1.5 px-2.5 py-1.5 text-xs rounded-sm outline-none text-on-surface font-ui focus:border-primary-container placeholder:text-on-surface-variant/60", placeholder: "Search chats...", type: "text" }) as HTMLInputElement;
    this.sessionSearchInput.oninput = () => {
      this.state.sessionFilter = this.sessionSearchInput.value;
      this.renderSessionList();
    };
    this.sessionListEl = el("div", { className: "session-list" });
    this.sessionsPanel.append(this.sessionSearchInput, this.sessionListEl);
    this.chatArea = el("div", { className: "flex-1 overflow-y-auto px-3 py-6 flex flex-col gap-5 overflow-x-hidden scroll-smooth" });
    const inputArea = this.createInputArea();
    const statusBar = this.createStatusBar();
    this.overlayEl = el("div", { className: "fixed inset-0 bg-black/50 z-200 flex items-center justify-center backdrop-blur-sm hidden" });
    this.root.append(header, agentBar, this.sessionsPanel, this.chatArea, inputArea, statusBar, this.overlayEl);
    this.renderMessages();
    this.renderSessionList();
    this.renderModels();
    this.renderAgents();
  }

  private createHeader(): HTMLElement {
    const hdr = el("header", { className: "flex items-center justify-between px-3 h-11 flex-shrink-0 bg-surface-container-low border-b border-outline-variant" });
    const left = el("div", { className: "flex items-center gap-2" });
    left.appendChild(el("span", { className: "text-headline font-bold text-on-surface" }, [txt("OpenCode")]));
    left.appendChild(el("span", { className: "text-label text-on-surface-variant/60 self-end mb-px" }, [txt("v" + (this.state.opencodeVersion || "?"))]));
    hdr.appendChild(left);

    const right = el("div", { className: "flex items-center gap-1" });
    const sessBtn = el("button", { className: "flex items-center gap-1 bg-transparent border-none cursor-pointer text-label text-on-surface-variant px-2 py-1 rounded-sm transition-all duration-150 whitespace-nowrap hover:text-primary hover:bg-white/4", title: "Toggle sessions" });
    sessBtn.innerHTML = "Chat Sessions <span style='font-size:10px'>▼</span>";
    sessBtn.onclick = () => {
      this.state.showSessions = !this.state.showSessions;
      this.sessionsPanel.classList.toggle("hidden", !this.state.showSessions);
      sessBtn.querySelector("span")!.textContent = this.state.showSessions ? "▲" : "▼";
    };
    right.appendChild(sessBtn);
    const histBtn = el("button", { className: "flex items-center gap-1 bg-transparent border-none cursor-pointer text-label text-on-surface-variant px-2 py-1 rounded-sm transition-all duration-150 whitespace-nowrap hover:text-primary hover:bg-white/4", title: "History" });
    histBtn.innerHTML = "<span class='icon'>&#x1F4CB;</span>";
    histBtn.onclick = () => { this.state.showSessions = !this.state.showSessions; this.sessionsPanel.classList.toggle("hidden"); };
    right.appendChild(histBtn);
    const providersBtn = el("button", { className: "flex items-center gap-1 bg-transparent border-none cursor-pointer text-label text-on-surface-variant px-2 py-1 rounded-sm transition-all duration-150 whitespace-nowrap hover:text-primary hover:bg-white/4", title: "Providers" });
    providersBtn.innerHTML = "&#x2699;";
    providersBtn.onclick = () => {
      vscode.postMessage({ type: "get-providers" });
      this.showProvidersModal();
    };
    right.appendChild(providersBtn);
    hdr.appendChild(right);
    return hdr;
  }

  private createAgentBar(): HTMLElement {
    const bar = el("div", { className: "flex flex-col gap-1.5 p-2 bg-surface-container border-b border-outline-variant shrink-0" });
    const top = el("div", { className: "flex items-center justify-between px-0.5" });
    const label = el("span", { className: "text-label text-on-surface-variant flex items-center gap-1 uppercase tracking-wide" });
    label.innerHTML = "<span class='icon'>&#x2699;</span> Agent Mode";
    top.appendChild(label);
    const newBtn = el("button", { className: "flex items-center gap-1 text-label text-primary bg-primary/10 border-none px-2.5 py-0.5 rounded-full cursor-pointer transition-all duration-150 hover:bg-primary/20" });
    newBtn.innerHTML = "<span class='icon'>+</span> New Chat";
    newBtn.onclick = () => this.newSession();
    top.appendChild(newBtn);
    bar.appendChild(top);

    const seg = el("div", { className: "flex gap-1 p-0.5 rounded-lg bg-surface-container-lowest border border-outline-variant overflow-x-auto", "data-part": "agent-segmented" });
    const ags = this.state.agents.length ? this.state.agents : ["build", "plan", "review"];
    if (!this.state.selectedAgent && ags.includes("plan")) this.state.selectedAgent = "plan";
    for (const a of ags) {
      const pill = el("button", { className: "shrink-0 flex items-center justify-center gap-1 text-label text-on-surface-variant bg-transparent border-none px-2.5 py-1 rounded-md cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-primary" + (a === this.state.selectedAgent ? " active" : ""), "data-agent": a });
      pill.textContent = a.charAt(0).toUpperCase() + a.slice(1);
      pill.onclick = () => {
        this.state.selectedAgent = a;
        this.state.selectedVariant = "";
        seg.querySelectorAll("[data-agent]").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
      };
      seg.appendChild(pill);
    }
    bar.appendChild(seg);
    return bar;
  }





  private renderSessionList(): void {
    this.sessionListEl.innerHTML = "";
    const q = this.state.sessionFilter.toLowerCase();
    const filtered = q ? this.state.sessions.filter(s => (s.title || "").toLowerCase().includes(q)) : this.state.sessions;
    if (!filtered.length) {
      this.sessionListEl.appendChild(el("div", { className: "text-xs text-on-surface-variant/60 text-center py-5" }, [txt(q ? "No chats match \"" + q + "\"" : "No chats yet")]));
      return;
    }
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today.getTime() - 86400000);
    const groups: { label: string; items: Session[] }[] = [
      { label: "Today", items: [] },
      { label: "Yesterday", items: [] },
      { label: "Earlier", items: [] },
    ];
    for (const s of filtered) {
      const d = new Date(s.updated_at || s.created_at || 0);
      if (d >= today) groups[0].items.push(s);
      else if (d >= yesterday) groups[1].items.push(s);
      else groups[2].items.push(s);
    }
    for (const g of groups) {
      if (!g.items.length) continue;
      const section = el("div", { className: "py-1" });
      const hdr = el("div", { className: "text-label text-outline uppercase tracking-wider px-3.5 pb-1 pt-1.5 text-xs" }, [txt(g.label)]);
      section.appendChild(hdr);
      for (const s of g.items) {
        const item = el("div", { className: "flex items-start gap-2.5 px-3 py-2 cursor-pointer text-xs font-ui rounded-sm mx-1.5 my-px relative hover:bg-white/3" + (s.id === this.state.currentSessionId ? " active" : "") });
        item.onclick = () => this.switchSession(s.id);

        const icon = el("div", { className: "shrink-0 w-8 h-8 rounded-md bg-primary/12 flex items-center justify-center text-sm text-primary" });
        icon.textContent = "\uD83D\uDCAC";
        item.appendChild(icon);

        const body = el("div", { className: "flex-1 min-w-0" });
        const topRow = el("div", { className: "flex items-center gap-2" });
        const title = el("span", { className: "flex-1 overflow-hidden text-ellipsis whitespace-nowrap font-medium text-on-surface text-xs" }, [txt(s.title || "Untitled")]);
        const ts = el("span", { className: "text-label text-outline whitespace-nowrap shrink-0 text-xs" }, [txt(fmtTime(new Date(s.updated_at || s.created_at || 0).getTime()))]);
        topRow.append(title, ts);
        body.appendChild(topRow);
        const msgCount = s.message_count ? s.message_count + " messages" : "";
        body.appendChild(el("div", { className: "text-body-sm text-on-surface-variant overflow-hidden text-ellipsis whitespace-nowrap opacity-70" }, [txt(msgCount || s.title || "No messages")]));
        item.appendChild(body);

        const actions = el("div", { className: "absolute right-2 top-1 bottom-1 flex flex-col justify-between opacity-0 transition-opacity duration-150 [.session-item:hover_&]:opacity-50 [&:hover]:opacity-100" });
        const renameBtn = el("button", { className: "bg-transparent border-none cursor-pointer text-xs px-1.5 py-0.5 rounded-sm transition-all duration-150 text-on-surface-variant hover:text-primary", title: "Rename" });
        renameBtn.textContent = "\u270F";
        renameBtn.onclick = (e) => {
          e.stopPropagation();
          const input = el("input", { className: "flex-1 bg-transparent text-on-surface border border-primary-container px-1.5 py-0.5 text-xs rounded-sm outline-none font-ui", value: s.title || "", type: "text" }) as HTMLInputElement;
          title.replaceWith(input);
          input.focus();
          input.select();
          const save = () => {
            const val = input.value.trim();
            if (val && val !== s.title) {
              s.title = val;
              vscode.postMessage({ type: "rename-session", sessionId: s.id, title: val });
            }
            this.renderSessionList();
          };
          input.onkeydown = (ev) => { if (ev.key === "Enter") save(); if (ev.key === "Escape") this.renderSessionList(); };
          input.onblur = save;
        };
        const shareBtn = el("button", { className: "bg-transparent border-none cursor-pointer text-xs px-1.5 py-0.5 rounded-sm transition-all duration-150 text-on-surface-variant hover:text-primary", title: "Share" });
        shareBtn.textContent = "\u2197";
        shareBtn.onclick = (e) => { e.stopPropagation(); vscode.postMessage({ type: "share-session", sessionId: s.id }); };
        const diffBtn = el("button", { className: "bg-transparent border-none cursor-pointer text-xs px-1.5 py-0.5 rounded-sm transition-all duration-150 text-on-surface-variant hover:text-primary", title: "Show changes" });
        diffBtn.textContent = "\u0394";
        diffBtn.onclick = (e) => {
          e.stopPropagation();
          vscode.postMessage({ type: "get-session-diff", sessionId: s.id });
          this.showDiffModal(s.id);
        };
        const delBtn = el("button", { className: "bg-transparent border-none cursor-pointer text-xs px-1.5 py-0.5 rounded-sm transition-all duration-150 text-on-surface-variant hover:text-error text-error", title: "Delete" });
        delBtn.textContent = "\u2715";
        delBtn.onclick = (e) => { e.stopPropagation(); this.deleteSession(s.id); };
        actions.append(renameBtn, shareBtn, diffBtn, delBtn);
        item.appendChild(actions);

        section.appendChild(item);
      }
      this.sessionListEl.appendChild(section);
    }
  }

  private createInputArea(): HTMLElement {
    const container = el("div", { className: "relative z-30 shrink-0 px-3 pb-2.5 pt-2 backdrop-blur-sm bg-surface-dim/85 border-t border-outline-variant" });
    const inner = el("div", { className: "max-w-2xl mx-auto bg-surface-container-highest border border-outline-variant rounded-xl overflow-hidden transition-all duration-150 focus-within:border-primary-container focus-within:shadow-[0_0_0_1px_rgba(77,142,255,0.2)]" });

    this.slashMenuEl = el("div", { className: "absolute bottom-full left-3 bg-surface-container-low border border-outline-variant rounded-md max-h-64 overflow-y-auto min-w-[220px] shadow-lg z-100 mb-1 hidden" });
    container.appendChild(this.slashMenuEl);
    this.atMenuEl = el("div", { className: "absolute bottom-full left-3 bg-surface-container-low border border-outline-variant rounded-md max-h-60 overflow-y-auto min-w-[240px] shadow-lg z-100 hidden" });
    container.appendChild(this.atMenuEl);

    const inputToolbar = el("div", { className: "flex items-center gap-1.5 px-3 py-1.5 border-b border-outline-variant" });
    const modelPill = el("button", { className: "flex items-center gap-1 text-label text-on-surface-variant bg-surface-container-high border border-outline-variant px-2 py-0.5 rounded-full cursor-pointer transition-all duration-150 hover:border-primary hover:text-primary", title: "Selected model", "data-part": "model-pill" });
    modelPill.innerHTML = "<span class='icon'>&#x2699;</span> " + (this.state.selectedModel || "Model") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
    const modelPopup = el("div", { className: "absolute bottom-[calc(100%+4px)] left-0 bg-surface-container-low border border-outline-variant rounded-md min-w-[220px] z-100 shadow-lg flex flex-col hidden" });
    const modelSearch = el("input", { className: "bg-surface-container-lowest border-none border-b border-outline-variant text-on-surface px-2 py-1.5 text-xs font-ui outline-none rounded-t-md placeholder:text-on-surface-variant/60", placeholder: "Search models...", type: "text" }) as HTMLInputElement;
    const modelList = el("div", { className: "max-h-50 overflow-y-auto" });
    modelPopup.append(modelSearch, modelList);
    const renderModelList = (q: string) => {
      modelList.innerHTML = "";
      const filtered = q ? this.state.models.filter(m => m.toLowerCase().includes(q)) : this.state.models;
      const groups: Record<string, string[]> = {};
      for (const m of filtered) {
        const slash = m.indexOf("/");
        const prov = slash > 0 ? m.slice(0, slash) : "other";
        const name = slash > 0 ? m.slice(slash + 1) : m;
        if (!groups[prov]) groups[prov] = [];
        groups[prov].push(m);
      }
      for (const [prov, items] of Object.entries(groups)) {
        const gh = el("div", { className: "px-2 py-1 text-xs font-semibold uppercase text-on-surface-variant/70 tracking-wide bg-black/10" }, [txt(prov)]);
        modelList.appendChild(gh);
        for (const m of items) {
          const opt = el("div", { className: "px-3 py-1 text-xs cursor-pointer font-ui transition-colors duration-100 hover:bg-primary/8" + (m === this.state.selectedModel ? " on" : "") }, [txt(m)]);
          opt.onclick = () => {
            this.state.selectedModel = m;
            modelPopup.classList.add("hidden");
            modelPill.innerHTML = "<span class='icon'>&#x2699;</span> " + (m || "Model") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
          };
          modelList.appendChild(opt);
        }
      }
      if (!filtered.length) modelList.appendChild(el("div", { className: "px-3 py-1 text-xs text-on-surface-variant/60 cursor-default" }, [txt("No models match")]));
    };
    modelPill.onclick = () => {
      modelSearch.value = "";
      renderModelList("");
      modelPopup.classList.toggle("hidden");
      if (!modelPopup.classList.contains("hidden")) modelSearch.focus();
    };
    modelSearch.oninput = () => renderModelList(modelSearch.value.toLowerCase());
    modelSearch.onkeydown = (e) => { if (e.key === "Escape") modelPopup.classList.add("hidden"); };
    document.addEventListener("click", (e) => {
      if (!modelPill.contains(e.target as Node) && !modelPopup.contains(e.target as Node))
        modelPopup.classList.add("hidden");
    });
    inputToolbar.appendChild(modelPill);
    container.appendChild(modelPopup);

    const variantPill = el("button", { className: "flex items-center gap-1 text-label text-on-surface-variant bg-surface-container-high border border-outline-variant px-2 py-0.5 rounded-full cursor-pointer transition-all duration-150 hover:border-primary hover:text-primary", title: "Variant" });
    variantPill.innerHTML = "<span class='icon'>&#x2699;</span> " + (this.state.selectedVariant || "Balanced") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
    this.variantPopup = el("div", { className: "absolute bottom-full left-0 mb-1 bg-surface-container-low border border-outline-variant rounded-md min-w-[120px] z-100 shadow-lg hidden" });
    const vars = VARIANTS.filter(Boolean);
    for (const v of vars) {
      const opt = el("div", { className: "px-3 py-1.5 text-xs cursor-pointer font-ui transition-colors duration-100 capitalize hover:bg-primary/8" + (v === this.state.selectedVariant ? " on" : "") }, [txt(v)]);
      opt.onclick = () => {
        this.state.selectedVariant = v;
        this.variantPopup.classList.add("hidden");
        variantPill.innerHTML = "<span class='icon'>&#x2699;</span> " + v + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
      };
      this.variantPopup.appendChild(opt);
    }
    variantPill.onclick = () => this.variantPopup.classList.toggle("hidden");
    document.addEventListener("click", (e) => {
      if (!variantPill.contains(e.target as Node) && !this.variantPopup.contains(e.target as Node))
        this.variantPopup.classList.add("hidden");
    });
    inputToolbar.appendChild(variantPill);

    inner.appendChild(inputToolbar);

    container.appendChild(this.variantPopup);

    const inputMain = el("div", { className: "flex items-end" });
    this.inputTextarea = el("textarea", { placeholder: "Ask a question or type /", rows: "1" }) as HTMLTextAreaElement;
    this.inputTextarea.className = "flex-1 bg-transparent text-on-surface border-none px-3.5 py-2.5 resize-none text-body min-h-[40px] max-h-[140px] outline-none leading-relaxed placeholder:text-on-surface-variant/50";
    this.inputTextarea.oninput = () => {
      this.inputTextarea.style.height = "";
      this.inputTextarea.style.height = Math.min(this.inputTextarea.scrollHeight, 140) + "px";
      this.handleSlashInput();
      this.handleAtInput();
    };
    this.inputTextarea.onkeydown = (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); this.send(); }
      if (e.key === "Escape") { this.hideSlashMenu(); this.hideAtMenu(); }
      const inSlash = !this.slashMenuEl.classList.contains("hidden");
      const inAt = !this.atMenuEl.classList.contains("hidden");
      if (e.key === "ArrowDown" && inSlash) {
        e.preventDefault(); this.slashIdx = Math.min(this.slashIdx + 1, this.filteredSlash.length - 1);
        this.renderSlashMenu();
      }
      if (e.key === "ArrowUp" && inSlash) {
        e.preventDefault(); this.slashIdx = Math.max(this.slashIdx - 1, 0);
        this.renderSlashMenu();
      }
      if (e.key === "Enter" && !e.shiftKey && inSlash && this.filteredSlash[this.slashIdx]) {
        e.preventDefault();
        this.selectSlash(this.filteredSlash[this.slashIdx].cmd);
      }
    };
    inputMain.appendChild(this.inputTextarea);
    inner.appendChild(inputMain);

    const footer = el("div", { className: "flex items-center justify-between px-2.5 py-1.5 border-t border-outline-variant" });
    const left = el("div", { className: "flex items-center gap-0.5" });
    const attachBtn = el("button", { className: "bg-transparent border-none cursor-pointer text-on-surface-variant p-1 rounded-sm transition-all duration-150 flex items-center justify-center hover:text-primary hover:bg-white/4", title: "Attach file" });
    attachBtn.innerHTML = "<span class='icon'>&#x1F4CE;</span>";
    attachBtn.onclick = () => vscode.postMessage({ type: "show-file-picker" });
    left.appendChild(attachBtn);
    footer.appendChild(left);

    const right = el("div", { className: "flex gap-1 items-center" });
    const actions = el("div", { className: "flex gap-1 items-center" });
    this.abortBtn = el("button", { className: "w-8 h-8 rounded-full bg-transparent text-error border border-error cursor-pointer flex items-center justify-center transition-all duration-150 text-sm hover:bg-error/10", style: "display:none", title: "Abort" });
    this.abortBtn.textContent = "\u25A0";
    this.abortBtn.onclick = () => vscode.postMessage({ type: "abort" });
    actions.appendChild(this.abortBtn);

    this.sendBtn = el("button", { className: "w-8 h-8 rounded-full bg-primary-container text-on-primary border-none cursor-pointer flex items-center justify-center transition-all duration-150 hover:scale-105 active:scale-95", title: "Send" });
    this.sendBtn.innerHTML = "<span class='icon'>&#x2191;</span>";
    this.sendBtn.onclick = () => this.send();
    actions.appendChild(this.sendBtn);
    right.appendChild(actions);
    footer.appendChild(right);

    inner.appendChild(footer);
    container.appendChild(inner);
    return container;
  }

  private handleSlashInput(): void {
    const val = this.inputTextarea.value;
    const cursor = this.inputTextarea.selectionStart;
    if (cursor === 1 && val.startsWith("/")) {
      this.filteredSlash = [...SLASH_CMDS];
      this.slashIdx = 0;
      this.renderSlashMenu();
      this.slashMenuEl.classList.remove("hidden");
    } else if (val.startsWith("/") && cursor > 1) {
      const partial = val.slice(0, cursor).toLowerCase();
      this.filteredSlash = SLASH_CMDS.filter(s => s.cmd.startsWith(partial));
      this.slashIdx = 0;
      if (this.filteredSlash.length > 0) {
        this.renderSlashMenu();
        this.slashMenuEl.classList.remove("hidden");
      } else {
        this.hideSlashMenu();
      }
    } else {
      this.hideSlashMenu();
    }
  }

  private renderSlashMenu(): void {
    this.slashMenuEl.innerHTML = "";
    for (let i = 0; i < this.filteredSlash.length; i++) {
      const s = this.filteredSlash[i];
      const item = el("div", { className: "item" + (i === this.slashIdx ? " selected" : "") });
      item.innerHTML = `<div class="cmd">${s.cmd}</div><div class="desc">${s.desc}</div>`;
      item.onclick = () => this.selectSlash(s.cmd);
      this.slashMenuEl.appendChild(item);
    }
  }

  private selectSlash(cmd: string): void {
    this.inputTextarea.value = cmd + " ";
    this.inputTextarea.focus();
    this.inputTextarea.selectionStart = this.inputTextarea.selectionEnd = cmd.length + 1;
    this.hideSlashMenu();
  }

  private hideSlashMenu(): void {
    this.slashMenuEl.classList.add("hidden");
  }

  private handleAtInput(): void {
    const val = this.inputTextarea.value;
    const cursor = this.inputTextarea.selectionStart;
    const before = val.slice(0, cursor);
    const atIdx = before.lastIndexOf("@");
    if (atIdx >= 0 && (atIdx === 0 || before[atIdx - 1] === " " || before[atIdx - 1] === "\n")) {
      if (!this.state.workspaceFiles.length) {
        vscode.postMessage({ type: "get-files", pattern: "**/*", exclude: "**/node_modules/**,**/.git/**", maxResults: 200 });
      }
      const query = before.slice(atIdx + 1).toLowerCase();
      this.renderAtMenu(query);
      this.atMenuEl.classList.remove("hidden");
    } else {
      this.hideAtMenu();
    }
  }

  private hideAtMenu(): void {
    this.atMenuEl.classList.add("hidden");
  }

  private renderAtMenu(query: string): void {
    this.atMenuEl.innerHTML = "";
    const files = this.state.workspaceFiles || [];
    console.log(`[webview] renderAtMenu: query="${query}", files=${files.length}`);
    const q = query.replace(/\//g, "\\");
    const matched = files.filter(f => !q || f.toLowerCase().includes(q));
    console.log(`[webview] renderAtMenu: matched=${matched.length}`);
    if (!matched.length) {
      if (!files.length) {
        const item = el("div", { className: "item" });
        item.innerHTML = `<div class="cmd">Loading files...</div><div class="desc">Type more or browse</div>`;
        this.atMenuEl.appendChild(item);
      }
      const browse = el("div", { className: "item" });
      browse.innerHTML = `<div class="cmd">@file</div><div class="desc">Browse for file...</div>`;
      browse.onclick = () => {
        vscode.postMessage({ type: "show-file-picker" });
        this.hideAtMenu();
      };
      this.atMenuEl.appendChild(browse);
      return;
    }
    const limit = query ? 20 : 5;
    for (const f of matched.slice(0, limit)) {
      const item = el("div", { className: "item" });
      const parts = f.split(/[\\/]/);
      const name = parts.pop() || f;
      // show last 2 path segments for context (parent/child or enough to disambiguate)
      const ctx = parts.slice(-2);
      ctx.push(name);
      const display = ctx.join("/");
      const insertKey = display;
      const dir = parts.join("/") || ".";
      item.innerHTML = `<div class="cmd">@${display}</div><div class="desc">${dir}</div>`;
      item.onclick = () => {
        const before = this.inputTextarea.value.slice(0, this.inputTextarea.selectionStart);
        const after = this.inputTextarea.value.slice(this.inputTextarea.selectionStart);
        const atIdx = before.lastIndexOf("@");
        this.inputTextarea.value = before.slice(0, atIdx) + "@" + insertKey + " " + after;
        this.inputTextarea.focus();
        const pos = before.slice(0, atIdx).length + insertKey.length + 2;
        this.inputTextarea.selectionStart = this.inputTextarea.selectionEnd = pos;
        this.hideAtMenu();
      };
      this.atMenuEl.appendChild(item);
    }
    const browse = el("div", { className: "item" });
    browse.innerHTML = `<div class="cmd">@file</div><div class="desc">Browse for file...</div>`;
    browse.onclick = () => {
      vscode.postMessage({ type: "show-file-picker" });
      this.hideAtMenu();
    };
    this.atMenuEl.appendChild(browse);
  }

  private createStatusBar(): HTMLElement {
    const bar = el("div", { className: "flex items-center gap-1.5 px-3 py-0.5 text-label text-on-surface-variant border-t border-outline-variant shrink-0" });

    this.infoBtn = el("button", { className: "bg-transparent border-none text-on-surface-variant cursor-pointer text-sm p-0 leading-none transition-colors duration-150 hover:text-on-surface", title: "Show session state" }, [txt("ⓘ")]);
    this.infoBtn.onclick = () => this.showStateModal();

    this.statusDot = el("span", { className: "dot w-1.5 h-1.5 rounded-full shrink-0 ready" });
    this.statusText = el("span", { style: "flex:1" }, [txt("Ready")]);
    bar.append(this.infoBtn, this.statusDot, this.statusText);
    return bar;
  }

  private setStatus(state: "ready" | "busy" | "error", text: string): void {
    this.statusDot.className = "w-1.5 h-1.5 rounded-full shrink-0 " + state;
    this.statusText.textContent = text;
  }

  private showDiffModal(sessionId: string): void {
    this.overlayEl.innerHTML = "";
    this.overlayEl.classList.remove("hidden");

    const modal = el("div", { className: "modal wide" });
    modal.appendChild(el("h3", {}, [txt("Session Changes")]));
    const body = el("div", { className: "modal-body" });

    const loadingEl = el("div", { className: "row" }, [txt("Loading diff...")]);
    body.appendChild(loadingEl);
    modal.appendChild(body);

    const closeBtn = el("button", { className: "close-btn" }, [txt("Close")]);
    closeBtn.onclick = () => this.overlayEl.classList.add("hidden");
    modal.appendChild(closeBtn);
    this.overlayEl.appendChild(modal);

    this.overlayEl.onclick = (e) => {
      if (e.target === this.overlayEl) this.overlayEl.classList.add("hidden");
    };

    this.pendingDiffResolve = (diffs) => {
      body.innerHTML = "";
      if (!diffs.length) {
        body.appendChild(el("div", { className: "row" }, [txt("No file changes in this session")]));
        return;
      }
      for (const d of diffs) {
        const section = el("div", { className: "diff-section" });
        const hdr = el("div", { className: "diff-header" });
        hdr.appendChild(el("span", { className: "diff-file" }, [txt(d.file)]));
        const stats = el("span", { className: "diff-stats" });
        const add = el("span", { style: "color:#22c55e" }, [txt("+" + d.additions)]);
        const del = el("span", { style: "color:#ef4444;margin-left:4px" }, [txt("-" + d.deletions)]);
        stats.append(add, del);
        hdr.appendChild(stats);
        section.appendChild(hdr);
        body.appendChild(section);
      }
    };
  }

  private showProvidersModal(): void {
    this.overlayEl.innerHTML = "";
    this.overlayEl.classList.remove("hidden");

    const modal = el("div", { className: "modal" });
    modal.appendChild(el("h3", {}, [txt("Providers")]));
    const body = el("div", { className: "modal-body" });

    const loadingEl = el("div", { className: "row" }, [txt("Loading providers...")]);
    body.appendChild(loadingEl);
    modal.appendChild(body);

    const closeBtn = el("button", { className: "close-btn" }, [txt("Close")]);
    closeBtn.onclick = () => this.overlayEl.classList.add("hidden");
    modal.appendChild(closeBtn);
    this.overlayEl.appendChild(modal);

    this.overlayEl.onclick = (e) => {
      if (e.target === this.overlayEl) this.overlayEl.classList.add("hidden");
    };

    this.pendingProviderResolve = (providers) => {
      body.innerHTML = "";
      if (!providers.length) {
        body.appendChild(el("div", { className: "row" }, [txt("No providers found")]));
        return;
      }
      for (const p of providers) {
        const section = el("div", { className: "row", style: "flex-direction:column;gap:2px;padding:6px 0" });
        const nameRow = el("div", { style: "display:flex;justify-content:space-between;width:100%" });
        nameRow.appendChild(el("span", { className: "value" }, [txt(p.name || p.id)]));
        nameRow.appendChild(el("span", { className: "value" }, [txt(p.modelCount + " models")]));
        section.appendChild(nameRow);
        if (p.key) {
          const masked = p.key.length > 8 ? p.key.slice(0, 4) + "..." + p.key.slice(-4) : "***";
          section.appendChild(el("span", { style: "font-size:11px;opacity:.6" }, [txt("Key: " + masked)]));
        }
        body.appendChild(section);
      }
    };
  }

  private showStateModal(): void {
    const s = this.state;
    const currentSession = s.sessions.find(x => x.id === s.currentSessionId);

    this.overlayEl.innerHTML = "";
    this.overlayEl.classList.remove("hidden");

    const modal = el("div", { className: "bg-surface-container-low border border-outline-variant rounded-lg p-5" });
    modal.appendChild(el("h3", { className: "text-headline mb-3" }, [txt("OpenCode State")]));

    const rows: [string, string][] = [
      ["CLI Installed", s.isInstalled ? "Yes" : "No"],
      ["CLI Version", s.opencodeVersion || "—"],
      ["Status", s.isRunning ? "Running" : "Ready"],
      ["Current Session", currentSession?.title || "None"],
      ["Session ID", s.currentSessionId ? s.currentSessionId.slice(0, 12) + "…" : "—"],
      ["Messages", String(s.messages.length)],
      ["Total Sessions", String(s.sessionCount)],
      ["Selected Model", s.selectedModel || "Default"],
      ["Selected Agent", s.selectedAgent || "Default"],
    ];

    for (const [label, value] of rows) {
      const row = el("div", { className: "flex gap-3 py-1 text-xs" });
      row.appendChild(el("span", { className: "font-medium text-on-surface-variant min-w-[110px]" }, [txt(label)]));
      row.appendChild(el("span", { className: "text-on-surface" }, [txt(value)]));
      modal.appendChild(row);
    }

    const closeBtn = el("button", { className: "mt-4 w-full bg-primary text-on-primary border-none py-2.5 text-label font-bold rounded-lg cursor-pointer font-ui transition-all duration-150 hover:bg-primary/85 shadow-[0_4px_12px_rgba(173,198,255,0.15)]" }, [txt("Close")]);
    closeBtn.onclick = () => this.overlayEl.classList.add("hidden");
    modal.appendChild(closeBtn);
    this.overlayEl.appendChild(modal);

    this.overlayEl.onclick = (e) => {
      if (e.target === this.overlayEl) this.overlayEl.classList.add("hidden");
    };
  }

  private renderMessages(): void {
    this.chatArea.innerHTML = "";
    if (!this.state.messages.length) {
      this.chatArea.appendChild(el("div", { className: "empty" }, [
        txt("Start a conversation with OpenCode."),
        el("div", { className: "cmd-hint" }, [txt("Type / for commands · Cmd ▼ for actions")]),
      ]));
      return;
    }
    for (const msg of this.state.messages) this.appendMessageDOM(msg.role, msg.content, msg.parts, msg.model, msg.time, msg.id);
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  private appendMessageDOM(role: string, content: string, parts?: unknown[], model?: string, time?: number, msgId?: string): void {
    if (!content && (!parts || !parts.length)) return;
    const div = el("div", { className: "msg " + role + " group" });

    // avatar — per ai-chat-with-question.html design
    const avatarWrap = el("div", { className: "avatar-wrap" });
    const avatar = el("div", { className: "avatar" });
    avatar.innerHTML = role === "user" ? "&#x1F464;" : "&#x25C7;";
    avatarWrap.appendChild(avatar);
    div.appendChild(avatarWrap);

    // bubble-wrap (per ai-chat-with-question.html design)
    const bubbleWrap = el("div", { className: "bubble-wrap" });
    const bubble = el("div", { className: "bubble" });

    // role label
    const labelEl = el("div", { className: "role-label" });
    if (role === "user") {
      labelEl.innerHTML = "<span class='name'>You</span>";
    } else {
      const name = model || "OpenCode";
      const ts = time ? " <span class='time'>\u00B7 " + fmtTime(time) + "</span>" : "";
      labelEl.innerHTML = "<span class='name'>" + name + "</span>" + ts;
    }
    bubble.appendChild(labelEl);

    // parts (tool calls, reasoning, text — in array order)
    let foundParts = false;
    if (parts) for (const part of parts as Record<string, unknown>[]) {
      foundParts = true;
      if (part.type === "text" || part.type === "content") {
        const t = (part as any).text || (part as any).content || "";
        if (t) {
          const textEl = el("div", { className: "text" });
          textEl.appendChild(renderMarkdown(t));
          bubble.appendChild(textEl);
        }
        continue;
      }
      if ((part.type === "tool_use" || part.type === "tool-call" || part.type === "tool") && (part as any).tool === "question") {
        const st = (part as any).state as Record<string, unknown> | undefined;
        const inp = (st?.input || part.input || {}) as Record<string, unknown>;
        const qArr = inp.questions as Array<Record<string, unknown>> | undefined;
        const qs = (qArr && qArr.length) ? qArr : [inp];
        bubble.appendChild(this.renderQuestionCard(qs, true));
      } else if ((part.type === "tool_use" || part.type === "tool-call" || part.type === "tool") && (part as any).tool === "task") {
        bubble.appendChild(this.renderTaskCard(part as Record<string, unknown>));
      } else if (part.type === "tool_use" || part.type === "tool-call") {
        const tc = el("div", { className: "tool-call" });
        const name = (part as any).name || (part as any).tool || "unknown";
        tc.appendChild(el("div", { className: "tool-name" }, [txt("\u2699 Tool: " + name)]));
        tc.appendChild(el("div", { className: "tool-input" }, [txt(JSON.stringify((part as any).input || (part as any).arguments || {}, null, 2))]));
        bubble.appendChild(tc);
      }
      if (part.type === "tool_result" || part.type === "tool-result") {
        const tr = el("div", { className: "tool-result" });
        tr.appendChild(el("div", { className: "tool-result-content" }, [txt(String((part as any).content || (part as any).result || ""))]));
        bubble.appendChild(tr);
      }
      if (part.type === "reasoning") {
        const rc = document.createElement("div");
        rc.className = "reasoning";
        const hdr = document.createElement("div");
        hdr.className = "reasoning-header";
        const hdrLeft = el("div", { className: "reasoning-header-left" });
        const pTime = (part as any).time as Record<string, unknown> | undefined;
        let durStr = "...";
        if (pTime && typeof pTime.start === "number" && typeof pTime.end === "number") {
          const ms = (pTime.end as number) - (pTime.start as number);
          if (ms < 1000) durStr = Math.round(ms) + "ms";
          else durStr = Math.round(ms / 1000) + "s";
        }
        hdrLeft.innerHTML = '<span class="icon">\uD83D\uDCA1</span> <span>Reasoned for ' + durStr + '</span>';
        hdr.appendChild(hdrLeft);
        const chevron = el("span", { className: "reasoning-chevron" });
        chevron.textContent = "\u23F7"; // ⏷ expand_more
        hdr.appendChild(chevron);
        const body = document.createElement("div");
        body.className = "reasoning-body";
        body.textContent = String((part as any).text || "");
        hdr.onclick = () => {
          const open = body.classList.toggle("open");
          chevron.classList.toggle("open", open);
        };
        rc.append(hdr, body);
        bubble.appendChild(rc);
      }
      if (part.type === "step-finish") {
        const sf = el("div", { className: "step-finish" });
        const reason = (part as any).reason || "stop";
        const tokens = (part as any).tokens as Record<string, unknown> | undefined;
        const cost = (part as any).cost as number | undefined;
        let info = "Step finished: " + reason;
        if (tokens) info += " \u00B7 " + ((tokens as any).total || 0) + " tokens";
        if (cost) info += " \u00B7 $" + cost;
        sf.textContent = info;
        bubble.appendChild(sf);
      }
    }
    // fallback: no parts but content exists (old-style messages)
    if (!foundParts && content) {
      const textEl = el("div", { className: "text" });
      textEl.appendChild(renderMarkdown(content));
      bubble.appendChild(textEl);
    }

    // pending question card (ai-chat-with-question.html design)
    if (role === "assistant" && this.state.pendingQuestion) {
      const qs = this.state.pendingQuestion.questions as Array<Record<string, unknown>>;
      if (qs && qs.length) bubble.appendChild(this.renderQuestionCard(qs, false));
    }

    bubbleWrap.appendChild(bubble);

    // message actions (ai-chat-with-question.html line 259-268)
    const actions = el("div", { className: "msg-actions" });
    // copy for both roles
    const copyAct = el("button", { className: "msg-action", title: "Copy message" });
    copyAct.innerHTML = "&#x1F4CB;";
    copyAct.onclick = () => {
      const txt = content || (parts ? parts.map((p: any) => p.text || "").filter(Boolean).join("\n") : "") || "";
      navigator.clipboard.writeText(txt).catch(() => {});
    };
    actions.appendChild(copyAct);
    // revert only for user
    if (role === "user") {
      const revertAct = el("button", { className: "msg-action", title: "Revert" });
      revertAct.innerHTML = "&#x21A9;";
      revertAct.onclick = () => {
        this.inputTextarea.value = content || "";
        this.inputTextarea.focus();
        this.inputTextarea.style.height = "auto";
        this.inputTextarea.style.height = this.inputTextarea.scrollHeight + "px";
      };
      actions.appendChild(revertAct);
    }
    // fork only for assistant
    if (role === "assistant" && msgId) {
      const forkAct = el("button", { className: "msg-action", title: "Fork from here" });
      forkAct.innerHTML = "&#x2442;";
      forkAct.onclick = () => {
        vscode.postMessage({ type: "fork-session", sessionId: this.state.currentSessionId, messageID: msgId });
      };
      actions.appendChild(forkAct);
    }
    bubbleWrap.appendChild(actions);

    div.appendChild(bubbleWrap);
    const emptyMsg = this.chatArea.querySelector(".empty");
    if (emptyMsg) emptyMsg.remove();
    this.chatArea.appendChild(div);
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  private showThinking(): void {
    if (this.streamingMsgEl) return;
    const emptyMsg = this.chatArea.querySelector(".empty");
    if (emptyMsg) emptyMsg.remove();
    const modelName = this.state.selectedModel || "OpenCode";
    this.streamingMsgEl = el("div", { className: "msg assistant group animate-pulse" });
    const avatarWrap = el("div", { className: "avatar-wrap" });
    const avatar = el("div", { className: "avatar" });
    avatar.innerHTML = "&#x25C7;";
    avatarWrap.appendChild(avatar);
    this.streamingMsgEl.appendChild(avatarWrap);
    const bubbleWrap = el("div", { className: "bubble-wrap" });
    const bubble = el("div", { className: "bubble" });
    const labelEl = el("div", { className: "role-label" });
    labelEl.innerHTML = "<span class='name'>" + modelName + '</span> <span class="time">\u00B7 Just now</span>';
    bubble.appendChild(labelEl);
    // thinking card per ai-chat-generation.html
    const thinking = el("div", { className: "thinking-card" });
    thinking.innerHTML = '<span class="spinner"></span> ' + modelName + ' is thinking...';
    bubble.appendChild(thinking);
    const stEl = el("div", { className: "streaming-status" });
    bubble.appendChild(stEl);
    bubbleWrap.appendChild(bubble);
    this.streamingMsgEl.appendChild(bubbleWrap);
    this.chatArea.appendChild(this.streamingMsgEl);
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  private appendStreaming(content: string): void {
    if (!this.streamingMsgEl) this.showThinking();
    // remove thinking card on first content
    const thinkingCard = this.streamingMsgEl!.querySelector(".thinking-card");
    if (thinkingCard) thinkingCard.remove();
    this.streamingMsgEl!.classList.add("streaming");
    this.streamingContent += content;
  }

  private appendStreamingTask(desc: string, status: string): void {
    if (!this.streamingMsgEl) this.appendStreaming("");
    const existing = this.streamingMsgEl!.querySelector(".streaming-status");
    if (!existing) return;
    const card = el("div", { className: "task-inline " + status });
    card.innerHTML = '<span class="dot"></span> ' + (desc || (status === "done" ? "Task complete" : "Running task..."));
    existing.appendChild(card);
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  private finalizeStreaming(): void {
    if (this.streamingMsgEl) {
      this.streamingMsgEl.innerHTML = "";
      const modelName = this.state.selectedModel || "OpenCode";
      const avatarWrap = el("div", { className: "avatar-wrap" });
      const avatar = el("div", { className: "avatar" });
      avatar.innerHTML = "&#x25C7;";
      avatarWrap.appendChild(avatar);
      this.streamingMsgEl.appendChild(avatarWrap);
      const bubbleWrap = el("div", { className: "bubble-wrap" });
      const bubble = el("div", { className: "bubble" });
      const labelEl = el("div", { className: "role-label" });
      labelEl.innerHTML = "<span class='name'>" + modelName + "</span>";
      bubble.appendChild(labelEl);
      if (this.streamingContent) {
        const textEl = el("div", { className: "text" });
        textEl.appendChild(renderMarkdown(this.streamingContent));
        bubble.appendChild(textEl);
      }
      bubbleWrap.appendChild(bubble);
      this.streamingMsgEl.appendChild(bubbleWrap);
      this.streamingMsgEl.classList.remove("streaming", "animate-pulse");
      this.streamingMsgEl = null;
    }
  }

  private sendCommand(cmd: string): void {
    this.inputTextarea.value = "";
    this.state.messages.push({ role: "user", content: cmd });
    this.renderMessages();
    this.state.isRunning = true;
    this.updateRunningState();
    this.setStatus("busy", "Running command...");
    vscode.postMessage({
      type: "send-message",
      text: cmd,
      sessionId: this.state.currentSessionId || undefined,
      model: this.state.selectedModel || undefined,
      agent: this.state.selectedAgent || undefined,
      variant: this.state.selectedVariant || undefined,
    });
  }

  private runCliQuick(cmd: string): void {
    this.state.messages.push({ role: "user", content: "$ " + cmd });
    this.renderMessages();
    this.setStatus("busy", "Running...");
    vscode.postMessage({ type: "run-cli", command: cmd });
  }

  private answerQuestion(answer: string): void {
    this.state.pendingQuestion = null;
    this.state.messages.push({ role: "user", content: answer });
    this.state.isRunning = true;
    this.updateRunningState();
    this.setStatus("busy", "Waiting for response...");
    this.streamingMsgEl = null;
    vscode.postMessage({
      type: "send-message",
      text: answer,
      sessionId: this.state.currentSessionId || undefined,
      model: this.state.selectedModel || undefined,
      agent: this.state.selectedAgent || undefined,
      variant: this.state.selectedVariant || undefined,
    });
    this.renderMessages();
  }

  private renderQuestionCard(questions: Array<Record<string, unknown>>, readOnly: boolean): HTMLElement {
    const qDiv = el("div", { className: "question-card" });
    const answers: Record<number, string> = {};
    const multiSelected: Record<number, Set<string>> = {};

    questions.forEach((q, idx) => {
      const qText = (q.question as string) || (q.text as string) || "";
      const optsRaw = q.options as Array<Record<string, unknown>> | string[] | undefined;
      const qOpts = optsRaw ? optsRaw.map(o => typeof o === "string" ? o : String((o as any).label || "")) : undefined;
      const qType = (q.type as string) || (qOpts ? "select" : "text");
      if (!qText) return;

      const section = el("div", { className: "q-section" });
      const label = el("div", { className: "q-label" }, [txt((idx + 1) + ". " + qText)]);
      section.appendChild(label);

      if (qType === "select" && qOpts) {
        const pills = el("div", { className: "q-pills" });
        for (const opt of qOpts) {
          const btn = el("button", { className: "q-pill" }, [txt(opt)]);
          btn.onclick = () => {
            if (readOnly) return;
            pills.querySelectorAll(".q-pill").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
            answers[idx] = opt;
          };
          pills.appendChild(btn);
        }
        section.appendChild(pills);
      } else if (qType === "multiselect" && qOpts) {
        const grid = el("div", { className: "q-grid" });
        const sel = new Set<string>();
        multiSelected[idx] = sel;
        for (const opt of qOpts) {
          const lbl = el("label", { className: "q-chk" });
          const box = el("div", { className: "q-chk-box" });
          box.innerHTML = "<span class='icon'>\u2713</span>";
          lbl.appendChild(box);
          lbl.appendChild(txt(opt));
          lbl.onclick = () => {
            if (readOnly) return;
            const on = box.classList.toggle("checked");
            if (on) sel.add(opt); else sel.delete(opt);
          };
          grid.appendChild(lbl);
        }
        section.appendChild(grid);
      } else {
        const inp = el("textarea", { className: "q-input", placeholder: "Describe...", rows: "2" }) as HTMLTextAreaElement;
        inp.oninput = () => { answers[idx] = inp.value; };
        section.appendChild(inp);
      }
      qDiv.appendChild(section);
    });

    // bottom textarea for custom plan
    const bottomSection = el("div", { className: "q-section" });
    bottomSection.appendChild(el("div", { className: "q-label" }, [txt("Write your own plan")]));
    const planInp = el("textarea", { className: "q-input", placeholder: "Describe your specific requirements...", rows: "3" }) as HTMLTextAreaElement;
    bottomSection.appendChild(planInp);
    qDiv.appendChild(bottomSection);

    // submit button
    const okBtn = el("button", { className: "q-submit" }, [txt("Submit Answers")]);
    okBtn.onclick = () => {
      if (readOnly) return;
      const lines: string[] = [];
      questions.forEach((_, idx) => {
        const a = answers[idx] || (multiSelected[idx] ? Array.from(multiSelected[idx]).join(", ") : "");
        if (a) lines.push((idx + 1) + ". " + a);
      });
      if (planInp.value.trim()) lines.push("Plan: " + planInp.value.trim());
      this.answerQuestion(lines.length ? lines.join("\n") : planInp.value.trim() || "Submitted");
    };
    qDiv.appendChild(okBtn);

    if (readOnly) qDiv.style.opacity = ".6";
    return qDiv;
  }

  private renderTaskCard(part: Record<string, unknown>): HTMLElement {
    const p = part as any;
    const st = (p.state || {}) as Record<string, unknown>;
    const inp = (st.input || {}) as Record<string, unknown>;
    const desc = (inp.description as string) || "";
    const agentType = (inp.subagent_type as string) || "";
    const status = (st.status as string) || "";
    const errMsg = (st.error as string) || "";
    const output = (st.output as string) || "";
    const isDone = status === "completed";
    const isError = status === "error" || status === "cancelled";
    const isWorking = !isDone && !isError;
    const title = (st.title as string) || desc || "Task";

    const card = el("div", { className: "task-card" });

    // header (chat-with-to-do.html design)
    const hdr = el("div", { className: "task-header" });
    const hdrLeft = el("div", { className: "task-header-left" });
    const iconContainer = el("div", { className: "task-icon-container" + (isWorking ? " working" : "") });
    iconContainer.innerHTML = isDone ? "&#x2714;" : isError ? "&#x2718;" : "&#x25CB;";
    hdrLeft.appendChild(iconContainer);
    const titleSection = el("div", { className: "task-title-section" });
    const titleEl = el("span", { className: "task-title" }, [txt(title)]);
    titleSection.appendChild(titleEl);
    const subtitle = el("span", { className: "task-subtitle" });
    subtitle.textContent = isDone ? "Completed" : isError ? "Failed" : "Working...";
    titleSection.appendChild(subtitle);
    hdrLeft.appendChild(titleSection);
    hdr.appendChild(hdrLeft);
    const chevron = el("span", { className: "task-chevron" });
    chevron.textContent = "\u23F7"; // ⏷ expand_more
    hdr.appendChild(chevron);
    card.appendChild(hdr);

    // collapsible body
    const body = el("div", { className: "task-body hidden" });

    // main task item
    const item = el("div", { className: "task-item " + (isWorking ? "working" : isDone ? "done" : "pending") });
    const itemIcon = el("div", { className: "task-item-icon" });
    if (isWorking) {
      itemIcon.className = "task-item-icon pulsing";
    } else if (isDone) {
      itemIcon.className = "task-item-icon checked";
      itemIcon.textContent = "\u2714";
    } else {
      itemIcon.className = "task-item-icon unchecked";
    }
    item.appendChild(itemIcon);
    const label = el("span", { className: "task-item-label" + (isDone ? " done" : isWorking ? " active" : "") });
    label.textContent = title;
    item.appendChild(label);
    const ibadge = el("span", { className: "task-item-badge " + (isWorking ? "working" : isDone ? "done" : "pending") });
    ibadge.textContent = isWorking ? "Working" : isDone ? "Done" : "Pending";
    item.appendChild(ibadge);
    body.appendChild(item);

    // extra info items
    if (desc && desc !== title) {
      const infoItem = el("div", { className: "task-item pending" });
      const infoIcon = el("div", { className: "task-item-icon unchecked" });
      infoIcon.textContent = "\u2139";
      infoItem.appendChild(infoIcon);
      const infoLabel = el("span", { className: "task-item-label" }, [txt(desc)]);
      infoItem.appendChild(infoLabel);
      body.appendChild(infoItem);
    }
    if (agentType) {
      const agentItem = el("div", { className: "task-item pending" });
      const agentIcon = el("div", { className: "task-item-icon unchecked" });
      agentIcon.textContent = "\u2699";
      agentItem.appendChild(agentIcon);
      const agentLabel = el("span", { className: "task-item-label" }, [txt("Agent: " + agentType)]);
      agentItem.appendChild(agentLabel);
      body.appendChild(agentItem);
    }
    if (output) {
      const outEl = el("div", { className: "task-output" }, [txt(
        output.length > 300 ? output.slice(0, 300) + "..." : output
      )]);
      body.appendChild(outEl);
    }
    if (errMsg) {
      body.appendChild(el("div", { className: "task-error" }, [txt("\u26A0 " + errMsg)]));
    }
    card.appendChild(body);

    hdr.onclick = () => {
      body.classList.toggle("hidden");
      chevron.classList.toggle("open");
    };

    return card;
  }

  private send(): void {
    let text = this.inputTextarea.value.trim();
    if (!text || this.state.isRunning) return;
    this.inputTextarea.value = "";
    this.inputTextarea.style.height = "auto";
    const isSlash = text.startsWith("/");
    // resolve @filename to full paths for sending
    text = text.replace(/(^|\s)@([\w.\-\\\/]+)/g, (match, before, name) => {
      const normalized = name.replace(/\//g, "\\");
      const found = this.state.workspaceFiles.find(f => f.endsWith(normalized) || f.endsWith(name));
      return found ? before + "@" + found : match;
    });
    this.state.messages.push({ role: "user", content: text });
    this.renderMessages();
    this.state.isRunning = true;
    this.updateRunningState();
    this.setStatus("busy", isSlash ? "Running command..." : "Waiting for response...");
    this.streamingMsgEl = null;
    vscode.postMessage({
      type: "send-message",
      text,
      sessionId: this.state.currentSessionId || undefined,
      model: this.state.selectedModel || undefined,
      agent: this.state.selectedAgent || undefined,
      variant: this.state.selectedVariant || undefined,
    });
    this.showThinking();
  }

  private newSession(): void {
    this.state.currentSessionId = null;
    this.state.messages = [];
    this.renderMessages();
    this.renderSessionList();
    this.inputTextarea.focus();
  }

  private switchSession(id: string): void {
    this.state.currentSessionId = id;
    this.state.showSessions = false;
    this.sessionsPanel.classList.add("hidden");
    this.state.messages = [];
    this.renderMessages();
    this.setStatus("busy", "Loading...");
    vscode.postMessage({ type: "load-messages", sessionId: id });
  }

  private deleteSession(id: string): void {
    vscode.postMessage({ type: "delete-session", sessionId: id });
    this.state.sessions = this.state.sessions.filter(s => s.id !== id);
    if (this.state.currentSessionId === id) this.newSession();
    else this.renderSessionList();
  }

  private updateRunningState(): void {
    this.sendBtn.style.display = this.state.isRunning ? "none" : "";
    this.abortBtn.style.display = this.state.isRunning ? "" : "none";
    this.inputTextarea.disabled = this.state.isRunning;
  }

  private handleMessage(msg: Record<string, unknown>): void {
    console.log(`[webview] handleMessage: type="${msg.type}"`, msg);
    try {
      switch (msg.type) {
        case "state":
          console.log(`[webview] state: isInstalled=${msg.isInstalled}, version=${msg.opencodeVersion}`);
          this.state.isInstalled = msg.isInstalled as boolean;
          this.state.opencodeVersion = (msg.opencodeVersion as string) || "";
          this.render();
          break;
        case "state-info":
          this.state.sessionCount = (msg.sessionCount as number) || 0;
          break;
        case "sessions":
          this.state.sessions = msg.sessions as Session[];
          this.state.sessionCount = this.state.sessions.length;
          console.log(`[webview] sessions: got ${this.state.sessions.length} sessions`);
          this.renderSessionList();
          break;
        case "models":
          this.state.models = msg.models as string[];
          console.log(`[webview] models: got ${this.state.models.length} models`);
          this.renderModels();
          break;
        case "agents":
          this.state.agents = msg.agents as string[];
          if (!this.state.selectedAgent && this.state.agents.includes("plan")) this.state.selectedAgent = "plan";
          console.log(`[webview] agents: got ${this.state.agents.length} agents`);
          this.renderAgents();
          break;
        case "session-loaded":
          this.state.currentSessionId = msg.sessionId as string;
          const raw = msg.messages as Record<string, unknown>[];
          this.state.messages = raw.map((m) => {
            const info = (m as any).info || {};
            const parts = (m.parts || info.parts) as unknown[] | undefined;
            let content = (m.content as string) || info.content || "";
            if (!content && parts) {
              content = parts
                .filter((p: any) => p.type === "text" || p.type === "content")
                .map((p: any) => p.text || p.content || "")
                .join("\n");
            }
            const role = (m.role as string) || info.role || "assistant";
            const model = info.modelID || (info.model && info.model.modelID) || "";
            const time = info.time && info.time.created ? Number(info.time.created) : undefined;
            const id = (m.id as string) || (info.id as string) || "";
            return { role, content, parts, model, time, id };
          });
          console.log(`[webview] session-loaded: id=${this.state.currentSessionId}, messages=${this.state.messages.length}`);
          this.renderMessages();
          this.renderSessionList();
          this.setStatus("ready", "Ready");
          break;
        case "new-session-ready":
          console.log("[webview] new-session-ready");
          this.newSession();
          break;
        case "response-start":
          console.log("[webview] response-start");
          this.state.isRunning = true;
          this.updateRunningState();
          this.setStatus("busy", "Generating...");
          if (!this.streamingMsgEl) this.showThinking();
          this.streamingContent = "";
          this.streamingSaved = false;
          break;
        case "response-chunk":
          console.log("[webview] response-chunk", msg.event);
          this.handleResponseChunk(msg.event as Record<string, unknown>);
          break;
        case "response-error":
          console.log(`[webview] response-error: ${msg.message}`);
          this.finalizeStreaming();
          this.state.messages.push({ role: "assistant", content: this.streamingContent || "Error: " + (msg.message as string) });
          this.renderMessages();
          this.state.isRunning = false;
          this.streamingContent = "";
          this.streamingSaved = false;
          this.updateRunningState();
          this.setStatus("error", "Error");
          break;
        case "response-end":
          console.log(`[webview] response-end streamingContentLen=${this.streamingContent.length} saved=${this.streamingSaved}`);
          this.finalizeStreaming();
          if (this.streamingContent && !this.streamingSaved) {
            this.state.messages.push({ role: "assistant", content: this.streamingContent });
          }
          this.state.isRunning = false;
          this.streamingContent = "";
          this.streamingSaved = false;
          this.renderMessages();
          this.updateRunningState();
          this.setStatus("ready", "Ready");
          break;
        case "session-id":
          console.log(`[webview] session-id: ${msg.sessionId}`);
          this.state.currentSessionId = msg.sessionId as string;
          break;
        case "aborted":
          console.log("[webview] aborted");
          this.finalizeStreaming();
          if (this.streamingContent && !this.streamingSaved) {
            this.state.messages.push({ role: "assistant", content: this.streamingContent });
          }
          this.state.isRunning = false;
          this.streamingContent = "";
          this.streamingSaved = false;
          this.renderMessages();
          this.updateRunningState();
          this.setStatus("ready", "Aborted");
          break;
        case "cli-result": {
          console.log(`[webview] cli-result: "${(msg.result as string || "").slice(0, 80)}..."`);
          const txt = (msg.result as string) || "Done";
          const wrapped = /[┌│└┐┘]/.test(txt) ? "```\n" + txt + "\n```" : txt;
          this.state.messages.push({ role: "assistant", content: wrapped });
          this.renderMessages();
          this.setStatus("ready", "Ready");
          break;
        }
        case "files":
          this.state.workspaceFiles = msg.files as string[];
          if (!this.atMenuEl.classList.contains("hidden")) {
            const val = this.inputTextarea.value;
            const cursor = this.inputTextarea.selectionStart;
            const before = val.slice(0, cursor);
            const atIdx = before.lastIndexOf("@");
            if (atIdx >= 0) {
              const query = before.slice(atIdx + 1).toLowerCase();
              this.renderAtMenu(query);
            }
          }
          break;
        case "file-picked": {
          const fp = msg.path as string;
          if (fp) {
            const name = fp.split(/[\\/]/).pop() || fp;
            this.inputTextarea.value += "@" + name + " ";
            this.inputTextarea.focus();
          }
          break;
        }
        case "session-created":
          console.log(`[webview] session-created: id=${(msg.session as any)?.id}`);
          this.state.sessions.unshift(msg.session as Session);
          this.renderSessionList();
          this.switchSession((msg.session as any)?.id);
          break;
        case "session-summarized":
          console.log(`[webview] session-summarized: id=${msg.sessionId}`);
          break;
        case "session-diff":
          console.log(`[webview] session-diff: ${(msg.diff as any[])?.length} files`);
          if (this.pendingDiffResolve) {
            this.pendingDiffResolve(msg.diff as FileDiff[]);
            this.pendingDiffResolve = null;
          }
          break;
        case "providers":
          console.log(`[webview] providers: ${(msg.providers as any[])?.length} providers`);
          if (this.pendingProviderResolve) {
            this.pendingProviderResolve(msg.providers as Array<{ id: string; name: string; key?: string; modelCount: number }>);
            this.pendingProviderResolve = null;
          }
          break;
        case "error":
          console.error(`[webview] error from extension: ${msg.message}`);
          break;
        default:
          console.log(`[webview] unknown message type: ${msg.type}`);
      }
    } catch (e) {
      console.error(`[webview] handleMessage ERROR: ${e}`);
    }
  }

  private handleResponseChunk(event: Record<string, unknown>): void {
    const type = (event.type as string) || "";
    const part = event.part as Record<string, unknown> | undefined;
    const content = (event.content as string) || (event.text as string) || (part?.text as string) || (part?.content as string) || "";
    const name = (event.name as string) || "";
    console.log(`[webview] handleResponseChunk: type="${type}" contentLen=${content.length} name="${name}"`);

    try {
      if (type === "content.text.delta" || type === "text" || type === "content") {
        if (content) this.appendStreaming(content);
      } else if (type === "reasoning") {
        const r = (event.text as string) || content || (part?.text as string) || "";
        if (r) this.appendStreaming(r);
      } else if (type === "message" || type === "message.complete") {
        this.finalizeStreaming();
        const info = (event.info as Record<string, unknown>) || {};
        const role = (event.role as string) || (info.role as string) || "assistant";
        const parts = (event.parts || info.parts) as unknown[] | undefined;
        let text = (event.content as string) || (event.text as string) || (info.content as string) || "";
        if (!text && parts) {
          text = (parts as any[])
            .filter((p: any) => p.type === "text")
            .map((p: any) => p.text || "")
            .join("\n");
        }
        this.streamingSaved = true;
        const model = (event.modelID as string) || (info.modelID as string) || (info.model && (info.model as any).modelID) || "";
        const time = (event.time && (event.time as any).created ? Number((event.time as any).created) : undefined) || (info.time && (info.time as any).created ? Number((info.time as any).created) : undefined);
        if (text || parts) { this.state.messages.push({ role, content: text, parts, model, time }); this.renderMessages(); }
      } else if (type === "tool_use_start" || type === "tool_use.start" || type === "tool-start") {
        if (name === "question" || name === "ask") {
          const raw = (event.input as Record<string, unknown>) || {};
          const qArr = raw.questions as Array<Record<string, unknown>> | undefined;
          this.state.pendingQuestion = {
            questions: (qArr && qArr.length) ? qArr : [raw],
            messageID: event.messageID as string,
            partID: event.id as string,
          };
          this.renderMessages();
        } else if (name === "task") {
          const inp = (event.input as Record<string, unknown>) || {};
          const desc = (inp.description as string) || "";
          this.appendStreamingTask(desc || "Task started...", "working");
        } else {
          const input = event.input ? JSON.stringify(event.input, null, 2) : "";
          this.appendStreaming("\n[" + (name || "tool") + ": " + input + "]\n");
        }
      } else if (type === "tool_result" || type === "tool-result") {
        const output = (event.content as string) || (event.output as string) || "";
        if (output && name === "task") this.appendStreamingTask("", "done");
      } else if (type === "stderr") {
        if (content) this.appendStreaming("\n[stderr: " + content + "]\n");
      } else if (type === "error") {
        const errMsg = (event.message as string) || content || "Unknown error";
        console.error(`[webview] error in response: ${errMsg}`);
        this.state.messages.push({ role: "assistant", content: "Error: " + errMsg });
        this.finalizeStreaming(); this.renderMessages();
      } else {
        console.log(`[webview] unhandled event type: "${type}"`);
      }
    } catch (e) {
      console.error(`[webview] handleResponseChunk error: ${e}`);
    }
  }

  private renderModels(): void {
    const pill = document.querySelector("[data-part='model-pill']");
    if (pill) pill.innerHTML = "<span class='icon'>&#x2699;</span> " + (this.state.selectedModel || "Model") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
  }

  private renderAgents(): void {
    const seg = this.root.querySelector("[data-part='agent-segmented']");
    if (!seg) return;
    seg.innerHTML = "";
    const defaultOrder = ["build", "plan", "compact"];
    const ags = this.state.agents.length ? [...this.state.agents].sort((a, b) => {
      const ia = defaultOrder.indexOf(a);
      const ib = defaultOrder.indexOf(b);
      if (ia !== -1 && ib !== -1) return ia - ib;
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      return 0;
    }) : ["build", "plan", "review"];
    if (!this.state.selectedAgent && ags.includes("plan")) this.state.selectedAgent = "plan";
    for (const a of ags) {
      const pill = el("button", { className: "shrink-0 flex items-center justify-center gap-1 text-label text-on-surface-variant bg-transparent border-none px-2.5 py-1 rounded-md cursor-pointer transition-all duration-150 whitespace-nowrap hover:text-primary" + (a === this.state.selectedAgent ? " active" : ""), "data-agent": a });
      pill.textContent = a.charAt(0).toUpperCase() + a.slice(1);
      pill.onclick = () => {
        this.state.selectedAgent = a;
        this.state.selectedVariant = "";
        seg.querySelectorAll("[data-agent]").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
      };
      seg.appendChild(pill);
    }
  }

  private listen(): void {
    window.addEventListener("message", (event) => {
      console.log("[webview] raw message event received", event.data);
      this.handleMessage(event.data as Record<string, unknown>);
    });
    console.log("[webview] listener attached");
  }
}

new App();
