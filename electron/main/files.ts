import { copyFile, mkdir, rename, stat, access } from 'fs/promises'
import { dirname, join, basename, extname } from 'path'
import { constants } from 'fs'

export function sanitizeFilename(name: string): string {
  const base = basename(name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim()
  return base || 'document'
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
}

export async function uniquePath(dir: string, filename: string): Promise<string> {
  const ext = extname(filename)
  const stem = ext ? filename.slice(0, -ext.length) : filename
  let candidate = join(dir, filename)
  let n = 1
  while (true) {
    try {
      await access(candidate, constants.F_OK)
      candidate = join(dir, `${stem}-${n}${ext}`)
      n++
    } catch {
      return candidate
    }
  }
}

export async function finalizeFile(
  source: string,
  destDir: string,
  originalName: string,
  mode: 'copy' | 'move'
): Promise<string> {
  await ensureDir(destDir)
  const name = sanitizeFilename(originalName)
  const dest = await uniquePath(destDir, name)
  if (mode === 'move') {
    await rename(source, dest)
  } else {
    await copyFile(source, dest)
  }
  return dest
}

export async function pathExists(p: string): Promise<boolean> {
  try {
    await stat(p)
    return true
  } catch {
    return false
  }
}

export function resolveTemplate(
  template: string,
  vars: Record<string, string>
): string {
  let out = template.replace(/\\/g, '/').replace(/^\/+/, '')
  for (const [k, v] of Object.entries(vars)) {
    const safe = String(v || 'unknown').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    out = out.split(`{${k}}`).join(safe)
  }
  return out.replace(/\{[^}]+\}/g, 'unknown')
}
