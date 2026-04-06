import type Database from 'better-sqlite3'

export type SuggestResult = { slug: string; name: string; score: number } | null

export function suggestCategory(database: Database.Database, filename: string): SuggestResult {
  const lower = filename.toLowerCase()
  const rows = database
    .prepare('SELECT slug, name, keywords FROM categories')
    .all() as Array<{ slug: string; name: string; keywords: string | null }>

  let best: { slug: string; name: string; score: number } | null = null

  for (const row of rows) {
    let score = 0
    if (row.slug && lower.includes(row.slug.replace(/_/g, ' '))) score += 2
    if (row.slug && lower.includes(row.slug.replace(/_/g, '-'))) score += 2
    try {
      const kw = row.keywords ? (JSON.parse(row.keywords) as string[]) : []
      for (const k of kw) {
        if (k && lower.includes(String(k).toLowerCase())) score += 3
      }
    } catch {
      /* ignore */
    }
    if (score > 0 && (!best || score > best.score)) {
      best = { slug: row.slug, name: row.name, score }
    }
  }

  if (best && best.score >= 3) return best
  return null
}
