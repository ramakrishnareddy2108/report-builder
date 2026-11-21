// Messages between the page and the worker. Each request has an id; the
// worker answers with any number of progress messages, then one result or error.

import type { CollectNamesRequest, CollectNamesResult } from './tasks/collectNames';
import type { RunOutput } from '@/core/runMonth';
import type { ReadFileRequest, ReadFileResult } from './tasks/readFile';
import type { BuildReportsRequest, BuildReportsResult, CheckTemplatesRequest, InspectTemplateRequest, InspectTemplateResult, ReadReportRequest, ReadReportResult } from './tasks/reports';
import type { CompareExportInput } from '@/excel/compareSheet';
import type { CheckResult } from '@/core/types';
import type { RunMonthRequest } from './tasks/runMonth';

export type TaskProgress = {
  /** Short plain-language step, e.g. "Reading rows". */
  stage: string;
  /** 0..1 overall. */
  fraction: number;
  detail?: string;
};

/** Every task the worker knows: request payload → result. */
export type TaskMap = {
  readFile: { request: ReadFileRequest; result: ReadFileResult };
  collectNames: { request: CollectNamesRequest; result: CollectNamesResult };
  runMonth: { request: RunMonthRequest; result: RunOutput };
  checkTemplates: { request: CheckTemplatesRequest; result: CheckResult[] };
  buildReports: { request: BuildReportsRequest; result: BuildReportsResult };
  inspectTemplate: { request: InspectTemplateRequest; result: InspectTemplateResult };
  readReport: { request: ReadReportRequest; result: ReadReportResult };
  exportCompare: { request: CompareExportInput; result: Uint8Array };
};
export type TaskName = keyof TaskMap;

export type WorkerRequest = {
  [K in TaskName]: { id: number; task: K; payload: TaskMap[K]['request'] };
}[TaskName];

export type WorkerResponse =
  | { id: number; type: 'progress'; progress: TaskProgress }
  | { id: number; type: 'result'; result: TaskMap[TaskName]['result'] }
  | { id: number; type: 'error'; message: string };
