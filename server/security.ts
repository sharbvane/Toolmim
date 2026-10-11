import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

export function inside(root: string, target: string) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
export function existingFile(value: unknown) {
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0')) throw new Error('文件路径无效');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isFile()) throw new Error('请选择实际存在的文件');
  return resolved;
}
export function directory(value: unknown) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0') || value.length > 4096) throw new Error('目录必须是有效的绝对路径');
  const resolved = fs.realpathSync(value);
  if (!fs.statSync(resolved).isDirectory()) throw new Error('目录不存在');
  return resolved;
}
export function redact(message: string, secrets: string[] = []) {
  let result = message.replace(/(bearer\s+)[^\s"']+/gi, '$1[已隐藏]').replace(/((?:api[_-]?key|token|cookie|password|authorization)\s*[:=]\s*)[^\n,}]+/gi, '$1[已隐藏]').replace(/sk-[A-Za-z0-9_-]{10,}/g, '[已隐藏]');
  for (const secret of secrets) if (secret.length >= 4) result = result.split(secret).join('[已隐藏]');
  return result;
}
async function dpapi(mode: 'protect' | 'unprotect', value: string) {
  if (process.platform !== 'win32') throw new Error('本版凭据持久化需要 Windows DPAPI，请在 Windows 运行。');
  const expression = mode === 'protect'
    ? '[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)'
    : '[Security.Cryptography.ProtectedData]::Unprotect([Convert]::FromBase64String($value),$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)';
  const output = mode === 'protect' ? '[Convert]::ToBase64String($bytes)' : '[Text.Encoding]::UTF8.GetString($bytes)';
  const script = `Add-Type -AssemblyName System.Security; $value=[Console]::In.ReadToEnd(); $bytes=${expression}; [Console]::Out.Write(${output})`;
  return new Promise<string>((resolve, reject) => {
    const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    let result = ''; child.stdout.on('data', data => result += data);
    child.stderr.resume(); child.on('error', () => reject(new Error('无法调用 Windows 凭据保护服务')));
    child.on('close', code => code === 0 ? resolve(result) : reject(new Error('Windows 凭据加解密失败，请重新配置密钥')));
    child.stdin.end(value);
  });
}
export class KeyVault {
  private cached?: string;
  constructor(private readonly file: string) {}
  async get() {
    if (this.cached !== undefined) return this.cached || undefined;
    this.cached = fs.existsSync(this.file) ? await dpapi('unprotect', fs.readFileSync(this.file, 'utf8')) : '';
    return this.cached || undefined;
  }
  async set(key: string) {
    if (!key.trim() || key.length > 8192 || /[\r\n]/.test(key)) throw new Error('API Key 格式无效');
    const encrypted = await dpapi('protect', key.trim());
    fs.writeFileSync(this.file + '.tmp', encrypted, { mode: 0o600 });
    fs.renameSync(this.file + '.tmp', this.file); this.cached = key.trim();
  }
  clear() { if (fs.existsSync(this.file)) fs.unlinkSync(this.file); this.cached = ''; }
}
