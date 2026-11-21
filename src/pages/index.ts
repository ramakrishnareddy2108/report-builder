import { lazy, type ComponentType } from 'react';
import type { PageId } from '@/app/nav';

// Each page is loaded when it is first opened, so the first screen is quick to appear.
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(async () => ({ default: (await load())[name] }));

export const PAGE_COMPONENTS: Record<PageId, ComponentType> = {
  home: page(() => import('./Home'), 'HomePage'),
  recipe: page(() => import('./RecipeBuilder'), 'RecipeBuilderPage'),
  generate: page(() => import('./Generate'), 'GeneratePage'),
  dashboards: page(() => import('./Dashboards'), 'DashboardsPage'),
  help: page(() => import('./Help'), 'HelpPage'),
};
