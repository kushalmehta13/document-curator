import { contextBridge, ipcRenderer, webUtils } from 'electron'

const api = {
  /** Real filesystem path for a File from drag-and-drop (renderer File has no .path). */
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (partial: Record<string, unknown>) => ipcRenderer.invoke('settings:set', partial)
  },
  dialog: {
    openFile: () => ipcRenderer.invoke('dialog:openFile')
  },
  profiles: {
    list: () => ipcRenderer.invoke('profiles:list'),
    create: (row: { name: string; kind: 'person' | 'family' | 'pet'; color?: string }) =>
      ipcRenderer.invoke('profiles:create', row),
    update: (id: number, partial: { name?: string; color?: string | null }) =>
      ipcRenderer.invoke('profiles:update', id, partial),
    delete: (id: number) => ipcRenderer.invoke('profiles:delete', id),
    setMembers: (familyId: number, memberIds: number[]) =>
      ipcRenderer.invoke('profiles:setMembers', familyId, memberIds)
  },
  categories: {
    list: () => ipcRenderer.invoke('categories:list'),
    create: (row: {
      name: string
      slug: string
      path_template: string
      keywords?: string[]
      metadata_schema?: Array<{ key: string; label: string }>
    }) => ipcRenderer.invoke('categories:create', row),
    update: (
      id: number,
      row: Partial<{
        name: string
        path_template: string
        keywords: string[]
        metadata_schema: Array<{ key: string; label: string }>
      }>
    ) => ipcRenderer.invoke('categories:update', id, row),
    delete: (id: number) => ipcRenderer.invoke('categories:delete', id)
  },
  documents: {
    suggestCategory: (filename: string) => ipcRenderer.invoke('documents:suggestCategory', filename),
    createDraft: (sourcePath: string) => ipcRenderer.invoke('documents:createDraft', sourcePath),
    analyzeLocal: (payload: { id: number; resetCategory?: boolean }) =>
      ipcRenderer.invoke('documents:analyzeLocal', payload),
    applySuggestion: (id: number) => ipcRenderer.invoke('documents:applySuggestion', id),
    finalize: (payload: {
      id: number
      categoryId: number
      templateVars: Record<string, string>
      continueLater?: boolean
      metadata?: Record<string, string>
      filingStem?: string
    }) => ipcRenderer.invoke('documents:finalize', payload),
    computeFilingStem: (id: number) => ipcRenderer.invoke('documents:computeFilingStem', id),
    list: (filter?: {
      status?: string
      categoryId?: number
      profileId?: number | null
      useActiveProfile?: boolean
    }) => ipcRenderer.invoke('documents:list', filter),
    setProfile: (id: number, profileId: number | null) =>
      ipcRenderer.invoke('documents:setProfile', id, profileId),
    get: (id: number) => ipcRenderer.invoke('documents:get', id),
    updateMetadata: (id: number, metadata: Record<string, string>, filingStem?: string | null) =>
      ipcRenderer.invoke('documents:updateMetadata', id, metadata, filingStem),
    delete: (id: number) => ipcRenderer.invoke('documents:delete', id)
  },
  shell: {
    reveal: (filePath: string) => ipcRenderer.invoke('shell:reveal', filePath),
    open: (filePath: string) => ipcRenderer.invoke('shell:open', filePath)
  },
  bundleTemplates: {
    list: () => ipcRenderer.invoke('bundleTemplates:list'),
    reloadSeeds: () => ipcRenderer.invoke('bundleTemplates:reloadSeeds'),
    getItems: (templateId: number) => ipcRenderer.invoke('bundleTemplates:getItems', templateId)
  },
  bundles: {
    list: () => ipcRenderer.invoke('bundles:list'),
    create: (templateId: number, name: string) =>
      ipcRenderer.invoke('bundles:create', templateId, name),
    getDetail: (bundleId: number) => ipcRenderer.invoke('bundles:getDetail', bundleId),
    attach: (bundleId: number, documentId: number, templateItemId: number) =>
      ipcRenderer.invoke('bundles:attach', bundleId, documentId, templateItemId),
    detach: (attachmentId: number) => ipcRenderer.invoke('bundles:detach', attachmentId),
    delete: (bundleId: number) => ipcRenderer.invoke('bundles:delete', bundleId)
  },
  previewUrl: (documentId: number) => `curator-doc://doc/${documentId}`,
  archive: {
    export: (options?: { includeDrafts?: boolean }) => ipcRenderer.invoke('archive:export', options),
    importPreview: () => ipcRenderer.invoke('archive:importPreview'),
    importApply: (payload: {
      archive_dir: string
      decisions: Array<{ hash: string; action: 'import' | 'skip'; profile_slug?: string | null }>
    }) => ipcRenderer.invoke('archive:importApply', payload)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type CuratorApi = typeof api
