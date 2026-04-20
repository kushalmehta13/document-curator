import { readFile, writeFile, unlink } from 'fs/promises'
import { dirname, join, sep } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

export type ExtractSource = 'pdf_text' | 'pdf_ocr' | 'ocr' | 'none'

export type ExtractResult = {
  text: string
  source: ExtractSource
  error?: string
}

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'tif', 'tiff', 'bmp'])

const MIN_PDF_TEXT_CHARS = 48

function extOf(filePath: string): string {
  const i = filePath.lastIndexOf('.')
  return i >= 0 ? filePath.slice(i + 1).toLowerCase() : ''
}

async function extractPdfTextAndMaybeOcr(filePath: string): Promise<ExtractResult> {
  const { PDFParse } = await import('pdf-parse')
  const buf = await readFile(filePath)
  const parser = new PDFParse({ data: new Uint8Array(buf) })
  try {
    const textResult = await parser.getText({ first: 50 })
    const plain = (textResult.text || '').replace(/\s+/g, ' ').trim()
    if (plain.length >= MIN_PDF_TEXT_CHARS) {
      return { text: plain, source: 'pdf_text' }
    }

    const shot = await parser.getScreenshot({ first: 1, scale: 1.5, imageBuffer: true, imageDataUrl: false })
    const page0 = shot.pages[0]
    if (!page0?.data?.length) {
      return { text: plain, source: plain.length ? 'pdf_text' : 'none' }
    }

    const tmp = join(tmpdir(), `curator-pdf-${randomUUID()}.png`)
    try {
      await writeFile(tmp, page0.data)
      const ocrText = await ocrImageFile(tmp)
      const merged = [plain, ocrText].filter(Boolean).join('\n').trim()
      return { text: merged || plain, source: ocrText ? 'pdf_ocr' : plain.length ? 'pdf_text' : 'none' }
    } finally {
      try {
        await unlink(tmp)
      } catch {
        /* ignore */
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: '', source: 'none', error: msg }
  } finally {
    try {
      await parser.destroy()
    } catch {
      /* ignore */
    }
  }
}

let workerSingleton: import('tesseract.js').Worker | null = null

async function getOcrWorker(): Promise<import('tesseract.js').Worker> {
  if (workerSingleton) return workerSingleton
  const { createWorker } = await import('tesseract.js')
  const eng = require('@tesseract.js-data/eng') as { langPath: string; gzip: boolean }
  const corePkgDir = dirname(require.resolve('tesseract.js-core/package.json'))
  const corePath = `${corePkgDir}${sep}`
  // Browser bundle `worker.min.js` breaks under Node worker_threads (no addEventListener on global).
  const tesseractPkgDir = dirname(require.resolve('tesseract.js/package.json'))
  const nodeWorkerPath = join(tesseractPkgDir, 'src', 'worker-script', 'node', 'index.js')

  workerSingleton = await createWorker('eng', 1, {
    workerPath: nodeWorkerPath,
    corePath,
    langPath: eng.langPath,
    gzip: eng.gzip ?? true,
    workerBlobURL: false,
    logger: () => {}
  })
  return workerSingleton
}

async function ocrImageFile(imagePath: string): Promise<string> {
  try {
    const worker = await getOcrWorker()
    const {
      data: { text }
    } = await worker.recognize(imagePath)
    return (text || '').replace(/\s+/g, ' ').trim()
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`OCR failed: ${msg}`)
  }
}

export async function extractDocumentText(filePath: string): Promise<ExtractResult> {
  const ext = extOf(filePath)
  try {
    if (ext === 'pdf') {
      return await extractPdfTextAndMaybeOcr(filePath)
    }
    if (IMAGE_EXT.has(ext)) {
      const text = await ocrImageFile(filePath)
      return { text, source: text ? 'ocr' : 'none' }
    }
    if (ext === 'heic' || ext === 'heif') {
      return { text: '', source: 'none', error: 'HEIC preview is supported; OCR for HEIC is not enabled in this build.' }
    }
    return { text: '', source: 'none', error: 'Unsupported type for text extraction' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return { text: '', source: 'none', error: msg }
  }
}

export async function terminateOcrWorker(): Promise<void> {
  if (!workerSingleton) return
  try {
    await workerSingleton.terminate()
  } catch {
    /* ignore */
  }
  workerSingleton = null
}
