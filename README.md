# Report Builder

A small browser app that turns a set of **Excel exports** into a **finished Excel report**, using a saved
**recipe**. Open the recipe, add the files, press **Generate**, read the checks, download.

It started as the DRR (Doctor-wise Revenue Report) tool for the finance team at G2 Health Care, and is generic: the
DRR and the Sponsor-wise report are just the two starter recipes. It also draws **dashboards** from finished reports,
for example to compare three months.

**Your data stays on your device.** Everything runs in the browser. Nothing is uploaded, there is no server and no
login. Only recipes and dashboard layouts are saved (in this browser). The Excel files you add, and the names and
amounts in them, live in memory until you close the page. Patient names, phone numbers and addresses cannot even be
picked as columns.

## It is an installable app (PWA)

Open the site once, then **Install app** (Chrome, Edge, Android) or **Share → Add to Home Screen** (iPhone). After the
first visit it also works without internet. The layout adapts to phones: a tab bar at the bottom, large touch targets.

## How it works

| Page | What it is for |
| --- | --- |
| **Home** | Your recipes and dashboards: New, Edit, Generate, Duplicate, Delete. Export / Import library. |
| **Recipe builder** | 1 Sources · 2 Prepare · 3 Report · 4 Output · 5 Test & Save. Set up once. |
| **Generate** | Pick a recipe → add this month's files → check the month → Generate → checks → download. |
| **Dashboards** | Tiles (numbers, charts, tables) over the last report or several saved reports. |
| **Help** | A short how-to and the formula reference. |

See [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) for the guide for users, and [`CLAUDE.md`](CLAUDE.md) for the design and the
rules the app follows. [`docs/DESIGN_NOTES.md`](docs/DESIGN_NOTES.md) lists where the code adds to, or interprets, that design.

## Backup and sharing

Recipes and dashboards are stored in IndexedDB in the browser. **Export library** (on Home) saves them as one JSON file
(`report-library-YYYYMMDD.json`); **Import library** reads it back, shows what is new and what would be overwritten,
and lets you Merge (default) or Replace all. A badge, *Unsaved to file*, reminds you to export after changes.

## Never commit patient data

The real exports are patient data. The folder `samples/` and every `.xlsx` outside `tests/fixtures/synthetic/` are
git-ignored, and tests use made-up data built in memory. The app also refuses an Excel template that already holds
names and amounts, because a template is saved inside the recipe.

## For developers

Stack: React + TypeScript (strict) + Vite, Tailwind + shadcn/ui, Zustand, AG Grid, Apache ECharts, SheetJS, ExcelJS, Zod,
idb-keyval, Vitest, a plain Web Worker. No server.

```bash
npm ci            # install exactly what package-lock.json says
npm run dev       # run locally
npm run typecheck
npm run test      # golden tests skip themselves when samples/ is missing
npm run build     # production build in dist/ (includes the offline service worker)
```

```text
src/
  app/        shell, stores (library, generate session, dashboards hand-off), PWA
  pages/      Home, RecipeBuilder, Generate, Dashboards, Help
  recipe/     schema (Zod), library (IndexedDB + import/export), validate, defaults/*.recipe.json
  engine/     assignFiles, readSource, combine, cleanup, lookups, report, checks, output, generate  (pure)
  formula/    the formula language (no eval)
  excel/      readWorkbook, detectHeader, convert, fillTemplate, writePlain, escape
  dashboard/  schema, data (load + stack), tiles (spec → numbers), chartOption
  worker/     generate.worker.ts and its tasks
tests/        unit, golden (real files in samples/, skipped when absent), fixtures/synthetic
```

The engine is pure functions with unit tests; React only edits recipe / dashboard JSON and shows results.
Real-data checks: `npx vitest run tests/golden/drr.test.ts --silent=false` (needs `samples/2026-10/`).

### The offline service worker

`public/sw.js` is hand-written (no PWA library). At build time `scripts/precachePlugin.ts` writes the list of every file
of the app into it, so the whole app is stored on the first visit. A new version waits until the user taps **Reload**.
App icons are made by `node scripts/make-icons.mjs`. The starter recipes are made by `node scripts/make-default-recipes.mjs`.

### Publishing to GitHub Pages

The app is a set of static files. `.github/workflows/deploy.yml` builds and publishes it on every push to `main`
(install, typecheck, test, build, deploy). One-time repository setup:

1. In GitHub, open the repository's **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main`. The run appears in the **Actions** tab, and the address of the site is shown in the
   `github-pages` environment (normally `https://<user>.github.io/<repository>/`).

A public repository is fine because the code holds no patient data. A private repository needs a paid GitHub plan
for Pages. Installing the app needs the site to be served over HTTPS, which GitHub Pages does.
