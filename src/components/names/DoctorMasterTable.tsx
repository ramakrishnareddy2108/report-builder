import { Stethoscope, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { useSettings } from '@/app/settingsStore';
import { useSaveDoctors } from '@/app/useSaveDoctors';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { EmptyState } from '@/components/EmptyState';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { removeAlias, updateDoctor } from '@/core/doctors';
import type { DoctorMaster } from '@/core/types';
import { AliasList } from './AliasList';
import { DepartmentSelect } from './DepartmentSelect';

/** The saved doctor list: rename, change department, unlink spellings, delete. */
export function DoctorMasterTable({ departmentOptions }: { departmentOptions: string[] }) {
  const file = useSettings((s) => s.doctors);
  const save = useSaveDoctors();
  const [deleting, setDeleting] = useState<DoctorMaster | null>(null);

  if (file.doctors.length === 0) {
    return (
      <EmptyState
        icon={Stethoscope}
        title="No doctors yet"
        description="Load this month’s files on the Sources page, scan them above, and add the doctor names. A name that is not in this list is never added automatically; it is reported in Checks."
      />
    );
  }

  const apply = (doctors: DoctorMaster[], message?: string) => save({ ...file, doctors }, message);

  async function rename(d: DoctorMaster, name: string) {
    const displayName = name.trim();
    if (displayName === d.displayName) return;
    if (displayName === '') return void toast.error('A doctor needs a name.');
    await apply(updateDoctor(file.doctors, d.id, { displayName }));
  }

  return (
    <>
      <ul className="divide-y rounded-lg border" aria-label="Doctor list">
        {file.doctors.map((d) => (
          <li key={d.id} className="grid gap-2 px-4 py-3 md:grid-cols-[1fr_14rem_auto] md:items-start">
            <div className="space-y-1.5">
              <Input
                key={d.displayName}
                defaultValue={d.displayName}
                onBlur={(e) => void rename(d, e.target.value)}
                aria-label={`Name of ${d.displayName}`}
              />
              <AliasList
                aliases={d.aliases}
                onRemove={(alias) => void apply(removeAlias(file.doctors, d.id, alias), 'Spelling unlinked. It will show up as a new name again.')}
              />
            </div>
            <DepartmentSelect
              value={d.department}
              options={departmentOptions}
              onChange={(department) => void apply(updateDoctor(file.doctors, d.id, { department }))}
              label={`Department for ${d.displayName}`}
            />
            <Button variant="ghost" size="icon" aria-label={`Delete ${d.displayName}`} onClick={() => setDeleting(d)}>
              <Trash2 />
            </Button>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title={`Delete ${deleting?.displayName ?? ''}?`}
        description="Their spellings become unmatched again, so the next run reports them in Checks until you add them back. Saved runs are not changed."
        confirmLabel="Delete"
        destructive
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void apply(file.doctors.filter((d) => d.id !== deleting.id), `${deleting.displayName} deleted.`);
          setDeleting(null);
        }}
      />
    </>
  );
}
