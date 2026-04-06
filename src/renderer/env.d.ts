/// <reference types="vite/client" />

import type { WindowApi } from './types/window-api'

declare global {
  interface Window {
    api: WindowApi
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

declare module 'vue-router' {
  interface RouteMeta {
    title?: string
    tagline?: string
    hideChrome?: boolean
  }
}

export {}
