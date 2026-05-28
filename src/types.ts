export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue }

export interface JsonRpcRequest {
  jsonrpc: "2.0"
  id: number | string
  method: string
  params?: unknown
}

export interface JsonRpcError {
  code: number
  message: string
  data?: unknown
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: "2.0"
  id?: number | string | null
  result?: T
  error?: JsonRpcError
}

export interface ThreadStatus {
  type: string
  activeTurnId?: string | null
  activeFlags?: string[]
}

export interface ThreadSummary {
  id: string
  preview: string
  modelProvider: string
  model: string
  createdAt: number
  updatedAt: number
  status: ThreadStatus
  cwd: string
  name?: string | null
  turns?: Turn[]
  usage?: unknown
}

export interface Turn {
  id: string
  items: ThreadItem[]
  itemsView: string
  status: string
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
  error?: unknown
  usage?: unknown
}

export type ThreadItem =
  | { type: "userMessage"; id: string; text: string; status?: string; images?: unknown[] }
  | { type: "agentMessage"; id: string; text: string; phase?: string; status?: string }
  | { type: "reasoning"; id: string; summary?: string[]; content?: string[]; status?: string }
  | { type: "toolExecution"; id: string; toolCallId: string; toolName: string; status: string; input?: unknown; output?: string; error?: string }
  | { type: "compaction"; id: string; summary: string; status?: string }
  | { type: "error"; id: string; message: string; status?: string }
  | { type: "raw"; id: string; payload: unknown; status?: string }
  | Record<string, unknown>

export interface InitializeResult {
  provider: string
  model: string
  cwd?: string | null
  remote?: { authenticated: boolean; authSchemes: string[]; serverName: string; workspace?: string | null }
}

export interface ThreadListResult { data: ThreadSummary[]; nextCursor?: string | null; backwardsCursor?: string | null }
export interface ThreadStartResult { thread: ThreadSummary; model: string; modelProvider: string; reasoning: string; cwd: string }
export interface ThreadReadResult { thread?: ThreadSummary | null }
export interface TurnStartResult { turnId: string }
export interface ModelListResult { models: Array<{ id: string; name: string; modelProvider: string; defaultReasoningEffort?: string | null; reasoningEfforts?: string[]; isDefault?: boolean }> }
export interface ToolsListResult { tools: unknown[] }
export interface CommandsListResult { commands: Array<{ name: string; description?: string | null; argumentHint?: string | null; source?: string }> }
export interface SkillsListResult { skills: Array<{ name?: string; id?: string; title?: string; description?: string; enabled?: boolean; exposure?: string }>; diagnostics?: string[] }
export interface ThreadStateResult { mode: string; pendingPlanExit?: unknown | null }

export interface AppConfig {
  url: string
  token?: string
  cwd: string
  model?: string
  provider?: string
  reasoning?: string
  ephemeral: boolean
  reconnect: boolean
}
