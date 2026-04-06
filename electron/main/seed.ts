import type Database from 'better-sqlite3'
import { readdir, readFile } from 'fs/promises'
import { join } from 'path'

const DEFAULT_CATEGORIES: Array<{
  name: string
  slug: string
  path_template: string
  keywords: string[]
  metadata_schema: Array<{ key: string; label: string }>
}> = [
  {
    name: "Driver's license",
    slug: 'drivers_license',
    path_template: 'Identification/State/{state}',
    keywords: ['license', 'dl', 'driver', 'driving', 'dmv'],
    metadata_schema: [
      { key: 'dl_number', label: 'License number' },
      { key: 'expiry', label: 'Expiry date' },
      { key: 'issue_date', label: 'Issue date' },
      { key: 'state', label: 'State' }
    ]
  },
  {
    name: 'Passport',
    slug: 'passport',
    path_template: 'Identification/Passport/{country}',
    keywords: ['passport', 'travel'],
    metadata_schema: [
      { key: 'passport_number', label: 'Passport number' },
      { key: 'expiry', label: 'Expiry date' },
      { key: 'country', label: 'Country' }
    ]
  },
  {
    name: 'Birth certificate',
    slug: 'birth_certificate',
    path_template: 'Identification/BirthCertificate',
    keywords: ['birth', 'certificate'],
    metadata_schema: [{ key: 'issued_by', label: 'Issued by' }]
  },
  {
    name: 'Immigration — visa',
    slug: 'immigration_visa',
    path_template: 'Immigration/Visa',
    keywords: ['visa', 'h1b', 'h-1b', 'l1', 'o1'],
    metadata_schema: [
      { key: 'visa_type', label: 'Visa type' },
      { key: 'expiry', label: 'Expiry date' },
      { key: 'i94', label: 'I-94 number' }
    ]
  },
  {
    name: 'Immigration — green card',
    slug: 'immigration_green_card',
    path_template: 'Immigration/GreenCard',
    keywords: ['green card', 'pr card', 'i-551', 'permanent resident'],
    metadata_schema: [
      { key: 'uscis_number', label: 'USCIS / card number' },
      { key: 'expiry', label: 'Expiry date' }
    ]
  },
  {
    name: 'Academic transcript',
    slug: 'academic_transcript',
    path_template: 'Academic/Transcripts/{institution}',
    keywords: ['transcript', 'university', 'college', 'gpa'],
    metadata_schema: [
      { key: 'institution', label: 'Institution' },
      { key: 'year', label: 'Year / term' }
    ]
  },
  {
    name: 'Diploma / degree',
    slug: 'academic_diploma',
    path_template: 'Academic/Diplomas/{institution}',
    keywords: ['diploma', 'degree', 'graduation'],
    metadata_schema: [{ key: 'institution', label: 'Institution' }, { key: 'degree', label: 'Degree' }]
  },
  {
    name: 'Tax return',
    slug: 'financial_tax_return',
    path_template: 'Financial/Tax/{year}',
    keywords: ['tax', '1040', 'w2', 'w-2', 'irs'],
    metadata_schema: [{ key: 'year', label: 'Tax year' }, { key: 'jurisdiction', label: 'Jurisdiction' }]
  },
  {
    name: 'Bank statement',
    slug: 'financial_bank_statement',
    path_template: 'Financial/Bank/{institution}',
    keywords: ['bank', 'statement', 'checking', 'savings'],
    metadata_schema: [
      { key: 'institution', label: 'Institution' },
      { key: 'period', label: 'Statement period' }
    ]
  },
  {
    name: 'Pay stub',
    slug: 'financial_pay_stub',
    path_template: 'Financial/PayStubs/{employer}',
    keywords: ['paystub', 'pay stub', 'payroll', 'salary'],
    metadata_schema: [{ key: 'employer', label: 'Employer' }, { key: 'period', label: 'Pay period' }]
  }
]

export function seedCategoriesIfEmpty(database: Database.Database): void {
  const n = (database.prepare('SELECT COUNT(*) as c FROM categories').get() as { c: number }).c
  if (n > 0) return
  const ins = database.prepare(`
    INSERT INTO categories (name, slug, path_template, keywords, metadata_schema)
    VALUES (@name, @slug, @path_template, @keywords, @metadata_schema)
  `)
  for (const c of DEFAULT_CATEGORIES) {
    ins.run({
      name: c.name,
      slug: c.slug,
      path_template: c.path_template,
      keywords: JSON.stringify(c.keywords),
      metadata_schema: JSON.stringify(c.metadata_schema)
    })
  }
}

type BundleSeedFile = {
  id: string
  name: string
  description?: string
  items: Array<{
    categorySlug: string
    label: string
    required?: boolean
    sortOrder?: number
  }>
}

export async function importBundleTemplatesFromDir(
  database: Database.Database,
  dir: string
): Promise<number> {
  let imported = 0
  let files: string[] = []
  try {
    files = await readdir(dir)
  } catch {
    return 0
  }
  for (const f of files.filter((x) => x.endsWith('.json'))) {
    const raw = await readFile(join(dir, f), 'utf-8')
    let data: BundleSeedFile
    try {
      data = JSON.parse(raw) as BundleSeedFile
    } catch {
      continue
    }
    if (!data.id || !data.name || !Array.isArray(data.items)) continue

    const existing = database
      .prepare('SELECT id FROM bundle_templates WHERE external_id = ?')
      .get(data.id) as { id: number } | undefined

    if (existing) {
      database.prepare('DELETE FROM bundle_template_items WHERE template_id = ?').run(existing.id)
      database
        .prepare('UPDATE bundle_templates SET name = ?, description = ? WHERE id = ?')
        .run(data.name, data.description ?? null, existing.id)
      const tid = existing.id
      const insItem = database.prepare(`
        INSERT INTO bundle_template_items (template_id, category_slug, label, required, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const item of data.items) {
        insItem.run(
          tid,
          item.categorySlug,
          item.label,
          item.required === false ? 0 : 1,
          item.sortOrder ?? 0
        )
      }
    } else {
      const r = database
        .prepare(
          'INSERT INTO bundle_templates (external_id, name, description) VALUES (?, ?, ?)'
        )
        .run(data.id, data.name, data.description ?? null)
      const tid = Number(r.lastInsertRowid)
      const insItem = database.prepare(`
        INSERT INTO bundle_template_items (template_id, category_slug, label, required, sort_order)
        VALUES (?, ?, ?, ?, ?)
      `)
      for (const item of data.items) {
        insItem.run(
          tid,
          item.categorySlug,
          item.label,
          item.required === false ? 0 : 1,
          item.sortOrder ?? 0
        )
      }
    }
    imported++
  }
  return imported
}
