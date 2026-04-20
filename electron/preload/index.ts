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
    }) => ipcRenderer.invoke('documents:finalize', payload),
    list: (filter?: { status?: string; categoryId?: number }) =>
      ipcRenderer.invoke('documents:list', filter),
    get: (id: number) => ipcRenderer.invoke('documents:get', id),
    updateMetadata: (id: number, metadata: Record<string, string>) =>
      ipcRenderer.invoke('documents:updateMetadata', id, metadata),
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
  previewUrl: (documentId: number) => `curator-doc://doc/${documentId}`
}

contextBridge.exposeInMainWorld('api', api)

export type CuratorApi = typeof api
