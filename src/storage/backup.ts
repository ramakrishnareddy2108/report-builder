// Workspace backup / restore as a zip (JSZip).
//
// A backup holds settings/ and data/ (not output/, which can be regenerated)
// plus backup-info.json at the root. Restore is two steps: planRestore() checks
// every file and reports what would change; applyRestore() writes it after the
// user confirms. Files in the workspace that are not in the backup are kept.

import JSZip from 'jszip';
import { BACKUP_APP_ID, BackupManifestSchema, RunInfoSchema, SCHEMA_VERSION } from '@/core/schemas';
import {
  describeJsonPath,
  isTempFileName,
  joinPath,
  parseJsonFile,
  paths,
  splitPath,
  toJsonText,
  Workspace,
  WorkspacePathError,
} from './workspace';

export const BACKUP_ROOTS = [paths.settings, paths.data] as const;
export const MANIFEST_NAME = 'backup-info.json';

const pad = (n: number) => String(n).padStart(2, '0');

/** `backup-YYYYMMDD-HHmm.zip` in the laptop's local time. */
export function backupFileName(at: Date = new Date()): string {
  const d = `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}`;
  return `backup-${d}-${pad(at.getHours())}${pad(at.getMinutes())}.zip`;
}

// ---------------------------------------------------------------------------
// Backup
// ---------------------------------------------------------------------------

export type BackupResult = { fileName: string; data: Uint8Array; fileCount: number };

export async function createBackup(ws: Workspace, at: Date = new Date()): Promise<BackupResult> {
  const zip = new JSZip();
  const files: string[] = [];
  for (const root of BACKUP_ROOTS) {
    for (const path of await ws.listFilesDeep(root)) {
      const blob = await ws.readFile(path);
      if (!blob) continue; // removed while we were reading
      zip.file(path, new Uint8Array(await blob.arrayBuffer()));
      files.push(path);
    }
  }
  const manifest = BackupManifestSchema.parse({
    version: SCHEMA_VERSION,
    app: BACKUP_APP_ID,
    createdAt: at.toISOString(),
    workspaceName: ws.name,
    files,
  });
  zip.file(MANIFEST_NAME, toJsonText(manifest));
  const data = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  return { fileName: backupFileName(at), data, fileCount: files.length };
}

/** Save bytes as a download in the browser. */
export function downloadFile(data: Uint8Array | Blob, fileName: string, type = 'application/zip'): void {
  const blob = data instanceof Blob ? data : new Blob([new Uint8Array(data)], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

// ---------------------------------------------------------------------------
// Restore
// ---------------------------------------------------------------------------

export type RestoreAction = 'add' | 'replace' | 'unchanged';

export type RestoreItem = {
  path: string;
  action: RestoreAction;
  sizeBytes: number;
  /** True when this replaces a file in a run that is Final in the workspace. */
  touchesFinalRun: boolean;
};

export type RestorePlan =
  | {
      ok: true;
      createdAt: string;
      workspaceName: string;
      items: RestoreItem[];
      /** Months that have files in the backup, newest first. */
      months: string[];
      counts: Record<RestoreAction, number>;
      /** File contents keyed by path, written by applyRestore. */
      contents: ReadonlyMap<string, Uint8Array>;
    }
  | { ok: false; errors: string[] };

const utf8 = new TextDecoder('utf-8', { fatal: true });

function decodeText(path: string, bytes: Uint8Array): string {
  try {
    return utf8.decode(bytes);
  } catch {
    throw new Error(`${path} is not readable text.`);
  }
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Check one file from the zip. Returns an error message, or null if it is fine. */
function checkEntry(path: string, bytes: Uint8Array): string | null {
  try {
    splitPath(path);
  } catch (err) {
    return err instanceof WorkspacePathError ? err.message : String(err);
  }
  const top = path.split('/')[0];
  if (!(BACKUP_ROOTS as readonly string[]).includes(top ?? '')) {
    return `${path} is outside settings/ and data/.`;
  }
  const name = path.split('/').pop() ?? '';
  if (isTempFileName(name)) return `${path} is a temporary file.`;

  if (name.toLowerCase().endsWith('.json')) {
    const info = describeJsonPath(path);
    if (!info) return `${path} is not a file this app knows how to check.`;
    try {
      const data = parseJsonFile(path, decodeText(path, bytes), info.schema) as {
        month?: unknown;
        runNumber?: unknown;
      };
      if (info.area !== 'settings' && data.month !== undefined && data.month !== info.month) {
        return `${path} says month ${String(data.month)}, but it is in the ${info.month} folder.`;
      }
      if (info.area === 'run' && data.runNumber !== undefined && data.runNumber !== info.runNumber) {
        return `${path} says run ${String(data.runNumber)}, but it is in the run-${info.runNumber} folder.`;
      }
    } catch (err) {
      return (err as Error).message;
    }
    return null;
  }

  if (path.startsWith(`${paths.templates}/`) && name.toLowerCase().endsWith('.xlsx')) return null;
  return `${path} is not a file this app expects in a backup.`;
}

/** Read a backup zip, validate everything and compare it with the workspace. Writes nothing. */
export async function planRestore(
  ws: Workspace,
  zipData: Blob | Uint8Array | ArrayBuffer,
): Promise<RestorePlan> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(zipData instanceof Blob ? await zipData.arrayBuffer() : zipData);
  } catch {
    return { ok: false, errors: ['This file is not a zip file, or it is damaged.'] };
  }

  const errors: string[] = [];
  const contents = new Map<string, Uint8Array>();
  const seenLower = new Map<string, string>();
  let manifestText: string | null = null;

  for (const entry of Object.values(zip.files)) {
    if (entry.dir) continue;
    const bytes = await entry.async('uint8array');
    if (entry.name === MANIFEST_NAME) {
      try {
        manifestText = decodeText(entry.name, bytes);
      } catch (err) {
        errors.push((err as Error).message);
      }
      continue;
    }
    // Windows folders ignore case, so two names differing only by case would collide.
    const lower = entry.name.toLowerCase();
    const clash = seenLower.get(lower);
    if (clash !== undefined) {
      errors.push(`${entry.name} and ${clash} would overwrite each other.`);
      continue;
    }
    seenLower.set(lower, entry.name);

    const problem = checkEntry(entry.name, bytes);
    if (problem) errors.push(problem);
    else contents.set(entry.name, bytes);
  }

  if (manifestText === null) {
    errors.unshift(`This zip has no ${MANIFEST_NAME}, so it is not a backup made by this app.`);
    return { ok: false, errors };
  }
  let manifest;
  try {
    manifest = parseJsonFile(MANIFEST_NAME, manifestText, BackupManifestSchema);
  } catch (err) {
    errors.unshift((err as Error).message);
    return { ok: false, errors };
  }

  const listed = new Set(manifest.files);
  const actual = new Set(seenLower.values());
  for (const p of listed) if (!actual.has(p)) errors.push(`${p} is listed in the backup but missing from the zip.`);
  for (const p of actual) if (!listed.has(p)) errors.push(`${p} is in the zip but not listed in the backup.`);

  if (errors.length > 0) return { ok: false, errors };

  // Compare with the workspace.
  const finalRuns = new Set<string>();
  const checkedRuns = new Set<string>();
  const items: RestoreItem[] = [];
  const months = new Set<string>();
  const sorted = [...contents.keys()].sort();

  for (const path of sorted) {
    const bytes = contents.get(path) as Uint8Array;
    const parts = path.split('/');
    let runDir: string | null = null;
    if (parts[0] === 'data' && parts.length >= 4) {
      months.add(parts[1] as string);
      runDir = joinPath(parts[0], parts[1] as string, parts[2] as string);
      if (!checkedRuns.has(runDir)) {
        checkedRuns.add(runDir);
        try {
          const info = await ws.readJson(joinPath(runDir, 'run-info.json'), RunInfoSchema);
          if (info?.status === 'Final') finalRuns.add(runDir);
        } catch {
          // An unreadable run-info.json in the workspace is not Final as far as we can tell.
        }
      }
    }
    const existing = await ws.readFile(path);
    let action: RestoreAction = 'add';
    if (existing) {
      action = sameBytes(new Uint8Array(await existing.arrayBuffer()), bytes) ? 'unchanged' : 'replace';
    }
    items.push({
      path,
      action,
      sizeBytes: bytes.length,
      touchesFinalRun: action === 'replace' && runDir !== null && finalRuns.has(runDir),
    });
  }

  const counts: Record<RestoreAction, number> = { add: 0, replace: 0, unchanged: 0 };
  for (const i of items) counts[i.action]++;

  return {
    ok: true,
    createdAt: manifest.createdAt,
    workspaceName: manifest.workspaceName,
    items,
    months: [...months].sort().reverse(),
    counts,
    contents,
  };
}

/** Write the files from a confirmed plan. Unchanged files are skipped. Returns how many were written. */
export async function applyRestore(
  ws: Workspace,
  plan: Extract<RestorePlan, { ok: true }>,
): Promise<number> {
  let written = 0;
  for (const item of plan.items) {
    if (item.action === 'unchanged') continue;
    const bytes = plan.contents.get(item.path);
    if (!bytes) throw new Error(`Missing contents for ${item.path}`);
    if (item.path.toLowerCase().endsWith('.json')) {
      await ws.writeText(item.path, decodeText(item.path, bytes));
    } else {
      await ws.writeFile(item.path, bytes);
    }
    written++;
  }
  return written;
}
