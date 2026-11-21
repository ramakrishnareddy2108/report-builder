// Settings read from the workspace folder (sources, doctors, rules), shared by all pages.
// An invalid file blocks editing: saving over it would silently destroy the user's data.

import { create } from 'zustand';
import { loadDefaultRules } from '@/core/defaults';
import {
  DashboardsFileSchema,
  DoctorsFileSchema,
  RulesFileSchema,
  SCHEMA_VERSION,
  SourcesFileSchema,
  type DashboardsFile,
  type DoctorsFile,
  type RulesFile,
  type SourcesFile,
} from '@/core/schemas';
import { paths, type Workspace } from '@/storage/workspace';

type SettingsState = {
  status: 'idle' | 'loading' | 'ready' | 'error';
  /** Plain-language reason when status is 'error'. */
  error: string | null;
  workspace: Workspace | null;
  sources: SourcesFile;
  doctors: DoctorsFile;
  rules: RulesFile;
  /** null until dashboards.json exists (the Dashboards page then saves the starter dashboards). */
  dashboards: DashboardsFile | null;
  load: (ws: Workspace) => Promise<void>;
  saveSources: (next: SourcesFile) => Promise<void>;
  saveDoctors: (next: DoctorsFile) => Promise<void>;
  saveRules: (next: RulesFile) => Promise<void>;
  saveDashboards: (next: DashboardsFile) => Promise<void>;
};

const emptySources = (): SourcesFile => ({ version: SCHEMA_VERSION, sources: [] });
const emptyDoctors = (): DoctorsFile => ({ version: SCHEMA_VERSION, doctors: [], departments: [], sponsors: [] });

export const useSettings = create<SettingsState>()((set, get) => {
  const requireWorkspace = (): Workspace => {
    const ws = get().workspace;
    if (!ws) throw new Error('No workspace folder is connected.');
    return ws;
  };

  return {
    status: 'idle',
    error: null,
    workspace: null,
    sources: emptySources(),
    doctors: emptyDoctors(),
    rules: loadDefaultRules(),
    dashboards: null,

    async load(ws) {
      set({ status: 'loading', error: null, workspace: ws });
      try {
        await ws.ensureLayout();
        const [sources, doctors, rules, dashboards] = await Promise.all([
          ws.readJson(paths.sources, SourcesFileSchema),
          ws.readJson(paths.doctors, DoctorsFileSchema),
          ws.readJson(paths.rules, RulesFileSchema),
          ws.readJson(paths.dashboards, DashboardsFileSchema),
        ]);
        set({
          status: 'ready',
          sources: sources ?? emptySources(),
          doctors: doctors ?? emptyDoctors(),
          rules: rules ?? loadDefaultRules(),
          dashboards,
        });
      } catch (err) {
        set({ status: 'error', error: err instanceof Error ? err.message : String(err) });
      }
    },

    async saveSources(next) {
      await requireWorkspace().writeJson(paths.sources, next, SourcesFileSchema);
      set({ sources: next });
    },
    async saveDoctors(next) {
      await requireWorkspace().writeJson(paths.doctors, next, DoctorsFileSchema);
      set({ doctors: next });
    },
    async saveDashboards(next) {
      await requireWorkspace().writeJson(paths.dashboards, next, DashboardsFileSchema);
      set({ dashboards: next });
    },
    async saveRules(next) {
      await requireWorkspace().writeJson(paths.rules, next, RulesFileSchema);
      set({ rules: next });
    },
  };
});
