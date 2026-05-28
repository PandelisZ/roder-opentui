import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface, type Interface } from "node:readline"
import WebSocket from "ws"
import type { JsonRpcRequest, JsonRpcResponse } from "./types"

export type ClientEvent =
  | { type: "status"; status: "disconnected" | "connecting" | "connected"; message: string }
  | { type: "notification"; method: string; params: unknown }
  | { type: "error"; message: string }

export interface RoderClientLike {
  on(listener: (event: ClientEvent) => void): () => void
  connect(): Promise<void>
  disconnect(): void
  request<T = unknown>(method: string, params?: unknown): Promise<T>
}

type Pending = { resolve: (value: unknown) => void; reject: (err: Error) => void; method: string }

abstract class EventedClient implements RoderClientLike {
  protected seq = 1
  protected pending = new Map<number | string, Pending>()
  private listeners = new Set<(event: ClientEvent) => void>()

  on(listener: (event: ClientEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  protected emit(event: ClientEvent) {
    for (const listener of this.listeners) listener(event)
  }

  abstract connect(): Promise<void>
  abstract disconnect(): void
  abstract request<T = unknown>(method: string, params?: unknown): Promise<T>

  protected handleJsonText(text: string) {
    let msg: JsonRpcResponse | { method: string; params?: unknown }
    try { msg = JSON.parse(text) } catch (error) {
      this.emit({ type: "error", message: `Invalid JSON from server: ${String(error)}` })
      return
    }
    if ("method" in msg && !("id" in msg)) {
      this.emit({ type: "notification", method: msg.method, params: msg.params })
      return
    }
    const id = (msg as JsonRpcResponse).id
    if (id === undefined || id === null) return
    const pending = this.pending.get(id)
    if (!pending) return
    this.pending.delete(id)
    if ((msg as JsonRpcResponse).error) {
      const err = (msg as JsonRpcResponse).error!
      pending.reject(new Error(`${pending.method}: ${err.message} (${err.code})`))
    } else {
      pending.resolve((msg as JsonRpcResponse).result)
    }
  }

  protected rejectAll(error: Error) {
    for (const item of this.pending.values()) item.reject(error)
    this.pending.clear()
  }
}

export class RemoteRoderClient extends EventedClient {
  private ws?: WebSocket
  private shouldReconnect = false
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(private url: string, private token?: string, private reconnect = true) { super() }

  async connect(): Promise<void> {
    this.shouldReconnect = true
    this.emit({ type: "status", status: "connecting", message: `Connecting ${this.url}` })
    await new Promise<void>((resolve, reject) => {
      const headers: Record<string, string> = {}
      const protocols = ["roder.remote.v1"]
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`
        protocols.push(`bearer.${this.token}`)
      }
      const ws = new WebSocket(this.url, protocols, { headers })
      this.ws = ws
      let settled = false
      ws.on("open", () => {
        settled = true
        this.emit({ type: "status", status: "connected", message: "Connected remote app-server" })
        resolve()
      })
      ws.on("message", data => this.handleJsonText(data.toString()))
      ws.on("error", error => {
        this.emit({ type: "error", message: error.message })
        if (!settled) reject(error)
      })
      ws.on("close", (code, reason) => {
        this.emit({ type: "status", status: "disconnected", message: `Disconnected (${code}) ${reason.toString()}` })
        this.rejectAll(new Error("WebSocket disconnected"))
        if (this.shouldReconnect && this.reconnect) this.scheduleReconnect()
      })
    })
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer)
    this.ws?.close()
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) throw new Error("Roder server is not connected")
    const id = this.seq++
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method }
    if (params !== undefined) req.params = params
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject, method })
    })
    this.ws.send(JSON.stringify(req))
    return promise
  }

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined
      try { await this.connect() } catch { this.scheduleReconnect() }
    }, 1500)
  }
}

export interface LocalRoderClientOptions {
  command?: string
  args?: string[]
  cwd?: string
  env?: NodeJS.ProcessEnv
  startupTimeoutMs?: number
}

export class LocalRoderClient extends EventedClient {
  private child?: ChildProcessWithoutNullStreams
  private lines?: Interface
  private stderrTail = ""
  private started = false

  constructor(private options: LocalRoderClientOptions = {}) { super() }

  async connect(): Promise<void> {
    if (this.started) return
    const target = resolveRoderSpawnTarget(this.options)
    this.emit({ type: "status", status: "connecting", message: `Starting embedded app-server: ${target.command} ${target.args.join(" ")}` })
    this.child = spawn(target.command, target.args, {
      cwd: this.options.cwd ?? process.cwd(),
      env: { ...process.env, RODER_OPENTUI: "1", ...this.options.env },
      stdio: ["pipe", "pipe", "pipe"],
    })
    this.child.stdout.setEncoding("utf8")
    this.child.stderr.setEncoding("utf8")
    this.lines = createInterface({ input: this.child.stdout })
    this.lines.on("line", line => { if (line.trim()) this.handleJsonText(line.trim()) })
    this.child.stderr.on("data", chunk => {
      this.stderrTail = `${this.stderrTail}${chunk}`.slice(-1200)
      const message = chunk.toString().trim().slice(0, 300)
      if (message) this.emit({ type: "error", message })
    })
    this.child.once("exit", (code, signal) => {
      this.started = false
      const message = signal ? `embedded app-server exited with signal ${signal}` : `embedded app-server exited with code ${code ?? 0}`
      this.rejectAll(new Error(message))
      this.emit({ type: "status", status: "disconnected", message })
    })
    this.child.once("error", error => {
      this.started = false
      this.rejectAll(error)
      this.emit({ type: "error", message: error.message })
    })

    const timeoutMs = this.options.startupTimeoutMs ?? 10_000
    await withTimeout(this.rawRequest("initialize", {
      clientInfo: { name: "roder-opentui", title: "Roder OpenTUI", version: "0.0.0" },
      capabilities: { experimentalApi: true },
    }), timeoutMs, () => `embedded app-server did not initialize within ${timeoutMs}ms${this.stderrTail ? `; stderr: ${this.stderrTail}` : ""}`)
    this.started = true
    this.emit({ type: "status", status: "connected", message: `Embedded app-server ready (${target.label})` })
  }

  disconnect() {
    this.lines?.close()
    this.child?.kill()
    this.child = undefined
    this.started = false
  }

  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.child) await this.connect()
    return this.rawRequest<T>(method, params)
  }

  private async rawRequest<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (!this.child) throw new Error("embedded Roder app-server is not running")
    const id = this.seq++
    const req: JsonRpcRequest = { jsonrpc: "2.0", id, method }
    if (params !== undefined) req.params = params
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: value => resolve(value as T), reject, method })
    })
    this.child.stdin.write(`${JSON.stringify(req)}\n`, error => {
      if (!error) return
      this.pending.delete(id)
      throw error
    })
    return promise
  }
}

export type RoderClient = RemoteRoderClient
export const RoderClient = RemoteRoderClient

export function resolveRoderSpawnTarget(options: LocalRoderClientOptions = {}): { command: string; args: string[]; label: string } {
  if (options.command) return { command: options.command, args: options.args ?? [], label: options.command }
  const binaryName = process.platform === "win32" ? "roder.exe" : "roder"
  const here = dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.RODER_BIN,
    resolve(process.cwd(), "resources", "bin", binaryName),
    resolve(here, "..", "resources", "bin", binaryName),
    resolve(here, "..", "..", "resources", "bin", binaryName),
    resolve(here, "..", "..", "..", "resources", "bin", binaryName),
    resolve(dirname(process.execPath), "resources", "bin", binaryName),
    resolve(dirname(process.execPath), binaryName),
    resolve(process.cwd(), "..", "gode", "target", "debug", binaryName),
    resolve(process.cwd(), "..", "gode", "target", "release", binaryName),
    "roder",
  ].filter(Boolean) as string[]
  const command = candidates.find(candidate => candidate === "roder" || existsSync(candidate))
  if (!command) throw new Error(`Could not find bundled roder binary. Run bun run bundle:roder or set RODER_BIN=/path/to/roder.`)
  return { command, args: options.args ?? ["app-server", "--listen", "stdio://"], label: command }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: () => string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(message())), ms) })
  try { return await Promise.race([promise, timeout]) } finally { if (timer) clearTimeout(timer) }
}
