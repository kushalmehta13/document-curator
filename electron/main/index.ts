import { app, BrowserWindow, protocol } from 'electron'

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'curator-doc',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
      stream: true
    }
  }
])
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import { initDb, getDb, closeDb } from './db'
import { terminateOcrWorker } from './extract'
import { registerIpc, bootstrapData } from './ipc'

let mainWindow: BrowserWindow | null = null

function registerDocProtocol(): void {
  protocol.registerFileProtocol('curator-doc', (request, callback) => {
    try {
      const url = new URL(request.url)
      const segments = url.pathname.split('/').filter(Boolean)
      const idStr = segments[segments.length - 1]
      const id = Number(idStr)
      if (!idStr || Number.isNaN(id)) {
        callback({ error: -2 })
        return
      }
      const row = getDb().prepare('SELECT stored_path FROM documents WHERE id = ?').get(id) as
        | { stored_path: string }
        | undefined
      if (!row?.stored_path) {
        callback({ error: -6 })
        return
      }
      callback({ path: row.stored_path })
    } catch {
      callback({ error: -2 })
    }
  })
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 780,
    minWidth: 800,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 14, y: 12 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  electronApp.setAppUserModelId('com.documentcurator.app')
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  initDb(app)
  bootstrapData()
  registerDocProtocol()
  registerIpc()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    closeDb()
    app.quit()
  }
})

app.on('before-quit', () => {
  void terminateOcrWorker()
  closeDb()
})
