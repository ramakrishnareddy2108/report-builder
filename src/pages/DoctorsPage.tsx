import { Stethoscope } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function DoctorsPage() {
  return (
    <>
      <PageHeader
        title="Doctors"
        description="The doctor master list: display name, department and name spellings (aliases)."
      />
      <EmptyState
        icon={Stethoscope}
        title="No doctors yet"
        description="Doctors will be listed here after the first source files are loaded."
      />
    </>
  );
}
