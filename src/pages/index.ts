import type { ComponentType } from 'react';
import type { PageId } from '@/app/nav';
import { CostsPage } from './CostsPage';
import { DashboardsPage } from './DashboardsPage';
import { DoctorsPage } from './DoctorsPage';
import { MonthsPage } from './MonthsPage';
import { RunPage } from './RunPage';
import { SettingsPage } from './SettingsPage';
import { SourcesPage } from './SourcesPage';
import { WorkspacePage } from './WorkspacePage';

export const PAGE_COMPONENTS: Record<PageId, ComponentType> = {
  workspace: WorkspacePage,
  sources: SourcesPage,
  doctors: DoctorsPage,
  costs: CostsPage,
  run: RunPage,
  months: MonthsPage,
  dashboards: DashboardsPage,
  settings: SettingsPage,
};
