/** Pages of the app. `recipe` (the recipe builder) is opened from Home, so it is not in the menu. */
export type PageId = 'home' | 'recipe' | 'generate' | 'dashboards' | 'help';

export const NAV_PAGES: readonly { id: PageId; label: string }[] = [
  { id: 'home', label: 'Home' },
  { id: 'generate', label: 'Generate' },
  { id: 'dashboards', label: 'Dashboards' },
  { id: 'help', label: 'Help' },
];

export type Route = {
  page: PageId;
  /** Recipe to open in the builder or to generate with. */
  recipeId?: string;
  /** Dashboard template to open. */
  dashboardId?: string;
};

const PAGE_IDS: readonly PageId[] = ['home', 'recipe', 'generate', 'dashboards', 'help'];

/** `#/generate/abc` → { page: 'generate', recipeId: 'abc' }. Unknown or empty hashes mean Home. */
export function parseHash(hash: string): Route {
  const [page, id] = hash.replace(/^#\/?/, '').split('/');
  const found = PAGE_IDS.find((p) => p === page);
  if (!found) return { page: 'home' };
  const decoded = id ? decodeURIComponent(id) : undefined;
  if (found === 'dashboards') return { page: found, dashboardId: decoded };
  if (found === 'recipe' || found === 'generate') return { page: found, recipeId: decoded };
  return { page: found };
}

export function routeToHash(route: Route): string {
  const id = route.recipeId ?? route.dashboardId;
  return `#/${route.page}${id ? `/${encodeURIComponent(id)}` : ''}`;
}
