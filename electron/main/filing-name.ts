import { basename, extname } from 'path'

/** Safe filename stem (no extension, no path separators). */
export function sanitizeFileStem(raw: string): string {
  const s = basename(String(raw || '').trim())
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/\.+$/, '')
    .trim()
  return s || 'document'
}

/** Final filename: stem + extension from original upload. */
export function buildFilingFilename(originalName: string, stem: string | null | undefined): string {
  const ext = extname(originalName || '').toLowerCase() || ''
  const fallbackStem = sanitizeFileStem(ext ? basename(originalName, ext) : basename(originalName))
  const useStem =
    stem != null && String(stem).trim() !== '' ? sanitizeFileStem(String(stem)) : fallbackStem
  return `${useStem || 'document'}${ext}`
}

/**
 * Human-readable filing stem from document type + extracted metadata (no extension).
 */
export function suggestFilingStem(
  slug: string | null | undefined,
  fields: Record<string, string>,
  categoryLabel: string
): string {
  const t = (v: string | undefined, max = 48) =>
    String(v || '')
      .trim()
      .replace(/[<>:"/\\|?*]+/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, max)

  const label = t(categoryLabel, 24).replace(/\s+/g, '-') || 'Document'

  if (slug === 'passport') {
    const c = t(fields.country, 14).replace(/\s+/g, '-') || 'Unknown'
    const e = t(fields.expiry, 14).replace(/\s+/g, '-')
    const n = t(fields.passport_number, 12).replace(/\s+/g, '-')
    const tail = e || n || ''
    return `Passport-${c}${tail ? `-${tail}` : ''}`.replace(/-+/g, '-').replace(/^-|-$/g, '') || 'Passport'
  }

  if (slug === 'drivers_license') {
    const st = t(fields.state, 6).replace(/\s+/g, '-')
    const e = t(fields.expiry, 14).replace(/\s+/g, '-')
    const idn = t(fields.dl_number, 12).replace(/\s+/g, '-')
    const tail = e || idn?.slice(-6) || ''
    return `Driver-license${st ? `-${st}` : ''}${tail ? `-${tail}` : ''}`
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'Driver-license'
  }

  const parts: string[] = [label]
  for (const v of Object.values(fields)) {
    const x = t(String(v), 20).replace(/\s+/g, '-')
    if (x) {
      parts.push(x)
      if (parts.length >= 3) break
    }
  }
  return parts.join('-').replace(/-+/g, '-').slice(0, 120) || 'Document'
}
