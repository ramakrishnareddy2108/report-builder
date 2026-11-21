// The workspace folder on the user's laptop: layout, paths and JSON helpers.
//
// All file access goes through the FsDir interface (./fs.ts) so this module can be
// tested with an in-memory folder. The only direct browser calls are the folder
// picker, permission checks and handle persistence at the bottom of this file.

import { del, get, set } from 'idb-keyval';
import { z } from 'zod';
import { loadDefaultRules } from '@/core/defaults';
import {
  ChecksFileSchema,
  CostsDefaultsFileSchema,
  CostsFileSchema,
  DashboardsFileSchema,
  DoctorsFileSchema,
  FactsFileSchema,
  MonthSchema,
  RulesFileSchema,
  RunInfoSchema,
  SettingsUsedFileSchema,
  SourcesFileSchema,
} from '@/core/schemas';
import type { RunStatus } from '@/core/types';
import { fsDirFromHandle, type FsDir } from './fs';

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

/** Suffix of the temp file written before a JSON file is replaced. */
export const TEMP_SUFFIX = '.tmp';

/** Characters Windows does not allow in file or folder names. */
const BAD_NAME_CHARS = /[\\:*?"<>|\u0000-\u001f]/;

export class WorkspacePathError extends Error {
  constructor(
    readonly path: string,
    reason: string,
  ) {
    super(`"${path}" is not a valid workspace path: ${reason}`);
    this.name = 'WorkspacePathError';
  }
}

/**
 * Split a workspace-relative path like `settings/rules.json` into segments.
 * Rejects absolute paths, `.` / `..`, empty segments and characters Windows forbids.
 */
export function splitPath(path: string): string[] {
  if (path.startsWith('/')) throw new WorkspacePathError(path, 'it must not start with "/"');
  const parts = path.split('/');
  for (const p of parts) {
    if (p === '') throw new WorkspacePathError(path, 'it has an empty folder name');
    if (p === '.' || p === '..') throw new WorkspacePathError(path, `"${p}" is not allowed`);
    if (BAD_NAME_CHARS.test(p)) throw new WorkspacePathError(path, `"${p}" has a forbidden character`);
    if (p !== p.trim() || p.endsWith('.')) {
      throw new WorkspacePathError(path, `"${p}" starts or ends with a space or dot`);
    }
  }
  return parts;
}

export function joinPath(...parts: string[]): string {
  return parts.filter((p) => p !== '').join('/');
}

export function runDirName(runNumber: number): string {
  return `run-${runNumber}`;
}

/** `run-3` → 3, anything else → null. */
export function parseRunDirName(name: string): number | null {
  const m = /^run-([1-9]\d*)$/.exec(name);
  return m ? Number(m[1]) : null;
}

export function isMonthDirName(name: string): boolean {
  return MonthSchema.safeParse(name).success;
}

export const paths = {
  settings: 'settings',
  templates: 'settings/templates',
  data: 'data',
  output: 'output',
  sources: 'settings/sources.json',
  doctors: 'settings/doctors.json',
  rules: 'settings/rules.json',
  costsDefaults: 'settings/costs-defaults.json',
  dashboards: 'settings/dashboards.json',
  drrTemplate: 'settings/templates/DRR Format.xlsx',
  sponsorTemplate: 'settings/templates/Sponsor-wise Revenue Report.xlsx',
  month: (month: string) => joinPath('data', month),
  run: (month: string, runNumber: number) => joinPath('data', month, runDirName(runNumber)),
  outputMonth: (month: string) => joinPath('output', month),
} as const;

/** Folders every workspace has. Parents come before children. */
export const LAYOUT_DIRS = [paths.settings, paths.templates, paths.data, paths.output] as const;

/** The settings files shown on the Workspace page. */
export const SETTINGS_FILES: readonly { path: string; label: string }[] = [
  { path: paths.sources, label: 'Source mappings' },
  { path: paths.doctors, label: 'Doctor master' },
  { path: paths.rules, label: 'Measure rules' },
  { path: paths.costsDefaults, label: 'Default costs' },
  { path: paths.dashboards, label: 'Dashboards' },
  { path: paths.drrTemplate, label: 'DRR template' },
  { path: paths.sponsorTemplate, label: 'Sponsor-wise template' },
];

/** Files inside data/<month>/run-<n>/ and the schema each must pass. */
const RUN_FILE_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  'facts.json': FactsFileSchema,
  'costs.json': CostsFileSchema,
  'checks.json': ChecksFileSchema,
  'settings-used.json': SettingsUsedFileSchema,
  'run-info.json': RunInfoSchema,
};

const SETTINGS_SCHEMAS: Readonly<Record<string, z.ZodType>> = {
  [paths.sources]: SourcesFileSchema,
  [paths.doctors]: DoctorsFileSchema,
  [paths.rules]: RulesFileSchema,
  [paths.costsDefaults]: CostsDefaultsFileSchema,
  [paths.dashboards]: DashboardsFileSchema,
};

/** Where a JSON path sits in the layout; used to pick its schema. */
export type JsonPathInfo =
  | { area: 'settings'; schema: z.ZodType }
  | { area: 'run'; schema: z.ZodType; month: string; runNumber: number };

/** The schema for a known JSON file in the workspace, or null if the path is not one. */
export function describeJsonPath(path: string): JsonPathInfo | null {
  const settingsSchema = SETTINGS_SCHEMAS[path];
  if (settingsSchema) return { area: 'settings', schema: settingsSchema };

  const parts = path.split('/');
  if (parts.length !== 4 || parts[0] !== 'data') return null;
  const [, month = '', run = '', file = ''] = parts;
  const runNumber = parseRunDirName(run);
  const schema = RUN_FILE_SCHEMAS[file];
  if (!isMonthDirName(month) || runNumber === null || !schema) return null;
  return { area: 'run', schema, month, runNumber };
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** A workspace file exists but cannot be used. The message is plain language. */
export class WorkspaceFileError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = 'WorkspaceFileError';
  }
}

/** Parse JSON text and validate it. Throws WorkspaceFileError with a readable message. */
export function parseJsonFile<S extends z.ZodType>(path: string, text: string, schema: S): z.output<S> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new WorkspaceFileError(path, `${path} is not valid JSON. It may be damaged or hand-edited.`);
  }
  const result = schema.safeParse(raw);
  if (!result.success) {
    throw new WorkspaceFileError(path, `${path} has problems:\n${z.prettifyError(result.error)}`);
  }
  return result.data;
}

export function toJsonText(data: unknown): string {
  return `${JSON.stringify(data, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Workspace
// ---------------------------------------------------------------------------

export type RunSummary = { runNumber: number; status: RunStatus | 'Unknown' };
export type MonthSummary = { month: string; runs: RunSummary[] };
export type SettingsFileStatus = {
  path: string;
  label: string;
  status: 'ok' | 'missing' | 'invalid';
  message?: string;
};
export type WorkspaceSummary = {
  name: string;
  /** Newest month first. */
  months: MonthSummary[];
  settings: SettingsFileStatus[];
};

export class Workspace {
  constructor(readonly root: FsDir) {}

  get name(): string {
    return this.root.name;
  }

  /** The folder at `segments`, or null if missing and `create` is false. */
  private async dirAt(segments: readonly string[], create: boolean): Promise<FsDir | null> {
    let dir: FsDir | null = this.root;
    for (const seg of segments) {
      dir = await dir.getDir(seg, create);
      if (!dir) return null;
    }
    return dir;
  }

  /** Parent folder and file name for a file path. */
  private async parentOf(path: string, create: boolean): Promise<{ dir: FsDir | null; name: string }> {
    const segs = splitPath(path);
    const name = segs.pop() as string; // splitPath never returns []
    return { dir: await this.dirAt(segs, create), name };
  }

  async readFile(path: string): Promise<Blob | null> {
    const { dir, name } = await this.parentOf(path, false);
    return dir ? dir.readFile(name) : null;
  }

  async exists(path: string): Promise<boolean> {
    return (await this.readFile(path)) !== null;
  }

  /** Write a file, creating parent folders as needed. */
  async writeFile(path: string, data: Blob | string | Uint8Array): Promise<void> {
    const { dir, name } = await this.parentOf(path, true);
    const payload = data instanceof Uint8Array ? new Blob([new Uint8Array(data)]) : data;
    await (dir as FsDir).writeFile(name, payload);
  }

  /** Read and validate a JSON file. Null if missing; throws WorkspaceFileError if unusable. */
  async readJson<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S> | null> {
    const blob = await this.readFile(path);
    if (!blob) return null;
    return parseJsonFile(path, await blob.text(), schema);
  }

  /**
   * Write a JSON file safely: write `<name>.tmp`, then rename it over the target.
   * Pass `schema` to refuse writing data that would not load again.
   */
  async writeJson(path: string, data: unknown, schema?: z.ZodType): Promise<void> {
    if (schema) {
      const r = schema.safeParse(data);
      if (!r.success) {
        throw new WorkspaceFileError(path, `Refusing to save ${path}:\n${z.prettifyError(r.error)}`);
      }
    }
    await this.writeText(path, toJsonText(data));
  }

  /** Write text via temp file + rename. */
  async writeText(path: string, text: string): Promise<void> {
    const { dir, name } = await this.parentOf(path, true);
    const d = dir as FsDir;
    const tmp = name + TEMP_SUFFIX;
    await d.writeFile(tmp, text);
    await d.renameFile(tmp, name);
  }

  /** Names of the folders inside `path`, sorted. [] if `path` does not exist. */
  async listDirs(path: string): Promise<string[]> {
    const dir = await this.dirAt(path === '' ? [] : splitPath(path), false);
    if (!dir) return [];
    return (await dir.entries()).filter((e) => e.kind === 'directory').map((e) => e.name);
  }

  /** Names of the files inside `path`, sorted. Temp files are left out. */
  async listFiles(path: string): Promise<string[]> {
    const dir = await this.dirAt(path === '' ? [] : splitPath(path), false);
    if (!dir) return [];
    return (await dir.entries())
      .filter((e) => e.kind === 'file' && !isTempFileName(e.name))
      .map((e) => e.name);
  }

  /** Every file under `path`, as workspace paths, sorted. Temp files are left out. */
  async listFilesDeep(path: string): Promise<string[]> {
    const out: string[] = [];
    const walk = async (dir: FsDir, prefix: string): Promise<void> => {
      for (const e of await dir.entries()) {
        const p = joinPath(prefix, e.name);
        if (e.kind === 'directory') {
          const sub = await dir.getDir(e.name, false);
          if (sub) await walk(sub, p);
        } else if (!isTempFileName(e.name)) {
          out.push(p);
        }
      }
    };
    const start = await this.dirAt(path === '' ? [] : splitPath(path), false);
    if (start) await walk(start, path);
    return out.sort();
  }

  /**
   * Create any missing layout folders and seed settings/rules.json from the defaults.
   * Existing files are never touched. Returns the paths that were created.
   */
  ensureLayout(): Promise<string[]> {
    // Two callers at once (the Workspace page and the settings loader) share one run;
    // otherwise they would race on the same temp file.
    this.layoutInFlight ??= this.createLayout().finally(() => {
      this.layoutInFlight = null;
    });
    return this.layoutInFlight;
  }

  private layoutInFlight: Promise<string[]> | null = null;

  private async createLayout(): Promise<string[]> {
    const created: string[] = [];
    for (const path of LAYOUT_DIRS) {
      const segs = splitPath(path);
      if (!(await this.dirAt(segs, false))) {
        await this.dirAt(segs, true);
        created.push(`${path}/`);
      }
    }
    if (!(await this.exists(paths.rules))) {
      await this.writeJson(paths.rules, loadDefaultRules(), RulesFileSchema);
      created.push(paths.rules);
    }
    return created;
  }

  /** Months under data/ (newest first) with their runs. */
  async listMonths(): Promise<MonthSummary[]> {
    const months = (await this.listDirs(paths.data)).filter(isMonthDirName).sort().reverse();
    const out: MonthSummary[] = [];
    for (const month of months) {
      const runNumbers = (await this.listDirs(paths.month(month)))
        .map(parseRunDirName)
        .filter((n): n is number => n !== null)
        .sort((a, b) => a - b);
      const runs: RunSummary[] = [];
      for (const runNumber of runNumbers) {
        let status: RunSummary['status'] = 'Unknown';
        try {
          const info = await this.readJson(joinPath(paths.run(month, runNumber), 'run-info.json'), RunInfoSchema);
          if (info) status = info.status;
        } catch {
          // shown as Unknown
        }
        runs.push({ runNumber, status });
      }
      out.push({ month, runs });
    }
    return out;
  }

  /** Which settings files exist and whether the JSON ones pass validation. */
  async settingsStatus(): Promise<SettingsFileStatus[]> {
    const out: SettingsFileStatus[] = [];
    for (const { path, label } of SETTINGS_FILES) {
      const blob = await this.readFile(path);
      if (!blob) {
        out.push({ path, label, status: 'missing' });
        continue;
      }
      const schema = SETTINGS_SCHEMAS[path];
      if (!schema) {
        out.push({ path, label, status: 'ok' });
        continue;
      }
      try {
        parseJsonFile(path, await blob.text(), schema);
        out.push({ path, label, status: 'ok' });
      } catch (err) {
        out.push({ path, label, status: 'invalid', message: (err as Error).message });
      }
    }
    return out;
  }

  async summary(): Promise<WorkspaceSummary> {
    const [months, settings] = await Promise.all([this.listMonths(), this.settingsStatus()]);
    return { name: this.name, months, settings };
  }
}

export function isTempFileName(name: string): boolean {
  return name.endsWith(TEMP_SUFFIX) || name.endsWith('.crswap');
}

// ---------------------------------------------------------------------------
// Browser: picker, permission, handle persistence (not unit-tested)
// ---------------------------------------------------------------------------

const HANDLE_KEY = 'drr-workspace-handle';

/** True when the browser supports picking a folder (Chrome / Edge on desktop). */
export function isFileSystemAccessSupported(win: object = globalThis): boolean {
  return typeof (win as { showDirectoryPicker?: unknown }).showDirectoryPicker === 'function';
}

/**
 * Ask the user to choose the workspace folder.
 * Returns null if the user cancels the picker.
 */
export async function pickWorkspaceFolder(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await window.showDirectoryPicker({ id: 'drr-workspace', mode: 'readwrite' });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return null;
    throw err;
  }
}

export function openWorkspace(handle: FileSystemDirectoryHandle): Workspace {
  return new Workspace(fsDirFromHandle(handle));
}

/** Remember the folder so it is offered again next time the app opens. */
export async function saveWorkspaceHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  await set(HANDLE_KEY, handle);
}

export async function loadWorkspaceHandle(): Promise<FileSystemDirectoryHandle | null> {
  const h: unknown = await get(HANDLE_KEY);
  return h instanceof FileSystemDirectoryHandle ? h : null;
}

export async function forgetWorkspaceHandle(): Promise<void> {
  await del(HANDLE_KEY);
}

/** Read/write permission already granted? (No prompt.) */
export async function hasWorkspacePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  return (await handle.queryPermission({ mode: 'readwrite' })) === 'granted';
}

/** Ask for read/write permission. Must be called from a click. */
export async function requestWorkspacePermission(handle: FileSystemDirectoryHandle): Promise<boolean> {
  if (await hasWorkspacePermission(handle)) return true;
  return (await handle.requestPermission({ mode: 'readwrite' })) === 'granted';
}
