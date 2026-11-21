import {
  CalendarRange,
  FileSpreadsheet,
  FolderOpen,
  LayoutDashboard,
  Play,
  Settings,
  Stethoscope,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { PageId } from './nav';

export const PAGE_ICONS: Record<PageId, LucideIcon> = {
  workspace: FolderOpen,
  sources: FileSpreadsheet,
  doctors: Stethoscope,
  costs: Wallet,
  run: Play,
  months: CalendarRange,
  dashboards: LayoutDashboard,
  settings: Settings,
};
