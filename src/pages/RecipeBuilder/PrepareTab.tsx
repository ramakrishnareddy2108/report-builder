import { IssueList } from '@/components/IssueList';
import { CleanupSection } from './CleanupSection';
import { LookupsSection } from './LookupsSection';
import { usePreviewAuto } from './previewStore';
import { useBuilder } from './builderStore';

/** Tab 2: make the data trustworthy before the report adds it up. */
export function PrepareTab() {
  const preview = usePreviewAuto('prepare');
  const hasSamples = useBuilder((s) => Object.keys(s.samples).length > 0);
  const result = preview.result;

  return (
    <div className="space-y-8">
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
