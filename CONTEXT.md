# Document Curator — project handoff

Use this file to resume work in a **new chat** or onboard someone quickly. It summarizes architecture, file locations, and conventions.

## What this is

A **local-only** desktop app (no cloud) to organize personal documents: IDs, immigration, academics, taxes, etc. Users file copies under a configurable root (default `~/Documents`), track **drafts** in an app inbox, edit **metadata** per document (manual entry today; DB ready for OCR later), and build **bundles** (checklists for forms) from JSON templates.

## Tech stack

| Layer | Choice |
|--------|--------|
| Shell | **Electron** (~33), **electron-vite** (main + preload + renderer builds) |
| UI | **Vue 3**, **Vue Router** (hash history: `#/inbox`, etc.) |
| Main process DB | **better-sqlite3** — DB file under `app.getPath('userData')/curator.db` |
| Packaging | **electron-builder** → `release/*.dmg` (macOS); `better-sqlite3` in `asarUnpack` |

## Repo layout (important paths)

```
electron/main/          # Main process: window, IPC, SQLite, FS, protocol
  index.ts              # Window, curator-doc protocol, lifecycle
  db.ts                 # Schema + migrations (schema_version)
  ipc.ts                # All ipcMain handlers
  seed.ts               # Default categories + import bundle JSON from disk
  settings.ts, files.ts, suggest.ts
electron/preload/       # Exposes window.api (contextBridge)
src/renderer/           # Vue app (electron-vite default renderer root)
  App.vue               # Sidebar shell + content header + RouterView
  router/index.ts       # Routes + meta.title, meta.tagline, meta.hideChrome
  views/*.vue             # Inbox, Library, DocumentDetail, Bundles, BundleDetail, Settings
  style.css             # Global theme, .lead, .stack, chips, etc.
resources/bundle-templates/*.json   # Shipped bundle definitions (also copied via extraResources)
```

Build output: `out/` (gitignored). Releases: `release/` (gitignored).

## Running and building

```bash
npm install
npm run dev              # hot reload
npm run typecheck
npm run build            # compile to out/
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist   # unsigned .dmg locally
```

## Architecture (mental model)

- **Renderer** never touches Node; it calls **`window.api.*`** from preload only.
- **Main** owns: SQLite, copying files, `shell.showItemInFolder` / `openPath`, file dialogs, path templates.
- **Preview**: custom protocol **`curator-doc://doc/<id>`** (privileged in `index.ts`) maps to `documents.stored_path` on disk; PDF/images use that URL in the DOM.

## Data model (SQLite)

- **settings** — key/value JSON blob for app settings (`documentsRoot`, `fileMode` copy|move).
- **categories** — `path_template` with `{var}` placeholders, `keywords` JSON for filename heuristics, `metadata_schema` JSON for form fields.
- **documents** — `status` `draft`|`complete`, `stored_path`, optional `category_id`, `metadata` JSON, `template_vars` JSON, nullable `ocr_*` for future use.
- **bundle_templates** + **bundle_template_items** — checklist rows keyed by `category_slug`.
- **bundles** — user instances; **bundle_documents** links `document_id` to `template_item_id` (unique per bundle slot).

Seeds: empty DB gets default categories (`seed.ts`); bundle JSON imported from `resources/bundle-templates` (dev) or `process.resourcesPath/bundle-templates` (packaged).

## Upload / file flow

1. **createDraft**: copy source file into `userData/inbox/<uuid>_<name>` — **`ensureDir(inbox)`** must run first (fixes past ENOENT). iCloud placeholders: user must download file in Finder first.
2. **finalize** (not `continueLater`): resolve `join(documentsRoot, resolveTemplate(category.path_template, templateVars))`, copy or move per settings, update row to `complete`.

## IPC surface (preload → main)

Exposed as `window.api`: `settings`, `dialog.openFile`, `categories` CRUD, `documents` (list/get/createDraft/finalize/updateMetadata/delete/suggestCategory), `shell` (reveal, open), `bundleTemplates`, `bundles`, `previewUrl(id)`.

## UI conventions

- **Sidebar** navigation; **no top tab bar**. macOS **hiddenInset** title bar: sidebar uses **top padding** to sit below traffic lights, **small left padding** (~14px)—avoid a full-height empty column beside nav.
- **Route meta**: `title`, `tagline` (shown under page title in main header), `hideChrome` for document/bundle detail (those screens use back links).
- **Text width**: `.lead` and `.content-tagline` use full main column width (`max-width: 100%`); `.stack` has `min-width: 0` for flex scroll correctness.
- **Scroll**: `html, body, #app { height: 100% }`, `.app-shell { height: 100% }`, `.main-scroll { flex: 1; min-height: 0; overflow-y: auto }`.

## GitHub

- Remote: typically **`origin`** → `github.com/kushalmehta13/document-curator` (verify with `git remote -v`).
- **`.github/workflows/build.yml`**: macOS `npm ci` → `npm run build` → unsigned `npm run dist`, uploads `release/` artifact.

## Product decisions already made

- Metadata **manual** in v1; schema extensible for OCR later.
- Deleting a **filed** document removes DB row only; **draft** delete removes inbox file too.
- Bundle templates match categories by **slug**; add categories in Settings or seeds.

## Quick “where do I change…?”

| Goal | Where |
|------|--------|
| New default categories | `electron/main/seed.ts` |
| New bundle checklist | `resources/bundle-templates/*.json` + reload in Settings |
| IPC / FS rules | `electron/main/ipc.ts`, `electron/main/files.ts` |
| Theme / global CSS | `src/renderer/style.css`, `App.vue` |
| New screen | `src/renderer/views/`, register in `router/index.ts` |
| Window / protocol | `electron/main/index.ts` |
| Preload API | `electron/preload/index.ts` + `src/renderer/types/window-api.ts` |

---

*Last meant for AI/session handoff: update this file when you change architecture, routes, or critical behavior.*
