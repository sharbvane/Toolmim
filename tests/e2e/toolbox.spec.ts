import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

test('toolbox search, favorites, ordering and desktop view are real', async ({ page }) => {
  await page.goto('/'); await expect(page.getByRole('heading', { name: '今天，想做点什么？' })).toBeVisible();
  await expect(page.locator('.tool-card')).toHaveCount(4);
  await page.getByLabel('搜索工具', { exact: true }).fill('混剪'); await expect(page.locator('.tool-card')).toHaveCount(1);
  await page.getByLabel('清空搜索').click(); await page.getByLabel('收藏批量混剪').click();
  await page.getByRole('button', { name: '我的收藏', exact: true }).click(); await expect(page.locator('.tool-card')).toHaveCount(1);
  await page.getByRole('button', { name: '全部工具', exact: true }).click();
  await page.getByRole('button', { name: '排列工具' }).click(); await page.getByLabel('批量混剪向前移动').click();
  await expect(page.locator('.tool-card').nth(2)).toContainText('批量混剪'); await page.getByRole('button', { name: '完成排序' }).click();
  fs.mkdirSync(path.resolve('test-results/screenshots'), { recursive: true }); await page.screenshot({ path: 'test-results/screenshots/toolbox.png', fullPage: true });
  await page.reload(); await expect(page.locator('.tool-card').nth(2)).toContainText('批量混剪');
});
test('dedicated tool fields, real upload and persisted presets', async ({ page }) => {
  await page.goto('/'); await page.getByRole('heading', { name: 'AI 动效宣传片', exact: true }).click();
  await expect(page.getByLabel('产品名称')).toBeVisible(); await page.getByLabel('产品名称').fill('图明测试');
  await page.getByLabel('产品介绍').fill('本地工具箱'); await page.getByLabel('预设名称').fill('浏览器验证预设');
  await page.getByRole('button', { name: '保存为预设' }).click(); await expect(page.getByLabel('加载本地预设')).toBeVisible();
  const fixture = path.resolve('test-results/image.png'); fs.writeFileSync(fixture, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2ZAAAAABJRU5ErkJggg==', 'base64'));
  await page.locator('input[type=file]').first().setInputFiles(fixture);
  await expect(page.getByLabel('截图与产品素材')).toHaveValue(/image.png/);
  await page.getByRole('button', { name: '全部工具', exact: true }).click(); await page.getByRole('heading', { name: 'AI 复刻视频', exact: true }).click(); await expect(page.getByLabel('参考视频', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '全部工具', exact: true }).click(); await page.getByRole('heading', { name: '自动发布', exact: true }).click(); await expect(page.getByLabel('上游账号名称')).toBeVisible(); await expect(page.getByRole('group', { name: '发布平台' })).toBeVisible();
  await page.getByRole('button', { name: '全部工具', exact: true }).click(); await page.getByRole('heading', { name: '批量混剪', exact: true }).click(); await expect(page.getByLabel('背景音乐', { exact: true })).toBeVisible();
});
test('missing model credentials become an actual failed task and retry is traceable', async ({ page }) => {
  await page.goto('/'); await page.getByRole('button', { name: '设置', exact: true }).first().click();
  await page.getByRole('button', { name: '创建连接测试' }).click();
  await expect(page.locator('.task-detail')).toContainText('请先在设置页配置项目专用 API Key');
  await expect(page.locator('.task-detail')).toContainText('失败');
  await page.getByRole('button', { name: '重试任务' }).click();
  await expect(page.locator('.task-detail')).toContainText('请先在设置页配置项目专用 API Key');
});
test('local Skill imports, toggles and refreshes via the real registry', async ({ page }) => {
  const folder = path.resolve('test-results/browser-skill'); fs.mkdirSync(folder, { recursive: true }); fs.writeFileSync(path.join(folder, 'SKILL.md'), '---\nname: browser-validation-skill\ndescription: browser integration fixture\n---\nUse only for a local test.');
  await page.goto('/'); await page.getByRole('button', { name: 'Skills 库', exact: true }).click();
  await page.getByRole('button', { name: '导入本地 Skill' }).click(); await page.getByLabel('本地 Skill 路径').fill(folder); await page.getByRole('button', { name: '导入', exact: true }).click();
  await page.getByLabel('搜索 Skills', { exact: true }).fill('browser-validation-skill');
  const toggle = page.getByLabel('启用 browser-validation-skill', { exact: true }); await expect(toggle).not.toBeChecked(); await toggle.check(); await expect(toggle).toBeChecked();
  await page.getByRole('button', { name: '重新扫描' }).click(); await expect(toggle).toBeChecked();
});
test('narrow window stays usable and browser reports no runtime errors', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 }); await page.goto('/'); await expect(page.locator('.tool-card')).toHaveCount(4);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await page.getByRole('button', { name: 'Pi Agent', exact: true }).click(); await expect(page.getByRole('heading', { name: '复杂一点，也可以。' })).toBeVisible();
  await expect(page.getByRole('button', { name: '发送', exact: true })).toBeDisabled();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy(); expect(errors).toEqual([]);
});
