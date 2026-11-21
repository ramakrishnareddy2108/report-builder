import { BookOpen } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function HomePage() {
  return (
    <>
      <PageHeader title="Home" description="Your report recipes and dashboards." />
      <EmptyState
        icon={BookOpen}
        title="No recipes yet"
        description="A recipe tells the app how to turn your Excel exports into a finished report. Create one once, then use it every month."
      />
    </>
  );
}
