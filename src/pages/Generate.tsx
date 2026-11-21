import { Play } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function GeneratePage() {
  return (
    <>
      <PageHeader title="Generate" description="Pick a recipe, add this month's files, and download the report." />
      <EmptyState icon={Play} title="Nothing to generate yet" description="Create a recipe on the Home page first." />
    </>
  );
}
