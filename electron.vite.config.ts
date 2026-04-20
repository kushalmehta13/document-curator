import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/main/index.ts')
      },
      rollupOptions: {
        external: [
          'better-sqlite3',
          'pdf-parse',
          'tesseract.js',
          'tesseract.js-core',
          '@tesseract.js-data/eng',
          /^@napi-rs\/canvas$/
        ]
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: {
        entry: resolve(__dirname, 'electron/preload/index.ts')
      }
    }
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer')
      }
    },
    plugins: [vue()]
  }
})
