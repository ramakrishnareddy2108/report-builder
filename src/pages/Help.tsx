import { CircleHelp } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function HelpPage() {
  return (
    <>
      <PageHeader title="Help" description="A short how-to and the formula reference." />
      <EmptyState icon={CircleHelp} title="Help is coming" description="The quick start and formula reference will appear here." />
    </>
  );
}
