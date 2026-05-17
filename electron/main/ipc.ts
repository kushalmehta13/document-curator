import { ipcMain, dialog, shell, app } from 'electron'
import { copyFile, unlink, stat } from 'fs/promises'
import { join, basename, extname, relative } from 'path'
import { randomUUID } from 'crypto'
import { getDb } from './db'
import { getSettings, setSettings } from './settings'
import { finalizeFile, resolveTemplate, sanitizeFilename, sanitizeFolderSegment, ensureDir } from './files'
import { suggestCategory } from './suggest'
import { seedCategoriesIfEmpty, importBundleTemplatesFromDir } from './seed'
import { analyzeDraftDocument } from './analyze'
import { buildFilingFilename, sanitizeFileStem, suggestFilingStem } from './filing-name'
import {
  ARCHIVE_VERSION,
  copyIntoArchive,
  ensureArchiveLayout,
  fileExt,
  findArchiveFile,
  hashFile,
  readManifest,
  writeManifest,
  type ArchiveBundle,
  type ArchiveBundleTemplate,
  type ArchiveCategory,
  type ArchiveDocument,
  type ArchiveManifest,
  type ArchiveProfile
} from './archive'

function profileSlug(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
    || 'profile'
}

function profileFolderFor(id: number | null | undefined): string {
  if (id == null) return ''
  const row = getDb().prepare('SELECT name FROM profiles WHERE id = ?').get(id) as
    | { name: string }
    | undefined
  if (!row) return ''
  return sanitizeFolderSegment(row.name)
}
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
    const s: Partial<{
      documentsRoot: string
      fileMode: 'copy' | 'move'
      activeProfileId: number | null
    }> = {}
    if (typeof partial.documentsRoot === 'string') s.documentsRoot = partial.documentsRoot
    if (partial.fileMode === 'copy' || partial.fileMode === 'move') s.fileMode = partial.fileMode
    if (partial.activeProfileId === null || typeof partial.activeProfileId === 'number') {
      s.activeProfileId = partial.activeProfileId as number | null
    }
    return setSettings(s)
  })

  ipcMain.handle('dialog:openFile', async () => {
    const r = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Documents', extensions: ['pdf', 'png', 'jpg', 'jpeg', 'webp', 'tiff', 'heic'] },
        { name: 'All', extensions: ['*'] }
      ]
    })
    if (r.canceled || !r.filePaths.length) return []
    return r.filePaths
  })

  ipcMain.handle('profiles:list', () => {
    const rows = getDb()
      .prepare(
        `SELECT id, name, slug, kind, color, sort_order, created_at FROM profiles
         ORDER BY sort_order, id`
      )
      .all() as Array<Record<string, unknown>>
    const memberRows = getDb()
      .prepare(`SELECT family_id, member_id FROM profile_members`)
      .all() as Array<{ family_id: number; member_id: number }>
    const byFamily = new Map<number, number[]>()
    for (const r of memberRows) {
      const cur = byFamily.get(r.family_id) || []
      cur.push(r.member_id)
      byFamily.set(r.family_id, cur)
    }
    return rows.map((r) => ({
      ...r,
      members: byFamily.get(Number(r.id)) || []
    }))
  })

  ipcMain.handle(
    'profiles:create',
    (_e, row: { name: string; kind: 'person' | 'family' | 'pet'; color?: string }) => {
      const db = getDb()
      const name = String(row.name || '').trim()
      if (!name) throw new Error('Profile name is required')
      const kind: 'person' | 'family' | 'pet' =
        row.kind === 'family' ? 'family' : row.kind === 'pet' ? 'pet' : 'person'
      let slug = profileSlug(name)
      const exists = (s: string) =>
        db.prepare('SELECT 1 FROM profiles WHERE slug = ?').get(s) != null
      let n = 2
      while (exists(slug)) {
        slug = `${profileSlug(name)}_${n++}`
      }
      const max = db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM profiles').get() as {
        m: number
      }
      const r = db
        .prepare(
          `INSERT INTO profiles (name, slug, kind, color, sort_order) VALUES (?, ?, ?, ?, ?)`
        )
        .run(name, slug, kind, row.color || null, (max.m || 0) + 1)
      return Number(r.lastInsertRowid)
    }
  )

  ipcMain.handle(
    'profiles:update',
    (_e, id: number, partial: { name?: string; color?: string | null }) => {
      const db = getDb()
      const cur = db.prepare('SELECT * FROM profiles WHERE id = ?').get(id) as
        | Record<string, unknown>
        | undefined
      if (!cur) return false
      const name = partial.name != null ? String(partial.name).trim() : (cur.name as string)
      if (!name) throw new Error('Profile name is required')
      const color =
        partial.color === undefined ? (cur.color as string | null) : partial.color
      db.prepare('UPDATE profiles SET name = ?, color = ? WHERE id = ?').run(name, color, id)
      return true
    }
  )

  ipcMain.handle('profiles:delete', (_e, id: number) => {
    const db = getDb()
    const has = (
      db.prepare('SELECT COUNT(*) as c FROM documents WHERE profile_id = ?').get(id) as {
        c: number
      }
    ).c
    if (has > 0) return { ok: false, error: 'Profile has documents — move or delete them first' }
    db.prepare('DELETE FROM profile_members WHERE family_id = ? OR member_id = ?').run(id, id)
    db.prepare('DELETE FROM profiles WHERE id = ?').run(id)
    const settings = getSettings()
    if (settings.activeProfileId === id) setSettings({ activeProfileId: null })
    return { ok: true }
  })

  ipcMain.handle('profiles:setMembers', (_e, familyId: number, memberIds: number[]) => {
    const db = getDb()
    const fam = db.prepare('SELECT kind FROM profiles WHERE id = ?').get(familyId) as
      | { kind: string }
      | undefined
    if (!fam) throw new Error('Family profile not found')
    if (fam.kind !== 'family') throw new Error('Only family profiles can have members')
    const tx = db.transaction((ids: number[]) => {
      db.prepare('DELETE FROM profile_members WHERE family_id = ?').run(familyId)
      const ins = db.prepare(
        'INSERT OR IGNORE INTO profile_members (family_id, member_id) VALUES (?, ?)'
      )
      for (const m of ids) {
        if (m === familyId) continue
        ins.run(familyId, m)
      }
    })
    tx(Array.from(new Set(memberIds.filter((x) => Number.isFinite(x)))))
    return true
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
    const activeProfileId = getSettings().activeProfileId ?? null
    const r = db
      .prepare(
        `INSERT INTO documents (category_id, profile_id, original_name, stored_path, inbox_path, status, metadata, template_vars)
         VALUES (NULL, ?, ?, ?, ?, 'draft', '{}', NULL)`
      )
      .run(activeProfileId, originalName, dest, dest)
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

    const catRow = db
      .prepare('SELECT slug, name FROM categories WHERE id = ?')
      .get(suggestedId) as { slug: string; name: string } | undefined
    const stemFromAnalysis =
      typeof analysis.suggestedFileStem === 'string' ? analysis.suggestedFileStem.trim() : ''
    const prevStem = String(row.filing_name || '').trim()
    const computedStem = suggestFilingStem(
      catRow?.slug ?? null,
      meta,
      catRow?.name ?? 'Document'
    )
    const filingStem = prevStem || stemFromAnalysis || computedStem

    db.prepare(
      `UPDATE documents SET category_id = ?, metadata = ?, filing_name = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(suggestedId, JSON.stringify(meta), sanitizeFileStem(filingStem), docId)

    return true
  })

  ipcMain.handle('documents:computeFilingStem', (_e, docId: number) => {
    const db = getDb()
    const row = db
      .prepare(
        `SELECT d.metadata, c.slug, c.name FROM documents d
         LEFT JOIN categories c ON c.id = d.category_id WHERE d.id = ?`
      )
      .get(docId) as
      | { metadata: string | null; slug: string | null; name: string | null }
      | undefined
    if (!row) throw new Error('Document not found')
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
    return suggestFilingStem(row.slug, meta, row.name || 'Document')
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
        filingStem?: string
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

      /** Stem for library file: explicit payload, else DB, else derive from original filename. */
      const stemForFinalize = (): string | null => {
        if (payload.filingStem !== undefined) {
          const t = payload.filingStem.trim()
          return t ? sanitizeFileStem(t) : null
        }
        if (doc.filing_name != null && String(doc.filing_name).trim() !== '') {
          return sanitizeFileStem(String(doc.filing_name))
        }
        return null
      }

      const filingStemResolved = stemForFinalize()

      if (payload.continueLater) {
        if (payload.filingStem !== undefined) {
          const stem = payload.filingStem.trim() ? sanitizeFileStem(payload.filingStem) : null
          db.prepare(
            `UPDATE documents SET category_id = ?, template_vars = ?, metadata = ?, filing_name = ?,
             updated_at = datetime('now') WHERE id = ?`
          ).run(
            payload.categoryId,
            JSON.stringify(payload.templateVars ?? {}),
            metaJson,
            stem,
            payload.id
          )
        } else {
          db.prepare(
            `UPDATE documents SET category_id = ?, template_vars = ?, metadata = ?, updated_at = datetime('now') WHERE id = ?`
          ).run(
            payload.categoryId,
            JSON.stringify(payload.templateVars ?? {}),
            metaJson,
            payload.id
          )
        }
        return { ok: true, stored_path: doc.stored_path }
      }

      const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(payload.categoryId) as
        | { path_template: string }
        | undefined
      if (!cat) throw new Error('Category not found')

      const settings = getSettings()
      const rel = resolveTemplate(cat.path_template, payload.templateVars ?? {})
      const docProfileId =
        doc.profile_id != null ? Number(doc.profile_id) : settings.activeProfileId ?? null
      const profileSeg = profileFolderFor(docProfileId)
      const destDir = profileSeg
        ? join(settings.documentsRoot, profileSeg, rel)
        : join(settings.documentsRoot, rel)
      const currentPath = doc.stored_path as string
      const originalName = doc.original_name as string
      const outName = buildFilingFilename(originalName, filingStemResolved)

      const finalPath = await finalizeFile(currentPath, destDir, outName, settings.fileMode)

      if (settings.fileMode === 'copy' && currentPath !== finalPath) {
        try {
          await unlink(currentPath)
        } catch {
          /* ignore */
        }
      }

      const ext = extname(finalPath)
      const stemStored = ext ? basename(finalPath, ext) : basename(finalPath)
      const displayName = basename(finalPath)

      db.prepare(
        `UPDATE documents SET category_id = ?, stored_path = ?, inbox_path = NULL, status = 'complete',
         template_vars = ?, metadata = ?, original_name = ?, filing_name = ?, updated_at = datetime('now') WHERE id = ?`
      ).run(
        payload.categoryId,
        finalPath,
        JSON.stringify(payload.templateVars ?? {}),
        metaJson,
        displayName,
        stemStored,
        payload.id
      )

      return { ok: true, stored_path: finalPath }
    }
  )

  ipcMain.handle(
    'documents:list',
    (
      _e,
      filter?: {
        status?: string
        categoryId?: number
        profileId?: number | null
        useActiveProfile?: boolean
      }
    ) => {
      const db = getDb()
      let sql = `SELECT d.*, c.name as category_name, c.slug as category_slug, c.metadata_schema,
        p.name as profile_name, p.kind as profile_kind
        FROM documents d
        LEFT JOIN categories c ON c.id = d.category_id
        LEFT JOIN profiles p ON p.id = d.profile_id
        WHERE 1=1`
      const params: unknown[] = []
      if (filter?.status) {
        sql += ' AND d.status = ?'
        params.push(filter.status)
      }
      if (filter?.categoryId != null) {
        sql += ' AND d.category_id = ?'
        params.push(filter.categoryId)
      }

      let profileId: number | null | undefined = filter?.profileId
      if (profileId === undefined && filter?.useActiveProfile) {
        profileId = getSettings().activeProfileId ?? null
      }
      if (profileId != null) {
        const prof = db.prepare('SELECT kind FROM profiles WHERE id = ?').get(profileId) as
          | { kind: string }
          | undefined
        if (prof?.kind === 'family') {
          const members = db
            .prepare('SELECT member_id FROM profile_members WHERE family_id = ?')
            .all(profileId) as Array<{ member_id: number }>
          const ids = [profileId, ...members.map((m) => m.member_id)]
          const placeholders = ids.map(() => '?').join(',')
          sql += ` AND d.profile_id IN (${placeholders})`
          params.push(...ids)
        } else {
          sql += ' AND d.profile_id = ?'
          params.push(profileId)
        }
      }
      sql += ' ORDER BY d.updated_at DESC'
      return db.prepare(sql).all(...params)
    }
  )

  ipcMain.handle('documents:get', (_e, id: number) => {
    return getDb()
      .prepare(
        `SELECT d.*, c.name as category_name, c.slug as category_slug, c.path_template, c.metadata_schema,
         p.name as profile_name, p.kind as profile_kind
         FROM documents d
         LEFT JOIN categories c ON c.id = d.category_id
         LEFT JOIN profiles p ON p.id = d.profile_id
         WHERE d.id = ?`
      )
      .get(id)
  })

  ipcMain.handle(
    'documents:updateMetadata',
    (_e, id: number, metadata: Record<string, string>, filingStem?: string | null) => {
      if (filingStem !== undefined) {
        const stem =
          filingStem != null && String(filingStem).trim() !== ''
            ? sanitizeFileStem(String(filingStem))
            : null
        getDb()
          .prepare(
            `UPDATE documents SET metadata = ?, filing_name = ?, updated_at = datetime('now') WHERE id = ?`
          )
          .run(JSON.stringify(metadata ?? {}), stem, id)
      } else {
        getDb()
          .prepare(`UPDATE documents SET metadata = ?, updated_at = datetime('now') WHERE id = ?`)
          .run(JSON.stringify(metadata ?? {}), id)
      }
      return true
    }
  )

  ipcMain.handle('documents:setProfile', (_e, id: number, profileId: number | null) => {
    const db = getDb()
    if (profileId != null) {
      const exists = db.prepare('SELECT 1 FROM profiles WHERE id = ?').get(profileId)
      if (!exists) throw new Error('Profile not found')
    }
    db.prepare(
      `UPDATE documents SET profile_id = ?, updated_at = datetime('now') WHERE id = ?`
    ).run(profileId, id)
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

  registerArchiveIpc()
}

/* --------------------------------- archive --------------------------------- */

type ImportPlanRow = {
  hash: string
  ext: string
  original_name: string
  filing_name: string | null
  category_slug: string | null
  category_name: string | null
  profile_slug: string | null
  profile_name: string | null
  status: 'draft' | 'complete'
  /** New on this Mac, no matching hash. */
  duplicate_kind: 'none' | 'same_spot' | 'different_spot'
  /** Recommendation surfaced to the user. */
  recommended_action: 'import' | 'skip'
  reason: string
  /** Existing local document(s) sharing this hash. */
  existing: Array<{
    id: number
    stored_path: string
    profile_name: string | null
    category_name: string | null
  }>
}

type ImportPlan = {
  archive_dir: string
  exported_at: string
  rows: ImportPlanRow[]
  totals: {
    total: number
    new: number
    same_spot: number
    different_spot: number
  }
}

type ImportDecision = {
  hash: string
  action: 'import' | 'skip'
  /** Optional override; otherwise the manifest's profile_slug is used. */
  profile_slug?: string | null
}

function registerArchiveIpc(): void {
  ipcMain.handle('archive:export', async (_e, options?: { includeDrafts?: boolean }) => {
    const r = await dialog.showOpenDialog({
      title: 'Choose an empty folder to export into',
      properties: ['openDirectory', 'createDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false as const, canceled: true as const }
    const targetDir = r.filePaths[0]

    const db = getDb()
    const includeDrafts = options?.includeDrafts === true

    const profileRows = db
      .prepare(
        `SELECT id, name, slug, kind, color FROM profiles ORDER BY sort_order, id`
      )
      .all() as Array<{
        id: number
        name: string
        slug: string
        kind: 'person' | 'family' | 'pet'
        color: string | null
      }>

    const memberRows = db
      .prepare(
        `SELECT pm.family_id, pm.member_id, p.slug as member_slug
         FROM profile_members pm JOIN profiles p ON p.id = pm.member_id`
      )
      .all() as Array<{ family_id: number; member_id: number; member_slug: string }>

    const profilesById = new Map(profileRows.map((p) => [p.id, p]))
    const archiveProfiles: ArchiveProfile[] = profileRows.map((p) => {
      const members = memberRows
        .filter((m) => m.family_id === p.id)
        .map((m) => m.member_slug)
      return {
        slug: p.slug,
        name: p.name,
        kind: p.kind,
        color: p.color,
        members
      }
    })

    const categoryRows = db
      .prepare(
        `SELECT id, name, slug, path_template, keywords, metadata_schema FROM categories`
      )
      .all() as Array<{
        id: number
        name: string
        slug: string
        path_template: string
        keywords: string | null
        metadata_schema: string | null
      }>
    const categoriesById = new Map(categoryRows.map((c) => [c.id, c]))
    const archiveCategories: ArchiveCategory[] = categoryRows.map((c) => ({
      slug: c.slug,
      name: c.name,
      path_template: c.path_template,
      keywords: tryJson(c.keywords),
      metadata_schema: tryJson(c.metadata_schema)
    }))

    const tplRows = db
      .prepare(`SELECT id, external_id, name, description FROM bundle_templates`)
      .all() as Array<{
        id: number
        external_id: string | null
        name: string
        description: string | null
      }>
    const tplItems = db
      .prepare(`SELECT template_id, category_slug, label, required, sort_order FROM bundle_template_items`)
      .all() as Array<{
        template_id: number
        category_slug: string
        label: string
        required: number
        sort_order: number
      }>
    const tplItemsByTemplate = new Map<number, typeof tplItems>()
    for (const it of tplItems) {
      const cur = tplItemsByTemplate.get(it.template_id) || []
      cur.push(it)
      tplItemsByTemplate.set(it.template_id, cur)
    }
    const archiveTemplates: ArchiveBundleTemplate[] = tplRows
      .filter((t) => t.external_id)
      .map((t) => ({
        external_id: t.external_id as string,
        name: t.name,
        description: t.description,
        items: (tplItemsByTemplate.get(t.id) || []).map((it) => ({
          category_slug: it.category_slug,
          label: it.label,
          required: it.required,
          sort_order: it.sort_order
        }))
      }))

    const docRows = db
      .prepare(
        `SELECT id, original_name, stored_path, status, category_id, profile_id, metadata, template_vars, filing_name
         FROM documents WHERE status = 'complete' ${includeDrafts ? "OR status = 'draft'" : ''}`
      )
      .all() as Array<{
        id: number
        original_name: string
        stored_path: string
        status: 'draft' | 'complete'
        category_id: number | null
        profile_id: number | null
        metadata: string | null
        template_vars: string | null
        filing_name: string | null
      }>

    await ensureArchiveLayout(targetDir)
    const archiveDocs: ArchiveDocument[] = []
    const settings = getSettings()
    const docsRoot = settings.documentsRoot
    const hashByDocId = new Map<number, string>()
    let copyErrors = 0

    for (const d of docRows) {
      try {
        const st = await stat(d.stored_path)
        if (!st.isFile()) continue
      } catch {
        copyErrors++
        continue
      }
      const ext = fileExt(d.stored_path)
      const hash = await hashFile(d.stored_path)
      hashByDocId.set(d.id, hash)
      await copyIntoArchive(targetDir, d.stored_path, hash, ext)
      const cat = d.category_id != null ? categoriesById.get(d.category_id) : null
      const prof = d.profile_id != null ? profilesById.get(d.profile_id) : null
      const rel = isUnder(d.stored_path, docsRoot)
        ? relative(docsRoot, d.stored_path)
        : null
      archiveDocs.push({
        hash,
        ext,
        filing_name: d.filing_name,
        original_name: d.original_name,
        relative_path: rel,
        category_slug: cat?.slug ?? null,
        profile_slug: prof?.slug ?? null,
        metadata: parseJsonObject(d.metadata),
        template_vars: parseJsonObject(d.template_vars),
        status: d.status
      })
    }

    const bundleRows = db
      .prepare(
        `SELECT b.id, b.name, t.external_id as template_external_id
         FROM bundles b JOIN bundle_templates t ON t.id = b.template_id`
      )
      .all() as Array<{ id: number; name: string; template_external_id: string | null }>
    const attachRows = db
      .prepare(
        `SELECT bd.bundle_id, bd.document_id, bti.label as item_label
         FROM bundle_documents bd
         LEFT JOIN bundle_template_items bti ON bti.id = bd.template_item_id`
      )
      .all() as Array<{ bundle_id: number; document_id: number; item_label: string | null }>

    const archiveBundles: ArchiveBundle[] = bundleRows
      .filter((b) => b.template_external_id)
      .map((b) => ({
        external_template_id: b.template_external_id as string,
        name: b.name,
        attachments: attachRows
          .filter((a) => a.bundle_id === b.id && hashByDocId.has(a.document_id))
          .map((a) => ({
            document_hash: hashByDocId.get(a.document_id) as string,
            template_item_label: a.item_label || ''
          }))
      }))

    const manifest: ArchiveManifest = {
      version: ARCHIVE_VERSION,
      exportedAt: new Date().toISOString(),
      app: 'document-cabinet',
      profiles: archiveProfiles,
      categories: archiveCategories,
      bundle_templates: archiveTemplates,
      documents: archiveDocs,
      bundles: archiveBundles
    }
    await writeManifest(targetDir, manifest)

    return {
      ok: true as const,
      dir: targetDir,
      counts: {
        profiles: archiveProfiles.length,
        categories: archiveCategories.length,
        documents: archiveDocs.length,
        bundles: archiveBundles.length,
        copyErrors
      }
    }
  })

  ipcMain.handle('archive:importPreview', async () => {
    const r = await dialog.showOpenDialog({
      title: 'Choose the export folder to import',
      properties: ['openDirectory']
    })
    if (r.canceled || !r.filePaths[0]) return { ok: false as const, canceled: true as const }
    const archiveDir = r.filePaths[0]
    const manifest = await readManifest(archiveDir)
    const db = getDb()

    const localDocs = db
      .prepare(
        `SELECT d.id, d.stored_path, d.profile_id, d.category_id,
         p.slug as profile_slug, c.slug as category_slug,
         p.name as profile_name, c.name as category_name
         FROM documents d
         LEFT JOIN profiles p ON p.id = d.profile_id
         LEFT JOIN categories c ON c.id = d.category_id
         WHERE d.status = 'complete'`
      )
      .all() as Array<{
        id: number
        stored_path: string
        profile_id: number | null
        category_id: number | null
        profile_slug: string | null
        category_slug: string | null
        profile_name: string | null
        category_name: string | null
      }>

    const localByHash = new Map<
      string,
      Array<{
        id: number
        stored_path: string
        profile_slug: string | null
        category_slug: string | null
        profile_name: string | null
        category_name: string | null
      }>
    >()
    for (const d of localDocs) {
      try {
        const h = await hashFile(d.stored_path)
        const cur = localByHash.get(h) || []
        cur.push(d)
        localByHash.set(h, cur)
      } catch {
        /* file missing on disk; ignore */
      }
    }

    const categoryNameBySlug = new Map(
      (
        db
          .prepare(`SELECT name, slug FROM categories`)
          .all() as Array<{ name: string; slug: string }>
      ).map((c) => [c.slug, c.name])
    )
    const profileNameBySlug = new Map(
      (
        db
          .prepare(`SELECT name, slug FROM profiles`)
          .all() as Array<{ name: string; slug: string }>
      ).map((p) => [p.slug, p.name])
    )

    const rows: ImportPlanRow[] = manifest.documents.map((d) => {
      const localMatches = localByHash.get(d.hash) || []
      const sameSpot = localMatches.some(
        (m) =>
          (m.profile_slug || null) === (d.profile_slug || null) &&
          (m.category_slug || null) === (d.category_slug || null)
      )
      const diffSpot = localMatches.length > 0 && !sameSpot
      const dupKind: ImportPlanRow['duplicate_kind'] = sameSpot
        ? 'same_spot'
        : diffSpot
          ? 'different_spot'
          : 'none'
      const reason =
        dupKind === 'same_spot'
          ? 'Already filed under the same profile and category — recommended skip.'
          : dupKind === 'different_spot'
            ? 'Same content already exists under a different profile or category — recommended import as a new copy.'
            : 'New file — recommended import.'
      return {
        hash: d.hash,
        ext: d.ext,
        original_name: d.original_name,
        filing_name: d.filing_name,
        category_slug: d.category_slug,
        category_name: d.category_slug
          ? categoryNameBySlug.get(d.category_slug) ||
            manifest.categories.find((c) => c.slug === d.category_slug)?.name ||
            null
          : null,
        profile_slug: d.profile_slug,
        profile_name: d.profile_slug
          ? profileNameBySlug.get(d.profile_slug) ||
            manifest.profiles.find((p) => p.slug === d.profile_slug)?.name ||
            null
          : null,
        status: d.status,
        duplicate_kind: dupKind,
        recommended_action: dupKind === 'same_spot' ? 'skip' : 'import',
        reason,
        existing: localMatches.map((m) => ({
          id: m.id,
          stored_path: m.stored_path,
          profile_name: m.profile_name,
          category_name: m.category_name
        }))
      }
    })

    return {
      ok: true as const,
      plan: {
        archive_dir: archiveDir,
        exported_at: manifest.exportedAt,
        rows,
        totals: {
          total: rows.length,
          new: rows.filter((r) => r.duplicate_kind === 'none').length,
          same_spot: rows.filter((r) => r.duplicate_kind === 'same_spot').length,
          different_spot: rows.filter((r) => r.duplicate_kind === 'different_spot').length
        }
      } satisfies ImportPlan
    }
  })

  ipcMain.handle(
    'archive:importApply',
    async (
      _e,
      payload: {
        archive_dir: string
        decisions: ImportDecision[]
      }
    ) => {
      const db = getDb()
      const archiveDir = payload.archive_dir
      const manifest = await readManifest(archiveDir)
      const decisionsByHash = new Map(payload.decisions.map((d) => [d.hash, d]))

      // 1. Upsert profiles by slug
      const profileIdBySlug = new Map<string, number>()
      const existingProfiles = db
        .prepare(`SELECT id, slug FROM profiles`)
        .all() as Array<{ id: number; slug: string }>
      for (const p of existingProfiles) profileIdBySlug.set(p.slug, p.id)
      const insProfile = db.prepare(
        `INSERT INTO profiles (name, slug, kind, color, sort_order) VALUES (?, ?, ?, ?, ?)`
      )
      let nextSort = (
        db.prepare('SELECT COALESCE(MAX(sort_order), 0) as m FROM profiles').get() as {
          m: number
        }
      ).m
      for (const p of manifest.profiles) {
        if (profileIdBySlug.has(p.slug)) continue
        nextSort += 1
        const r = insProfile.run(p.name, p.slug, p.kind, p.color, nextSort)
        profileIdBySlug.set(p.slug, Number(r.lastInsertRowid))
      }
      // family members
      const insMember = db.prepare(
        `INSERT OR IGNORE INTO profile_members (family_id, member_id) VALUES (?, ?)`
      )
      for (const p of manifest.profiles) {
        if (p.kind !== 'family') continue
        const familyId = profileIdBySlug.get(p.slug)
        if (familyId == null) continue
        for (const memberSlug of p.members) {
          const memberId = profileIdBySlug.get(memberSlug)
          if (memberId == null) continue
          insMember.run(familyId, memberId)
        }
      }

      // 2. Upsert categories by slug
      const categoryIdBySlug = new Map<string, number>()
      const categoryRowBySlug = new Map<string, { path_template: string; metadata_schema: string | null }>()
      const existingCategories = db
        .prepare(`SELECT id, slug, path_template, metadata_schema FROM categories`)
        .all() as Array<{ id: number; slug: string; path_template: string; metadata_schema: string | null }>
      for (const c of existingCategories) {
        categoryIdBySlug.set(c.slug, c.id)
        categoryRowBySlug.set(c.slug, { path_template: c.path_template, metadata_schema: c.metadata_schema })
      }
      const insCategory = db.prepare(
        `INSERT INTO categories (name, slug, path_template, keywords, metadata_schema) VALUES (?, ?, ?, ?, ?)`
      )
      for (const c of manifest.categories) {
        if (categoryIdBySlug.has(c.slug)) continue
        const r = insCategory.run(
          c.name,
          c.slug,
          c.path_template,
          JSON.stringify(c.keywords ?? []),
          JSON.stringify(c.metadata_schema ?? [])
        )
        categoryIdBySlug.set(c.slug, Number(r.lastInsertRowid))
        categoryRowBySlug.set(c.slug, {
          path_template: c.path_template,
          metadata_schema: JSON.stringify(c.metadata_schema ?? [])
        })
      }

      // 3. Upsert bundle templates (by external_id) and items
      const bundleTplIdByExternal = new Map<string, number>()
      const existingTpl = db
        .prepare(`SELECT id, external_id FROM bundle_templates`)
        .all() as Array<{ id: number; external_id: string | null }>
      for (const t of existingTpl) {
        if (t.external_id) bundleTplIdByExternal.set(t.external_id, t.id)
      }
      const insTpl = db.prepare(
        `INSERT INTO bundle_templates (external_id, name, description) VALUES (?, ?, ?)`
      )
      const insTplItem = db.prepare(
        `INSERT INTO bundle_template_items (template_id, category_slug, label, required, sort_order) VALUES (?, ?, ?, ?, ?)`
      )
      for (const t of manifest.bundle_templates) {
        if (bundleTplIdByExternal.has(t.external_id)) continue
        const r = insTpl.run(t.external_id, t.name, t.description)
        const tid = Number(r.lastInsertRowid)
        bundleTplIdByExternal.set(t.external_id, tid)
        for (const it of t.items) {
          insTplItem.run(tid, it.category_slug, it.label, it.required, it.sort_order)
        }
      }

      // 4. Documents — apply per-row decisions
      const settings = getSettings()
      const docsRoot = settings.documentsRoot
      const insDoc = db.prepare(
        `INSERT INTO documents (category_id, profile_id, original_name, stored_path, status, metadata, template_vars, filing_name)
         VALUES (?, ?, ?, ?, 'complete', ?, ?, ?)`
      )
      const docIdByHash = new Map<string, number>()
      let imported = 0
      let skipped = 0
      const errors: Array<{ hash: string; message: string }> = []

      for (const d of manifest.documents) {
        const decision = decisionsByHash.get(d.hash)
        if (!decision || decision.action === 'skip') {
          skipped++
          continue
        }
        try {
          const archivePath = await findArchiveFile(archiveDir, d.hash, d.ext || null)
          if (!archivePath) throw new Error(`File missing in archive for hash ${d.hash.slice(0, 12)}…`)

          const profileSlug = decision.profile_slug ?? d.profile_slug
          const profileId = profileSlug ? profileIdBySlug.get(profileSlug) ?? null : null
          const categoryId = d.category_slug ? categoryIdBySlug.get(d.category_slug) ?? null : null
          const catRow = d.category_slug ? categoryRowBySlug.get(d.category_slug) : null

          const profileSeg = profileId != null
            ? sanitizeFolderSegment(
                manifest.profiles.find((p) => p.slug === profileSlug)?.name ||
                  (db.prepare('SELECT name FROM profiles WHERE id = ?').get(profileId) as { name: string })?.name ||
                  profileSlug || ''
              )
            : ''

          const rel = catRow?.path_template
            ? resolveTemplate(catRow.path_template, d.template_vars || {})
            : ''
          const destDir = profileSeg
            ? rel
              ? join(docsRoot, profileSeg, rel)
              : join(docsRoot, profileSeg)
            : rel
              ? join(docsRoot, rel)
              : docsRoot
          const outName = buildFilingFilename(d.original_name, d.filing_name)
          const finalPath = await finalizeFile(archivePath, destDir, outName, 'copy')

          const r = insDoc.run(
            categoryId,
            profileId,
            d.original_name,
            finalPath,
            JSON.stringify(d.metadata || {}),
            JSON.stringify(d.template_vars || {}),
            d.filing_name ? sanitizeFileStem(d.filing_name) : null
          )
          docIdByHash.set(d.hash, Number(r.lastInsertRowid))
          imported++
        } catch (e) {
          errors.push({ hash: d.hash, message: e instanceof Error ? e.message : String(e) })
        }
      }

      // 5. Bundles
      const insBundle = db.prepare(
        `INSERT INTO bundles (template_id, name) VALUES (?, ?)`
      )
      const insBundleDoc = db.prepare(
        `INSERT INTO bundle_documents (bundle_id, document_id, template_item_id) VALUES (?, ?, ?)`
      )
      let bundlesImported = 0
      for (const b of manifest.bundles) {
        const tid = bundleTplIdByExternal.get(b.external_template_id)
        if (tid == null) continue
        const r = insBundle.run(tid, b.name)
        const bundleId = Number(r.lastInsertRowid)
        const items = db
          .prepare(`SELECT id, label FROM bundle_template_items WHERE template_id = ?`)
          .all(tid) as Array<{ id: number; label: string }>
        const itemByLabel = new Map(items.map((x) => [x.label, x.id]))
        for (const att of b.attachments) {
          const docId = docIdByHash.get(att.document_hash)
          if (docId == null) continue
          const itemId = itemByLabel.get(att.template_item_label) || null
          insBundleDoc.run(bundleId, docId, itemId)
        }
        bundlesImported++
      }

      return {
        ok: true as const,
        imported,
        skipped,
        bundlesImported,
        errors
      }
    }
  )
}

function isUnder(child: string, parent: string): boolean {
  const r = relative(parent, child)
  return !!r && !r.startsWith('..') && !r.startsWith('/')
}

function tryJson(s: string | null): unknown {
  if (!s) return null
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}

function parseJsonObject(s: string | null): Record<string, string> {
  if (!s) return {}
  try {
    const o = JSON.parse(s) as Record<string, unknown>
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

export function bootstrapData(): void {
  const database = getDb()
  seedCategoriesIfEmpty(database)
  const dir = templatesDir()
  void importBundleTemplatesFromDir(database, dir)
}
