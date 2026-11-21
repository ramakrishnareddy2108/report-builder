// Small valid objects for workspace and backup tests.

export function runInfo(month: string, runNumber: number, status: 'Draft' | 'Final') {
  return {
    version: 1,
    month,
    runNumber,
    status,
    createdAt: '2026-11-01T10:00:00+05:30',
    ...(status === 'Final' ? { finalizedAt: '2026-11-02T10:00:00+05:30' } : {}),
    operatorName: 'Tester',
    reason: null,
    files: [],
  };
}
