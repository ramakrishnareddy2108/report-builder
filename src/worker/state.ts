// What the worker remembers between tasks: the last combined table, in memory only (never stored).
// It lets "Download combined data" work without sending thousands of rows back and forth.

import type { CombinedTable } from '@/engine/types';

let lastCombined: CombinedTable | null = null;

export const setLastCombined = (table: CombinedTable | null): void => {
  lastCombined = table;
};
export const getLastCombined = (): CombinedTable | null => lastCombined;
