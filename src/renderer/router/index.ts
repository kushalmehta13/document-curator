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
        title: 'Intake tray',
        tagline:
          'Drop new paperwork here. Drafts wait on the tray until you label them and slide them into a drawer.'
      }
    },
    {
      path: '/library',
      name: 'library',
      component: LibraryView,
      meta: {
        title: 'The cabinet',
        tagline: 'Every filed document, sitting where it belongs. Pick a drawer or open a document for its details.'
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
        title: 'Folders',
        tagline:
          'A folder is a checklist for a form or application — collect the right documents into one tabbed dossier.'
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
        title: 'Workshop',
        tagline: 'Adjust where the cabinet keeps your files and how each drawer is labelled — still entirely on your machine.'
      }
    }
  ]
})

export default router
