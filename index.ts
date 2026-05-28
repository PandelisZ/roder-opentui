#!/usr/bin/env bun
import { Command } from "commander"
import { RoderClient } from "./src/client"
import { RoderTui } from "./src/ui"
import type { AppConfig } from "./src/types"

const program = new Command()
  .name("roder-opentui")
  .description("OpenTUI client for the Roder remote app server")
  .option("-u, --url <url>", "Roder WebSocket URL", process.env.RODER_URL ?? "ws://127.0.0.1:4768")
  .option("-t, --token <token>", "remote auth token", process.env.RODER_TOKEN)
  .option("--cwd <path>", "workspace cwd for new threads", process.env.RODER_CWD ?? process.cwd())
  .option("-m, --model <model>", "model override", process.env.RODER_MODEL)
  .option("-p, --provider <provider>", "provider override", process.env.RODER_PROVIDER)
  .option("-r, --reasoning <effort>", "reasoning effort override", process.env.RODER_REASONING)
  .option("--ephemeral", "create ephemeral new threads", false)
  .option("--no-reconnect", "disable websocket reconnect")

program.parse(process.argv)
const opts = program.opts()

const config: AppConfig = {
  url: opts.url,
  token: opts.token,
  cwd: opts.cwd,
  model: opts.model,
  provider: opts.provider,
  reasoning: opts.reasoning,
  ephemeral: Boolean(opts.ephemeral),
  reconnect: Boolean(opts.reconnect),
}

const client = new RoderClient(config.url, config.token, config.reconnect)
await new RoderTui(client, config).start()
