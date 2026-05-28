# roder-opentui

An OpenTUI/Bun terminal client for the Roder remote app-server. It speaks the Roder JSON-RPC 2.0 protocol over the authenticated remote WebSocket transport documented in `~/w/gode/docs/app-server`.

## Start a Roder app-server

From a Roder checkout or installed `roder` binary:

```sh
roder app-server --remote --auth-token env:RODER_REMOTE_TOKEN --listen ws://127.0.0.1:4768
```

Remote Roder can also choose a random port; copy the printed URL/token into the client options.

## Run this TUI

```sh
bun install
RODER_TOKEN="$RODER_REMOTE_TOKEN" bun run index.ts --url ws://127.0.0.1:4768 --cwd /path/to/project
```

Options:

```sh
bun run index.ts --help
```

Useful environment variables: `RODER_URL`, `RODER_TOKEN`, `RODER_CWD`, `RODER_MODEL`, `RODER_PROVIDER`, `RODER_REASONING`.

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

Implemented client surfaces include startup handshake, thread list/start/read/archive-level viewing, turn start/interrupt, live notification logging, model/tool/command/skill browsers, policy mode changes, approval/plan-exit resolution, raw JSON-RPC escape hatch, and reconnect/auth handling over `roder.remote.v1` + bearer token.
