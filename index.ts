#!/usr/bin/env bun
import { Command } from "commander"
import { LocalRoderClient, RemoteRoderClient } from "./src/client"
import { RoderTui } from "./src/ui"
import type { AppConfig } from "./src/types"

const program = new Command()
  .name("roder-opentui")
  .description("OpenTUI client for the Roder app-server")
  .option("--transport <mode>", "embedded stdio app-server or remote websocket", process.env.RODER_TRANSPORT ?? "embedded")
  .option("-u, --url <url>", "Roder WebSocket URL for --transport remote", process.env.RODER_URL ?? "ws://127.0.0.1:4768")
  .option("-t, --token <token>", "remote auth token", process.env.RODER_TOKEN)
  .option("--server-command <command>", "embedded app-server command override", process.env.RODER_SERVER_COMMAND)
  .option("--server-args <args...>", "embedded app-server args override")
  .option("--cwd <path>", "workspace cwd for new threads", process.env.RODER_CWD ?? process.cwd())
  .option("-m, --model <model>", "model override", process.env.RODER_MODEL)
  .option("-p, --provider <provider>", "provider override", process.env.RODER_PROVIDER)
  .option("-r, --reasoning <effort>", "reasoning effort override", process.env.RODER_REASONING)
  .option("--ephemeral", "create ephemeral new threads", false)
  .option("--no-reconnect", "disable websocket reconnect")

program.parse(process.argv)
const opts = program.opts()
const transport = String(opts.transport)
if (!["embedded", "remote"].includes(transport)) {
  throw new Error(`--transport must be "embedded" or "remote", got ${transport}`)
}

const config: AppConfig = {
  url: transport === "remote" ? opts.url : "embedded://stdio",
  token: opts.token,
  cwd: opts.cwd,
  model: opts.model,
  provider: opts.provider,
  reasoning: opts.reasoning,
  ephemeral: Boolean(opts.ephemeral),
  reconnect: Boolean(opts.reconnect),
}

const client = transport === "remote"
  ? new RemoteRoderClient(opts.url, opts.token, config.reconnect)
  : new LocalRoderClient({ command: opts.serverCommand, args: opts.serverArgs, cwd: opts.cwd })

await new RoderTui(client, config).start()
