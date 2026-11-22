import { ArrowRight } from 'lucide-react';
import { IssueList } from '@/components/IssueList';
import { Button } from '@/components/ui/button';
import { CleanupSection } from './CleanupSection';
import { LookupsSection } from './LookupsSection';
import { usePreviewAuto } from './previewStore';
import { useBuilder } from './builderStore';

/** Tab 2: make the data trustworthy before the report adds it up. */
export function PrepareTab() {
  const preview = usePreviewAuto('prepare');
  const hasSamples = useBuilder((s) => Object.keys(s.samples).length > 0);
  const setTab = useBuilder((s) => s.setTab);
  const result = preview.result;

  return (
    <div className="space-y-8">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={() => setTab('report')}>
          Names look fine? Skip to Report <ArrowRight className="size-3.5" />
        </Button>
      </div>
      {!hasSamples && (
        <p className="rounded-lg border border-dashed p-3 text-sm text-muted-foreground">
          Add sample files in <b>1 Sources</b> to see live results here. You can still set the rules up without them.
        </p>
      )}
      {preview.error && (
        <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">
          {preview.error}
        </p>
      )}
      {result && <IssueList issues={result.issues.filter((i) => i.level !== 'info')} />}
      <CleanupSection reports={result?.cleanup} running={preview.running} />
      <LookupsSection results={result?.lookups} />
    </div>
  );
}
