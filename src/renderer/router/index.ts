import { createRouter, createWebHashHistory } from 'vue-router'
import InboxView from '../views/InboxView.vue'
import LibraryView from '../views/LibraryView.vue'
import DocumentDetailView from '../views/DocumentDetailView.vue'
import BundlesView from '../views/BundlesView.vue'
import BundleDetailView from '../views/BundleDetailView.vue'
import SettingsView from '../views/SettingsView.vue'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', redirect: '/inbox' },
    {
      path: '/inbox',
      name: 'inbox',
      component: InboxView,
      meta: {
        title: 'Inbox',
        tagline:
          'Add files when you have a moment—drafts wait here until you are ready to sort them into your library.'
      }
    },
    {
      path: '/library',
      name: 'library',
      component: LibraryView,
      meta: {
        title: 'Library',
        tagline: 'Everything you have filed lives here. Filter by category or open a document for preview and metadata.'
      }
    },
    {
      path: '/document/:id',
      name: 'document',
      component: DocumentDetailView,
      meta: { hideChrome: true }
    },
    {
      path: '/bundles',
      name: 'bundles',
      component: BundlesView,
      meta: {
        title: 'Bundles',
        tagline:
          'Think of a bundle as a smart checklist for a form or application—attach the right documents over time.'
      }
    },
    {
      path: '/bundle/:id',
      name: 'bundle',
      component: BundleDetailView,
      meta: { hideChrome: true }
    },
    {
      path: '/settings',
      name: 'settings',
      component: SettingsView,
      meta: {
        title: 'Settings',
        tagline: 'Tune where files land on disk and how categories behave—still entirely on your machine.'
      }
    }
  ]
})

export default router
