import { create } from 'zustand';
import { parseHash, routeToHash, type Route } from './nav';

type AppState = {
  route: Route;
  /** Go to a page. The address bar follows, so the phone's Back button works. */
  go: (route: Route) => void;
};

export const useAppStore = create<AppState>()((set) => ({
  route: typeof window === 'undefined' ? { page: 'home' } : parseHash(window.location.hash),
  go: (route) => {
    if (typeof window !== 'undefined') {
      const hash = routeToHash(route);
      if (window.location.hash !== hash) window.location.hash = hash;
    }
    set({ route });
  },
}));

/** Keep the page in step with the address bar (Back / Forward). Call once at start. */
export function listenToHash(): () => void {
  const onChange = () => useAppStore.setState({ route: parseHash(window.location.hash) });
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}
