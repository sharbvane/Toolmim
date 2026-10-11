import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Adapter, AgentSession, CardId, RuntimeEvent, Task } from '../shared/types.js';
import { Store } from './store.js';
import { PiRuntime } from './pi-runtime.js';
import { inside, redact } from './security.js';

export const mediaType = (file: string) => ({ '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime', '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.pdf': 'application/pdf' }[path.extname(file).toLowerCase()] ?? 'text/plain');
export class TaskManager {
  private readonly controllers = new Map<string, AbortController>();
  private busy = false;
  private closing = false;
  constructor(private store: Store, private adapters: Record<CardId, Adapter>, private pi: PiRuntime, private broadcast: (name: string, data: unknown) => void, private secret: () => Promise<string | undefined>) {}
  changed() { this.store.save(); this.broadcast('update', {}); }
  private async log(task: Task, message: string) {
    const text = redact(message, [await this.secret() ?? '']).slice(0, 12_000);
    if (!text.trim()) return;
    task.logs.push({ time: new Date().toISOString(), message: text });
    if (task.logs.length > 1000) task.logs.splice(0, task.logs.length - 1000);
    this.changed();
  }
  private create(kind: Task['kind'], input: Record<string, unknown>, title: string, cwd: string) {
    const task: Task = { id: randomUUID(), kind, input, title, workingDirectory: cwd, status: 'queued', stage: '等待执行', logs: [], artifacts: [], createdAt: new Date().toISOString() };
    this.store.state.tasks.unshift(task); return task;
  }
  enqueueCard(cardId: CardId, input: Record<string, unknown>) {
    const card = this.store.state.cards.find(c => c.id === cardId);
    if (!card) throw new Error('未知工具卡片');
    if ('confirmed' in input || 'choice' in input) throw new Error('确认和方案选择只能在任务预览后提交');
    const task = this.create('card', input, card.title, this.store.state.settings.workDirectory); task.cardId = cardId;
    const prefs = this.store.state.preferences;
    prefs.lastInputs[cardId] = input; prefs.recent = [cardId, ...prefs.recent.filter(id => id !== cardId)].slice(0, 4);
    this.changed(); void this.drain(); return task;
  }
  enqueueAgent(session: AgentSession, text: string, files: string[] = []) {
    if (this.store.state.tasks.some(t => t.sessionId === session.id && ['queued', 'running'].includes(t.status))) throw new Error('该会话正在运行，请等待或停止后再发送');
    const task = this.create('agent', { text, files }, 'Agent · ' + text.slice(0, 32), session.cwd); task.sessionId = session.id;
    session.messages.push({ role: 'user', text, time: new Date().toISOString() });
    this.changed(); void this.drain(); return task;
  }
  cancel(id: string) {
    const task = this.find(id);
    if (!['queued', 'running', 'waiting_user'].includes(task.status)) throw new Error('此任务已结束');
    this.controllers.get(id)?.abort();
    if (task.status !== 'running') { task.status = 'cancelled'; task.stage = '已取消'; task.endedAt = new Date().toISOString(); }
    else task.stage = '正在停止执行与子进程';
    this.changed(); return task;
  }
  retry(id: string) {
    const original = this.find(id);
    if (!['failed', 'cancelled', 'interrupted'].includes(original.status)) throw new Error('只有失败、取消或中断任务可以重试');
    const input = { ...original.input }; delete input.confirmed; delete input.choice;
    if (original.cardId === 'social' && original.result && typeof original.result === 'object' && 'platforms' in original.result) {
      const results = (original.result as { platforms: { platform: string; status: string }[] }).platforms;
      if (results.some(result => result.status === 'unknown')) throw new Error('有平台上传结果未知，请先在平台核查，确认后新建发布任务，避免重复发布');
      const successful = results.filter(result => result.status === 'cli_success').map(result => result.platform);
      if (Array.isArray(input.platforms)) input.platforms = input.platforms.filter(platform => !successful.includes(platform as string));
      if (Array.isArray(input.platforms) && !input.platforms.length) throw new Error('所有平台已执行成功，请勿重复发布');
    }
    const task = original.kind === 'card' ? this.enqueueCard(original.cardId!, input)
      : this.enqueueAgent(this.store.state.sessions.find(s => s.id === original.sessionId)!, String(input.text), input.files as string[]);
    task.retryOf = original.id; this.changed(); return task;
  }
  continue(id: string, input: { choice?: number; confirmed?: boolean }) {
    const task = this.find(id);
    if (task.status !== 'waiting_user') throw new Error('此任务没有等待用户操作');
    if (task.cardId === 'social') {
      if (task.result && typeof task.result === 'object' && 'canConfirm' in task.result && (task.result as { canConfirm: boolean }).canConfirm !== true) throw new Error('账号检查未通过，不能确认发布');
      if (input.confirmed !== true) throw new Error('发布需要明确确认');
      task.input.confirmed = true;
    } else if (task.cardId === 'onetake') {
      if (!Number.isInteger(input.choice) || input.choice! < 0 || input.choice! > 2) throw new Error('请选择三份方案之一');
      task.input.choice = input.choice;
      task.input.concepts = task.result;
    } else throw new Error('此工作流不支持继续操作');
    task.status = 'queued'; task.stage = '等待继续执行'; this.changed(); void this.drain(); return task;
  }
  find(id: string) { const task = this.store.state.tasks.find(t => t.id === id); if (!task) throw new Error('任务不存在'); return task; }
  async idle() { while (this.busy) await new Promise(resolve => setTimeout(resolve, 20)); }
  async close() { this.closing = true; for (const controller of this.controllers.values()) controller.abort(); await this.idle(); }
  private async drain() {
    if (this.busy || this.closing) return;
    this.busy = true;
    try {
      let task: Task | undefined;
      while (!this.closing && (task = [...this.store.state.tasks].reverse().find(t => t.status === 'queued'))) await this.execute(task);
    } finally { this.busy = false; }
  }
  private async execute(task: Task) {
    const controller = new AbortController(); this.controllers.set(task.id, controller);
    task.status = 'running'; task.stage = '检查输入与执行环境'; task.startedAt ??= new Date().toISOString(); this.changed();
    const outputRoot = typeof task.input.outputDirectory === 'string' && task.input.outputDirectory ? task.input.outputDirectory : this.store.state.settings.outputDirectory;
    const outputDirectory = path.join(outputRoot, task.id);
    const pendingLogs: Promise<void>[] = [];
    const onLog = (message: string) => { pendingLogs.push(this.log(task, message)); };
    const onStage = (stage: string) => { task.stage = stage; onLog('阶段：' + stage); this.changed(); };
    try {
      fs.mkdirSync(outputDirectory, { recursive: true });
      if (task.kind === 'card') task.workingDirectory = outputDirectory;
      if (task.kind === 'agent') {
        const session = this.store.state.sessions.find(s => s.id === task.sessionId);
        if (!session) throw new Error('会话不存在');
        const answer = { role: 'assistant', text: '', time: new Date().toISOString() }; session.messages.push(answer);
        onStage('Pi Agent 执行中');
        const result = await this.pi.run(session, String(task.input.text), { signal: controller.signal, files: task.input.files as string[], onEvent: (event: RuntimeEvent) => {
          if (event.type === 'text_delta') answer.text += event.text ?? '';
          if (event.type === 'tool_start') onLog(`调用工具 ${event.tool}: ${JSON.stringify(event.data)}`);
          if (event.type === 'tool_end') {
            onLog(`${event.tool}: ${event.text ?? ''}`);
            session.messages.push({ role: 'tool', tool: event.tool, text: event.text ?? '', time: new Date().toISOString() });
          }
          if (event.type === 'error') onLog(event.text ?? 'Pi 执行出错');
          this.broadcast('agent', { sessionId: session.id, event });
        } });
        answer.text = result.text; session.sessionFile = result.sessionFile; task.result = { text: result.text };
      } else {
        const adapter = this.adapters[task.cardId!];
        const errors = await adapter.validate(task.input, this.store.state.settings); if (errors.length) throw new Error(errors.join('\n'));
        const diagnosis = await adapter.inspect(this.store.state.settings); if (!diagnosis.available) throw new Error([...diagnosis.issues, ...diagnosis.fixes].join('\n'));
        controller.signal.throwIfAborted();
        const result = await adapter.execute(task.input, { taskId: task.id, input: task.input, workingDirectory: task.workingDirectory, outputDirectory, settings: this.store.state.settings, skills: this.store.state.skills, signal: controller.signal, onLog, onStage,
          runPi: async prompt => {
            let session = this.store.state.sessions.find(s => s.id === task.id);
            if (!session) {
              session = { id: task.id, title: '工具 · ' + task.title, cwd: outputDirectory, createdAt: task.createdAt, messages: [] };
              this.store.state.sessions.push(session); task.sessionId = session.id; this.changed();
            }
            session.messages.push({ role: 'user', text: prompt, time: new Date().toISOString() });
            const outcome = await this.pi.run(session, prompt, { signal: controller.signal, onEvent: event => { if (event.type !== 'text_delta' && (event.text || event.tool)) onLog(`${event.type}: ${event.tool ?? ''} ${event.text ?? ''}`); } });
            session.messages.push({ role: 'assistant', text: outcome.text, time: new Date().toISOString() });
            return outcome.text;
          }
        });
        for (const file of result.files ?? []) {
          const resolved = fs.realpathSync(file);
          if (!inside(fs.realpathSync(outputRoot), resolved) || !fs.statSync(resolved).isFile()) throw new Error('适配器返回的产物不在授权输出目录内');
          const id = randomUUID(); task.artifacts.push({ id, name: path.basename(resolved), path: resolved, mime: mediaType(resolved), url: '/api/artifacts/' + id });
        }
        task.result = result.waiting?.data ?? result.result;
        if (result.error) throw new Error(result.error);
        if (result.waiting) { task.status = 'waiting_user'; task.stage = result.waiting.stage; }
      }
      controller.signal.throwIfAborted();
      if (task.status === 'running') { task.status = 'completed'; task.stage = '执行完成'; task.endedAt = new Date().toISOString(); }
    } catch (error) {
      task.status = controller.signal.aborted ? 'cancelled' : 'failed'; task.stage = controller.signal.aborted ? '已取消' : '执行失败';
      task.error = redact(error instanceof Error ? error.message : String(error), [await this.secret() ?? '']); task.endedAt = new Date().toISOString(); onLog(task.error);
    } finally {
      await Promise.all(pendingLogs); this.controllers.delete(task.id); this.changed();
    }
  }
}
