import { getDb } from './db'
import { homedir } from 'os'
import { join } from 'path'

export type AppSettings = {
  documentsRoot: string
  fileMode: 'copy' | 'move'
}

const DEFAULTS: AppSettings = {
  documentsRoot: join(homedir(), 'Documents'),
  fileMode: 'copy'
}

export function getSettings(): AppSettings {
  const row = getDb()
    .prepare('SELECT value FROM settings WHERE key = ?')
    .get('app') as { value: string } | undefined
  if (!row) return { ...DEFAULTS }
  try {
    const parsed = JSON.parse(row.value) as Partial<AppSettings>
    return { ...DEFAULTS, ...parsed }
  } catch {
    return { ...DEFAULTS }
  }
}

export function setSettings(partial: Partial<AppSettings>): AppSettings {
  const next = { ...getSettings(), ...partial }
  getDb()
    .prepare(
      `INSERT INTO settings (key, value) VALUES ('app', @value)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    .run({ value: JSON.stringify(next) })
  return next
}
