import fs from 'node:fs';
import path from 'node:path';
import type { AgentSession, Asset, Preferences, Settings, Skill, Task, ToolCard } from '../shared/types.js';

export interface State { settings: Settings; skills: Skill[]; tasks: Task[]; sessions: AgentSession[]; assets: Asset[]; preferences: Preferences; cards: ToolCard[] }
export class Store {
  state: State;
  readonly directory: string;
  readonly file: string;
  constructor(directory: string, cards: ToolCard[]) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true });
    this.file = path.join(this.directory, 'state.json');
    if (fs.existsSync(this.file)) {
      this.state = JSON.parse(fs.readFileSync(this.file, 'utf8')) as State;
      if (!Array.isArray(this.state.tasks) || !this.state.settings) throw new Error('本地状态文件损坏，请先备份 .data/state.json 后修复，应用未覆盖数据。');
    } else {
      this.state = {
        settings: { provider: 'openai', modelId: 'gpt-4.1-mini', baseUrl: '', keyConfigured: false, allowCommands: false,
          workDirectory: path.join(this.directory, 'workspace'), outputDirectory: path.join(this.directory, 'outputs'),
          skillRoots: [], executors: { onetakeRoot: '', hypitRoot: '', socialRoot: '', montageRoot: '', python: 'python', ffmpeg: 'ffmpeg' } },
        skills: [], tasks: [], sessions: [], assets: [], cards,
        preferences: { favorites: [], order: cards.map(c => c.id), lastInputs: {}, presets: [], recent: [] }
      };
    }
    fs.mkdirSync(this.state.settings.workDirectory, { recursive: true });
    fs.mkdirSync(this.state.settings.outputDirectory, { recursive: true });
    for (const task of this.state.tasks) if (['running', 'queued'].includes(task.status)) {
      task.status = 'interrupted'; task.stage = '应用重启，执行已中断'; task.error = '上次执行未正常结束，请检查产物后重试。'; task.endedAt = new Date().toISOString();
    }
    this.save();
  }
  save() {
    const temporary = this.file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { mode: 0o600 });
    fs.renameSync(temporary, this.file);
  }
}
