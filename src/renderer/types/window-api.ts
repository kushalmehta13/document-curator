export type WindowApi = {
  getPathForFile: (file: File) => string
  settings: {
    get: () => Promise<{
      documentsRoot: string
      fileMode: 'copy' | 'move'
      activeProfileId: number | null
    }>
    set: (partial: Record<string, unknown>) => Promise<{
      documentsRoot: string
      fileMode: 'copy' | 'move'
      activeProfileId: number | null
    }>
  }
  profiles: {
    list: () => Promise<
      Array<{
        id: number
        name: string
        slug: string
        kind: 'person' | 'family' | 'pet'
        color: string | null
        sort_order: number
        created_at: string
        members: number[]
      }>
    >
    create: (row: { name: string; kind: 'person' | 'family' | 'pet'; color?: string }) => Promise<number>
    update: (id: number, partial: { name?: string; color?: string | null }) => Promise<boolean>
    delete: (id: number) => Promise<{ ok: boolean; error?: string }>
    setMembers: (familyId: number, memberIds: number[]) => Promise<boolean>
  }
  dialog: { openFile: () => Promise<string[]> }
  categories: {
    list: () => Promise<unknown[]>
    create: (row: {
      name: string
      slug: string
      path_template: string
      keywords?: string[]
      metadata_schema?: Array<{ key: string; label: string }>
    }) => Promise<number>
    update: (
      id: number,
      row: Partial<{
        name: string
        path_template: string
        keywords: string[]
        metadata_schema: Array<{ key: string; label: string }>
      }>
    ) => Promise<boolean>
    delete: (id: number) => Promise<{ ok: boolean; error?: string }>
  }
  documents: {
    suggestCategory: (filename: string) => Promise<{ slug: string; name: string; score: number } | null>
    createDraft: (sourcePath: string) => Promise<{
      id: number
      suggested: { slug: string; name: string; score: number } | null
      analysis: Record<string, unknown> | null
      categoryId: number | null
      ocr_status: string | null
      analysisError?: string
    }>
    analyzeLocal: (payload: {
      id: number
      resetCategory?: boolean
    }) => Promise<Record<string, unknown> | undefined>
    applySuggestion: (id: number) => Promise<boolean>
    finalize: (payload: {
      id: number
      categoryId: number
      templateVars: Record<string, string>
      continueLater?: boolean
      metadata?: Record<string, string>
      filingStem?: string
    }) => Promise<{ ok: boolean; stored_path: string }>
    computeFilingStem: (id: number) => Promise<string>
    list: (filter?: {
      status?: string
      categoryId?: number
      profileId?: number | null
      useActiveProfile?: boolean
    }) => Promise<unknown[]>
    setProfile: (id: number, profileId: number | null) => Promise<boolean>
    get: (id: number) => Promise<Record<string, unknown> | undefined>
    updateMetadata: (
      id: number,
      metadata: Record<string, string>,
      filingStem?: string | null
    ) => Promise<boolean>
    delete: (id: number) => Promise<boolean>
  }
  shell: {
    reveal: (filePath: string) => Promise<void>
    open: (filePath: string) => Promise<string>
  }
  bundleTemplates: {
    list: () => Promise<unknown[]>
    reloadSeeds: () => Promise<{ imported: number; dir: string }>
    getItems: (templateId: number) => Promise<unknown[]>
  }
  bundles: {
    list: () => Promise<unknown[]>
    create: (templateId: number, name: string) => Promise<number>
    getDetail: (bundleId: number) => Promise<unknown>
    attach: (bundleId: number, documentId: number, templateItemId: number) => Promise<boolean>
    detach: (attachmentId: number) => Promise<boolean>
    delete: (bundleId: number) => Promise<boolean>
  }
  previewUrl: (documentId: number) => string
  archive: {
    export: (options?: { includeDrafts?: boolean }) => Promise<
      | { ok: true; dir: string; counts: { profiles: number; categories: number; documents: number; bundles: number; copyErrors: number } }
      | { ok: false; canceled: true }
    >
    importPreview: () => Promise<
      | {
          ok: true
          plan: {
            archive_dir: string
            exported_at: string
            rows: Array<{
              hash: string
              ext: string
              original_name: string
              filing_name: string | null
              category_slug: string | null
              category_name: string | null
              profile_slug: string | null
              profile_name: string | null
              status: 'draft' | 'complete'
              duplicate_kind: 'none' | 'same_spot' | 'different_spot'
              recommended_action: 'import' | 'skip'
              reason: string
              existing: Array<{
                id: number
                stored_path: string
                profile_name: string | null
                category_name: string | null
              }>
            }>
            totals: { total: number; new: number; same_spot: number; different_spot: number }
          }
        }
      | { ok: false; canceled: true }
    >
    importApply: (payload: {
      archive_dir: string
      decisions: Array<{ hash: string; action: 'import' | 'skip'; profile_slug?: string | null }>
    }) => Promise<{
      ok: true
      imported: number
      skipped: number
      bundlesImported: number
      errors: Array<{ hash: string; message: string }>
    }>
  }
}
