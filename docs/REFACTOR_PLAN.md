# Refactor plan — old workspace design → recipe design

Source of truth: `CLAUDE.md` (new). Old design: `docs/CLAUDE.old.md`.
Steps follow `docs/REDESIGN_PROMPTS.md` (R1 … R13), plus one extra step **R2b** for the
PWA / mobile shell that was requested on top of the prompts.

## KEEP as is

| Module | Why |
|---|---|
| `src/excel/readWorkbook.ts` | SheetJS read, rows aligned to Excel rows, cached formula values, error cells. Already does what the reading rules need. |
| `src/excel/detectHeader.ts` | Header auto-detect (most text cells in first 20 rows), **unique headers (`NAME (2)`)**, column letters, `findHeaderColumn`. |
| `src/excel/escape.ts` | Principle 5 (leading `'`). |
| `src/formula/*` | Tokenizer / parser / evaluator / ColumnIndex (letters supported). Gets 3 new functions in R4. |
| `src/core/money.ts` | Exact paise parse / sum / format. |
| `src/core/dates.ts` | **IST calendar dates**, `02-OCT-2026`, `02-10-2026`, `2026-10-02`, `monthLabel`, `defaultReportMonth`. |
| `src/worker/client.ts`, `protocol.ts`, `*.worker.ts` shape | Promise-per-task worker with progress events. Tasks are replaced; plumbing stays. |
| `src/components/ui/*`, `DataGrid`, `EmptyState`, `PageHeader`, `ConfirmDialog`, `ErrorBoundary`, `lib/useUnsavedWarning` | UI building blocks. |
| `src/components/dashboards/TileChart.tsx` + the ECharts option idea in `tileOption.ts` | Rewritten against the new `Tile` type in R12; the ECharts setup (tree-shaken, PNG export) stays. |
| `.github/workflows/deploy.yml` | Deploys `main` to GitHub Pages. |
| `tests/helpers/syntheticWorkbook.ts`, `tests/fixtures/synthetic/` | Synthetic data only. |
| Tests for the kept modules: `formula`, `money`, `dates`, `detectHeader`, `readWorkbook`, `escape` (inside others) | Still valid. |

## Facts in the old code that must be preserved

- **Dates:** Excel dates are read as calendar days in **Asia/Kolkata** (`istDateParts`); never slice the UTC ISO string. Text dates `DD-MON-YYYY`, `DD-MM-YYYY`, `DD/MM/YYYY`, `YYYY-MM-DD`.
- **Duplicate headers:** second one becomes `ADMISSIONDT (2)`; blank header → `Column F`; `from` may be a column letter.
- **Footer / total rows:** a blank-ID row at the end of ipDischarge / opBilling / opConsultations. Old code filtered "no reference" rows automatically; new design uses `rowFilter` and must **count** them as "footer/total rows" and keep the footer value for tie-outs.
- **Patient columns are never read** (`isPatientColumn`: patient, mobile, phone, address…). Keep this guard in the new column picker.
- **Money:** `parseMoney` distinguishes blank from invalid; invalid → blank + counted.
- **Formula cells:** cached value; counts of formula cells without a cached value are reported.
- **Extra sheets:** pick by sheet name.
- **IFERROR does not hide `#REF!` / `#NAME?`** (setup mistakes).
- **Template fill:** SUBTOTAL range warning, copy last row style when more rows than template, clear unused rows keeping formatting, write cached results next to formulas, write month as a real date at midnight UTC, rupees written once (paise / 100).
- **Checks sheet / Table export** layouts in `reportSheets.ts` / `tableSheet.ts` (escape, rupees only at export).

## MOVE / REWRITE into the new folders

| From | To | Notes |
|---|---|---|
| `src/excel/templates.ts` + `fillTemplate.ts` | `src/excel/fillTemplate.ts` (generic) | Same logic, but columns come from the recipe's report columns instead of `MEASURES`. |
| `src/excel/mapSource.ts` (`readMappedRows`, `resolveMapping`) | `src/engine/readSource.ts` | Recipe `SourceDef` instead of `SourceMapping`. Reuses `ColumnIndex`, `parseMoney`, `toIsoDate`. |
| `src/excel/identifySource.ts` | `src/engine/assignFiles.ts` | Name-pattern normalisation (ignore months / years / dates) reused. |
| `src/excel/reportSheets.ts`, `tableSheet.ts` | `src/excel/writePlain.ts`, `src/engine/output.ts` | Checks / Combined sheets. |
| `src/excel/readReport.ts` | `src/dashboard/data.ts` | Generic: header row auto, skip totals / SUBTOTAL rows, stack with `_file`. |
| `src/core/schemas.ts` (Zod) | `src/recipe/schema.ts`, `src/dashboard/schema.ts` | Zod 4 style kept. |
| `src/core/dashboard*.ts`, `components/dashboards/*` | `src/dashboard/tiles.ts`, `src/pages/Dashboards/*` | New `Tile` spec over report columns. |
| `src/worker/tasks/*` | `src/worker/generate.worker.ts` + `src/engine/*` | Tasks: `readSheetPreview`, `combine`, `generate`, `readOutput`. |
| `src/pages/DashboardsPage.tsx` | `src/pages/Dashboards/` | Rebuilt. |
| `src/app/Sidebar/Header/App/nav/store` | `src/app/*` | New pages: Home, Recipe builder, Generate, Dashboards, Help. |

## DELETE

- Workspace folder storage: `src/storage/*` (workspace, fs, backup, history, runs, costs, templates), `src/app/workspaceSession.ts`, `useWorkspace.ts`, `UnsupportedBrowser.tsx`, File System Access check, `@types/wicg-file-system-access`.
- Doctors master + names: `core/doctors.ts`, `pages/DoctorsPage`, `components/names/*`, `app/nameScan.ts`, `useSaveDoctors`, `worker/tasks/collectNames`.
- Costs: `core/costs.ts`, `pages/CostsPage`, `components/costs/*`, `storage/costs`.
- Runs / Final locking / months: `core/runMonth.ts`, `runTypes.ts`, `history.ts`, `app/runSession.ts`, `monthActions`, `pages/RunPage`, `MonthsPage`, `components/run/*`, `components/months/*`, `worker/tasks/runMonth`.
- Measures registry, `rules.ts` + `defaults/rules.default.json`, `sourceDefaults.ts`, `attribution.ts`, `aggregate.ts`, `report.ts`, `checks.ts` (old, rule-specific), `types.ts` (FieldKey etc.), `measures.ts`.
- Settings page + `settingsStore`, `operator.ts`, `reportFiles.ts`, `fileLoader.ts`, `filesStore.ts`, `useSourceInfos`, `MonthPicker`, `SettingsGate`, `components/sources/*`, `components/files/*`, `components/settings/*`.
- JSZip backup (`jszip` dependency).
- Old tests that only cover the removed code (workspace, backup, history, runs, doctors, costs, measures, attribution, runMonth, golden tests tied to the old rules).

Ideas from deleted code that return in new form: `core/checks.ts` check levels → `engine/checks.ts`; `attribution.ts` latest-on-or-before logic → `engine/lookups.ts`; `doctors.ts` `normaliseLabel` → `engine/cleanup.ts`.

## NEW modules

- `src/recipe/schema.ts`, `library.ts` (idb-keyval, export / import, merge), `defaults/*.recipe.json`
- `src/formula`: `TEXT`, `PARAM`, `STARTSWITH`; evaluator context with params
- `src/engine/`: `assignFiles`, `readSource`, `combine`, `cleanup`, `lookups`, `report`, `checks`, `output`, `generate`
- `src/excel/writePlain.ts`, generic `fillTemplate.ts`
- `src/dashboard/schema.ts`, `data.ts`, `tiles.ts`
- `src/pages/Home`, `RecipeBuilder/*`, `Generate`, `Dashboards`, `Help`
- `src/worker/generate.worker.ts`
- Zustand stores: `libraryStore` (recipes, dashboards, unsaved flag), `sessionStore` (last report in memory)

## Cross-cutting requirements added by the user

### 1. Progressive web app (installable, works on a phone)
- Web app manifest + icons (SVG + PNG 192/512 + maskable) + `theme-color` + iOS meta tags.
- **Hand-written service worker** (`public/sw.js`) that caches the app shell and hashed assets (cache-first for `assets/`, network-first for the page). **No new library** (CLAUDE.md: do not add libraries without asking; `vite-plugin-pwa` is therefore not used). Registered from `main.tsx` in production only. Relative paths so it works from a GitHub Pages sub-path.
- "Install app" button when the browser offers `beforeinstallprompt`; "New version available — Reload" banner.
- Works offline after the first visit (all processing is local anyway).
- Done in step **R2b**, right after the new shell.

### 2. Simple, mobile-friendly UX
- Responsive shell: sidebar ≥ md, **bottom tab bar** on phones; 44 px touch targets; no horizontal page scroll; grids scroll inside their own box.
- Home is the starting point with one big action per recipe: **Generate**.
- Generate is a 3-step guided flow (Files → Month → Generate) with a plain checklist and one primary button.
- Recipe builder uses plain-language labels and shows only the current tab's essentials; advanced options are collapsed.
- Mobile: files are picked via the file picker (drag & drop is optional), downloads use normal browser downloads.

## Order of work

R2 → R2b (PWA + mobile shell) → R3 … R13, one commit per step on branch `recipe-redesign`. Each step ends with typecheck, test, build. Nothing is pushed or merged to `main` until the user confirms.
