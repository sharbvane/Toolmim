import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, ArrowUpRight, Check, ChevronDown, ChevronRight, CircleHelp, Clapperboard, Copy, ExternalLink, File, FileVideo, Folder, FolderOpen, Grid2X2, Heart, Layers, LoaderCircle, MessageSquare, MoreHorizontal, Pause, Play, Plus, RefreshCw, Search, Send, Settings2, ShieldCheck, SlidersHorizontal, Sparkles, Terminal, Upload, WandSparkles, X } from 'lucide-react';
import type { AgentSession, Artifact, Asset, Bootstrap, CardId, Diagnostic, Field, Preferences, RuntimeEvent, Settings, Task, TaskStatus, ToolCard } from '../shared/types';

type Page = 'tools' | 'favorites' | 'tasks' | 'agent' | 'skills' | 'settings' | CardId;
type Actions = <T = unknown>(path: string, body?: unknown, method?: string) => Promise<T>;
const statusLabels: Record<TaskStatus, string> = { queued: '排队中', running: '运行中', waiting_user: '等待确认', completed: '已完成', failed: '失败', cancelled: '已取消', interrupted: '运行中断' };
const cardNames: Record<CardId, string> = { onetake: '一镜到底的产品故事', hypit: '从参考画面开始', social: '让作品抵达观众', montage: '让素材跟上节拍' };
const cardIcons = { onetake: WandSparkles, hypit: Copy, social: Send, montage: Clapperboard };
const manifestIcons = { sparkles: WandSparkles, copy: Copy, send: Send, clapperboard: Clapperboard, terminal: Terminal, layers: Layers, message: MessageSquare, folder: Folder, play: Play };
const resolveCardIcon = (card: ToolCard) => manifestIcons[card.icon as keyof typeof manifestIcons] || cardIcons[card.id];
const platformLabels: Record<string, string> = { douyin: '抖音', kuaishou: '快手', xiaohongshu: '小红书', bilibili: '哔哩哔哩', tencent: '视频号', youtube: 'YouTube', baijiahao: '百家号' };
const formatDate = (date: string) => new Date(date).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const active = (task: Task) => ['queued', 'running'].includes(task.status);
const asText = (value: unknown) => Array.isArray(value) ? value.join('\n') : value == null ? '' : String(value);

async function request<T>(path: string, body?: unknown, method = 'POST'): Promise<T> {
  const multipart = body instanceof FormData;
  const response = await fetch(path, { method, headers: { 'X-Toolbox': 'local', ...(!multipart && body !== undefined ? { 'Content-Type': 'application/json' } : {}) }, ...(body !== undefined ? { body: multipart ? body : JSON.stringify(body) } : {}) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || data.message || `请求失败（${response.status}）`);
  return data as T;
}

export default function App() {
  const [data, setData] = useState<Bootstrap>();
  const [page, setPage] = useState<Page>('tools');
  const [search, setSearch] = useState('');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [selectedTask, setSelectedTask] = useState('');
  const [events, setEvents] = useState<Record<string, RuntimeEvent[]>>({});
  const refresh = useCallback(async () => {
    try { setData(await request<Bootstrap>('/api/bootstrap', undefined, 'GET')); setError(''); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
  }, []);
  useEffect(() => {
    void refresh();
    const source = new EventSource('/api/events');
    let timer: ReturnType<typeof setTimeout>;
    source.addEventListener('update', () => { clearTimeout(timer); timer = setTimeout(() => void refresh(), 120); });
    source.addEventListener('agent', message => {
      try {
        const { sessionId, event } = JSON.parse((message as MessageEvent).data) as { sessionId: string; event: RuntimeEvent };
        setEvents(previous => {
          const history = previous[sessionId] || [];
          const last = history.at(-1);
          const next = event.type === 'text_delta' && last?.type === 'text_delta'
            ? [...history.slice(0, -1), { ...event, text: (last.text || '') + (event.text || '') }]
            : [...history.slice(-149), event];
          return { ...previous, [sessionId]: next };
        });
      } catch { /* Malformed events leave the next bootstrap update as the source of truth. */ }
    });
    return () => { clearTimeout(timer); source.close(); };
  }, [refresh]);
  useEffect(() => { if (toast) { const timer = setTimeout(() => setToast(''), 4500); return () => clearTimeout(timer); } }, [toast]);
  const act: Actions = async <T,>(path: string, body?: unknown, method = 'POST') => {
    try {
      const messageSession = path.match(/^\/api\/sessions\/([^/]+)\/messages$/)?.[1];
      const retryTask = path.match(/^\/api\/tasks\/([^/]+)\/retry$/)?.[1];
      const liveSession = messageSession || data?.tasks.find(task => task.id === retryTask)?.sessionId;
      if (liveSession) setEvents(previous => ({ ...previous, [liveSession]: [] }));
      const result = await request<T>(path, body, method); await refresh(); return result;
    }
    catch (cause) { const message = cause instanceof Error ? cause.message : String(cause); setToast(message); throw cause; }
  };
  const navigate = (next: Page) => { setPage(next); setSearch(''); };
  const openTask = (id: string) => { setSelectedTask(id); navigate('tasks'); };
  const prefs = (next: Partial<Preferences>) => act('/api/preferences', next, 'PUT');
  if (!data) return <div className="boot-screen"><div className="brand-mark"><Layers size={27} /></div><h1>Toolmim · 图明 AI 全能箱</h1><p>{error || '正在连接本地工作区…'}</p>{error ? <button className="primary" onClick={() => void refresh()}>重新连接</button> : <LoaderCircle className="spin" size={22} />}</div>;
  const running = data.tasks.filter(active).length;
  const waiting = data.tasks.filter(task => task.status === 'waiting_user').length;
  const currentCard = data.cards.find(card => card.id === page);
  const nav = [
    { id: 'tools', label: '全部工具', icon: Grid2X2 }, { id: 'favorites', label: '我的收藏', icon: Heart },
    { id: 'agent', label: 'Pi Agent', icon: MessageSquare }, { id: 'tasks', label: '任务中心', icon: Layers },
    { id: 'skills', label: 'Skills 库', icon: SlidersHorizontal }, { id: 'settings', label: '设置', icon: Settings2 },
  ];
  return <div className="app-shell">
    <aside className="sidebar">
      <button className="brand" onClick={() => navigate('tools')} aria-label="Toolmim 首页"><span className="brand-mark"><Layers size={24} /></span><span>Toolmim<span className="brand-sub">图明 AI 全能箱</span></span></button>
      <div className="workspace-label"><span className="green-dot" /> 本地工作区 <span className="local-tag">LOCAL</span></div>
      <nav aria-label="主导航">{nav.map(item => <button key={item.id} aria-label={item.label} title={item.label} className={`nav-item ${page === item.id || currentCard && item.id === 'tools' ? 'selected' : ''}`} onClick={() => navigate(item.id as Page)}><item.icon size={19} /><span>{item.label}</span>{item.id === 'tasks' && (running + waiting > 0) && <span className="nav-count">{running + waiting}</span>}</button>)}</nav>
      <div className="sidebar-bottom"><button className="runtime-card" onClick={() => navigate('settings')}><span className={`status-dot ${data.runtime.connected ? 'ready' : 'pending'}`} /><span><strong>Pi Agent</strong><small>{data.runtime.connected ? '配置就绪 · 尚未测试' : '配置模型后开始'}</small></span><ChevronRight size={15} /></button><p>在本地创造，把重复交给工具。</p></div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><div className="breadcrumb">工作区 <ChevronRight size={13} /><span>{currentCard?.title || nav.find(item => item.id === page)?.label}</span></div><div className="topbar-right"><span className="version-label">MVP · 本地优先</span><button className="icon-button" title="设置" aria-label="设置" onClick={() => navigate('settings')}><Settings2 size={18} /></button></div></header>
      <main>
        {error && <div className="notice danger"><span>本地服务连接失败：{error}</span><button onClick={() => void refresh()}>重试</button></div>}
        {(page === 'tools' || page === 'favorites') && <Toolbox key={page} data={data} favoritesOnly={page === 'favorites'} search={search} setSearch={setSearch} navigate={navigate} prefs={prefs} openTask={openTask} />}
        {currentCard && <CardWorkspace key={currentCard.id} card={currentCard} data={data} act={act} prefs={prefs} navigate={navigate} openTask={openTask} notify={setToast} />}
        {page === 'tasks' && <Tasks data={data} selectedId={selectedTask} setSelectedId={setSelectedTask} act={act} navigate={navigate} />}
        {page === 'agent' && <Agent data={data} events={events} act={act} navigate={navigate} />}
        {page === 'skills' && <Skills data={data} act={act} navigate={navigate} notify={setToast} />}
        {page === 'settings' && <SettingsPage data={data} act={act} openTask={openTask} notify={setToast} />}
      </main>
      <footer className="app-footer"><span><ShieldCheck size={13} /> 本地存储 · 由 Pi 驱动</span><span>Toolmim · 图明 AI 全能箱</span></footer>
    </div>
    {toast && <div role="status" className="toast"><span>{toast}</span><button className="icon-button" aria-label="关闭提示" onClick={() => setToast('')}><X size={16} /></button></div>}
  </div>;
}

function PageHeading({ label, title, description, children }: { label?: string; title: string; description: string; children?: ReactNode }) {
  return <div className="page-heading"><div>{label && <span className="eyebrow">{label}</span>}<h1>{title}</h1><p>{description}</p></div>{children && <div className="heading-actions">{children}</div>}</div>;
}
function Status({ status }: { status: TaskStatus }) { return <span className={`badge task-${status}`}><span className="status-dot" />{statusLabels[status]}</span>; }
function CardGraphic({ id }: { id: CardId }) {
  return <div className={`card-art art-${id}`} aria-hidden="true">{id === 'onetake' ? <><div className="motion-orbit" /><div className="motion-window"><div className="motion-pill" /><span>图明</span><i /></div><div className="motion-note">MOTION / ONE TAKE</div></> : id === 'hypit' ? <><div className="replica-frame first"><div className="replica-shape" /><span>参考</span></div><div className="replica-frame second"><div className="replica-shape" /><span>创作</span></div><ArrowUpRight className="replica-arrow" size={22} /></> : id === 'social' ? <><div className="social-orbit one" /><div className="social-orbit two" /><div className="social-send"><Send size={25} /></div><span className="social-node n1"><Play size={12} /></span><span className="social-node n2"><MessageSquare size={14} /></span><span className="social-node n3"><Heart size={12} /></span></> : <><div className="timeline-ruler"><span>00:00</span><span>00:15</span><span>00:30</span></div><div className="clip-strip"><i /><i /><i /><i /></div><div className="waveform">{Array.from({ length: 32 }, (_, i) => <i key={i} style={{ height: `${[14, 23, 12, 33, 28, 11, 21, 36][i % 8]}px` }} />)}</div><div className="playhead" /></>}</div>;
}

function Toolbox({ data, favoritesOnly, search, setSearch, navigate, prefs, openTask }: { data: Bootstrap; favoritesOnly: boolean; search: string; setSearch: (value: string) => void; navigate: (page: Page) => void; prefs: (next: Partial<Preferences>) => Promise<unknown>; openTask: (id: string) => void }) {
  const [category, setCategory] = useState('全部');
  const [sort, setSort] = useState(false);
  const searchInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      if (event.key === '/' && !(event.target instanceof HTMLElement && event.target.closest('input, textarea, select, [contenteditable]'))) {
        event.preventDefault(); searchInput.current?.focus();
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, []);
  const categories = ['全部', ...new Set(data.cards.map(card => card.category))];
  const ordered = [...data.cards].sort((a, b) => { const order = data.preferences.order; return (order.includes(a.id) ? order.indexOf(a.id) : 999) - (order.includes(b.id) ? order.indexOf(b.id) : 999); });
  const cards = ordered.filter(card => (!favoritesOnly || data.preferences.favorites.includes(card.id)) && (category === '全部' || card.category === category) && `${card.title} ${card.description} ${card.category}`.toLowerCase().includes(search.toLowerCase()));
  const toggleFavorite = (id: string) => void prefs({ favorites: data.preferences.favorites.includes(id) ? data.preferences.favorites.filter(item => item !== id) : [...data.preferences.favorites, id] }).catch(() => {});
  const move = (id: string, direction: number) => { const ids = ordered.map(card => card.id); const position = ids.indexOf(id as CardId); const to = position + direction; if (to < 0 || to >= ids.length) return; [ids[position], ids[to]] = [ids[to], ids[position]]; void prefs({ order: ids }).catch(() => {}); };
  const recent = data.preferences.recent.map(id => data.cards.find(card => card.id === id)).filter((card): card is ToolCard => Boolean(card));
  const inProgress = data.tasks.find(task => active(task) || task.status === 'waiting_user');
  return <div className="toolbox-page">
    <PageHeading label="YOUR CREATIVE WORKSPACE" title={favoritesOnly ? '常用的，放在手边。' : '今天，想做点什么？'} description={favoritesOnly ? '收藏你的常用工具，下次直接开始。' : '从一个想法，到一份作品。选好工具，其余交给工作流。'} />
    <div className="search-row"><label className="search-box"><Search size={19} /><input ref={searchInput} aria-label="搜索工具" placeholder="搜索工具、用途或关键词…" value={search} onChange={event => setSearch(event.target.value)} />{search && <button className="icon-button" aria-label="清空搜索" onClick={() => setSearch('')}><X size={16} /></button>}<kbd>/</kbd></label><button className={`secondary sort-button ${sort ? 'toggled' : ''}`} onClick={() => setSort(!sort)}><SlidersHorizontal size={16} />{sort ? '完成排序' : '排列工具'}</button></div>
    <div className="filter-row"><div className="category-tabs">{categories.map(item => <button className={category === item ? 'active' : ''} key={item} onClick={() => setCategory(item)}>{item}</button>)}</div><span>{cards.length} 个工具</span></div>
    {cards.length === 0 ? <Empty icon={<Search size={25} />} title={favoritesOnly ? '还没有收藏工具' : '没有找到匹配的工具'} description={favoritesOnly ? '点击工具右上角的爱心，保存在这里。' : '试试其他关键词，或查看全部分类。'} /> : <div className="tool-grid">{cards.map(card => { const diagnostic = data.diagnostics.find(item => item.id === card.id); const Icon = resolveCardIcon(card); const task = data.tasks.find(item => item.cardId === card.id && active(item)); return <article className={`tool-card card-${card.id}`} key={card.id}><div className="tool-card-top"><span className="card-category">{card.category}</span><button className={`favorite-button ${data.preferences.favorites.includes(card.id) ? 'is-favorite' : ''}`} aria-label={`${data.preferences.favorites.includes(card.id) ? '取消收藏' : '收藏'}${card.title}`} onClick={() => toggleFavorite(card.id)}><Heart size={18} /></button></div><button className="card-open" onClick={() => navigate(card.id)}><CardGraphic id={card.id} /><div className="tool-card-title"><span className="small-tool-icon"><Icon size={18} /></span><h2>{card.title}</h2></div><p>{card.description}</p></button><div className="tool-card-bottom"><span className={`availability ${task ? 'busy' : diagnostic?.available ? 'ready' : 'pending'}`}><span className="status-dot" />{task ? '任务运行中' : diagnostic?.available ? '可使用' : '需要配置'}</span><button className="text-action" onClick={() => navigate(card.id)}>打开工具 <ArrowUpRight size={15} /></button></div>{sort && <div className="sort-controls"><span>调整工具位置</span><button className="icon-button" aria-label={`${card.title}向前移动`} disabled={ordered[0].id === card.id} onClick={() => move(card.id, -1)}><ArrowUp size={16} /></button><button className="icon-button" aria-label={`${card.title}向后移动`} disabled={ordered.at(-1)?.id === card.id} onClick={() => move(card.id, 1)}><ArrowDown size={16} /></button></div>}</article>; })}</div>}
    <section className="home-bottom"><div className="recent-section"><div className="section-label"><h2>最近使用</h2><span>你的创作足迹</span></div>{recent.length ? <div className="recent-list">{recent.slice(0, 4).map(card => { const Icon = resolveCardIcon(card); return <button key={card.id} onClick={() => navigate(card.id)}><span className={`recent-icon card-${card.id}`}><Icon size={18} /></span><span>{card.title}</span><ArrowRight size={15} /></button>; })}</div> : <div className="quiet-empty"><FolderOpen size={20} /><span>第一次创作，从上方选一个工具开始。</span></div>}</div><div className="agent-invite"><span className="agent-spark"><Sparkles size={22} /></span><div><h2>想自由探索？</h2><p>打开 Pi Agent，用对话处理更复杂的任务。</p><button className="text-action" onClick={() => navigate('agent')}>进入 Agent 工作区 <ArrowRight size={16} /></button></div></div></section>
    {inProgress && <button className="running-strip" onClick={() => openTask(inProgress.id)}><LoaderCircle size={17} className={active(inProgress) ? 'spin' : ''} /><span>{inProgress.title}</span><Status status={inProgress.status} /><ChevronRight size={16} /></button>}
  </div>;
}

function Empty({ icon, title, description, children }: { icon: ReactNode; title: string; description: string; children?: ReactNode }) { return <div className="empty-state"><span className="empty-icon">{icon}</span><h3>{title}</h3><p>{description}</p>{children}</div>; }
function DiagnosticPanel({ diagnostic, navigate }: { diagnostic?: Diagnostic; navigate: (page: Page) => void }) {
  if (!diagnostic) return <div className="notice">正在读取执行器状态。</div>;
  return <details className={`diagnostic ${diagnostic.available ? 'healthy' : ''}`} open={!diagnostic.available}><summary><span className={`status-dot ${diagnostic.available ? 'ready' : 'pending'}`} /><strong>{diagnostic.available ? '执行器已就绪' : '运行前需要完成配置'}</strong><ChevronDown size={16} /></summary><div className="diagnostic-body">{diagnostic.issues.map((issue, index) => <p key={index}>{issue}</p>)}{diagnostic.fixes.length > 0 && <ul>{diagnostic.fixes.map((fix, index) => <li key={index}>{fix}</li>)}</ul>}{diagnostic.verified.length > 0 && <div className="verified-list"><span>已检查</span>{diagnostic.verified.map((item, index) => <p key={index}><Check size={13} />{item}</p>)}</div>}{!diagnostic.available && <button className="text-action" onClick={() => navigate('settings')}>前往设置 <ArrowRight size={15} /></button>}</div></details>;
}

function SchemaField({ field, value, onChange, act }: { field: Field; value: unknown; onChange: (value: unknown) => void; act: Actions }) {
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const inputId = `field-${field.key}`;
  const fileField = ['file', 'files', 'directory'].includes(field.type);
  const pick = async () => { setBusy(true); try { const response = await act<{ paths: string[] }>('/api/assets/select', { kind: field.type }); if (response.paths.length) onChange(field.type === 'files' ? response.paths : response.paths[0]); } catch { /* Request errors are reported by the shared action handler. */ } finally { setBusy(false); } };
  const upload = async (files: FileList | null) => { if (!files?.length) return; setBusy(true); try { const assets: Asset[] = []; for (const file of Array.from(files)) { const body = new FormData(); body.append('file', file); assets.push(await act<Asset>('/api/assets/upload', body)); } onChange(field.type === 'files' ? assets.map(asset => asset.path) : assets[0].path); } catch { /* Request errors are reported by the shared action handler. */ } finally { setBusy(false); if (fileRef.current) fileRef.current.value = ''; } };
  return <div className={`form-field ${fileField ? 'file-field' : ''}`}><label htmlFor={inputId}>{field.label}{field.required && <span className="required">*</span>}</label>
    {field.type === 'textarea' ? <textarea id={inputId} value={asText(value)} required={field.required} onChange={event => onChange(event.target.value)} rows={4} /> : field.type === 'select' ? <select id={inputId} value={asText(value)} required={field.required} onChange={event => onChange(event.target.value)}><option value="">请选择</option>{field.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select> : field.type === 'multiselect' ? <div className="choice-group" role="group" aria-label={field.label}>{field.options?.map(option => { const selected = Array.isArray(value) && value.includes(option.value); return <label className={`choice-chip ${selected ? 'chosen' : ''}`} key={option.value}><input type="checkbox" checked={selected} onChange={() => onChange(selected ? (value as string[]).filter(item => item !== option.value) : [...(Array.isArray(value) ? value : []), option.value])} /><span>{option.label}</span>{selected && <Check size={14} />}</label>; })}</div> : fileField ? <div className="file-input-box"><span className="file-illustration">{field.type === 'directory' ? <FolderOpen size={23} /> : <FileVideo size={23} />}</span><div className="file-path"><textarea id={inputId} aria-label={field.label} value={asText(value)} placeholder={field.type === 'files' ? '选择多个文件，或每行输入一个本地路径' : field.type === 'directory' ? '选择本地目录，或输入目录路径' : '选择文件，或输入本地文件路径'} onChange={event => onChange(field.type === 'files' ? event.target.value.split('\n').filter(Boolean) : event.target.value)} rows={field.type === 'files' && Array.isArray(value) && value.length > 1 ? Math.min(value.length, 4) : 2} /><div className="file-actions"><button type="button" className="secondary small" onClick={() => void pick()} disabled={busy}>{busy ? <LoaderCircle size={14} className="spin" /> : <Folder size={14} />}本地选择</button>{field.type !== 'directory' && <button type="button" className="text-action" onClick={() => fileRef.current?.click()} disabled={busy}><Upload size={14} />上传素材</button>}{Boolean(value && asText(value)) && <button type="button" className="text-action muted" onClick={() => onChange(field.type === 'files' ? [] : '')}>清空</button>}</div></div><input ref={fileRef} type="file" className="visually-hidden" multiple={field.type === 'files'} onChange={event => void upload(event.target.files)} /></div> : <div className={field.type === 'number' ? 'number-input' : ''}><input id={inputId} type={field.type === 'number' ? 'number' : 'text'} value={asText(value)} min={field.min} max={field.max} required={field.required} onChange={event => onChange(field.type === 'number' ? event.target.value === '' ? '' : Number(event.target.value) : event.target.value)} />{field.type === 'number' && field.min != null && field.max != null && <span>{field.min}–{field.max}</span>}</div>}
    {field.help && <p className="field-help">{field.help}</p>}
  </div>;
}

function CardWorkspace({ card, data, act, prefs, navigate, openTask, notify }: { card: ToolCard; data: Bootstrap; act: Actions; prefs: (next: Partial<Preferences>) => Promise<unknown>; navigate: (page: Page) => void; openTask: (id: string) => void; notify: (message: string) => void }) {
  const [input, setInput] = useState<Record<string, unknown>>(() => ({ ...Object.fromEntries(card.fields.map(field => [field.key, field.default ?? (field.type === 'multiselect' || field.type === 'files' ? [] : '')])), ...data.preferences.lastInputs[card.id] }));
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');
  const [presetName, setPresetName] = useState('');
  const [editing, setEditing] = useState(false);
  const [manifest, setManifest] = useState(JSON.stringify({ title: card.title, description: card.description, icon: card.icon, category: card.category, fields: card.fields }, null, 2));
  const diagnostic = data.diagnostics.find(item => item.id === card.id);
  const workflow = data.workflows.find(item => item.cardId === card.id);
  const Icon = resolveCardIcon(card);
  const presets = data.preferences.presets.filter(preset => preset.cardId === card.id);
  const setValue = (key: string, value: unknown) => setInput(previous => ({ ...previous, [key]: value }));
  const render = (fields: Field[]) => fields.map(field => <SchemaField key={field.key} field={field.key === 'platforms' ? { ...field, options: field.options?.map(option => ({ ...option, label: platformLabels[option.value] || option.label })) } : field} value={input[field.key]} onChange={value => setValue(field.key, value)} act={act} />);
  const visible = (field: Field) => !field.when || input[field.when.key] === field.when.value;
  const main = card.fields.filter(field => !field.advanced && visible(field));
  const sources = main.filter(field => ['file', 'files', 'directory'].includes(field.type) || /url|reference|assets|bgm/i.test(field.key));
  const params = main.filter(field => !sources.includes(field));
  const advanced = card.fields.filter(field => field.advanced && visible(field));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setFormError('');
    const missing = card.fields.find(field => visible(field) && field.required && (input[field.key] == null || asText(input[field.key]).trim() === ''));
    if (missing) { setFormError(`请填写或选择「${missing.label}」。`); return; }
    setBusy(true);
    try { await prefs({ lastInputs: { ...data.preferences.lastInputs, [card.id]: input } }); const task = await act<Task>('/api/tasks', { cardId: card.id, input }); openTask(task.id); }
    catch (cause) { setFormError(cause instanceof Error ? cause.message : String(cause)); }
    finally { setBusy(false); }
  };
  const savePreset = async () => { if (!presetName.trim()) return; try { await prefs({ presets: [...data.preferences.presets, { id: crypto.randomUUID(), cardId: card.id, name: presetName.trim(), input }] }); setPresetName(''); notify('本地预设已保存'); } catch {} };
  const sourceTitle = { onetake: '产品页面与素材', hypit: '参考视频', social: '准备发布的作品', montage: '视频与音乐素材' }[card.id];
  const paramsTitle = { onetake: '想讲怎样的产品故事？', hypit: '保留结构，换上你的内容', social: '填写发布内容', montage: '安排这次混剪' }[card.id];
  const task = data.tasks.find(item => item.cardId === card.id && (active(item) || item.status === 'waiting_user'));
  const sourceSection = sources.length > 0 && <section className="panel input-panel"><div className="panel-heading"><h2>{sourceTitle}</h2><span><FileVideo size={15} /> 本地素材</span></div><div className="source-fields">{render(sources)}</div>{card.id === 'montage' && <MontageInputs input={input} assets={data.assets} change={setValue} />}</section>;
  const parameterSection = <section className="panel input-panel"><div className="panel-heading"><h2>{paramsTitle}</h2><span>关键参数</span></div><div className={`parameter-fields ${card.id === 'social' ? 'publish-fields' : ''}`}>{render(params)}</div>{card.id === 'social' && Array.isArray(input.platforms) && input.platforms.length > 0 && <div className="platform-checks"><div className="section-label"><h3>发布前逐平台检查</h3><span>创建任务后检查登录状态</span></div>{input.platforms.map((platform: string) => <div className="platform-check" key={platform}><span className="platform-initial">{(platformLabels[platform] || platform).slice(0, 1)}</span><strong>{platformLabels[platform] || platform}</strong><span>{asText(input.account) || '尚未指定账号'}</span><small>待检查</small></div>)}</div>}</section>;
  return <div className={`card-workspace workspace-${card.id}`}><button className="back-button" onClick={() => navigate('tools')}><ArrowLeft size={16} />返回工具箱</button>
    <div className="tool-heading"><div><div className="detail-category"><span className={`detail-icon card-${card.id}`}><Icon size={23} /></span><span>{card.category}</span></div><h1>{card.title}</h1><p>{card.description}</p></div><button className="secondary small" onClick={() => setEditing(!editing)}><Settings2 size={14} />编辑卡片</button></div>
    {editing && <section className="panel manifest-editor"><h2>卡片 Manifest</h2><p className="muted">调整标题、说明、分类和字段。图标可用 sparkles、copy、send、clapperboard、terminal、layers、message、folder、play。执行能力由适配器决定。</p><textarea className="code-input" aria-label="卡片 Manifest JSON" value={manifest} onChange={event => setManifest(event.target.value)} rows={15} /><button className="primary small" onClick={async () => { try { await act(`/api/cards/${card.id}`, JSON.parse(manifest), 'PUT'); setEditing(false); notify('卡片已更新'); } catch (cause) { notify(cause instanceof Error ? cause.message : 'JSON 格式无效'); } }}>保存卡片</button></section>}
    <div className="workspace-layout"><form className="workspace-form" onSubmit={event => void submit(event)}>
      <div className="detail-signature"><CardGraphic id={card.id} /><div><span className="eyebrow">{card.id === 'onetake' ? 'PRODUCT MOTION' : card.id === 'hypit' ? 'REFERENCE TO REMIX' : card.id === 'social' ? 'PUBLISH WITH CONFIDENCE' : 'CUT TO THE BEAT'}</span><h2>{cardNames[card.id]}</h2><p>{card.id === 'onetake' ? '先选创意方案，再生成分镜与动效。' : card.id === 'hypit' ? '读取原片，再按参考构图生成你的版本。' : card.id === 'social' ? '先检查账号与发布预览，再由你确认上传。' : '多段视频，一首音乐，拼成有节奏的作品。'}</p></div></div>
      {presets.length > 0 && <div className="preset-bar"><span>本地预设</span><select aria-label="加载本地预设" defaultValue="" onChange={event => { const preset = presets.find(item => item.id === event.target.value); if (preset) setInput({ ...input, ...preset.input }); }}><option value="">选择预设…</option>{presets.map(preset => <option value={preset.id} key={preset.id}>{preset.name}</option>)}</select></div>}
      {card.id === 'montage' && input.mode === 'lite' && <div className="mode-explanation"><Clapperboard size={17} /><p><strong>Lite 模式 · 整首音乐混剪</strong>成片长度等于整首 BGM（1–600 秒），不截断音乐，不进行语义或参考风格分析。需要参考视频的专业模式可在下方切换。</p></div>}
      {card.id === 'hypit' && <HypitComparison input={input} data={data} />}
      {card.id === 'onetake' ? <>{parameterSection}{sourceSection}</> : <>{sourceSection}{parameterSection}</>}
      {advanced.length > 0 && <details className="panel advanced"><summary><span><SlidersHorizontal size={16} />高级设置</span><ChevronDown size={16} /></summary><div className="parameter-fields">{render(advanced)}</div></details>}
      <div className="save-preset"><input aria-label="预设名称" value={presetName} onChange={event => setPresetName(event.target.value)} placeholder="为这组参数起个名字" /><button type="button" className="secondary small" disabled={!presetName.trim()} onClick={() => void savePreset()}><Plus size={14} />保存为预设</button></div>
      {formError && <div role="alert" className="notice danger">{formError}</div>}
      <div className="launch-bar"><span>{card.id === 'social' ? '真实发布前会再次请求你的确认。' : '任务会保存到本地，可在任务中心查看。'}</span><button className="primary" type="submit" disabled={busy || !diagnostic?.available}>{busy ? <LoaderCircle size={17} className="spin" /> : <Play size={16} />}{busy ? '正在创建任务…' : diagnostic?.available ? card.id === 'social' ? '检查并生成预览' : '开始任务' : '配置后即可运行'}</button></div>
    </form><aside className="workspace-aside"><DiagnosticPanel diagnostic={diagnostic} navigate={navigate} /><section className="panel workflow-panel"><span className="eyebrow">WORKFLOW</span><h2>接下来会发生什么</h2><ol>{workflow?.steps.map((step, index) => <li key={index}><span>{index + 1}</span><p>{step}</p></li>)}</ol></section>{task && <div className="panel current-task"><h2>当前任务</h2><p>{task.title}</p><Status status={task.status} /><button className="text-action" onClick={() => openTask(task.id)}>查看执行记录 <ArrowRight size={14} /></button></div>}<p className="aside-help"><CircleHelp size={16} />{card.id === 'hypit' ? '模型或工具不支持的选项不会出现在此页面。' : card.id === 'onetake' ? '这是产品动效制作工具。先完成创意选择，再进入制作与渲染。' : card.id === 'social' ? '账号凭据保存在执行器的本地配置中，工具箱不会把它们传到浏览器。' : '仅展示当前执行模式支持的参数。检查素材格式后再开始。'}</p></aside></div></div>;
}

function HypitComparison({ input, data }: { input: Record<string, unknown>; data: Bootstrap }) {
  const reference = data.assets.find(asset => asset.path === input.referenceVideo);
  const completed = data.tasks.find(task => task.cardId === 'hypit' && task.status === 'completed' && task.input.referenceVideo === input.referenceVideo);
  const result = completed?.artifacts.find(artifact => artifact.mime.startsWith('video/'));
  return <div className="comparison-workbench"><div><span className="comparison-label">参考原片</span>{reference?.mime.startsWith('video/') ? <video controls src={reference.url} preload="metadata" /> : <div className="comparison-empty"><FileVideo size={25} /><p>{input.referenceVideo ? '本地原片将在执行时读取' : '先上传或选择参考视频'}</p></div>}</div><span className="comparison-arrow"><ArrowRight size={19} /></span><div><span className="comparison-label">你的版本</span>{result ? <video controls src={result.url} preload="metadata" /> : <div className="comparison-empty"><Copy size={25} /><p>完成任务后在这里对比成片</p></div>}</div></div>;
}

function MontageInputs({ input, assets, change }: { input: Record<string, unknown>; assets: Asset[]; change: (key: string, value: unknown) => void }) {
  const paths = Array.isArray(input.videos) ? input.videos as string[] : [];
  if (!paths.length) return null;
  return <div className="montage-source-list"><div className="section-label"><h3>素材池</h3><span>{paths.length} 段视频 · 原始文件只读</span></div><div className="clip-list">{paths.map((path, index) => { const asset = assets.find(item => item.path === path); return <div className="clip-tile" key={`${path}-${index}`}><span className="clip-number">{String(index + 1).padStart(2, '0')}</span><FileVideo size={20} /><strong title={path}>{path.split(/[\\/]/).at(-1)}</strong>{asset && <small>{(asset.size / 1024 / 1024).toFixed(1)} MB</small>}<button type="button" className="icon-button" aria-label={`移除素材 ${index + 1}`} onClick={() => change('videos', paths.filter((_, itemIndex) => itemIndex !== index))}><X size={13} /></button></div>; })}</div></div>;
}

function PublishPreview({ result }: { result: Record<string, unknown> }) {
  const platforms = Array.isArray(result.platforms) ? result.platforms as Record<string, unknown>[] : [];
  if (!platforms.length) return <pre className="result-json">{JSON.stringify(result, null, 2)}</pre>;
  return <div className="publish-preview-list">{platforms.map((item, index) => <div className="publish-preview" key={index}><div className="publish-preview-heading"><span className="platform-initial">{(platformLabels[asText(item.platform)] || asText(item.platform)).slice(0, 1)}</span><strong>{platformLabels[asText(item.platform)] || asText(item.platform)}</strong><span className={`availability ${item.status === 'valid' ? 'ready' : 'pending'}`}><span className="status-dot" />{item.status === 'valid' ? '账号检查通过' : '账号未通过检查'}</span></div><dl><div><dt>账号</dt><dd>{asText(item.account)}</dd></div><div><dt>标题</dt><dd>{asText(item.title)}</dd></div><div><dt>作品</dt><dd>{asText(item.video)}</dd></div>{item.description != null && <div><dt>描述</dt><dd>{asText(item.description)}</dd></div>}{item.tags != null && <div><dt>标签</dt><dd>{asText(item.tags)}</dd></div>}<div><dt>发布</dt><dd>{asText(item.schedule) || '确认后立即上传'}</dd></div></dl></div>)}</div>;
}

function Tasks({ data, selectedId, setSelectedId, act, navigate }: { data: Bootstrap; selectedId: string; setSelectedId: (id: string) => void; act: Actions; navigate: (page: Page) => void }) {
  const [filter, setFilter] = useState('all');
  const tasks = data.tasks.filter(task => filter === 'all' || filter === 'active' && (active(task) || task.status === 'waiting_user') || filter === 'completed' && task.status === 'completed' || filter === 'failed' && ['failed', 'interrupted'].includes(task.status));
  const selected = tasks.find(task => task.id === selectedId) || tasks[0];
  return <div><PageHeading label="TASK CENTER" title="每一步，都有迹可循。" description="查看真实执行阶段、活动日志和产物。没有可量化进度的任务只显示当前阶段。" /><div className="category-tabs task-tabs">{[['all', '全部任务'], ['active', '进行中'], ['completed', '已完成'], ['failed', '需要处理']].map(([id, name]) => <button key={id} className={filter === id ? 'active' : ''} onClick={() => setFilter(id)}>{name}</button>)}</div>{!tasks.length ? <Empty icon={<Layers size={26} />} title="这里还没有任务" description="从工具箱启动一次创作，执行记录会保存在这里。"><button className="primary small" onClick={() => navigate('tools')}>选择工具 <ArrowRight size={15} /></button></Empty> : <div className="tasks-layout"><div className="task-list">{tasks.map(task => <button key={task.id} className={`task-list-item ${selected?.id === task.id ? 'selected' : ''}`} onClick={() => setSelectedId(task.id)}><div><span className="task-kind">{task.kind === 'agent' ? 'Pi Agent' : data.cards.find(card => card.id === task.cardId)?.title}</span><Status status={task.status} /></div><strong>{task.title}</strong><p>{task.stage}</p><small>{formatDate(task.createdAt)}</small></button>)}</div>{selected && <TaskDetail key={selected.id} task={selected} act={act} onRetry={setSelectedId} />}</div>}</div>;
}

function TaskDetail({ task, act, onRetry }: { task: Task; act: Actions; onRetry: (id: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [choice, setChoice] = useState(0);
  const execute = async (action: string, body = {}) => { setBusy(true); try { const result = await act<Task>(`/api/tasks/${task.id}/${action}`, body); if (action === 'retry') onRetry(result.id); } catch {} finally { setBusy(false); } };
  const raw = task.result as Record<string, unknown> | undefined;
  const concepts = Array.isArray(task.result) ? task.result : Array.isArray(raw?.concepts) ? raw.concepts : Array.isArray(raw?.options) ? raw.options : [];
  return <section className="panel task-detail"><div className="task-detail-heading"><div><span className="eyebrow">{task.id.slice(0, 8)}</span><h2>{task.title}</h2></div><Status status={task.status} /></div><div className="task-stage"><span className={`stage-symbol ${active(task) ? 'running' : ''}`}>{active(task) ? <LoaderCircle size={20} className="spin" /> : task.status === 'completed' ? <Check size={20} /> : task.status === 'waiting_user' ? <Pause size={20} /> : <Terminal size={20} />}</span><div><span>当前阶段</span><strong>{task.stage}</strong></div><div className="task-actions">{(active(task) || task.status === 'waiting_user') && <button className="secondary small" disabled={busy} onClick={() => void execute('cancel')}><X size={14} />取消任务</button>}{['failed', 'cancelled', 'interrupted'].includes(task.status) && <button className="secondary small" disabled={busy} onClick={() => void execute('retry')}><RefreshCw size={14} />重试任务</button>}</div></div>
    {task.error && <div className="notice danger"><strong>任务未完成</strong><p>{task.error}</p></div>}
    {task.status === 'waiting_user' && <div className="confirmation-panel"><h3>{task.cardId === 'social' ? '检查发布预览，再确认上传' : task.cardId === 'onetake' ? '选择一个创意，继续制作' : '需要你的确认'}</h3>{task.cardId === 'onetake' && concepts.length > 0 ? <div className="concept-grid">{concepts.map((concept, index) => <label className={`concept ${choice === index ? 'chosen' : ''}`} key={index}><input type="radio" name="concept" value={index} checked={choice === index} onChange={() => setChoice(index)} /><span>方案 {index + 1}</span><strong>{typeof concept === 'string' ? `创意 ${index + 1}` : asText((concept as Record<string, unknown>).title || (concept as Record<string, unknown>).name || `创意 ${index + 1}`)}</strong><p>{typeof concept === 'string' ? concept : asText((concept as Record<string, unknown>).idea || (concept as Record<string, unknown>).description || (concept as Record<string, unknown>).summary || JSON.stringify(concept, null, 2))}</p></label>)}</div> : task.cardId === 'social' && raw ? <PublishPreview result={raw} /> : <pre className="result-json">{JSON.stringify(task.result, null, 2)}</pre>}{task.cardId === 'social' && <label className="confirm-check"><input type="checkbox" checked={confirm} onChange={event => setConfirm(event.target.checked)} /><span>我已检查平台、账号和作品内容，确认现在执行真实上传。</span></label>}<button className="primary small" disabled={busy || task.cardId === 'social' && (!confirm || raw?.canConfirm === false)} onClick={() => void execute('continue', task.cardId === 'onetake' ? { choice, confirmed: true } : { confirmed: true })}>{busy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}{task.cardId === 'social' ? '确认并上传' : '确认并继续'}</button></div>}
    <div className="task-meta"><span>创建于 <strong>{formatDate(task.createdAt)}</strong></span>{task.startedAt && <span>开始于 <strong>{formatDate(task.startedAt)}</strong></span>}{task.endedAt && <span>结束于 <strong>{formatDate(task.endedAt)}</strong></span>}</div>
    <div className="section-label"><h3>活动日志</h3><span>{task.logs.length} 条记录</span></div><div className="log-window" role="log" aria-label="任务活动日志">{task.logs.length ? task.logs.map((log, index) => <div className="log-line" key={index}><time>{new Date(log.time).toLocaleTimeString('zh-CN', { hour12: false })}</time><span>{log.message}</span></div>) : <p>等待执行器输出日志…</p>}</div>
    {task.artifacts.length > 0 && <div className="artifacts"><div className="section-label"><h3>任务产物</h3><span>{task.artifacts.length} 个文件</span></div>{task.artifacts.map(artifact => <ArtifactPreview key={artifact.id} artifact={artifact} act={act} />)}</div>}
    {task.result != null && task.status !== 'waiting_user' && <details className="result-details"><summary>结构化结果 <ChevronDown size={15} /></summary><pre className="result-json">{JSON.stringify(task.result, null, 2)}</pre></details>}
    <details className="result-details"><summary>输入参数与工作目录 <ChevronDown size={15} /></summary><p className="path-text">{task.workingDirectory}</p><pre className="result-json">{JSON.stringify(task.input, null, 2)}</pre></details>
  </section>;
}
function ArtifactPreview({ artifact, act }: { artifact: Artifact; act: Actions }) {
  return <div className="artifact"><div className="artifact-title"><File size={17} /><strong>{artifact.name}</strong><div><a className="text-action" href={artifact.url} download>下载 <ArrowDown size={14} /></a><button className="text-action" onClick={() => void act(`/api/artifacts/${artifact.id}/open`, {}).catch(() => {})}><FolderOpen size={14} />所在目录</button></div></div>{artifact.mime.startsWith('video/') ? <video src={artifact.url} controls preload="metadata" /> : artifact.mime.startsWith('image/') ? <img src={artifact.url} alt={artifact.name} /> : artifact.mime.startsWith('audio/') ? <audio src={artifact.url} controls preload="metadata" /> : <a className="artifact-file" href={artifact.url} target="_blank" rel="noreferrer">打开产物 <ExternalLink size={15} /></a>}<p className="path-text">{artifact.path}</p></div>;
}

function Agent({ data, events, act, navigate }: { data: Bootstrap; events: Record<string, RuntimeEvent[]>; act: Actions; navigate: (page: Page) => void }) {
  const [sessionId, setSessionId] = useState(data.sessions[0]?.id || '');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<string[]>([]);
  const [cwd, setCwd] = useState(data.settings.workDirectory);
  const [busy, setBusy] = useState(false);
  const [title, setTitle] = useState('');
  const [newForm, setNewForm] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);
  const session = data.sessions.find(item => item.id === sessionId) || data.sessions[0];
  const running = data.tasks.find(task => task.sessionId === session?.id && active(task));
  const stream = events[session?.id || ''] || [];
  const create = async () => { setBusy(true); try { const created = await act<AgentSession>('/api/sessions', { title: title.trim() || undefined, cwd }); setSessionId(created.id); setNewForm(false); setTitle(''); } catch {} finally { setBusy(false); } };
  const send = async (event: FormEvent) => { event.preventDefault(); if (!text.trim() || busy || running) return; setBusy(true); try { let id = session?.id; if (!id) { const created = await act<AgentSession>('/api/sessions', { cwd }); id = created.id; setSessionId(id); } await act(`/api/sessions/${id}/messages`, { text: text.trim(), files }); setText(''); setFiles([]); } catch {} finally { setBusy(false); } };
  const selectFiles = async () => { try { const result = await act<{ paths: string[] }>('/api/assets/select', { kind: 'files' }); setFiles(previous => [...new Set([...previous, ...result.paths])]); } catch {} };
  const pickDirectory = async () => { try { const result = await act<{ paths: string[] }>('/api/assets/select', { kind: 'directory' }); if (result.paths[0]) setCwd(result.paths[0]); } catch {} };
  const deltas = stream.filter(event => event.type === 'text_delta' || event.type === 'text').map(event => event.text || '').join('');
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }); }, [session?.messages.length, stream.length, deltas.length]);
  return <div className="agent-page"><PageHeading label="PI AGENT" title="复杂一点，也可以。" description="与 Pi 对话，读取本地文件、调用已启用的 Skills，保留完整执行记录。"><button className="secondary small" onClick={() => setNewForm(!newForm)}><Plus size={16} />新建会话</button></PageHeading>
    {!data.runtime.connected && <div className="notice"><span><strong>先连接一个模型</strong><p>{data.runtime.issues.join('；') || '在设置中选择 Provider、模型并配置认证，之后即可开始真实对话。'}</p></span><button className="secondary small" onClick={() => navigate('settings')}>配置模型 <ArrowRight size={14} /></button></div>}
    <div className="agent-layout"><aside className="session-list"><div className="section-label"><h3>本地会话</h3><span>{data.sessions.length}</span></div>{data.sessions.length ? data.sessions.map(item => <button className={session?.id === item.id ? 'selected' : ''} key={item.id} onClick={() => setSessionId(item.id)}><MessageSquare size={16} /><span><strong>{item.title}</strong><small>{formatDate(item.createdAt)}</small></span></button>) : <p className="muted session-empty">新建会话，或直接写下你的任务。</p>}<div className="session-foot"><ShieldCheck size={14} /> 会话保存在本地</div></aside><section className="agent-conversation">
      <div className="conversation-toolbar"><div><span className={`status-dot ${data.runtime.connected ? 'ready' : 'pending'}`} /><select aria-label="Agent 模型" value={`${data.settings.provider}/${data.settings.modelId}`} onChange={event => { const model = data.runtime.models.find(item => `${item.provider}/${item.id}` === event.target.value); if (model) void act('/api/settings', { provider: model.provider, modelId: model.id }, 'PUT').catch(() => {}); }}><option value={`${data.settings.provider}/${data.settings.modelId}`}>{data.settings.modelId || '尚未选择模型'}</option>{data.runtime.models.filter(item => `${item.provider}/${item.id}` !== `${data.settings.provider}/${data.settings.modelId}`).map(model => <option value={`${model.provider}/${model.id}`} key={`${model.provider}/${model.id}`}>{model.provider} / {model.name}</option>)}</select></div><span className="local-tag">PI RUNTIME</span></div>
      {newForm && <div className="new-session"><label>会话名称<input value={title} onChange={event => setTitle(event.target.value)} placeholder="例如：整理产品素材" /></label><label>工作目录<div className="inline-input"><input value={cwd} onChange={event => setCwd(event.target.value)} /><button className="icon-button" aria-label="选择工作目录" onClick={() => void pickDirectory()}><FolderOpen size={17} /></button></div></label><div><button className="primary small" disabled={busy || !cwd.trim()} onClick={() => void create()}>创建会话</button><button className="text-action" onClick={() => setNewForm(false)}>取消</button></div></div>}
      <div className="conversation-messages">{!session?.messages.length && <div className="agent-empty"><span><Sparkles size={30} /></span><h2>有什么可以一起完成？</h2><p>描述你的任务，或选择本地文件作为上下文。<br />当前已启用 {data.skills.filter(skill => skill.enabled).length} 个 Skill。</p><div className="suggestions">{['检查工作目录中的文件并概括内容', '列出当前可以使用的 Skills', '帮我制定一个产品视频创意'].map(suggestion => <button key={suggestion} onClick={() => setText(suggestion)}>{suggestion}<ArrowUpRight size={14} /></button>)}</div></div>}{session?.messages.filter((message, index, messages) => !(running && deltas && message.role === 'assistant' && index === messages.length - 1)).map((message, index) => <div className={`message message-${message.role}`} key={`${index}-${message.time}`}><span className="message-avatar">{message.role === 'user' ? '我' : message.role === 'assistant' ? <Sparkles size={16} /> : <Terminal size={16} />}</span><div><div className="message-label">{message.role === 'user' ? '你' : message.role === 'assistant' ? 'Pi Agent' : message.tool || '工具执行'}<time>{formatDate(message.time)}</time></div>{message.role === 'tool' ? <details><summary>{message.tool || '工具结果'} <ChevronDown size={14} /></summary><pre>{message.text}</pre></details> : <p>{message.text}</p>}</div></div>)}{running && deltas && <div className="message message-assistant"><span className="message-avatar"><Sparkles size={16} /></span><div><div className="message-label">Pi Agent <span className="streaming-label">正在生成</span></div><p>{deltas}<span className="typing-cursor" /></p></div></div>}{stream.some(event => event.type.includes('tool')) && <details className="agent-tools" open={Boolean(running)}><summary><Terminal size={15} />工具调用记录 <ChevronDown size={14} /></summary>{stream.filter(event => event.type.includes('tool')).map((event, index) => <div key={index}><strong>{event.tool || event.type}</strong><pre>{event.text || JSON.stringify(event.data, null, 2)}</pre></div>)}</details>}{running && <div className="agent-running"><LoaderCircle size={15} className="spin" /><span>{running.stage}</span><button className="text-action" onClick={() => void act(`/api/tasks/${running.id}/cancel`, {}).catch(() => {})}>停止运行</button></div>}<div ref={bottom} /></div>
      <form className="agent-composer" onSubmit={event => void send(event)}>{files.length > 0 && <div className="attached-files">{files.map(path => <span key={path}><File size={13} />{path.split(/[\\/]/).at(-1)}<button type="button" className="icon-button" aria-label={`移除 ${path}`} onClick={() => setFiles(previous => previous.filter(item => item !== path))}><X size={13} /></button></span>)}</div>}<textarea aria-label="发送给 Pi 的任务" placeholder={data.runtime.connected ? '描述你的任务，Pi 会调用真实工具执行…' : '先在设置中连接模型，再开始对话…'} value={text} onChange={event => setText(event.target.value)} rows={3} onKeyDown={event => { if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} /><div className="composer-bottom"><button type="button" className="text-action muted" onClick={() => void selectFiles()}><Plus size={17} />添加文件</button><span>Ctrl + Enter 发送</span><button type="submit" className="primary small" disabled={!data.runtime.connected || !text.trim() || busy || Boolean(running)}>{busy ? <LoaderCircle className="spin" size={15} /> : <ArrowUp size={17} />}发送</button></div></form><div className="agent-cwd"><Folder size={13} /><span>{session?.cwd || cwd}</span></div>
    </section></div></div>;
}

function Skills({ data, act, navigate, notify }: { data: Bootstrap; act: Actions; navigate: (page: Page) => void; notify: (message: string) => void }) {
  const [search, setSearch] = useState(''); const [path, setPath] = useState(''); const [importing, setImporting] = useState(false); const [busy, setBusy] = useState(false);
  const [optimistic, setOptimistic] = useState<Record<string, boolean>>({});
  const [toggleBusy, setToggleBusy] = useState<string[]>([]);
  const toggle = async (id: string, enabled: boolean) => {
    if (toggleBusy.includes(id)) return;
    setOptimistic(previous => ({ ...previous, [id]: enabled }));
    setToggleBusy(previous => [...previous, id]);
    try { await act(`/api/skills/${encodeURIComponent(id)}/toggle`, { enabled }); }
    catch { /* The previous server value is restored after the shared action reports the error. */ }
    finally {
      setOptimistic(previous => { const next = { ...previous }; delete next[id]; return next; });
      setToggleBusy(previous => previous.filter(item => item !== id));
    }
  };
  const skills = data.skills.filter(skill => `${skill.name} ${skill.description} ${skill.path}`.toLowerCase().includes(search.toLowerCase()));
  const importSkill = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { await act('/api/skills/import', { path }); setPath(''); setImporting(false); notify('本地 Skill 已导入'); } catch {} finally { setBusy(false); } };
  const pick = async () => { try { const result = await act<{ paths: string[] }>('/api/assets/select', { kind: 'directory' }); if (result.paths[0]) setPath(result.paths[0]); } catch {} };
  return <div><PageHeading label="SKILLS LIBRARY" title="工具背后的能力。" description="管理本地 Skills，让 Pi 读取你已启用的能力说明与资源。"><button className="secondary small" disabled={busy} onClick={async () => { setBusy(true); try { await act('/api/skills/rescan', {}); notify('Skills 扫描完成'); } catch {} finally { setBusy(false); } }}><RefreshCw className={busy ? 'spin' : ''} size={15} />重新扫描</button><button className="primary small" onClick={() => setImporting(!importing)}><Plus size={16} />导入本地 Skill</button></PageHeading>{importing && <form className="panel import-panel" onSubmit={event => void importSkill(event)}><h2>从本地导入</h2><p>选择包含 SKILL.md 的目录，或直接输入 SKILL.md 的路径。</p><div className="inline-input"><input aria-label="本地 Skill 路径" placeholder="本地 Skill 目录或 SKILL.md 完整路径" value={path} onChange={event => setPath(event.target.value)} required /><button type="button" className="secondary small" onClick={() => void pick()}><FolderOpen size={15} />选择目录</button><button className="primary small" disabled={busy || !path.trim()}>导入</button></div></form>}<div className="skills-filter"><label className="search-box"><Search size={18} /><input aria-label="搜索 Skills" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称、说明或路径…" /></label><span>{data.skills.filter(skill => skill.enabled).length} 个已启用 / {data.skills.length} 个已发现</span></div>{skills.length ? <div className="skill-grid">{skills.map(skill => <article className={`panel skill-card ${!(optimistic[skill.id] ?? skill.enabled) ? 'skill-disabled' : ''}`} key={skill.id}><div className="skill-card-heading"><span className="skill-icon"><Terminal size={21} /></span><div><h2>{skill.name}</h2><span>{skill.source}</span></div><label className="switch"><input type="checkbox" checked={optimistic[skill.id] ?? skill.enabled} disabled={toggleBusy.includes(skill.id)} aria-label={`启用 ${skill.name}`} onChange={event => void toggle(skill.id, event.target.checked)} /><span /></label></div><p className="skill-description">{skill.description || '该 Skill 尚未提供说明。'}</p><p className="skill-path" title={skill.path}><Folder size={13} />{skill.path}</p>{skill.issues.length ? <div className="skill-issues">{skill.issues.map((issue, index) => <p key={index}>{issue}</p>)}</div> : <span className="availability ready"><span className="status-dot" />{toggleBusy.includes(skill.id) ? '正在保存…' : (optimistic[skill.id] ?? skill.enabled) ? '已启用 · 可供 Pi 加载' : '已停用'}</span>}<div className="skill-links"><span>关联工具</span>{skill.cardIds.length ? skill.cardIds.map(id => <button className="text-action" key={id} onClick={() => navigate(id)}>{data.cards.find(card => card.id === id)?.title || id}<ArrowUpRight size={13} /></button>) : <span className="muted">通过 Agent 使用</span>}</div></article>)}</div> : <Empty icon={<Terminal size={26} />} title="还没有匹配的 Skill" description="导入本地 SKILL.md，或在设置中添加扫描目录。" />}</div>;
}

function SettingsPage({ data, act, openTask, notify }: { data: Bootstrap; act: Actions; openTask: (id: string) => void; notify: (message: string) => void }) {
  const [settings, setSettings] = useState(data.settings); const [apiKey, setApiKey] = useState(''); const [clearKey, setClearKey] = useState(false); const [busy, setBusy] = useState(false); const [testBusy, setTestBusy] = useState(false);
  const providers = [...new Set([...data.runtime.models.map(model => model.provider), settings.provider])].filter(Boolean);
  const models = data.runtime.models.filter(model => model.provider === settings.provider);
  const set = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(previous => ({ ...previous, [key]: value }));
  const save = async (event: FormEvent) => { event.preventDefault(); setBusy(true); try { const { keyConfigured: _, ...editable } = settings; await act('/api/settings', { ...editable, ...(apiKey ? { apiKey } : {}), ...(clearKey ? { clearKey: true } : {}) }, 'PUT'); setApiKey(''); setClearKey(false); notify('设置已保存到本地'); } catch {} finally { setBusy(false); } };
  const test = async () => { setTestBusy(true); try { const task = await act<Task>('/api/runtime/test', {}); openTask(task.id); } catch {} finally { setTestBusy(false); } };
  const chooseDirectory = async (key: 'workDirectory' | 'outputDirectory') => { try { const response = await act<{ paths: string[] }>('/api/assets/select', { kind: 'directory' }); if (response.paths[0]) set(key, response.paths[0]); } catch {} };
  return <div><PageHeading label="LOCAL SETTINGS" title="让工具准备好。" description="模型、执行器与本地路径。配置保存在此设备，认证密钥不会回传到前端。" /><form className="settings-layout" onSubmit={event => void save(event)}><div className="settings-main"><section className="panel settings-panel"><div className="panel-heading"><h2><Sparkles size={18} />模型与认证</h2><span className={`availability ${data.runtime.connected ? 'ready' : 'pending'}`}><span className="status-dot" />{data.runtime.connected ? '配置已就绪' : '待配置'}</span></div><div className="field-grid"><label className="form-field">Provider<select value={settings.provider} onChange={event => { set('provider', event.target.value); const first = data.runtime.models.find(model => model.provider === event.target.value); if (first) set('modelId', first.id); }}><option value="">选择 Provider</option>{providers.map(provider => <option key={provider} value={provider}>{provider}</option>)}</select></label><label className="form-field">模型<select value={settings.modelId} onChange={event => set('modelId', event.target.value)}><option value={settings.modelId}>{settings.modelId || '选择模型'}</option>{models.filter(model => model.id !== settings.modelId).map(model => <option value={model.id} key={model.id}>{model.name}</option>)}</select></label></div><label className="form-field">自定义模型 ID<input value={settings.modelId} onChange={event => set('modelId', event.target.value)} placeholder="填写 Provider 支持的模型 ID" /></label><label className="form-field">API Base URL（可选）<input type="url" value={settings.baseUrl} onChange={event => set('baseUrl', event.target.value)} placeholder="使用 Provider 默认地址" /></label><label className="form-field">API Key<input type="password" autoComplete="new-password" value={apiKey} onChange={event => { setApiKey(event.target.value); setClearKey(false); }} placeholder={data.settings.keyConfigured ? '已配置 · 留空保留现有密钥' : '输入此项目使用的 API Key'} /><span className="field-help">仅在保存时发送给本地服务，不写入浏览器存储。</span></label>{data.settings.keyConfigured && <label className="confirm-check"><input type="checkbox" checked={clearKey} onChange={event => { setClearKey(event.target.checked); if (event.target.checked) setApiKey(''); }} />移除当前保存的 API Key</label>}<div className="settings-test"><span>保存配置后，测试 Pi 的消息与工具调用。</span><button type="button" className="secondary small" disabled={testBusy} onClick={() => void test()}>{testBusy ? <LoaderCircle className="spin" size={15} /> : <Play size={15} />}创建连接测试</button></div></section>
    <section className="panel settings-panel"><div className="panel-heading"><h2><FolderOpen size={18} />文件与权限</h2><span>本地路径</span></div>{(['workDirectory', 'outputDirectory'] as const).map(key => <label className="form-field" key={key}>{key === 'workDirectory' ? 'Agent 默认工作目录' : '任务输出目录'}<div className="inline-input"><input value={settings[key]} required onChange={event => set(key, event.target.value)} /><button type="button" className="icon-button" aria-label={`选择${key === 'workDirectory' ? '工作' : '输出'}目录`} onClick={() => void chooseDirectory(key)}><FolderOpen size={18} /></button></div></label>)}<label className="permission-row"><div><strong>允许 Agent 执行本地命令</strong><p>命令拥有当前用户权限，工作目录不是命令沙箱。请只对可信的 Skills 开启。</p></div><span className="switch"><input type="checkbox" checked={settings.allowCommands} onChange={event => set('allowCommands', event.target.checked)} /><span /></span></label></section>
    <section className="panel settings-panel"><div className="panel-heading"><h2><Terminal size={18} />执行器</h2><span>真实程序入口</span></div>{[['onetakeRoot', 'onetake 项目目录'], ['hypitRoot', 'hypit 项目目录'], ['socialRoot', 'social-auto-upload 项目目录'], ['montageRoot', 'bgm-montage 项目目录'], ['python', 'Python 可执行文件'], ['ffmpeg', 'FFmpeg 可执行文件']].map(([key, label]) => <label className="form-field" key={key}>{label}<input value={settings.executors[key as keyof Settings['executors']]} onChange={event => set('executors', { ...settings.executors, [key]: event.target.value })} placeholder={key === 'python' ? 'python' : key === 'ffmpeg' ? 'ffmpeg' : '本地项目绝对路径'} /></label>)}</section>
    <section className="panel settings-panel"><div className="panel-heading"><h2><SlidersHorizontal size={18} />Skills 扫描目录</h2></div><label className="form-field">每行一个本地目录<textarea value={settings.skillRoots.join('\n')} onChange={event => set('skillRoots', event.target.value.split('\n').filter(Boolean))} rows={4} placeholder="本地 Skills 目录完整路径" /></label><p className="field-help">保存后重新扫描，已启用的 Skills 将参与后续 Pi 会话的资源加载。</p></section><div className="settings-save"><button className="primary" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Check size={17} />}保存设置</button></div></div>
    <aside className="settings-aside"><section className="panel runtime-info"><span className="eyebrow">RUNTIME</span><h2>Pi 核心运行时</h2><dl><div><dt>引擎</dt><dd>{data.runtime.engine}</dd></div><div><dt>版本</dt><dd>{data.runtime.version}</dd></div><div><dt>状态</dt><dd>{data.runtime.connected ? '配置就绪 · 尚未测试' : '需要配置'}</dd></div><div><dt>模型列表</dt><dd>{data.runtime.models.length} 个</dd></div></dl>{data.runtime.issues.map((issue, index) => <p className="runtime-issue" key={index}>{issue}</p>)}</section><section className="panel settings-note"><ShieldCheck size={21} /><h2>在你的设备上</h2><p>任务、会话、素材和预设保存在本地。任务调用模型时，所需上下文会发送到你选择的模型服务。</p><p>自动发布在上传前单独确认。</p></section></aside></form></div>;
}
