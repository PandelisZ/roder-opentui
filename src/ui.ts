import { BoxRenderable, createCliRenderer, InputRenderable, ScrollBoxRenderable, TextAttributes, TextRenderable, type CliRenderer } from "@opentui/core"
import type { RoderClient } from "./client"
import type { AppConfig, CommandsListResult, InitializeResult, ModelListResult, SkillsListResult, ThreadItem, ThreadListResult, ThreadReadResult, ThreadStartResult, ThreadSummary, ThreadStateResult, ToolsListResult, TurnStartResult } from "./types"

const palette = {
  bg: "#0b1020",
  panel: "#111827",
  panel2: "#0f172a",
  border: "#334155",
  accent: "#7c3aed",
  accent2: "#06b6d4",
  good: "#22c55e",
  warn: "#f59e0b",
  bad: "#ef4444",
  text: "#e5e7eb",
  mute: "#94a3b8",
}

type ViewName = "chat" | "threads" | "tools" | "commands" | "skills" | "models" | "logs" | "raw"

type LogEntry = { level: "info" | "error" | "event" | "command"; message: string }

export class RoderTui {
  private renderer!: CliRenderer
  private root!: BoxRenderable
  private header!: TextRenderable
  private status!: TextRenderable
  private nav!: TextRenderable
  private transcriptBox!: ScrollBoxRenderable
  private transcript!: TextRenderable
  private sideBox!: ScrollBoxRenderable
  private side!: TextRenderable
  private input!: InputRenderable
  private help!: TextRenderable

  private logs: LogEntry[] = []
  private threads: ThreadSummary[] = []
  private currentThread?: ThreadSummary
  private activeTurnId?: string
  private view: ViewName = "chat"
  private connected = false
  private init?: InitializeResult
  private mode = "unknown"
  private busy = false
  private commandMode = false
  private lastRaw: unknown

  constructor(private client: RoderClient, private config: AppConfig) {}

  async start() {
    this.renderer = await createCliRenderer({
      targetFps: 30,
      maxFps: 60,
      exitOnCtrlC: false,
      clearOnShutdown: true,
      useMouse: true,
      backgroundColor: palette.bg,
    })
    this.buildLayout()
    this.bindKeys()
    this.client.on(event => {
      if (event.type === "status") {
        this.connected = event.status === "connected"
        this.log("info", event.message)
      } else if (event.type === "error") {
        this.log("error", event.message)
      } else {
        this.handleNotification(event.method, event.params)
      }
      this.renderAll()
    })

    this.renderer.start()
    this.input.focus()
    this.renderAll()

    try {
      await this.client.connect()
      await this.bootstrap()
    } catch (error) {
      this.log("error", String(error instanceof Error ? error.message : error))
    }
    this.renderAll()
  }

  private buildLayout() {
    this.root = new BoxRenderable(this.renderer, {
      id: "root",
      width: "100%",
      height: "100%",
      flexDirection: "column",
      backgroundColor: palette.bg,
      padding: 1,
      gap: 1,
    })
    this.renderer.root.add(this.root)

    this.header = new TextRenderable(this.renderer, { id: "header", height: 1, fg: palette.text, attributes: TextAttributes.BOLD, content: "" })
    this.root.add(this.header)

    const main = new BoxRenderable(this.renderer, { id: "main", flexGrow: 1, flexDirection: "row", gap: 1 })
    this.root.add(main)

    this.transcriptBox = new ScrollBoxRenderable(this.renderer, {
      id: "transcriptBox",
      title: " conversation ",
      border: true,
      borderColor: palette.border,
      focusedBorderColor: palette.accent2,
      flexGrow: 1,
      scrollY: true,
      stickyScroll: true,
      stickyStart: "bottom",
      padding: 1,
      backgroundColor: palette.panel2,
    })
    this.transcript = new TextRenderable(this.renderer, { id: "transcript", width: "100%", content: "", fg: palette.text, wrapMode: "word" })
    this.transcriptBox.add(this.transcript)
    main.add(this.transcriptBox)

    const right = new BoxRenderable(this.renderer, { id: "right", width: 38, flexDirection: "column", gap: 1 })
    main.add(right)

    this.status = new TextRenderable(this.renderer, { id: "status", height: 8, content: "", fg: palette.text, wrapMode: "word" })
    const statusBox = new BoxRenderable(this.renderer, { id: "statusBox", title: " roder ", border: true, borderColor: palette.border, padding: 1, height: 10, backgroundColor: palette.panel })
    statusBox.add(this.status)
    right.add(statusBox)

    this.sideBox = new ScrollBoxRenderable(this.renderer, { id: "sideBox", title: " context ", border: true, borderColor: palette.border, flexGrow: 1, scrollY: true, padding: 1, backgroundColor: palette.panel })
    this.side = new TextRenderable(this.renderer, { id: "side", content: "", fg: palette.text, wrapMode: "word" })
    this.sideBox.add(this.side)
    right.add(this.sideBox)

    this.nav = new TextRenderable(this.renderer, { id: "nav", height: 1, content: "", fg: palette.mute })
    this.root.add(this.nav)

    this.input = new InputRenderable(this.renderer, {
      id: "input",
      height: 1,
      border: true,
      borderColor: palette.accent,
      focusedBorderColor: palette.accent2,
      placeholder: "Ask Roder, or type /help",
      fg: palette.text,
      bg: palette.panel,
    } as any)
    this.root.add(this.input)

    this.help = new TextRenderable(this.renderer, { id: "help", height: 1, fg: palette.mute, content: "" })
    this.root.add(this.help)
  }

  private bindKeys() {
    this.renderer.keyInput.on("keypress", key => {
      if (key.ctrl && key.name === "c") return this.shutdown()
      if (key.name === "tab") { this.cycleView(key.shift ? -1 : 1); key.preventDefault(); return }
      if (key.ctrl && key.name === "r") { void this.refresh(); key.preventDefault(); return }
      if (key.ctrl && key.name === "n") { void this.newThread(); key.preventDefault(); return }
      if (key.ctrl && key.name === "l") { this.logs = []; this.renderAll(); key.preventDefault(); return }
      if (key.ctrl && key.name === "s") { void this.interrupt(); key.preventDefault(); return }
      if (key.name === "enter") {
        const value = this.input.value.trim()
        this.input.value = ""
        if (value) void this.submit(value)
        key.preventDefault()
      }
    })
  }

  private async bootstrap() {
    this.init = await this.client.request<InitializeResult>("initialize")
    this.log("info", `Initialized ${this.init.provider}/${this.init.model}`)
    await this.refresh()
    if (!this.currentThread) await this.newThread(false)
  }

  private async refresh() {
    if (!this.connected) return
    try {
      const [threads, state] = await Promise.all([
        this.client.request<ThreadListResult>("thread/list", { limit: 50 }).catch(() => ({ data: [] })),
        this.client.request<ThreadStateResult>("thread/state").catch(() => ({ mode: "unknown" })),
      ])
      this.threads = threads.data ?? []
      this.mode = state.mode ?? "unknown"
      if (!this.currentThread && this.threads.length) this.currentThread = this.threads[0]
      if (this.currentThread) await this.loadThread(this.currentThread.id)
    } catch (error) {
      this.log("error", errText(error))
    }
    this.renderAll()
  }

  private async newThread(render = true) {
    const result = await this.client.request<ThreadStartResult>("thread/start", {
      cwd: this.config.cwd,
      model: this.config.model,
      modelProvider: this.config.provider,
      reasoning: this.config.reasoning,
      ephemeral: this.config.ephemeral,
    })
    this.currentThread = result.thread
    this.threads.unshift(result.thread)
    this.log("info", `Started thread ${short(result.thread.id)}`)
    if (render) this.renderAll()
  }

  private async loadThread(threadId: string) {
    const result = await this.client.request<ThreadReadResult>("thread/read", { threadId, includeTurns: true })
    if (result.thread) this.currentThread = result.thread
  }

  private async submit(text: string) {
    if (text.startsWith("/")) return this.runCommand(text)
    if (!this.currentThread) await this.newThread(false)
    if (!this.currentThread) return
    this.busy = true
    this.renderAll()
    try {
      const result = await this.client.request<TurnStartResult>("turn/start", {
        threadId: this.currentThread.id,
        input: [{ type: "text", text }],
        prompt: text,
        modelProvider: this.config.provider,
        model: this.config.model,
        reasoning: this.config.reasoning,
      })
      this.activeTurnId = result.turnId
      this.log("command", `turn/start ${short(result.turnId)}`)
      setTimeout(() => void this.pollThread(), 500)
    } catch (error) {
      this.busy = false
      this.log("error", errText(error))
    }
    this.renderAll()
  }

  private async pollThread() {
    if (!this.currentThread) return
    try {
      await this.loadThread(this.currentThread.id)
      const active = this.currentThread.status?.activeTurnId
      this.busy = Boolean(active)
      if (this.busy) setTimeout(() => void this.pollThread(), 900)
    } catch (error) {
      this.busy = false
      this.log("error", errText(error))
    }
    this.renderAll()
  }

  private async interrupt() {
    if (!this.currentThread) return
    try {
      await this.client.request("turn/interrupt", { threadId: this.currentThread.id, turnId: this.activeTurnId ?? this.currentThread.status?.activeTurnId ?? null })
      this.busy = false
      this.log("command", "turn/interrupt")
    } catch (error) { this.log("error", errText(error)) }
    this.renderAll()
  }

  private async runCommand(raw: string) {
    const [cmd, ...rest] = raw.slice(1).split(/\s+/)
    const args = rest.join(" ")
    this.log("command", raw)
    try {
      switch (cmd) {
        case "help": this.view = "commands"; break
        case "new": await this.newThread(false); break
        case "threads": this.view = "threads"; break
        case "thread": await this.loadThread(args || this.currentThread?.id || ""); break
        case "models": this.view = "models"; this.lastRaw = await this.client.request<ModelListResult>("model/list"); break
        case "tools": this.view = "tools"; this.lastRaw = await this.client.request<ToolsListResult>("tools/list"); break
        case "commands": this.view = "commands"; this.lastRaw = await this.client.request<CommandsListResult>("commands/list"); break
        case "skills": this.view = "skills"; this.lastRaw = await this.client.request<SkillsListResult>("skills/list"); break
        case "logs": this.view = "logs"; break
        case "raw": await this.raw(args); break
        case "mode": await this.client.request("thread/set_mode", { mode: args || "default", reason: "set from roder-opentui" }); await this.refresh(); break
        case "approve": await this.client.request("thread/resolve_approval", { approvalId: rest[0], approved: true }); break
        case "reject": await this.client.request("thread/resolve_approval", { approvalId: rest[0], approved: false }); break
        case "exit-plan": await this.client.request("thread/exit_plan", { requestId: rest[0], approved: rest[1] !== "false" }); break
        case "clear": this.logs = []; break
        case "quit": this.shutdown(); return
        default: this.log("error", `Unknown command: /${cmd}`)
      }
    } catch (error) { this.log("error", errText(error)) }
    this.renderAll()
  }

  private async raw(args: string) {
    const space = args.indexOf(" ")
    const method = space === -1 ? args : args.slice(0, space)
    const paramsText = space === -1 ? "" : args.slice(space + 1)
    if (!method) throw new Error("Usage: /raw method {jsonParams}")
    const params = paramsText ? JSON.parse(paramsText) : undefined
    this.lastRaw = await this.client.request(method, params)
    this.view = "raw"
  }

  private handleNotification(method: string, params: unknown) {
    this.log("event", `${method} ${compact(params)}`)
    if (method.startsWith("thread/") || method.includes("turn")) setTimeout(() => void this.refresh(), 250)
  }

  private renderAll() {
    this.header.content = ` Roder OpenTUI  ${this.connected ? "●" : "○"} ${this.config.url}  cwd ${this.config.cwd}`
    this.status.content = [
      `${this.connected ? "connected" : "offline"} ${this.busy ? "• running" : "• idle"}`,
      `thread ${this.currentThread ? short(this.currentThread.id) : "none"}`,
      `mode ${this.mode}`,
      `model ${this.config.provider ?? this.init?.provider ?? "?"}/${this.config.model ?? this.init?.model ?? "?"}`,
      `turn ${this.activeTurnId ? short(this.activeTurnId) : this.currentThread?.status?.activeTurnId ? short(this.currentThread.status.activeTurnId) : "-"}`,
      `threads ${this.threads.length}`,
    ].join("\n")
    this.nav.content = ` views: chat threads tools commands skills models logs raw   active: ${this.view}   keys: tab switch • ctrl-n new • ctrl-r refresh • ctrl-s stop • ctrl-c quit`
    this.help.content = " Slash: /new /threads /thread <id> /models /tools /commands /skills /mode <default|plan|ask> /raw <method> <json> /quit"
    this.transcript.content = this.renderTranscript()
    this.side.content = this.renderSide()
    this.renderer.requestRender()
  }

  private renderTranscript(): string {
    if (this.view !== "chat") return this.renderView()
    if (!this.currentThread) return "No thread yet. Type a message or /new."
    const turns = this.currentThread.turns ?? []
    if (!turns.length) return `Thread ${this.currentThread.id}\n\nSend a message to start.`
    return turns.map(turn => {
      const items = (turn.items ?? []).map(item => this.renderItem(item)).join("\n")
      return `╭─ turn ${short(turn.id)} ${turn.status}\n${items}\n╰─`
    }).join("\n\n")
  }

  private renderItem(item: ThreadItem): string {
    const t = String((item as any).type ?? "raw")
    if (t === "userMessage") return `You\n${indent((item as any).text ?? "")}`
    if (t === "agentMessage") return `Roder${(item as any).phase ? ` [${(item as any).phase}]` : ""}\n${indent((item as any).text ?? "")}`
    if (t === "reasoning") return `Reasoning\n${indent([...(item as any).summary ?? [], ...(item as any).content ?? []].join("\n"))}`
    if (t === "toolExecution") return `Tool ${(item as any).toolName} ${(item as any).status}\n${indent(compact((item as any).input))}${(item as any).output ? `\n${indent((item as any).output)}` : ""}${(item as any).error ? `\nERROR ${indent((item as any).error)}` : ""}`
    if (t === "error") return `Error\n${indent((item as any).message ?? "")}`
    if (t === "compaction") return `Compaction\n${indent((item as any).summary ?? "")}`
    return `Raw\n${indent(compact(item))}`
  }

  private renderSide(): string {
    const threadLines = this.threads.slice(0, 20).map((t, i) => `${this.currentThread?.id === t.id ? "▶" : " "} ${i + 1}. ${short(t.id)} ${t.status?.type ?? ""}\n   ${truncate(t.preview || t.name || t.cwd, 30)}`)
    const recent = this.logs.slice(-10).map(l => `${l.level}: ${l.message}`)
    return [`Threads`, ...threadLines, "", "Recent", ...recent].join("\n")
  }

  private renderView(): string {
    switch (this.view) {
      case "threads": return this.threads.map(t => `${t.id}\n  ${t.status?.type ?? ""} ${t.modelProvider}/${t.model}\n  ${t.cwd}\n  ${t.preview}`).join("\n\n") || "No threads"
      case "logs": return this.logs.map(l => `[${l.level}] ${l.message}`).join("\n") || "No logs"
      case "raw": return JSON.stringify(this.lastRaw, null, 2)
      case "models": return renderModels(this.lastRaw)
      case "tools": return renderGenericList(this.lastRaw, "tools")
      case "commands": return renderCommands(this.lastRaw)
      case "skills": return renderSkills(this.lastRaw)
      default: return "Run the matching slash command to load this view."
    }
  }

  private cycleView(delta: number) {
    const views: ViewName[] = ["chat", "threads", "tools", "commands", "skills", "models", "logs", "raw"]
    const next = (views.indexOf(this.view) + delta + views.length) % views.length
    this.view = views[next] ?? "chat"
    this.renderAll()
  }

  private log(level: LogEntry["level"], message: string) {
    this.logs.push({ level, message })
    if (this.logs.length > 500) this.logs.shift()
  }

  private shutdown() {
    this.client.disconnect()
    this.renderer.destroy()
    process.exit(0)
  }
}

function errText(error: unknown) { return error instanceof Error ? error.message : String(error) }
function short(id?: string | null) { return id ? id.slice(0, 8) : "-" }
function indent(text: string) { return String(text).split("\n").map(l => `  ${l}`).join("\n") }
function truncate(text: string, n: number) { return text.length > n ? `${text.slice(0, n - 1)}…` : text }
function compact(value: unknown) { try { return typeof value === "string" ? value : JSON.stringify(value) } catch { return String(value) } }
function renderGenericList(raw: any, key: string) { const items = raw?.[key] ?? raw?.data ?? []; return Array.isArray(items) ? items.map(x => compact(x)).join("\n") : JSON.stringify(raw, null, 2) }
function renderModels(raw: any) { const models = raw?.models ?? []; return models.map((m: any) => `${m.isDefault ? "★" : " "} ${m.modelProvider}/${m.id} ${m.name ?? ""}`).join("\n") || "Run /models" }
function renderCommands(raw: any) { const commands = raw?.commands ?? []; return commands.map((c: any) => `/${c.name}${c.argumentHint ? ` ${c.argumentHint}` : ""}\n  ${c.description ?? c.source ?? ""}`).join("\n\n") || "Built-ins: /new /threads /models /tools /commands /skills /logs /raw /quit" }
function renderSkills(raw: any) { const skills = raw?.skills ?? []; return skills.map((s: any) => `${s.enabled === false ? "○" : "●"} ${s.name ?? s.id ?? s.title}\n  ${s.description ?? ""}`).join("\n\n") || "Run /skills" }
