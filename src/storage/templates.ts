// The report templates kept in settings/templates/.

import type { ReportKind } from '@/core/measures';
import { paths, type Workspace } from './workspace';

export const TEMPLATE_PATHS: Readonly<Record<ReportKind, string>> = {
  drr: paths.drrTemplate,
  sponsor: paths.sponsorTemplate,
};

export const TEMPLATE_LABELS: Readonly<Record<ReportKind, string>> = {
  drr: 'DRR (Doctor-wise Revenue Report)',
  sponsor: 'Sponsor-wise Revenue Report',
};

/** The template's bytes, or null if none was uploaded. */
export async function readTemplate(ws: Workspace, kind: ReportKind): Promise<ArrayBuffer | null> {
  const blob = await ws.readFile(TEMPLATE_PATHS[kind]);
  return blob ? blob.arrayBuffer() : null;
}

export async function writeTemplate(ws: Workspace, kind: ReportKind, bytes: ArrayBuffer | Uint8Array): Promise<void> {
  await ws.writeFile(TEMPLATE_PATHS[kind], bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
}

/** Size of each template in bytes (null = not uploaded). */
export async function templateSizes(ws: Workspace): Promise<Record<ReportKind, number | null>> {
  const size = async (kind: ReportKind) => (await ws.readFile(TEMPLATE_PATHS[kind]))?.size ?? null;
  return { drr: await size('drr'), sponsor: await size('sponsor') };
}
