import { afterEach, expect, test } from "bun:test"
import { mkdtempSync, writeFileSync, chmodSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { WebSocketServer } from "ws"
import { LocalRoderClient, RemoteRoderClient, resolveRoderSpawnTarget } from "./client"

let servers: WebSocketServer[] = []

afterEach(() => {
  for (const server of servers) server.close()
  servers = []
})

test("RemoteRoderClient sends bearer auth and JSON-RPC requests", async () => {
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
  const client = new RemoteRoderClient(`ws://127.0.0.1:${addr.port}`, "secret", false)
  await client.connect()
  const result = await client.request<{ ok: boolean }>("initialize")
  expect(result.ok).toBe(true)
  expect(await seen).toEqual({ auth: "Bearer secret", method: "initialize" })
  client.disconnect()
})

test("RemoteRoderClient rejects JSON-RPC errors", async () => {
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
  const client = new RemoteRoderClient(`ws://127.0.0.1:${addr.port}`, undefined, false)
  await client.connect()
  await expect(client.request("missing/method")).rejects.toThrow("Method not found")
  client.disconnect()
})

test("LocalRoderClient speaks newline-delimited JSON-RPC over stdio", async () => {
  const dir = mkdtempSync(join(tmpdir(), "roder-opentui-fake-"))
  const fake = join(dir, "fake-roder.mjs")
  writeFileSync(fake, `
    import readline from "node:readline";
    const rl = readline.createInterface({ input: process.stdin });
    rl.on("line", line => {
      const msg = JSON.parse(line);
      if (msg.method === "initialize") console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { provider: "fake", model: "fake-model" } }));
      else console.log(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result: { echo: msg.method, params: msg.params } }));
    });
  `)
  chmodSync(fake, 0o755)
  const client = new LocalRoderClient({ command: process.execPath, args: [fake], startupTimeoutMs: 1000 })
  await client.connect()
  const result = await client.request<{ echo: string; params: unknown }>("thread/list", { limit: 1 })
  expect(result.echo).toBe("thread/list")
  expect(result.params).toEqual({ limit: 1 })
  client.disconnect()
})

test("resolveRoderSpawnTarget accepts command override", () => {
  expect(resolveRoderSpawnTarget({ command: "/bin/echo", args: ["ok"] })).toEqual({ command: "/bin/echo", args: ["ok"], label: "/bin/echo" })
})
