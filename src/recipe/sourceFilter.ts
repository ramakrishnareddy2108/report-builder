// The "only rows from these sources" quick-pick of an aggregate column, as a formula and back.
//   one source   →  [Source]="OP Billing"
//   several      →  OR([Source]="OP Pharmacy",[Source]="OP Returns")
// Anything else the user typed is left alone (parse returns null).

const ONE = /\[Source\]\s*=\s*"((?:[^"]|"")*)"/g;

export function buildSourceFilter(labels: readonly string[]): string {
  const terms = labels.map((l) => `[Source]="${l.replace(/"/g, '""')}"`);
  if (terms.length === 0) return '';
  return terms.length === 1 ? (terms[0] as string) : `OR(${terms.join(',')})`;
}

/** The source labels in a filter built by buildSourceFilter; null when the formula is anything else. */
export function parseSourceFilter(where: string | undefined): string[] | null {
  const text = (where ?? '').trim();
  if (text === '') return [];
  const labels = [...text.matchAll(ONE)].map((m) => (m[1] as string).replace(/""/g, '"'));
  if (labels.length === 0) return null;
  return buildSourceFilter(labels) === text.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ',').replace(/\s*=\s*/g, '=') ? labels : null;
}
