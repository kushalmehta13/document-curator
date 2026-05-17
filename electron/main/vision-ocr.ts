import { app } from 'electron'
import { execFile } from 'child_process'
import { join } from 'path'
import { promisify } from 'util'
import { access } from 'fs/promises'
import { constants } from 'fs'

const execFileP = promisify(execFile)

export type VisionLine = {
  text: string
  confidence: number
  x: number
  y: number
  w: number
  h: number
}

export type VisionPage = {
  path: string
  text: string
  lines: VisionLine[]
  error: string | null
}

let cachedBinaryPath: string | null = null
let cachedAvailability: boolean | null = null

function binaryCandidates(): string[] {
  const cands: string[] = []
  if (app.isPackaged) {
    cands.push(join(process.resourcesPath, 'bin', 'mac-vision-ocr'))
  }
  cands.push(join(app.getAppPath(), 'resources', 'bin', 'mac-vision-ocr'))
  return cands
}

async function resolveBinary(): Promise<string | null> {
  if (cachedBinaryPath) return cachedBinaryPath
  if (process.platform !== 'darwin') return null
  for (const p of binaryCandidates()) {
    try {
      await access(p, constants.X_OK)
      cachedBinaryPath = p
      return p
    } catch {
      /* try next */
    }
  }
  return null
}

export async function isVisionAvailable(): Promise<boolean> {
  if (cachedAvailability != null) return cachedAvailability
  const bin = await resolveBinary()
  cachedAvailability = bin != null
  return cachedAvailability
}

export async function ocrImagesWithVision(
  imagePaths: string[],
  languages: string[] = []
): Promise<VisionPage[]> {
  const bin = await resolveBinary()
  if (!bin) throw new Error('Apple Vision OCR helper not available')
  if (!imagePaths.length) return []
  const args: string[] = []
  if (languages.length) {
    args.push('--lang', languages.join(','))
  }
  args.push(...imagePaths)
  const { stdout } = await execFileP(bin, args, { maxBuffer: 64 * 1024 * 1024 })
  const parsed = JSON.parse(stdout) as VisionPage[]
  return parsed
}
