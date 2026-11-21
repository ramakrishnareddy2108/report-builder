import { useCallback, useState } from 'react';

const KEY = 'drr.operatorName';

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? '';
  } catch {
    return ''; // storage can be blocked; the name is then simply not remembered
  }
}

/** The self-declared name of the person using the app, remembered in this browser only. */
export function useOperatorName(): [string, (name: string) => void] {
  const [name, setName] = useState(read);
  const update = useCallback((next: string) => {
    setName(next);
    try {
      localStorage.setItem(KEY, next);
    } catch {
      // not remembered
    }
  }, []);
  return [name, update];
}
