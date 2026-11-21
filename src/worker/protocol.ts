// Messages between the page and the worker. Each request has an id; the
// worker answers with any number of progress messages, then one result or error.

import type { CombineRequest, CombineTaskResult } from './tasks/combine';
import type { GenerateRequest, GenerateTaskResult } from './tasks/generate';
import type { InspectFileRequest, InspectFileResult } from './tasks/inspectFile';

export type TaskProgress = {
  /** Short plain-language step, e.g. "Reading rows". */
  stage: string;
  /** 0..1 overall. */
  fraction: number;
  detail?: string;
};

/** Every task the worker knows: request payload → result. New tasks are added here. */
export type TaskMap = {
  inspectFile: { request: InspectFileRequest; result: InspectFileResult };
  combine: { request: CombineRequest; result: CombineTaskResult };
  generate: { request: GenerateRequest; result: GenerateTaskResult };
  exportCombined: { request: null; result: Uint8Array };
};
export type TaskName = keyof TaskMap;

export type WorkerRequest = {
  [K in TaskName]: { id: number; task: K; payload: TaskMap[K]['request'] };
}[TaskName];

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: TaskProgress }
  | { id: number; type: 'result'; result: TaskMap[TaskName]['result'] }
  | { id: number; type: 'error'; message: string };
