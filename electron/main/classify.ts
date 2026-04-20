import type Database from 'better-sqlite3'
import { suggestCategory } from './suggest'

export type ClassificationAnalysis = {
  /** Set only when score ≥ auto-apply threshold (used to pre-select category in DB). */
  categoryId: number | null
  /** Best-scoring category whenever any category scored > 0 (for “Use suggestion” in the UI). */
  suggestedCategoryId: number | null
  slug: string | null
  name: string | null
  confidence: number
  signals: string[]
  fields: Record<string, string>
}

export const CONFIDENCE_AUTO_SELECT = 0.55

type CategoryRow = {
  id: number
  name: string
  slug: string
  keywords: string | null
  metadata_schema: string | null
}

type SchemaField = { key: string; label: string }

const SLUG_HINTS: Record<string, Array<{ re: RegExp; score: number }>> = {
  financial_tax_return: [
    { re: /\bform\s*1040\b/i, score: 0.35 },
    { re: /\binternal revenue service\b|\birs\.gov\b/i, score: 0.3 },
    { re: /\b1040\b/i, score: 0.22 },
    { re: /\btax\s+year\b|\btaxable\s+year\b/i, score: 0.12 }
  ],
  financial_bank_statement: [
    { re: /\baccount\s+(number|ending)\b/i, score: 0.28 },
    { re: /\bstatement\s+period\b|\bending\s+balance\b/i, score: 0.22 },
    { re: /\bchecking\b|\bsavings\b/i, score: 0.12 }
  ],
  financial_pay_stub: [
    { re: /\bgross\s+pay\b|\bnet\s+pay\b|\bytd\b/i, score: 0.3 },
    { re: /\bearnings\s+statement\b|\bpay\s+stub\b/i, score: 0.28 },
    { re: /\bemployee\s+id\b|\bfederal\s+filing\s+status\b/i, score: 0.15 }
  ],
  passport: [
    { re: /\bpassport\b/i, score: 0.35 },
    { re: /\bunited\s+states\s+of\s+america\b/i, score: 0.12 }
  ],
  drivers_license: [
    { re: /\bDRIVER\s+LICEN[SC]E\b|\bDMV\b/i, score: 0.3 },
    { re: /\bDL\s*#?\s*[:\s]?\s*[A-Z0-9*]{4,}\b/i, score: 0.22 }
  ],
  birth_certificate: [
    { re: /\bbirth\s+certificate\b|\bcertificate\s+of\s+birth\b/i, score: 0.35 },
    { re: /\bregistry\s+of\s+vital\s+records\b/i, score: 0.2 }
  ],
  immigration_visa: [
    { re: /\bvisa\b.*\bclassification\b|\bnonimmigrant\s+visa\b/i, score: 0.32 },
    { re: /\bI-94\b|\bI94\b/i, score: 0.22 },
    { re: /\bH-1B\b|\bH1B\b|\bL-1\b|\bO-1\b/i, score: 0.18 }
  ],
  immigration_green_card: [
    { re: /\bpermanent\s+resident\b|\bI-551\b|\bUSCIS#\b/i, score: 0.35 },
    { re: /\bresident\s+since\b|\bcard\s+expires\b/i, score: 0.2 }
  ],
  academic_transcript: [
    { re: /\btranscript\b.*\b(credit|gpa|semester|hours)\b/i, score: 0.28 },
    { re: /\bcumulative\s+gpa\b|\bofficial\s+transcript\b/i, score: 0.25 }
  ],
  academic_diploma: [
    { re: /\bdegree\s+certificate\b|\bdiploma\b|\bdegree\s+conferred\b|\bgraduation\b/i, score: 0.32 },
    { re: /\bbachelor\b|\bmaster\b|\bdoctor\b.*\bdegree\b/i, score: 0.15 }
  ]
}

const FIELD_REGEX: Record<string, Record<string, RegExp>> = {
  financial_tax_return: {
    year: /\b(20[0-2]\d)\s+(tax|taxable)\s+year\b|\btax\s+year\s*(20[0-2]\d)\b|\bfor\s+year\s+(20[0-2]\d)\b/i
  },
  financial_bank_statement: {
    institution: /\b([A-Z][A-Za-z0-9 &.'-]{2,40})\s+(checking|savings)\b/i
  },
  financial_pay_stub: {
    employer: /\bemployer[:\s]+([A-Za-z0-9 &.'-]{2,60})/i,
    period: /\b(pay\s+period|period\s+ending)[:\s]+([^\n]{4,40})/i
  },
  passport: {
    passport_number: /\bpassport\s*(no\.?|number|#)?\s*[:\s]?\s*([A-Z0-9]{6,14})\b/i,
    country: /\bnationality[:\s]+([A-Za-z][A-Za-z\s]{1,36}?)(?:\n|$|\s{2,}|[,.])/i,
    expiry: /\bexp(?:ir(?:y|ation|es?))?\.?\s*[:\s.]+\s*(\d{1,2}[\s./-]+\d{1,2}[\s./-]+\d{2,4})/i
  },
  drivers_license: {
    dl_number: /\b(?:DL|LIC(?:ENSE)?)\s*[#:\s.]*\s*([A-Z0-9*]{5,})\b/i,
    state: /\b([A-Z]{2})\s+Driver'?s?\s+Licens/i,
    expiry: /\bexp(?:\.|iry)?\s*[:\s.]+\s*(\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{2,4})/i,
    issue_date: /\biss(?:ued?|ue)?\.?\s*[:\s.]+\s*(\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{2,4})/i
  },
  immigration_visa: {
    visa_type: /\b(class|category)\s*[:\s]+([A-Z0-9-]{2,10})\b/i,
    i94: /\bI-?94\s*#?\s*:?\s*([0-9]{8,12})\b/i
  },
  immigration_green_card: {
    uscis_number: /\b(?:USCIS#|A-?)\s*([0-9]{6,12})\b/i
  },
  academic_transcript: {
    institution: /\b([A-Z][A-Za-z0-9 .,'-]{4,60})\s*(university|college|institute)\b/i
  },
  academic_diploma: {
    institution: /\b([A-Z][A-Za-z0-9 .,'-]{4,60})\s*(university|college)\b/i,
    degree: /\b(Bachelor|Master|Doctor|Associate)\b[^.\n]{0,40}\b(of\s+[^.\n]{2,40})/i
  }
}

function parseKeywords(raw: string | null): string[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    return Array.isArray(arr) ? arr.map((x) => String(x)) : []
  } catch {
    return []
  }
}

function parseSchema(raw: string | null): SchemaField[] {
  if (!raw) return []
  try {
    const arr = JSON.parse(raw) as unknown
    if (!Array.isArray(arr)) return []
    return arr
      .map((x) => x as { key?: string; label?: string })
      .filter((x) => x && typeof x.key === 'string')
      .map((x) => ({ key: x.key as string, label: typeof x.label === 'string' ? x.label : x.key! }))
  } catch {
    return []
  }
}

function scoreKeywords(slug: string, keywords: string[], blob: string): { score: number; hits: string[] } {
  const lower = blob.toLowerCase()
  let score = 0
  const hits: string[] = []
  for (const k of keywords) {
    const kk = k.toLowerCase()
    if (kk && lower.includes(kk)) {
      score += 0.12
      hits.push(`keyword:${k}`)
    }
  }
  const slugWords = slug.replace(/_/g, ' ').toLowerCase()
  if (slugWords && lower.includes(slugWords)) {
    score += 0.08
    hits.push('slug')
  }
  return { score, hits }
}

function hintScore(slug: string, haystack: string): { score: number; signals: string[] } {
  const hints = SLUG_HINTS[slug]
  if (!hints) return { score: 0, signals: [] }
  let score = 0
  const signals: string[] = []
  for (const h of hints) {
    if (h.re.test(haystack)) {
      score += h.score
      signals.push(`pattern`)
    }
  }
  return { score, signals }
}

function fillIfEmpty(out: Record<string, string>, key: string, value: string | undefined) {
  if (value == null || !String(value).trim()) return
  if (out[key] != null && String(out[key]).trim() !== '') return
  out[key] = String(value).trim()
}

/** Extra heuristics for OCR-noisy passport images (MRZ-ish and common labels). */
function enrichPassportFields(haystack: string, out: Record<string, string>) {
  const h = haystack.replace(/\r/g, '\n')

  const numPatterns = [
    /\b([A-Z]\d{8,9})\b/,
    /Passport\s*(?:No\.?|Number|#)?\s*[:\s]{0,3}([A-Z0-9]{6,14})\b/i,
    /(?:^|\s)PPT\s*#?\s*([A-Z0-9]{6,14})\b/i,
    /Document\s*No\.?\s*[:\s]*([A-Z0-9]{6,14})\b/i
  ]
  for (const re of numPatterns) {
    const m = h.match(re)
    if (m?.[1]) {
      fillIfEmpty(out, 'passport_number', m[1])
      break
    }
  }

  const mrz = h.match(/[\n\r]([A-Z0-9<]{9})\d([A-Z<]{3})/)
  if (mrz?.[1]) {
    const num = mrz[1].replace(/</g, '')
    if (num.length >= 6) fillIfEmpty(out, 'passport_number', num)
  }

  const expPatterns = [
    /Exp(?:ir(?:y|ation|es?))?\.?\s*[:\s.]+\s*(\d{1,2}[\s./-]+\d{1,2}[\s./-]+\d{2,4})/i,
    /(?:Date\s+of\s+)?Exp(?:iry)?\s*[:\s]+\s*(\d{2}\s+[A-Za-z]{3}\s+\d{4})/i,
    /(\d{1,2}[\s./-]\d{1,2}[\s./-]\d{4})\s*(?:EXP|Expires?)\b/i
  ]
  for (const re of expPatterns) {
    const m = h.match(re)
    if (m?.[1]) {
      fillIfEmpty(out, 'expiry', m[1].trim())
      break
    }
  }

  const nat = h.match(/Nationality[:\s]+([A-Za-z][A-Za-z\s]{0,28}?)(?:\n|$|\s{2,}|[,.])/i)
  if (nat?.[1]) fillIfEmpty(out, 'country', nat[1].trim())

  const iss = h.match(/Issuing\s+(?:country|state|authority)[:\s]+([A-Za-z][^\n]{0,30}?)(?:\n|$)/i)
  if (iss?.[1]) fillIfEmpty(out, 'country', iss[1].trim())

  if (!out.country && /\bUnited\s+States\s+of\s+America\b/i.test(h)) fillIfEmpty(out, 'country', 'USA')
  if (!out.country && /\bUSA\b/i.test(h)) fillIfEmpty(out, 'country', 'USA')
}

/** Extra heuristics for US-style driver licenses and PDF417-style labels. */
function enrichDriversLicenseFields(haystack: string, out: Record<string, string>) {
  const h = haystack.replace(/\r/g, '\n')

  const dlPatterns = [
    /\b(?:DL|CDL|LIC(?:ENSE)?)\s*[#:\s.]*\s*([A-Z0-9*]{5,})\b/i,
    /\bI\.?D\.?\s*(?:N(?:O)?\.?|Number)?\s*[#:\s.]*\s*([A-Z0-9*]{6,})\b/i,
    /License\s*#\s*([A-Z0-9*]{5,})\b/i,
    /Document\s*#?\s*[:\s]*([A-Z0-9*]{5,})\b/i
  ]
  for (const re of dlPatterns) {
    const m = h.match(re)
    if (m?.[1]) {
      fillIfEmpty(out, 'dl_number', m[1].replace(/\*/g, ''))
      break
    }
  }

  const st = h.match(/\b([A-Z]{2})\s+Driver'?s?\s+Licens/i)
  if (st?.[1]) fillIfEmpty(out, 'state', st[1])

  const st2 = h.match(/State\s*[:\s]\s*([A-Z]{2})\b/i)
  if (st2?.[1] && st2[1] !== 'XX') fillIfEmpty(out, 'state', st2[1])

  const expPatterns = [
    /EXP(?:\.|(?:IRATION|IRY)?)?\s*[:\s.]+\s*(\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{2,4})/i,
    /Expires?\s*[:\s]+\s*(\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{2,4})/i,
    /\b4[Dd]\s*[:\s]+\s*(\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{2,4})/
  ]
  for (const re of expPatterns) {
    const m = h.match(re)
    if (m?.[1]) {
      fillIfEmpty(out, 'expiry', m[1].trim())
      break
    }
  }

  const iss = h.match(/ISS(?:UED?|UE)?\s*[:\s.]+\s*(\d{1,2}[\s/-]+\d{1,2}[\s/-]+\d{2,4})/i)
  if (iss?.[1]) fillIfEmpty(out, 'issue_date', iss[1].trim())
}

function extractFieldsForSlug(
  slug: string,
  schema: SchemaField[],
  haystack: string
): Record<string, string> {
  const out: Record<string, string> = {}
  const perSlug = FIELD_REGEX[slug]
  if (perSlug) {
    for (const f of schema) {
      const re = perSlug[f.key]
      if (!re) continue
      const m = haystack.match(re)
      if (!m) continue
      const cap = m.slice(1).find((g) => g != null && String(g).trim().length > 0)
      if (cap) out[f.key] = String(cap).trim()
    }
  }

  if (slug === 'passport') enrichPassportFields(haystack, out)
  else if (slug === 'drivers_license') enrichDriversLicenseFields(haystack, out)

  if (slug === 'financial_tax_return' && !out.year) {
    const y = haystack.match(/\b(20[0-2]\d)\b/)
    if (y) out.year = y[1]!
  }

  return out
}

export function classifyDocument(
  database: Database.Database,
  originalFilename: string,
  extractedText: string
): ClassificationAnalysis {
  const haystack = `${originalFilename}\n${extractedText}`.trim()
  const blob = `${originalFilename} ${extractedText}`.toLowerCase()

  const rows = database
    .prepare(`SELECT id, name, slug, keywords, metadata_schema FROM categories ORDER BY id`)
    .all() as CategoryRow[]

  type Scored = { id: number; name: string; slug: string; score: number; signals: string[] }
  const scored: Scored[] = []

  for (const row of rows) {
    const keywords = parseKeywords(row.keywords)
    const kw = scoreKeywords(row.slug, keywords, blob)
    const hi = hintScore(row.slug, haystack)
    const total = kw.score + hi.score
    if (total <= 0 && kw.hits.length === 0 && hi.signals.length === 0) continue
    scored.push({
      id: row.id,
      name: row.name,
      slug: row.slug,
      score: total,
      signals: [...kw.hits, ...hi.signals]
    })
  }

  const filenameSug = suggestCategory(database, originalFilename)
  if (filenameSug && filenameSug.score >= 3) {
    const bump = 0.12 + Math.min(0.22, filenameSug.score * 0.04)
    const existing = scored.find((s) => s.slug === filenameSug.slug)
    if (existing) {
      existing.score += bump
      existing.signals.push(`filename:${filenameSug.slug}`)
    } else {
      const row = rows.find((r) => r.slug === filenameSug.slug)
      if (row) {
        scored.push({
          id: row.id,
          name: row.name,
          slug: row.slug,
          score: bump,
          signals: [`filename:${filenameSug.slug}`]
        })
      }
    }
  }

  scored.sort((a, b) => b.score - a.score)
  const best = scored[0]
  const cappedScore = best ? Math.min(1, best.score) : 0
  const categoryId = best && cappedScore >= CONFIDENCE_AUTO_SELECT ? best.id : null
  const suggestedCategoryId = best ? best.id : null

  const slug = best?.slug ?? null
  const schemaRow = slug ? rows.find((r) => r.slug === slug) : undefined
  const schema = parseSchema(schemaRow?.metadata_schema ?? null)
  const fields = slug ? extractFieldsForSlug(slug, schema, haystack) : {}

  return {
    categoryId,
    suggestedCategoryId,
    slug: best?.slug ?? null,
    name: best?.name ?? null,
    confidence: cappedScore,
    signals: best?.signals ?? [],
    fields
  }
}
