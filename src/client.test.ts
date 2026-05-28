import { afterEach, expect, test } from "bun:test"
import { WebSocketServer } from "ws"
import { RoderClient } from "./client"

let servers: WebSocketServer[] = []

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
})

test("RoderClient sends bearer auth and JSON-RPC requests", async () => {
  const server = new WebSocketServer({ port: 0, handleProtocols: protocols => {
    expect(protocols.has("roder.remote.v1")).toBe(true)
    expect(protocols.has("bearer.secret")).toBe(true)
    return "roder.remote.v1"
  } })
  servers.push(server)

  const seen = new Promise<{ auth?: string; method: string }>(resolve => {
    server.on("connection", (socket, request) => {
      socket.on("message", data => {
        const msg = JSON.parse(data.toString())
        resolve({ auth: request.headers.authorization, method: msg.method })
        socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { ok: true } }))
      })
    })
  })

  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("expected TCP address")
  const client = new RoderClient(`ws://127.0.0.1:${addr.port}`, "secret", false)
  await client.connect()
  const result = await client.request<{ ok: boolean }>("initialize")
  expect(result.ok).toBe(true)
  expect(await seen).toEqual({ auth: "Bearer secret", method: "initialize" })
  client.disconnect()
})

test("RoderClient rejects JSON-RPC errors", async () => {
  const server = new WebSocketServer({ port: 0 })
  servers.push(server)
  server.on("connection", socket => {
    socket.on("message", data => {
      const msg = JSON.parse(data.toString())
      socket.send(JSON.stringify({ jsonrpc: "2.0", id: msg.id, error: { code: -32601, message: "Method not found" } }))
    })
  })

  const addr = server.address()
  if (!addr || typeof addr === "string") throw new Error("expected TCP address")
  const client = new RoderClient(`ws://127.0.0.1:${addr.port}`, undefined, false)
  await client.connect()
  await expect(client.request("missing/method")).rejects.toThrow("Method not found")
  client.disconnect()
})
