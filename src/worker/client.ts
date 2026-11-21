// Page-side wrapper around the worker: one shared worker, promise per task.

import type { TaskMap, TaskName, TaskProgress, WorkerRequest, WorkerResponse } from './protocol';
import type { CollectNamesRequest, CollectNamesResult } from './tasks/collectNames';
import type { RunOutput } from '@/core/runMonth';
import type { ReadFileRequest, ReadFileResult } from './tasks/readFile';
import type { BuildReportsRequest, BuildReportsResult, CheckTemplatesRequest, InspectTemplateRequest, InspectTemplateResult } from './tasks/reports';
import type { CheckResult } from '@/core/types';
import type { RunMonthRequest } from './tasks/runMonth';

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
  const w = new Worker(new URL('./runMonth.worker.ts', import.meta.url), { type: 'module' });
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

export function readFileInWorker(
  request: ReadFileRequest,
  onProgress?: (p: TaskProgress) => void,
): Promise<ReadFileResult> {
  return runTask('readFile', request, onProgress);
}

export function collectNamesInWorker(
  request: CollectNamesRequest,
  onProgress?: (p: TaskProgress) => void,
): Promise<CollectNamesResult> {
  return runTask('collectNames', request, onProgress);
}

export function runMonthInWorker(request: RunMonthRequest, onProgress?: (p: TaskProgress) => void): Promise<RunOutput> {
  return runTask('runMonth', request, onProgress);
}

export function checkTemplatesInWorker(request: CheckTemplatesRequest): Promise<CheckResult[]> {
  return runTask('checkTemplates', request);
}

export function buildReportsInWorker(request: BuildReportsRequest, onProgress?: (p: TaskProgress) => void): Promise<BuildReportsResult> {
  return runTask('buildReports', request, onProgress);
}

export function inspectTemplateInWorker(request: InspectTemplateRequest): Promise<InspectTemplateResult> {
  return runTask('inspectTemplate', request);
}
