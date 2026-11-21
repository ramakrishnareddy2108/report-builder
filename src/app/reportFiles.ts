// Making the two Excel reports for a run: fill the templates in the worker, keep a
// copy in output/<month>/, and offer the files for download. Used by the Run page
// (for the run on screen) and the Months page (to download a past run again).

import { doctorReport, sponsorReport } from '@/core/report';
import type { DoctorMaster } from '@/core/types';
import type { CheckResult, CostEntry, FactRow } from '@/core/types';
import { downloadFile } from '@/storage/backup';
import { readTemplate } from '@/storage/templates';
import { joinPath, paths, type Workspace } from '@/storage/workspace';
import { buildReportsInWorker } from '@/worker/client';
import type { TaskProgress } from '@/worker/protocol';
import type { BuildReportsResult } from '@/worker/tasks/reports';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export type ReportSource = {
  month: string;
  runNumber: number;
  facts: readonly FactRow[];
  costs: readonly CostEntry[];
  /** The doctor list the run used (names are in the reports). */
  doctors: readonly DoctorMaster[];
  checks: readonly CheckResult[];
};

/**
 * Fill the DRR and Sponsor-wise templates from a run's own data. Reports that cannot be made
 * (a template is missing or does not fit) are returned in `errors`, not thrown.
 */
export async function makeAndSaveReports(
  ws: Workspace,
  source: ReportSource,
  onProgress?: (p: TaskProgress) => void,
): Promise<BuildReportsResult> {
  const built = await buildReportsInWorker(
    {
      month: source.month,
      runNumber: source.runNumber,
      drr: await readTemplate(ws, 'drr'),
      sponsor: await readTemplate(ws, 'sponsor'),
      drrRows: doctorReport(source.facts, source.costs, source.doctors, source.month),
      sponsorRows: sponsorReport(source.facts, source.month),
      checks: [...source.checks],
      facts: [...source.facts],
      doctorNames: source.doctors.map((d) => [d.id, d.displayName]),
    },
    onProgress,
  );
  for (const file of built.files) {
    await ws.writeFile(joinPath(paths.outputMonth(source.month), file.fileName), file.bytes);
    downloadFile(file.bytes, file.fileName, XLSX_MIME);
  }
  return built;
}
