import { lazy, type ComponentType } from 'react';
import type { PageId } from '@/app/nav';

// Each page is loaded when it is first opened, so the first screen is quick to appear.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));

export const PAGE_COMPONENTS: Record<PageId, ComponentType> = {
  workspace: page(() => import('./WorkspacePage'), 'WorkspacePage'),
  sources: page(() => import('./SourcesPage'), 'SourcesPage'),
  doctors: page(() => import('./DoctorsPage'), 'DoctorsPage'),
  costs: page(() => import('./CostsPage'), 'CostsPage'),
  run: page(() => import('./RunPage'), 'RunPage'),
  months: page(() => import('./MonthsPage'), 'MonthsPage'),
  dashboards: page(() => import('./DashboardsPage'), 'DashboardsPage'),
  settings: page(() => import('./SettingsPage'), 'SettingsPage'),
};
