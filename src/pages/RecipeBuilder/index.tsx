import { FileSpreadsheet } from 'lucide-react';
import { EmptyState } from '@/components/EmptyState';
import { PageHeader } from '@/components/PageHeader';

export function RecipeBuilderPage() {
  return (
    <>
      <PageHeader title="Recipe builder" description="Set up how your Excel files become a report." />
      <EmptyState
        icon={FileSpreadsheet}
        title="Open a recipe from Home"
        description="Choose New recipe or Open on the Home page to start building."
      />
    </>
  );
}
