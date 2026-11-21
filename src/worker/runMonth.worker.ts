// Web Worker that reads source files (and, later, runs a month) off the main
// thread so big files such as the 12,586-row pharmacy export never freeze the page.

import { WorkbookReadError } from '@/excel/readWorkbook';
import type { TaskProgress, WorkerRequest, WorkerResponse } from './protocol';
import { readFileTask } from './tasks/readFile';

type WorkerScope = {
  postMessage(message: WorkerResponse): void;
  addEventListener(type: 'message', listener: (e: MessageEvent<WorkerRequest>) => void): void;
};
const scope = self as unknown as WorkerScope;

function plainMessage(err: unknown): string {
  if (err instanceof WorkbookReadError) return err.message;
  const detail = err instanceof Error ? err.message : String(err);
  return `Something went wrong while reading the file. (${detail})`;
}

scope.addEventListener('message', (e) => {
  const req = e.data;
  const progress = (p: TaskProgress) =>
    scope.postMessage({ id: req.id, type: 'progress', progress: p });

  const run = async () => {
    switch (req.task) {
      case 'readFile':
        return readFileTask(req.payload, progress);
    }
  };

  run().then(
    (result) => scope.postMessage({ id: req.id, type: 'result', result }),
    (err: unknown) => scope.postMessage({ id: req.id, type: 'error', message: plainMessage(err) }),
  );
});
