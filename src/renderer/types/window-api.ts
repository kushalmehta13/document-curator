export type WindowApi = {
  settings: {
    get: () => Promise<{ documentsRoot: string; fileMode: 'copy' | 'move' }>
    set: (partial: Record<string, unknown>) => Promise<{ documentsRoot: string; fileMode: 'copy' | 'move' }>
  }
  dialog: { openFile: () => Promise<string | null> }
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
    }>
    finalize: (payload: {
      id: number
      categoryId: number
      templateVars: Record<string, string>
      continueLater?: boolean
    }) => Promise<{ ok: boolean; stored_path: string }>
    list: (filter?: { status?: string; categoryId?: number }) => Promise<unknown[]>
    get: (id: number) => Promise<Record<string, unknown> | undefined>
    updateMetadata: (id: number, metadata: Record<string, string>) => Promise<boolean>
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
}
