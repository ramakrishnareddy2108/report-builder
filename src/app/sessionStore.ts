// The last report generated in this session, in memory only, so the Dashboards page can use it.
// Nothing here is saved: a reload clears it (principle: uploaded data lives only in memory).

import { create } from 'zustand';
import type { ReportColumnInfo, ReportRow } from '@/engine/report';

export type SessionReport = {
  recipeId: string;
  recipeName: string;
  /** The period the report is for (for example Oct-2026), when the recipe has a Month parameter. */
  period: string;
  columns: ReportColumnInfo[];
  rows: ReportRow[];
};

type SessionState = {
  lastReport: SessionReport | null;
  setLastReport: (report: SessionReport | null) => void;
};

export const useSession = create<SessionState>()((set) => ({
  lastReport: null,
  setLastReport: (lastReport) => set({ lastReport }),
}));
