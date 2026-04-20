import { ipcMain, dialog, shell, app } from 'electron'
import { copyFile, unlink, stat } from 'fs/promises'
import { join, basename } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getSettings, setSettings } from './settings'
import { finalizeFile, resolveTemplate, sanitizeFilename, ensureDir } from './files'
import { suggestCategory } from './suggest'
import { seedCategoriesIfEmpty, importBundleTemplatesFromDir } from './seed'
import { analyzeDraftDocument } from './analyze'
function templatesDir(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath, 'bundle-templates')
  }
  return join(app.getAppPath(), 'resources', 'bundle-templates')
}

function inboxDir(): string {
  return join(app.getPath('userData'), 'inbox')
}

export function registerIpc(): void {
  ipcMain.handle('settings:get', () => getSettings())
  ipcMain.handle('settings:set', (_e, partial: Record<string, unknown>) => {
    const s: Partial<{ documentsRoot: string; fileMode: 'copy' | 'move' }> = {}
    if (typeof partial.documentsRoot === 'string') s.documentsRoot = partial.documentsRoot
    if (partial.fileMode === 'copy' || partial.fileMode === 'move') s.fileMode = partial.fileMode
    return setSettings(s)
  })

  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'heic'] },
        { name: 'All', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths[0]) return null
    return r.filePaths[0]
  })

  ipcMain.handle('categories:list', () => {
    return getDb()
      .prepare(
        `SELECT id, name, slug, path_template, keywords, metadata_schema, created_at FROM categories ORDER BY name`
      )
      .all()
  })

  ipcMain.handle(
    'categories:create',
    (
      _e,
      row: {
        name: string
        slug: string
        path_template: string
        keywords?: string[]
        metadata_schema?: Array<{ key: string; label: string }>
      }
    ) => {
      const slug = row.slug.replace(/\s+/g, '_').toLowerCase()
      const r = getDb()
        .prepare(
          `INSERT INTO categories (name, slug, path_template, keywords, metadata_schema)
           VALUES (?, ?, ?, ?, ?)`
        )
        .run(
          row.name,
          slug,
          row.path_template,
          JSON.stringify(row.keywords ?? []),
          JSON.stringify(row.metadata_schema ?? [])
        )
      return Number(r.lastInsertRowid)
    }
  )

  ipcMain.handle(
    'categories:update',
    (
      _e,
      id: number,
      row: Partial<{
        name: string
        path_template: string
        keywords: string[]
        metadata_schema: Array<{ key: string; label: string }>
      }>
    ) => {
      const db = getDb()
      const cur = db.prepare('SELECT * FROM categories WHERE id = ?').get(id) as Record<
        string,
        unknown
      > | null
      if (!cur) return false
      const name = row.name ?? (cur.name as string)
      const path_template = row.path_template ?? (cur.path_template as string)
      const keywords =
        row.keywords !== undefined ? JSON.stringify(row.keywords) : (cur.keywords as string)
      const metadata_schema =
        row.metadata_schema !== undefined
          ? JSON.stringify(row.metadata_schema)
          : (cur.metadata_schema as string)
      db.prepare(
        `UPDATE categories SET name = ?, path_template = ?, keywords = ?, metadata_schema = ? WHERE id = ?`
      ).run(name, path_template, keywords, metadata_schema, id)
      return true
    }
  )

  ipcMain.handle('categories:delete', (_e, id: number) => {
    const n = (
      getDb().prepare('SELECT COUNT(*) as c FROM documents WHERE category_id = ?').get(id) as {
        c: number
      }
    ).c
    if (n > 0) return { ok: false, error: 'Category has documents' }
    getDb().prepare('DELETE FROM categories WHERE id = ?').run(id)
    return { ok: true }
  })

  ipcMain.handle('documents:suggestCategory', (_e, filename: string) => {
    return suggestCategory(getDb(), filename)
  })

  ipcMain.handle('documents:createDraft', async (_e, sourcePath: string) => {
    const db = getDb()
    let st: Awaited<ReturnType<typeof stat>>
    try {
      st = await stat(sourcePath)
    } catch {
      throw new Error(
        'Could not read that file. If it lives in iCloud Drive, open it in Finder first and wait for the cloud icon to disappear (fully downloaded), then try again.'
      )
    }
    if (!st.isFile()) throw new Error('Not a file')
    const originalName = basename(sourcePath)
    const id = randomUUID()
    const safe = sanitizeFilename(originalName)
    const inbox = inboxDir()
    await ensureDir(inbox)
    const dest = join(inbox, `${id}_${safe}`)
    try {
      await copyFile(sourcePath, dest)
    } catch (err: unknown) {
      const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: string }).code) : ''
      if (code === 'ENOENT') {
        throw new Error(
          'Copy failed (file missing or not accessible). For iCloud files, download them locally in Finder first.'
        )
      }
      throw err
    }
    const sug = suggestCategory(db, originalName)
    const r = db
      .prepare(
        `INSERT INTO documents (category_id, original_name, stored_path, inbox_path, status, metadata, template_vars)
         VALUES (NULL, ?, ?, ?, 'draft', '{}', NULL)`
      )
      .run(originalName, dest, dest)
    const docId = Number(r.lastInsertRowid)

    let analysisError: string | undefined
    try {
      await analyzeDraftDocument(db, docId)
    } catch (err) {
      analysisError = err instanceof Error ? err.message : String(err)
    }

    const after = db
      .prepare(
        `SELECT id, category_id, analysis, ocr_status, metadata FROM documents WHERE id = ?`
      )
      .get(docId) as Record<string, unknown> | undefined

    let analysisParsed: Record<string, unknown> | null = null
    if (after?.analysis && typeof after.analysis === 'string') {
      try {
        analysisParsed = JSON.parse(after.analysis) as Record<string, unknown>
      } catch {
        analysisParsed = null
      }
    }

    return {
      id: docId,
      suggested: sug,
      analysis: analysisParsed,
      categoryId: after?.category_id != null ? Number(after.category_id) : null,
      ocr_status: after?.ocr_status != null ? String(after.ocr_status) : null,
      analysisError
    }
  })

  ipcMain.handle(
    'documents:analyzeLocal',
    async (_e, payload: { id: number; resetCategory?: boolean }) => {
      const db = getDb()
      const doc = db.prepare('SELECT status FROM documents WHERE id = ?').get(payload.id) as
        | { status: string }
        | undefined
      if (!doc) throw new Error('Document not found')
      if (doc.status !== 'draft') throw new Error('Only drafts can be re-analyzed')
      await analyzeDraftDocument(db, payload.id, { resetCategory: payload.resetCategory === true })
      return db
        .prepare(
          `SELECT d.id, d.category_id, d.analysis, d.ocr_status, d.metadata,
           c.name as category_name, c.slug as category_slug, c.path_template, c.metadata_schema
           FROM documents d LEFT JOIN categories c ON c.id = d.category_id WHERE d.id = ?`
        )
        .get(payload.id)
    }
  )

  ipcMain.handle('documents:applySuggestion', (_e, docId: number) => {
    const db = getDb()
    const row = db.prepare('SELECT * FROM documents WHERE id = ?').get(docId) as
      | Record<string, unknown>
      | undefined
    if (!row) throw new Error('Document not found')
    if (row.status !== 'draft') throw new Error('Only drafts can use suggestions')

    let analysis: Record<string, unknown> = {}
    try {
      analysis = JSON.parse(String(row.analysis || '{}')) as Record<string, unknown>
    } catch {
      throw new Error('No analysis on this document — run local analysis first')
    }

    let suggestedId: number | undefined =
      typeof analysis.suggestedCategoryId === 'number' ? analysis.suggestedCategoryId : undefined
    if (suggestedId == null && typeof analysis.slug === 'string') {
      const cat = db
        .prepare('SELECT id FROM categories WHERE slug = ?')
        .get(analysis.slug) as { id: number } | undefined
      suggestedId = cat?.id
    }
    if (suggestedId == null) throw new Error('No suggested category — pick one manually')

    const rawFields = analysis.suggestedFields
    const fields =
      rawFields &&
      typeof rawFields === 'object' &&
      rawFields !== null &&
      !Array.isArray(rawFields)
        ? (rawFields as Record<string, unknown>)
        : {}

    const meta: Record<string, string> = {}
    try {
      const o = JSON.parse(String(row.metadata || '{}')) as Record<string, unknown>
      for (const [k, v] of Object.entries(o)) {
        if (k.startsWith('__')) continue
        meta[k] = v == null ? '' : String(v)
      }
    } catch {
      /* empty */
    }

    for (const [k, v] of Object.entries(fields)) {
      if (v == null) continue
      const s = String(v).trim()
      if (s !== '') meta[k] = s
    }

    db.prepare(
      `UPDATE documents SET category_id = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(suggestedId, JSON.stringify(meta), docId)

    return true
  })

  ipcMain.handle(
    'documents:finalize',
    async (
      _e,
      payload: {
        id: number
        categoryId: number
        templateVars: Record<string, string>
        continueLater?: boolean
        metadata?: Record<string, string>
      }
    ) => {
      const db = getDb()
      const doc = db.prepare('SELECT * FROM documents WHERE id = ?').get(payload.id) as
        | Record<string, unknown>
        | undefined
      if (!doc) throw new Error('Document not found')
      const metaJson =
        payload.metadata !== undefined
          ? JSON.stringify(payload.metadata ?? {})
          : String(doc.metadata ?? '{}')
      if (payload.continueLater) {
        db.prepare(
          `UPDATE documents SET category_id = ?, template_vars = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
        ).run(payload.categoryId, JSON.stringify(payload.templateVars ?? {}), metaJson, payload.id)
        return { ok: true, stored_path: doc.stored_path }
      }

      const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(payload.categoryId) as
        | { path_template: string }
        | undefined
      if (!cat) throw new Error('Category not found')

      const settings = getSettings()
      const rel = resolveTemplate(cat.path_template, payload.templateVars ?? {})
      const destDir = join(settings.documentsRoot, rel)
      const currentPath = doc.stored_path as string
      const originalName = doc.original_name as string

      const finalPath = await finalizeFile(
        currentPath,
        destDir,
        originalName,
        settings.fileMode
      )

      if (settings.fileMode === 'copy' && currentPath !== finalPath) {
        try {
          await unlink(currentPath)
        } catch {
          /* ignore */
        }
      }

      db.prepare(
        `UPDATE documents SET category_id = ?, stored_path = ?, inbox_path = NULL, status = 'complete',
         template_vars = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        payload.categoryId,
        finalPath,
        JSON.stringify(payload.templateVars ?? {}),
        metaJson,
        payload.id
      )

      return { ok: true, stored_path: finalPath }
    }
  )

  ipcMain.handle(
    'documents:list',
    (_e, filter?: { status?: string; categoryId?: number }) => {
      let sql = `SELECT d.*, c.name as category_name, c.slug as category_slug, c.metadata_schema
        FROM documents d LEFT JOIN categories c ON c.id = d.category_id WHERE 1=1`
      const params: unknown[] = []
      if (filter?.status) {
        sql += ' AND d.status = ?'
        params.push(filter.status)
      }
      if (filter?.categoryId != null) {
        sql += ' AND d.category_id = ?'
        params.push(filter.categoryId)
      }
      sql += ' ORDER BY d.updated_at DESC'
      return getDb().prepare(sql).all(...params)
    }
  )

  ipcMain.handle('documents:get', (_e, id: number) => {
    return getDb()
      .prepare(
        `SELECT d.*, c.name as category_name, c.slug as category_slug, c.path_template, c.metadata_schema
         FROM documents d LEFT JOIN categories c ON c.id = d.category_id WHERE d.id = ?`
      )
      .get(id)
  })

  ipcMain.handle('documents:updateMetadata', (_e, id: number, metadata: Record<string, string>) => {
    getDb()
      .prepare(`UPDATE documents SET metadata = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(JSON.stringify(metadata ?? {}), id)
    return true
  })

  ipcMain.handle('documents:delete', async (_e, id: number) => {
    const db = getDb()
    const doc = db.prepare('SELECT stored_path, status FROM documents WHERE id = ?').get(id) as
      | { stored_path: string; status: string }
      | undefined
    if (!doc) return false
    db.prepare('DELETE FROM bundle_documents WHERE document_id = ?').run(id)
    db.prepare('DELETE FROM documents WHERE id = ?').run(id)
    if (doc.status === 'draft') {
      try {
        await unlink(doc.stored_path)
      } catch {
        /* ignore */
      }
    }
    return true
  })

  ipcMain.handle('shell:reveal', (_e, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('shell:open', (_e, filePath: string) => {
    return shell.openPath(filePath)
  })

  ipcMain.handle('bundleTemplates:list', () => {
    return getDb()
      .prepare(
        `SELECT id, external_id, name, description FROM bundle_templates ORDER BY name`
      )
      .all()
  })

  ipcMain.handle('bundleTemplates:reloadSeeds', async () => {
    const dir = templatesDir()
    const n = await importBundleTemplatesFromDir(getDb(), dir)
    return { imported: n, dir }
  })

  ipcMain.handle('bundleTemplates:getItems', (_e, templateId: number) => {
    return getDb()
      .prepare(
        `SELECT id, template_id, category_slug, label, required, sort_order
         FROM bundle_template_items WHERE template_id = ? ORDER BY sort_order, id`
      )
      .all(templateId)
  })

  ipcMain.handle('bundles:list', () => {
    return getDb()
      .prepare(
        `SELECT b.id, b.name, b.created_at, t.name as template_name, b.template_id
         FROM bundles b JOIN bundle_templates t ON t.id = b.template_id ORDER BY b.updated_at DESC`
      )
      .all()
  })

  ipcMain.handle('bundles:create', (_e, templateId: number, name: string) => {
    const db = getDb()
    const r = db
      .prepare('INSERT INTO bundles (template_id, name) VALUES (?, ?)')
      .run(templateId, name)
    return Number(r.lastInsertRowid)
  })

  ipcMain.handle('bundles:getDetail', (_e, bundleId: number) => {
    const db = getDb()
    const bundle = db
      .prepare(
        `SELECT b.*, t.name as template_name, t.id as tpl_id FROM bundles b
         JOIN bundle_templates t ON t.id = b.template_id WHERE b.id = ?`
      )
      .get(bundleId)
    if (!bundle) return null
    const items = db
      .prepare(
        `SELECT i.* FROM bundle_template_items i WHERE i.template_id = (SELECT template_id FROM bundles WHERE id = ?)
         ORDER BY i.sort_order, i.id`
      )
      .all(bundleId) as Array<Record<string, unknown>>

    const attachments = db
      .prepare(
        `SELECT bd.*, d.original_name, d.stored_path, d.status, d.category_id, c.slug as category_slug
         FROM bundle_documents bd
         JOIN documents d ON d.id = bd.document_id
         LEFT JOIN categories c ON c.id = d.category_id
         WHERE bd.bundle_id = ?`
      )
      .all(bundleId)

    return { bundle, items, attachments }
  })

  ipcMain.handle(
    'bundles:attach',
    (_e, bundleId: number, documentId: number, templateItemId: number) => {
      const db = getDb()
      db.prepare('DELETE FROM bundle_documents WHERE bundle_id = ? AND template_item_id = ?').run(
        bundleId,
        templateItemId
      )
      db.prepare(
        `INSERT INTO bundle_documents (bundle_id, document_id, template_item_id) VALUES (?, ?, ?)`
      ).run(bundleId, documentId, templateItemId)
      db.prepare(`UPDATE bundles SET updated_at = datetime('now') WHERE id = ?`).run(bundleId)
      return true
    }
  )

  ipcMain.handle('bundles:detach', (_e, attachmentId: number) => {
    getDb().prepare('DELETE FROM bundle_documents WHERE id = ?').run(attachmentId)
    return true
  })

  ipcMain.handle('bundles:delete', (_e, bundleId: number) => {
    getDb().prepare('DELETE FROM bundles WHERE id = ?').run(bundleId)
    return true
  })
}

export function bootstrapData(): void {
  const database = getDb()
  seedCategoriesIfEmpty(database)
  const dir = templatesDir()
  void importBundleTemplatesFromDir(database, dir)
}
