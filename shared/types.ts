export type CardId = 'onetake' | 'hypit' | 'social' | 'montage';
export type TaskStatus = 'queued' | 'running' | 'waiting_user' | 'completed' | 'failed' | 'cancelled' | 'interrupted';
export interface Field {
  key: string; label: string; type: 'text' | 'textarea' | 'number' | 'select' | 'file' | 'files' | 'directory' | 'multiselect';
  required?: boolean; default?: unknown; min?: number; max?: number; options?: { value: string; label: string }[];
  help?: string; advanced?: boolean;
  when?: { key: string; value: string };
}
export interface ToolCard {
  id: CardId; title: string; description: string; icon: string; category: string;
  skillIds: string[]; workflowId: string; fields: Field[];
}
export interface Workflow { id: string; cardId: CardId; steps: string[]; requiresModel: boolean; requiresConfirmation: boolean }
export interface Diagnostic {
  id: CardId; installed: boolean; available: boolean; issues: string[]; fixes: string[];
  capabilities: Record<string, unknown>; verified: string[]; source: string;
}
export interface Skill {
  id: string; name: string; description: string; path: string; source: string; enabled: boolean;
  issues: string[]; cardIds: CardId[];
}
export interface Asset { id: string; name: string; path: string; size: number; mime: string; url: string }
export interface Artifact { id: string; name: string; path: string; mime: string; url: string }
export interface Task {
  id: string; kind: 'card' | 'agent'; cardId?: CardId; sessionId?: string; title: string;
  input: Record<string, unknown>; status: TaskStatus; stage: string; logs: { time: string; message: string }[];
  artifacts: Artifact[]; error?: string; result?: unknown; workingDirectory: string;
  createdAt: string; startedAt?: string; endedAt?: string; retryOf?: string;
}
export interface AgentSession {
  id: string; title: string; cwd: string; sessionFile?: string;
  createdAt: string; messages: { role: string; text: string; time: string; tool?: string }[];
}
export interface Settings {
  provider: string; modelId: string; baseUrl: string; keyConfigured: boolean;
  allowCommands: boolean; workDirectory: string; outputDirectory: string;
  skillRoots: string[]; executors: { onetakeRoot: string; hypitRoot: string; socialRoot: string; montageRoot: string; python: string; ffmpeg: string };
}
export interface Preferences { favorites: string[]; order: string[]; lastInputs: Record<string, Record<string, unknown>>; presets: { id: string; cardId: string; name: string; input: Record<string, unknown> }[]; recent: string[] }
export interface Bootstrap {
  cards: ToolCard[]; workflows: Workflow[]; diagnostics: Diagnostic[]; skills: Skill[]; tasks: Task[];
  sessions: AgentSession[]; settings: Settings; preferences: Preferences; assets: Asset[];
  runtime: { engine: string; version: string; connected: boolean; issues: string[]; models: { provider: string; id: string; name: string }[] };
}
export interface RuntimeEvent { type: string; text?: string; tool?: string; data?: unknown }
export interface RunContext {
  taskId: string; workingDirectory: string; outputDirectory: string; signal: AbortSignal;
  settings: Settings; skills: Skill[]; input: Record<string, unknown>;
  onLog: (message: string) => void; onStage: (stage: string) => void;
  runPi: (prompt: string) => Promise<string>;
}
export interface AdapterResult { files?: string[]; result?: unknown; error?: string; waiting?: { stage: string; data: unknown } }
export interface Adapter {
  id: CardId;
  inspect(settings: Settings): Promise<Diagnostic>;
  validate(input: Record<string, unknown>, settings: Settings): Promise<string[]>;
  execute(input: Record<string, unknown>, context: RunContext): Promise<AdapterResult>;
}
