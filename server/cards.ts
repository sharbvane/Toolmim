import type { ToolCard, Workflow, Field } from '../shared/types.js';
const options = (values: string[]) => values.map(value => ({ value, label: value }));
export const initialCards: ToolCard[] = [
  { id: 'onetake', title: 'AI 动效宣传片', description: '把产品亮点变成一镜到底的动效短片。', icon: 'sparkles', category: '视频创作', skillIds: ['onetake'], workflowId: 'onetake-film', fields: [
    { key: 'productName', label: '产品名称', type: 'text', required: true }, { key: 'description', label: '产品介绍', type: 'textarea', required: true },
    { key: 'url', label: '产品页面 URL', type: 'text' }, { key: 'assets', label: '截图与产品素材', type: 'files' }, { key: 'highlights', label: '宣传重点', type: 'textarea' },
    { key: 'duration', label: '目标时长（秒）', type: 'number', default: 20, min: 10, max: 30 }, { key: 'style', label: '视觉风格', type: 'select', default: 'ultramarine', options: ['paper:纸感', 'dusk:暮色', 'tabletop:桌面空间', 'ultramarine:群青', 'riso:孔版印刷', 'ember:暖焰'].map(option => ({ value: option.split(':')[0], label: option.split(':')[1] })) }
  ] },
  { id: 'hypit', title: 'AI 复刻视频', description: '从参考视频提取工作流，替换内容并生成变体。', icon: 'copy', category: '视频创作', skillIds: ['hypit'], workflowId: 'hypit-remix', fields: [
    { key: 'referenceVideo', label: '参考视频', type: 'file', required: true }, { key: 'replacement', label: '替换主题与内容', type: 'textarea', required: true },
    { key: 'preserve', label: '需要保留的内容', type: 'textarea', help: '作为 Agent 工作流要求；最终能力由本地安装的 Hypit 及工具配置决定。' },
    { key: 'ratio', label: '目标比例', type: 'select', default: '9:16', options: options(['9:16', '16:9', '1:1']) },
    { key: 'variants', label: '工作流变体数量', type: 'number', default: 1, min: 1, max: 5, help: '首版接通工作流 check / plan；完整 Build 与成片导出尚未接通。' }
  ] },
  { id: 'social', title: '自动发布', description: '检查账号与素材，确认预览后逐平台发布。', icon: 'send', category: '内容发布', skillIds: ['social-auto-upload'], workflowId: 'social-publish', fields: [
    { key: 'video', label: '本地视频', type: 'file', required: true }, { key: 'platforms', label: '发布平台', type: 'multiselect', required: true, options: ['douyin:抖音', 'kuaishou:快手', 'xiaohongshu:小红书', 'bilibili:B 站', 'tencent:视频号', 'youtube:YouTube', 'baijiahao:百家号'].map(option => ({ value: option.split(':')[0], label: option.split(':')[1] })) },
    { key: 'account', label: '上游账号名称', type: 'text', required: true, help: '在 sau 登录流程中建立的 account_name，Cookie 内容不会发送到浏览器。' },
    { key: 'title', label: '标题', type: 'text', required: true }, { key: 'description', label: '描述', type: 'textarea' }, { key: 'tags', label: '标签（逗号分隔）', type: 'text' },
    { key: 'accounts', label: '逐平台账号（JSON）', type: 'textarea', advanced: true, help: '例如 {"douyin":"my_account"}；覆盖统一账号名称。' },
    { key: 'schedule', label: '定时发布', type: 'text', advanced: true, help: '仅可用于上游支持的所选平台；格式 YYYY-MM-DD HH:mm，留空立即发布。' },
    { key: 'tid', label: 'B 站分区 ID', type: 'number', min: 1, advanced: true, help: '选择 B 站时必须填写，使用平台实际分区 ID。' }
  ] },
  { id: 'montage', title: '批量混剪', description: '多段视频配上 BGM，生成真实的自动卡点混剪。', icon: 'clapperboard', category: '视频创作', skillIds: ['bgm-montage'], workflowId: 'montage-local', fields: [
    { key: 'mode', label: '混剪模式', type: 'select', default: 'lite', options: [{ value: 'lite', label: '简化混剪 · 整首 BGM' }, { value: 'professional', label: '专业模式 · 参考视频' }], help: '简化模式无需参考视频，使用整首 1–600 秒 BGM；专业模式当前真实入口需要参考视频。' },
    { key: 'videos', label: '视频素材', type: 'files', required: true, help: '选择至少两段不同的素材；简化模式按整首音乐卡点。' }, { key: 'bgm', label: '背景音乐', type: 'file', required: true },
    { key: 'theme', label: '成片主题', type: 'text', required: true, default: '素材节奏混剪', when: { key: 'mode', value: 'professional' } }, { key: 'duration', label: '目标时长（秒）', type: 'number', default: 15, min: 5, max: 300, when: { key: 'mode', value: 'professional' } },
    { key: 'ratio', label: '画面比例', type: 'select', default: '16:9', options: options(['9:16', '16:9', '1:1', '4:5']) }, { key: 'count', label: '出片数量', type: 'number', default: 1, min: 1, max: 5 },
    { key: 'outputDirectory', label: '输出目录', type: 'directory', advanced: true, help: '留空使用设置中的产物目录；每个任务创建独立子目录。' },
    { key: 'referenceVideo', label: '参考视频', type: 'file', required: true, when: { key: 'mode', value: 'professional' } }, { key: 'visualStyle', label: '视觉风格', type: 'text', advanced: true, when: { key: 'mode', value: 'professional' } }
  ] }
];
export const workflows: Workflow[] = [
  { id: 'onetake-film', cardId: 'onetake', steps: ['生成三份创意', '选择方案', '分镜与动效', '渲染与质量检查'], requiresModel: true, requiresConfirmation: true },
  { id: 'hypit-remix', cardId: 'hypit', steps: ['解析参考视频', '还原工作流', '替换内容', '检查工作流与依赖计划'], requiresModel: true, requiresConfirmation: false },
  { id: 'social-publish', cardId: 'social', steps: ['账号与素材检查', '发布预览', '等待确认', '逐平台上传'], requiresModel: false, requiresConfirmation: true },
  { id: 'montage-local', cardId: 'montage', steps: ['素材与音频检查', '节拍和素材分析', '自动卡点混剪', '渲染与产物检查'], requiresModel: false, requiresConfirmation: false }
];
export function validateFields(fields: Field[], input: Record<string, unknown>) {
  const errors: string[] = [];
  for (const field of fields) {
    if (field.when && input[field.when.key] !== field.when.value) continue;
    const value = input[field.key];
    if (value === undefined || value === '' || value === null || (Array.isArray(value) && !value.length)) {
      if (field.required) errors.push(`请填写${field.label}`); continue;
    }
    if (field.type === 'number' && (typeof value !== 'number' || !Number.isFinite(value) || (field.min !== undefined && value < field.min) || (field.max !== undefined && value > field.max))) errors.push(`${field.label}超出允许范围`);
    if (['text', 'textarea', 'file', 'directory', 'select'].includes(field.type) && (typeof value !== 'string' || value.length > 32_000)) errors.push(`${field.label}格式无效`);
    if (['files', 'multiselect'].includes(field.type) && (!Array.isArray(value) || value.length > 100 || value.some(v => typeof v !== 'string'))) errors.push(`${field.label}必须是字符串列表`);
    if (field.options && field.type === 'select' && !field.options.some(option => option.value === value)) errors.push(`${field.label}不是可用选项`);
    if (field.options && field.type === 'multiselect' && Array.isArray(value) && value.some(v => !field.options!.some(option => option.value === v))) errors.push(`${field.label}包含无效选项`);
  }
  return errors;
}
