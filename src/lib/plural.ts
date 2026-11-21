/** "1 row", "2 rows". */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString('en-IN')} ${n === 1 ? singular : pluralForm}`;
}
