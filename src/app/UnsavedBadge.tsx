import { TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useLibrary } from './libraryStore';

/** Reminds the user that recipes live only in this browser until they are exported to a file. */
export function UnsavedBadge() {
  const unsaved = useLibrary((s) => s.unsaved);
  const exportLibrary = useLibrary((s) => s.exportLibrary);
  if (!unsaved) return null;

  return (
    <Button
      size="sm"
      variant="outline"
      onClick={exportLibrary}
      title="Your recipes are saved in this browser only. Tap to save them to a file as a backup."
      className="border-amber-500/60 bg-amber-50 text-amber-900 hover:bg-amber-100 dark:bg-amber-950/40 dark:text-amber-200"
    >
      <TriangleAlert className="size-4" />
      <span>
        Unsaved to file<span className="hidden sm:inline"> · Export</span>
      </span>
    </Button>
  );
}
