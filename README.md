# roder-opentui

An OpenTUI/Bun terminal client for the Roder app-server. By default it launches an embedded/bundled `roder app-server --listen stdio://` child process and speaks newline-delimited JSON-RPC over stdin/stdout, matching the IPC shape used by `~/w/gode-desktop`. It can also connect to an authenticated remote WebSocket app-server documented in `~/w/gode/docs/app-server`.

## Bundle the embedded Roder server

Build/copy the Roder CLI into `resources/bin/roder`:

```sh
bun install
bun run bundle:roder
```

`bundle:roder` defaults to `../gode`; override with `RODER_SOURCE_DIR=/path/to/gode` or copy an existing binary with `RODER_BIN=/path/to/roder bun run bundle:roder`.

## Run this TUI

Embedded stdio IPC mode, the default:

```sh
bun run index.ts --cwd /path/to/project
# or
bun run start:embedded -- --cwd /path/to/project
```

Remote WebSocket mode:

```sh
roder app-server --remote --auth-token env:RODER_REMOTE_TOKEN --listen ws://127.0.0.1:4768
RODER_TOKEN="$RODER_REMOTE_TOKEN" bun run start:remote -- --url ws://127.0.0.1:4768 --cwd /path/to/project
```

Options:

```sh
bun run index.ts --help
```

Useful environment variables: `RODER_TRANSPORT`, `RODER_BIN`, `RODER_SERVER_COMMAND`, `RODER_URL`, `RODER_TOKEN`, `RODER_CWD`, `RODER_MODEL`, `RODER_PROVIDER`, `RODER_REASONING`.

## UI controls

- Type a message and press Enter to start/steer a Roder turn.
- `Tab` / `Shift+Tab`: switch panels.
- `Ctrl+N`: new thread.
- `Ctrl+R`: refresh state.
- `Ctrl+S`: interrupt active turn.
- `Ctrl+L`: clear log.
- `Ctrl+C`: quit.

Slash commands:

- `/new`
- `/threads`, `/thread <id>`
- `/models`, `/tools`, `/commands`, `/skills`, `/logs`
- `/mode <mode>`
- `/raw <json-rpc-method> <json-params>`
- `/approve <approvalId>`, `/reject <approvalId>`, `/exit-plan <requestId> [true|false]`
- `/quit`

## Protocol coverage

Implemented client surfaces include startup handshake, embedded stdio IPC transport, remote `roder.remote.v1` WebSocket transport, thread list/start/read/archive-level viewing, turn start/interrupt, live notification logging, model/tool/command/skill browsers, policy mode changes, approval/plan-exit resolution, raw JSON-RPC escape hatch, and reconnect/auth handling for remote mode.
