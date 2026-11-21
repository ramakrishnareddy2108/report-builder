import { useEffect } from 'react';

/** While `active`, the browser asks before the tab is closed or reloaded, so unsaved work is not lost by accident. */
export function useUnsavedWarning(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ''; // required by some browsers to show the prompt
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [active]);
}
