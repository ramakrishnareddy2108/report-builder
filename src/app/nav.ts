export const PAGES = [
  { id: 'workspace', label: 'Workspace' },
  { id: 'sources', label: 'Sources' },
  { id: 'doctors', label: 'Doctors' },
  { id: 'costs', label: 'Costs' },
  { id: 'run', label: 'Run' },
  { id: 'months', label: 'Months' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'settings', label: 'Settings' },
] as const;

export type PageId = (typeof PAGES)[number]['id'];
