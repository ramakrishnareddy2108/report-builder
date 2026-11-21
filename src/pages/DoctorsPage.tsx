import { FolderOpen } from 'lucide-react';
import { useMemo } from 'react';
import { useNameScan } from '@/app/nameScan';
import { useSettings } from '@/app/settingsStore';
import { useWorkspace } from '@/app/useWorkspace';
import { EmptyState } from '@/components/EmptyState';
import { DoctorMasterTable } from '@/components/names/DoctorMasterTable';
import { DoctorSuggestions } from '@/components/names/DoctorSuggestions';
import { GroupEditor } from '@/components/names/GroupEditor';
import { ScanCard } from '@/components/names/ScanCard';
import { PageHeader } from '@/components/PageHeader';
import { SettingsGate } from '@/components/SettingsGate';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { GroupResolver } from '@/core/doctors';

export function DoctorsPage() {
  const ws = useWorkspace();
  const doctors = useSettings((s) => s.doctors);
  const scan = useNameScan((s) => s.result);

  // Department names offered in the pickers: saved groups, ones doctors already use, and ones just scanned.
  const departmentOptions = useMemo(() => {
    const resolver = new GroupResolver(doctors.departments);
    const names = new Set<string>(doctors.departments.map((g) => g.name));
    for (const d of doctors.doctors) if (d.department) names.add(d.department);
    for (const d of scan?.departments ?? []) names.add(resolver.resolve(d.raw).name);
    return [...names].sort((a, b) => a.localeCompare(b));
  }, [doctors, scan]);

  const header = (
    <PageHeader
      title="Doctors"
      description="The doctor list, with every spelling the HIS files use. Departments and sponsors can be grouped the same way."
    />
  );

  if (!ws) {
    return (
      <>
        {header}
        <EmptyState
          icon={FolderOpen}
          title="Choose a workspace folder first"
          description="The doctor list is saved in the workspace folder. Open the Workspace page to choose it."
        />
      </>
    );
  }

  return (
    <>
      {header}
      <SettingsGate>
        <div className="space-y-6">
          <ScanCard />
          <Tabs defaultValue="doctors">
            <TabsList>
              <TabsTrigger value="doctors">Doctors ({doctors.doctors.length})</TabsTrigger>
              <TabsTrigger value="departments">Departments</TabsTrigger>
              <TabsTrigger value="sponsors">Sponsors</TabsTrigger>
            </TabsList>
            <TabsContent value="doctors" className="mt-4 space-y-6">
              <DoctorSuggestions departmentOptions={departmentOptions} />
              <section className="space-y-3">
                <h2 className="text-sm font-medium">Doctor list</h2>
                <DoctorMasterTable departmentOptions={departmentOptions} />
              </section>
            </TabsContent>
            <TabsContent value="departments" className="mt-4">
              <GroupEditor
                list="departments"
                noun="department"
                nouns="departments"
                explanation="Department names differ in case between files. They are matched ignoring case automatically. Group spellings only when they really mean the same department (for example CARDIAC and CARDIOLOGY)."
              />
            </TabsContent>
            <TabsContent value="sponsors" className="mt-4">
              <GroupEditor
                list="sponsors"
                noun="sponsor"
                nouns="sponsors"
                explanation="Sponsors (ORGANIZATIONNAME) are matched ignoring case automatically. Group several names only if you want them to appear as one line in the Sponsor-wise report."
              />
            </TabsContent>
          </Tabs>
        </div>
      </SettingsGate>
    </>
  );
}
