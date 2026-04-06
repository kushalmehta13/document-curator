# Document Curator

A minimal **Electron + Vue 3** desktop app for organizing personal documents locally (immigration, IDs, academics, taxes, and similar). Files stay on your machine under a folder you choose (default: `~/Documents`). Nothing is uploaded to the cloud.

## Features

- **Inbox:** Add files with drag-and-drop or a file picker. Drafts stay in app storage until you pick a category and optional path variables (for example `{state}` for a driver license). Filename-based category suggestions; you can add new categories in Settings.
- **Library:** Filed documents grouped by category, with **preview** (images and PDF), **editable metadata** with per-field copy and JSON copy, **Show in Finder**, and **Open with default app**.
- **Bundles:** Start a bundle from a template (JSON checklists in `resources/bundle-templates`), attach library documents to each required slot, and finish over time.

Metadata is **manual** in v1; the database reserves fields for future OCR.

## Requirements

- **Node.js** 20 LTS (or newer)
- **macOS** for the provided build scripts and `.dmg` (the codebase is portable; Windows/Linux packaging would need extra `electron-builder` targets).

## Development

```bash
npm install
npm run dev
```

## Production build (Dock-ready `.app` and `.dmg`)

```bash
npm install
# Unsigned local build (no Apple Developer certificate):
CSC_IDENTITY_AUTO_DISCOVERY=false npm run dist
```

Artifacts appear under `release/` (for example `Document Curator-0.1.0-arm64.dmg`). Open the DMG, drag **Document Curator** to Applications, and keep it in the Dock.

To ship a signed build, configure macOS code signing and notarization as described in the [electron-builder code signing](https://www.electron.build/code-signing) documentation (then run `npm run dist` without disabling discovery).

## Native module (contributors)

This project uses `better-sqlite3`. If `npm install` fails on your platform, try:

```bash
npm rebuild better-sqlite3
```

## Bundle templates

Add JSON files under [`resources/bundle-templates/`](resources/bundle-templates/). In the app, use **Settings → Reload templates** (or restart) to import them. Each file looks like:

```json
{
  "id": "unique-id",
  "name": "Human name",
  "description": "Optional",
  "items": [
    {
      "categorySlug": "drivers_license",
      "label": "Driver license",
      "required": true,
      "sortOrder": 0
    }
  ]
}
```

`categorySlug` must match a category `slug` in the app (seed categories are created on first launch).

## License

MIT
