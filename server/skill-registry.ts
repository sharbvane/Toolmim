import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import type { Skill, CardId } from '../shared/types.js';

export function readSkill(input: string, previous?: Skill): Skill {
  const resolved = fs.realpathSync(input);
  const file = fs.statSync(resolved).isDirectory() ? path.join(resolved, 'SKILL.md') : resolved;
  if (path.basename(file).toLowerCase() !== 'skill.md') throw new Error('请选择包含 SKILL.md 的目录或 SKILL.md 文件');
  const source = fs.readFileSync(file, 'utf8');
  if (source.length > 2_000_000) throw new Error('SKILL.md 超过 2 MB');
  const frontmatter = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  const name = frontmatter?.[1].match(/^name:\s*([^\r\n]+)/m)?.[1].trim().replace(/^['"]|['"]$/g, '') || path.basename(path.dirname(file));
  const rawDescription = frontmatter?.[1].match(/^description:[ \t]*([^\r\n]*)(?:\r?\n((?:[ \t]+[^\r\n]*(?:\r?\n|$))*))?/m);
  const description = rawDescription ? (rawDescription[1].replace(/^[>|][-+]?$/, '') + (rawDescription[2] ?? '')).replace(/\s+/g, ' ').trim() : (source.match(/^#\s+(.+)/m)?.[1] ?? '本地 Skill 说明');
  const cardIds: CardId[] = /onetake/i.test(name) ? ['onetake'] : /hypit/i.test(name) ? ['hypit'] : /social.auto.upload/i.test(name) ? ['social'] : /bgm.montage/i.test(name) ? ['montage'] : [];
  return { id: createHash('sha256').update(file.toLowerCase()).digest('hex').slice(0, 16), name, description: description.slice(0, 800), path: file, source: '本地导入', enabled: previous?.enabled ?? false, issues: frontmatter ? [] : ['缺少 YAML 元数据，使用目录名称；可手动启用。'], cardIds };
}
export function scanSkills(roots: string[], previous: Skill[]) {
  const found = new Map<string, Skill>();
  for (const item of previous) {
    try { const next = readSkill(item.path, item); found.set(next.id, next); }
    catch { found.set(item.id, { ...item, enabled: false, issues: ['文件已移动或不存在，请重新导入。'] }); }
  }
  let visited = 0;
  const walk = (folder: string, depth: number) => {
    if (depth > 4 || visited++ > 1500) return;
    if (fs.existsSync(path.join(folder, 'SKILL.md'))) {
      try { const skill = readSkill(folder); found.set(skill.id, readSkill(folder, previous.find(p => p.id === skill.id))); } catch { /* unreadable resources are not enabled */ }
    }
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) if (entry.isDirectory() && !entry.name.startsWith('.') && !['node_modules', '.venv', 'vendor'].includes(entry.name)) {
      try { walk(path.join(folder, entry.name), depth + 1); } catch { /* a single inaccessible folder must not abort the scan */ }
    }
  };
  for (const root of roots) if (fs.existsSync(root) && fs.statSync(root).isDirectory()) walk(root, 0);
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}
