import WebSocket from "ws"
import type { JsonRpcRequest, JsonRpcResponse } from "./types"

export type ClientEvent =
  | { type: "status"; status: "disconnected" | "connecting" | "connected"; message: string }
  | { type: "notification"; method: string; params: unknown }
  | { type: "error"; message: string }

export class RoderClient {
  private ws?: WebSocket
  private seq = 1
  private pending = new Map<number | string, { resolve: (value: unknown) => void; reject: (err: Error) => void; method: string }>()
  private listeners = new Set<(event: ClientEvent) => void>()
  private shouldReconnect = false
  private reconnectTimer?: ReturnType<typeof setTimeout>

  constructor(private url: string, private token?: string, private reconnect = true) {}

  on(listener: (event: ClientEvent) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  emit(event: ClientEvent) {
    for (const listener of this.listeners) listener(event)
  }

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
        this.emit({ type: "status", status: "connected", message: "Connected" })
        resolve()
      })
      ws.on("message", data => this.handleMessage(data.toString()))
      ws.on("error", error => {
        this.emit({ type: "error", message: error.message })
        if (!settled) reject(error)
      })
      ws.on("close", (code, reason) => {
        this.emit({ type: "status", status: "disconnected", message: `Disconnected (${code}) ${reason.toString()}` })
        for (const item of this.pending.values()) item.reject(new Error("WebSocket disconnected"))
        this.pending.clear()
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

  private handleMessage(text: string) {
    let msg: JsonRpcResponse | { method: string; params: unknown }
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

  private scheduleReconnect() {
    if (this.reconnectTimer) return
    this.reconnectTimer = setTimeout(async () => {
      this.reconnectTimer = undefined
      try { await this.connect() } catch { this.scheduleReconnect() }
    }, 1500)
  }
}
