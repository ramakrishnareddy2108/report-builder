// Page-side wrapper around the worker: one shared worker, promise per task.

import type { TaskMap, TaskName, TaskProgress, WorkerRequest, WorkerResponse } from './protocol';
import type { CombineRequest, CombineTaskResult } from './tasks/combine';
import type { GenerateRequest, GenerateTaskResult } from './tasks/generate';
import type { PreviewRequest, PreviewResult } from './tasks/preview';
import type { InspectTemplateRequest, InspectTemplateResult } from './tasks/inspectTemplate';
import type { InspectFileRequest, InspectFileResult } from './tasks/inspectFile';

type Pending = {
  resolve: (result: unknown) => void;
  reject: (err: Error) => void;
  onProgress?: (p: TaskProgress) => void;
};

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();

function failAll(message: string) {
  for (const p of pending.values()) p.reject(new Error(message));
  pending.clear();
}

function getWorker(): Worker {
  if (worker) return worker;
  const w = new Worker(new URL('./generate.worker.ts', import.meta.url), { type: 'module' });
  w.addEventListener('message', (e: MessageEvent<WorkerResponse>) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    if (msg.type === 'progress') {
      p.onProgress?.(msg.progress);
    } else {
      pending.delete(msg.id);
      if (msg.type === 'result') p.resolve(msg.result);
      else p.reject(new Error(msg.message));
    }
  });
  w.addEventListener('error', (e) => {
    failAll(`The background reader stopped unexpectedly. Please reload the page. (${e.message})`);
    w.terminate();
    worker = null;
  });
  worker = w;
  return w;
}

export function runTask<K extends TaskName>(
  task: K,
  payload: TaskMap[K]['request'],
  onProgress?: (p: TaskProgress) => void,
): Promise<TaskMap[K]['result']> {
  const id = nextId++;
  return new Promise<TaskMap[K]['result']>((resolve, reject) => {
    pending.set(id, { resolve: (r) => resolve(r as TaskMap[K]['result']), reject, onProgress });
    getWorker().postMessage({ id, task, payload } as WorkerRequest);
  });
}

export function inspectFileInWorker(request: InspectFileRequest, onProgress?: (p: TaskProgress) => void): Promise<InspectFileResult> {
  return runTask('inspectFile', request, onProgress);
}

export function combineInWorker(request: CombineRequest, onProgress?: (p: TaskProgress) => void): Promise<CombineTaskResult> {
  return runTask('combine', request, onProgress);
}

export function generateInWorker(request: GenerateRequest, onProgress?: (p: TaskProgress) => void): Promise<GenerateTaskResult> {
  return runTask('generate', request, onProgress);
}

/** The combined table of the last generate run, as Excel bytes. */
export function exportCombinedInWorker(): Promise<Uint8Array> {
  return runTask('exportCombined', null);
}

/** Steps 1–7 (and optionally the report) on the sample files, for the Prepare and Report tabs. */
export function previewInWorker(request: PreviewRequest, onProgress?: (p: TaskProgress) => void): Promise<PreviewResult> {
  return runTask('preview', request, onProgress);
}

/** Where the report would go in an Excel template, and how its columns map. */
export function inspectTemplateInWorker(request: InspectTemplateRequest): Promise<InspectTemplateResult> {
  return runTask('inspectTemplate', request);
}
