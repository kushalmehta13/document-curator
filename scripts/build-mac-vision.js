#!/usr/bin/env node
/* Compile the Apple Vision OCR helper if missing or stale. macOS only; no-op elsewhere. */
const { spawnSync } = require('node:child_process')
const { existsSync, statSync, mkdirSync } = require('node:fs')
const { join, dirname } = require('node:path')

const root = join(__dirname, '..')
const src = join(root, 'tools', 'mac-vision-ocr.swift')
const outDir = join(root, 'resources', 'bin')
const out = join(outDir, 'mac-vision-ocr')

if (process.platform !== 'darwin') {
  process.exit(0)
}

mkdirSync(outDir, { recursive: true })

const needsBuild = !existsSync(out) || statSync(src).mtimeMs > statSync(out).mtimeMs
if (!needsBuild) process.exit(0)

const swiftc = spawnSync(
  'swiftc',
  ['-O', '-target', 'arm64-apple-macos12', src, '-o', out],
  { stdio: 'inherit' }
)
if (swiftc.status !== 0) {
  console.warn('[mac-vision] build failed; Tesseract fallback will be used')
  process.exit(0)
}
console.log('[mac-vision] built', out)
