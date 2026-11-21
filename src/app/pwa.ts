// Installable app (PWA): registers the service worker, remembers the browser's "install" offer,
// and tells the user when a new version is ready.

import { create } from 'zustand';

/** The browser's install offer (Chrome, Edge, Android). Not in the TypeScript DOM types yet. */
type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

type PwaState = {
  /** The browser can show its install dialog. */
  canInstall: boolean;
  /** A new version has been downloaded and is waiting for a reload. */
  updateReady: boolean;
  /** Running as an installed app (no browser bar). */
  installed: boolean;
  install: () => Promise<void>;
  applyUpdate: () => void;
};

let installEvent: InstallPromptEvent | null = null;
let waiting: ServiceWorker | null = null;

export const usePwa = create<PwaState>()((set) => ({
  canInstall: false,
  updateReady: false,
  installed: typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)').matches === true,
  install: async () => {
    if (!installEvent) return;
    await installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    if (outcome === 'accepted') {
      installEvent = null;
      set({ canInstall: false });
    }
  },
  applyUpdate: () => {
    // The new worker takes over, then the page reloads (see `controllerchange` below).
    if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' });
    else window.location.reload();
  },
}));

function trackWaitingWorker(registration: ServiceWorkerRegistration): void {
  const flag = (worker: ServiceWorker | null) => {
    // A waiting worker next to an active one is an update; the very first install is not.
    if (worker && navigator.serviceWorker.controller) {
      waiting = worker;
      usePwa.setState({ updateReady: true });
    }
  };
  flag(registration.waiting);
  registration.addEventListener('updatefound', () => {
    const next = registration.installing;
    next?.addEventListener('statechange', () => {
      if (next.state === 'installed') flag(next);
    });
  });
}

/** Call once at start. Does nothing in development, so hot reload is never served from a stored copy. */
export function startPwa(): void {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    installEvent = e as InstallPromptEvent;
    usePwa.setState({ canInstall: true });
  });
  window.addEventListener('appinstalled', () => {
    installEvent = null;
    usePwa.setState({ canInstall: false, installed: true });
  });

  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;

  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading || !waiting) return; // the first install also fires this; only reload after an update
    reloading = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then(trackWaitingWorker)
      .catch((err: unknown) => console.warn('Offline support could not be turned on', err));
  });
}
