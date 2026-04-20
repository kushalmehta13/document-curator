import type Database from 'better-sqlite3'
import { extractDocumentText } from './extract'
import { classifyDocument, CONFIDENCE_AUTO_SELECT } from './classify'
import { suggestFilingStem } from './filing-name'

export type AnalysisResult = {
  ocr_status: string | null
  ocr_raw: string | null
  analysis: Record<string, unknown>
  categoryId: number | null
}

const MIN_TEXT_OK = 24

function ocrStatusFromExtract(text: string, source: string, error?: string): string {
  if (error) return 'failed'
  if (source === 'none' && !text) return 'skipped'
  if (text.length >= MIN_TEXT_OK) return 'ok'
  return 'partial'
}

function parseMetadata(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== 'string') return {}
  try {
    const o = JSON.parse(raw) as Record<string, unknown>
    const out: Record<string, string> = {}
    for (const [k, v] of Object.entries(o)) {
      if (k.startsWith('__')) continue
      out[k] = v == null ? '' : String(v)
    }
    return out
  } catch {
    return {}
  }
}

/**
 * Extract text, classify locally, persist ocr_* / analysis / metadata / optional category.
 * Preserves an existing category_id unless `resetCategory` is true.
 */
export async function analyzeDraftDocument(
  database: Database.Database,
  documentId: number,
  options: { resetCategory?: boolean } = {}
): Promise<AnalysisResult> {
  const row = database.prepare('SELECT * FROM documents WHERE id = ?').get(documentId) as
    | Record<string, unknown>
    | undefined
  if (!row) throw new Error('Document not found')

  const storedPath = String(row.stored_path)
  const originalName = String(row.original_name)
  const existingMeta = parseMetadata(row.metadata)
  const currentCat =
    row.category_id != null && row.category_id !== '' ? Number(row.category_id) : null
  const prevFiling =
    row.filing_name != null && String(row.filing_name).trim() !== ''
      ? String(row.filing_name).trim()
      : null

  const ex = await extractDocumentText(storedPath)
  const ocrStatus = ocrStatusFromExtract(ex.text, ex.source, ex.error)
  const classification = classifyDocument(database, originalName, ex.text)

  const preserveCategory = !options.resetCategory && currentCat != null
  let newCategoryId: number | null = currentCat
  if (!preserveCategory) {
    newCategoryId =
      classification.categoryId != null &&
      classification.confidence >= CONFIDENCE_AUTO_SELECT
        ? classification.categoryId
        : null
  }

  const merged: Record<string, string> = { ...existingMeta }

  const catForDoc = newCategoryId ?? currentCat
  const shouldMergeExtracted =
    classification.suggestedCategoryId != null &&
    catForDoc != null &&
    catForDoc === classification.suggestedCategoryId

  if (shouldMergeExtracted) {
    for (const [k, v] of Object.entries(classification.fields)) {
      if (!v) continue
      const cur = merged[k]
      if (cur == null || String(cur).trim() === '') merged[k] = v
    }
  }

  const fieldsForStem: Record<string, string> = { ...classification.fields }
  for (const [k, v] of Object.entries(merged)) {
    if (fieldsForStem[k] == null || !String(fieldsForStem[k]).trim()) {
      if (v != null && String(v).trim() !== '') fieldsForStem[k] = String(v).trim()
    }
  }

  const suggestedStem = suggestFilingStem(
    classification.slug,
    fieldsForStem,
    classification.name || 'Document'
  )

  const filingToStore = prevFiling ?? suggestedStem

  const analysisObj: Record<string, unknown> = {
    confidence: classification.confidence,
    suggestedCategoryId: classification.suggestedCategoryId,
    suggestedFields: classification.fields,
    suggestedFileStem: suggestedStem,
    slug: classification.slug,
    name: classification.name,
    signals: classification.signals,
    extractSource: ex.source,
    autoSelectThreshold: CONFIDENCE_AUTO_SELECT,
    autoApplied: classification.categoryId != null
  }
  if (ex.error) analysisObj.extractError = ex.error

  database
    .prepare(
      `UPDATE documents SET ocr_status = ?, ocr_raw = ?, analysis = ?, metadata = ?, category_id = ?,
       filing_name = ?, updated_at = datetime('now') WHERE id = ?`
    )
    .run(
      ocrStatus,
      ex.text || null,
      JSON.stringify(analysisObj),
      JSON.stringify(merged),
      newCategoryId,
      filingToStore,
      documentId
    )

  return {
    ocr_status: ocrStatus,
    ocr_raw: ex.text || null,
    analysis: analysisObj,
    categoryId: newCategoryId
  }
}
