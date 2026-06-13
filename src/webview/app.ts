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

interface Msg { role: string; content: string; parts?: unknown[]; model?: string; time?: number }

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
    this.root.appendChild(el("div", { className: "install-view" }, [
      el("h2", {}, [txt("OpenCode CLI Required")]),
      el("p", {}, [txt("Install the opencode CLI to use AI-powered coding assistance.")]),
      el("button", { id: "install-btn" }, [txt("Install OpenCode")]),
    ]));
    document.getElementById("install-btn")!.onclick = () => vscode.postMessage({ type: "install" });
  }

  private renderMain(): void {
    const header = this.createHeader();
    const agentBar = this.createAgentBar();
    this.sessionsPanel = el("div", { className: "sessions-panel" });
    this.sessionSearchInput = el("input", { className: "session-search", placeholder: "Search chats...", type: "text" }) as HTMLInputElement;
    this.sessionSearchInput.oninput = () => {
      this.state.sessionFilter = this.sessionSearchInput.value;
      this.renderSessionList();
    };
    this.sessionListEl = el("div", { className: "session-list" });
    this.sessionsPanel.append(this.sessionSearchInput, this.sessionListEl);
    this.chatArea = el("div", { className: "chat-area" });
    const inputArea = this.createInputArea();
    const statusBar = this.createStatusBar();
    this.overlayEl = el("div", { className: "overlay hidden" });
    this.root.append(header, agentBar, this.sessionsPanel, this.chatArea, inputArea, statusBar, this.overlayEl);
    this.renderMessages();
    this.renderSessionList();
    this.renderModels();
    this.renderAgents();
  }

  private createHeader(): HTMLElement {
    const hdr = el("header", { className: "header" });
    const left = el("div", { className: "header-left" });
    left.appendChild(el("span", { className: "brand" }, [txt("OpenCode")]));
    left.appendChild(el("span", { className: "version" }, [txt("v" + (this.state.opencodeVersion || "?"))]));
    hdr.appendChild(left);

    const right = el("div", { className: "header-right" });
    const sessBtn = el("button", { className: "header-btn", title: "Toggle sessions" });
    sessBtn.innerHTML = "Chat Sessions <span class='arrow'>▼</span>";
    sessBtn.onclick = () => {
      this.state.showSessions = !this.state.showSessions;
      this.sessionsPanel.classList.toggle("hidden", !this.state.showSessions);
      sessBtn.querySelector(".arrow")!.textContent = this.state.showSessions ? "▲" : "▼";
    };
    right.appendChild(sessBtn);
    const histBtn = el("button", { className: "header-btn", title: "History" });
    histBtn.innerHTML = "<span class='icon'>&#x1F4CB;</span>";
    histBtn.onclick = () => { this.state.showSessions = !this.state.showSessions; this.sessionsPanel.classList.toggle("hidden"); };
    right.appendChild(histBtn);
    hdr.appendChild(right);
    return hdr;
  }

  private createAgentBar(): HTMLElement {
    const bar = el("div", { className: "agent-bar" });
    const top = el("div", { className: "agent-bar-top" });
    const label = el("span", { className: "agent-bar-label" });
    label.innerHTML = "<span class='icon'>&#x2699;</span> Agent Mode";
    top.appendChild(label);
    const newBtn = el("button", { className: "new-chat-btn" });
    newBtn.innerHTML = "<span class='icon'>+</span> New Chat";
    newBtn.onclick = () => this.newSession();
    top.appendChild(newBtn);
    bar.appendChild(top);

    const seg = el("div", { className: "agent-segmented" });
    const ags = this.state.agents.length ? this.state.agents : ["build", "plan", "review"];
    if (!this.state.selectedAgent && ags.includes("plan")) this.state.selectedAgent = "plan";
    for (const a of ags) {
      const pill = el("button", { className: "agent-seg-btn" + (a === this.state.selectedAgent ? " active" : ""), "data-agent": a });
      pill.textContent = a.charAt(0).toUpperCase() + a.slice(1);
      pill.onclick = () => {
        this.state.selectedAgent = a;
        this.state.selectedVariant = "";
        seg.querySelectorAll(".agent-seg-btn").forEach(p => p.classList.remove("active"));
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
      this.sessionListEl.appendChild(el("div", { className: "session-empty" }, [txt(q ? "No chats match \"" + q + "\"" : "No chats yet")]));
      return;
    }
    // group by time: today, yesterday, older
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
      const section = el("div", { className: "session-group" });
      const hdr = el("div", { className: "session-group-header" }, [txt(g.label)]);
      section.appendChild(hdr);
      for (const s of g.items) {
        const item = el("div", { className: "session-item" + (s.id === this.state.currentSessionId ? " active" : "") });
        item.onclick = () => this.switchSession(s.id);

        const icon = el("div", { className: "session-item-icon" });
        icon.textContent = "\uD83D\uDCAC";
        item.appendChild(icon);

        const body = el("div", { className: "session-item-body" });
        const topRow = el("div", { className: "session-item-top" });
        const title = el("span", { className: "session-item-title" }, [txt(s.title || "Untitled")]);
        const ts = el("span", { className: "session-item-time" }, [txt(fmtTime(new Date(s.updated_at || s.created_at || 0).getTime()))]);
        topRow.append(title, ts);
        body.appendChild(topRow);
        const msgCount = s.message_count ? s.message_count + " messages" : "";
        body.appendChild(el("div", { className: "session-item-sub" }, [txt(msgCount || s.title || "No messages")]));
        item.appendChild(body);

        const actions = el("div", { className: "session-item-actions" });
        const renameBtn = el("button", { className: "session-action-btn", title: "Rename" });
        renameBtn.textContent = "\u270F";
        renameBtn.onclick = (e) => {
          e.stopPropagation();
          const input = el("input", { className: "rename-input", value: s.title || "", type: "text" }) as HTMLInputElement;
          title.replaceWith(input);
          input.focus();
          input.select();
          const save = () => {
            const val = input.value.trim();
            if (val) s.title = val;
            this.renderSessionList();
          };
          input.onkeydown = (ev) => { if (ev.key === "Enter") save(); if (ev.key === "Escape") this.renderSessionList(); };
          input.onblur = save;
        };
        const delBtn = el("button", { className: "session-action-btn danger", title: "Delete" });
        delBtn.textContent = "\u2715";
        delBtn.onclick = (e) => { e.stopPropagation(); this.deleteSession(s.id); };
        actions.append(renameBtn, delBtn);
        item.appendChild(actions);

        section.appendChild(item);
      }
      this.sessionListEl.appendChild(section);
    }
  }

  private createInputArea(): HTMLElement {
    const container = el("div", { className: "input-container" });
    const inner = el("div", { className: "input-inner" });

    this.slashMenuEl = el("div", { className: "slash-menu hidden" });
    container.appendChild(this.slashMenuEl);
    this.atMenuEl = el("div", { className: "at-menu hidden" });
    container.appendChild(this.atMenuEl);

    // input toolbar row (model pill, variant pill)
    const inputToolbar = el("div", { className: "input-toolbar" });
    const modelPill = el("button", { className: "input-pill model-pill", title: "Selected model" });
    modelPill.innerHTML = "<span class='icon'>&#x2699;</span> " + (this.state.selectedModel || "Model") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
    const modelPopup = el("div", { className: "model-popup hidden" });
    const modelSearch = el("input", { className: "model-popup-search", placeholder: "Search models...", type: "text" }) as HTMLInputElement;
    const modelList = el("div", { className: "model-popup-list" });
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
        const gh = el("div", { className: "model-popup-group" }, [txt(prov)]);
        modelList.appendChild(gh);
        for (const m of items) {
          const opt = el("div", { className: "model-popup-opt" + (m === this.state.selectedModel ? " on" : "") }, [txt(m)]);
          opt.onclick = () => {
            this.state.selectedModel = m;
            modelPopup.classList.add("hidden");
            modelPill.innerHTML = "<span class='icon'>&#x2699;</span> " + (m || "Model") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
          };
          modelList.appendChild(opt);
        }
      }
      if (!filtered.length) modelList.appendChild(el("div", { className: "model-popup-opt dim" }, [txt("No models match")]));
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

    const variantPill = el("button", { className: "input-pill", title: "Variant" });
    variantPill.innerHTML = "<span class='icon'>&#x2699;</span> " + (this.state.selectedVariant || "Balanced") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
    this.variantPopup = el("div", { className: "variant-popup hidden" });
    const vars = VARIANTS.filter(Boolean);
    for (const v of vars) {
      const opt = el("div", { className: "variant-opt" + (v === this.state.selectedVariant ? " on" : "") }, [txt(v)]);
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

    // variant popup (dropdown positioned near input pills)
    container.appendChild(this.variantPopup);

    // textarea main area
    const inputMain = el("div", { className: "input-main" });
    this.inputTextarea = el("textarea", { placeholder: "Ask a question or type /", rows: "1" }) as HTMLTextAreaElement;
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

    // footer with attach, token count, send
    const footer = el("div", { className: "input-footer" });
    const left = el("div", { className: "input-footer-left" });
    const attachBtn = el("button", { className: "input-footer-btn", title: "Attach file" });
    attachBtn.innerHTML = "<span class='icon'>&#x1F4CE;</span>";
    left.appendChild(attachBtn);
    const ssBtn = el("button", { className: "input-footer-btn", title: "Screenshot" });
    ssBtn.innerHTML = "<span class='icon'>&#x1F4F7;</span>";
    left.appendChild(ssBtn);
    left.appendChild(el("div", { className: "input-footer-sep" }));
    const tokenBadge = el("div", { className: "token-badge" });
    tokenBadge.innerHTML = "<span class='icon'>&#x1F4CA;</span> 1.2k tokens";
    left.appendChild(tokenBadge);
    footer.appendChild(left);

    const right = el("div", { className: "input-actions" });
    const actions = el("div", { className: "input-actions" });
    this.abortBtn = el("button", { className: "abort-btn", style: "display:none", title: "Abort" });
    this.abortBtn.textContent = "\u25A0";
    this.abortBtn.onclick = () => vscode.postMessage({ type: "abort" });
    actions.appendChild(this.abortBtn);

    this.sendBtn = el("button", { className: "send-btn", title: "Send" });
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
    const q = query.replace(/\//g, "\\");
    const files = this.state.workspaceFiles.filter(f => !q || f.toLowerCase().includes(q));
    if (files.length === 0) {
      const browse = el("div", { className: "item" });
      browse.innerHTML = `<div class="cmd">@file</div><div class="desc">Browse for file...</div>`;
      browse.onclick = () => {
        vscode.postMessage({ type: "show-file-picker" });
        this.hideAtMenu();
      };
      this.atMenuEl.appendChild(browse);
      return;
    }
    for (const f of files.slice(0, 20)) {
      const item = el("div", { className: "item" });
      const parts = f.split(/[\\/]/);
      const name = parts.pop() || f;
      let display: string;
      let insertKey: string;
      if (parts.length === 0) {
        display = name;
        insertKey = name;
      } else {
        const parent = parts[parts.length - 1];
        display = parent + "/" + name;
        insertKey = parent + "/" + name;
      }
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
    const bar = el("div", { className: "status-bar" });

    this.infoBtn = el("button", { className: "info-btn", title: "Show session state" }, [txt("ⓘ")]);
    this.infoBtn.onclick = () => this.showStateModal();

    this.statusDot = el("span", { className: "dot ready" });
    this.statusText = el("span", { style: "flex:1" }, [txt("Ready")]);
    bar.append(this.infoBtn, this.statusDot, this.statusText);
    return bar;
  }

  private setStatus(state: "ready" | "busy" | "error", text: string): void {
    this.statusDot.className = "dot " + state;
    this.statusText.textContent = text;
  }

  private showStateModal(): void {
    const s = this.state;
    const currentSession = s.sessions.find(x => x.id === s.currentSessionId);

    this.overlayEl.innerHTML = "";
    this.overlayEl.classList.remove("hidden");

    const modal = el("div", { className: "modal" });
    modal.appendChild(el("h3", {}, [txt("OpenCode State")]));

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
      const row = el("div", { className: "row" });
      row.appendChild(el("span", { className: "label" }, [txt(label)]));
      row.appendChild(el("span", { className: "value" }, [txt(value)]));
      modal.appendChild(row);
    }

    const closeBtn = el("button", { className: "close-btn" }, [txt("Close")]);
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
    for (const msg of this.state.messages) this.appendMessageDOM(msg.role, msg.content, msg.parts, msg.model, msg.time);
    this.chatArea.scrollTop = this.chatArea.scrollHeight;
  }

  private appendMessageDOM(role: string, content: string, parts?: unknown[], model?: string, time?: number): void {
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
            return { role, content, parts, model, time };
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
    const pill = document.querySelector(".model-pill");
    if (pill) pill.innerHTML = "<span class='icon'>&#x2699;</span> " + (this.state.selectedModel || "Model") + " <span class='arrow' style='font-size:8px'>\u25BC</span>";
  }

  private renderAgents(): void {
    const seg = this.root.querySelector(".agent-segmented");
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
      const pill = el("button", { className: "agent-seg-btn" + (a === this.state.selectedAgent ? " active" : ""), "data-agent": a });
      pill.textContent = a.charAt(0).toUpperCase() + a.slice(1);
      pill.onclick = () => {
        this.state.selectedAgent = a;
        this.state.selectedVariant = "";
        seg.querySelectorAll(".agent-seg-btn").forEach(p => p.classList.remove("active"));
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
