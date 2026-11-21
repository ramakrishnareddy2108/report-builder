import { CircleHelp, House, LayoutDashboard, Play, type LucideIcon } from 'lucide-react';
import type { PageId } from './nav';

export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  home: House,
  recipe: House,
  generate: Play,
  dashboards: LayoutDashboard,
  help: CircleHelp,
};
