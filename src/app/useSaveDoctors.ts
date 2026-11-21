import { useCallback } from 'react';
import { toast } from 'sonner';
import type { DoctorsFile } from '@/core/schemas';
import { useSettings } from './settingsStore';

/** Save doctors.json, telling the user in plain language when it cannot be saved. */
export function useSaveDoctors(): (next: DoctorsFile, message?: string) => Promise<boolean> {
  const saveDoctors = useSettings((s) => s.saveDoctors);
  return useCallback(
    async (next, message) => {
      try {
        await saveDoctors(next);
        if (message) toast.success(message);
        return true;
      } catch (err) {
        toast.error(`Could not save: ${err instanceof Error ? err.message : String(err)}`);
        return false;
      }
    },
    [saveDoctors],
  );
}
