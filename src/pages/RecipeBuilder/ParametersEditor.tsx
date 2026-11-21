import { Plus, Trash2 } from 'lucide-react';
import { NativeSelect } from '@/components/NativeSelect';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Parameter } from '@/recipe/schema';
import { useBuilder } from './builderStore';

/** Values you type each time you generate, such as the report month. Formulas read them with PARAM("Month"). */
export function ParametersEditor() {
  const recipe = useBuilder((s) => s.recipe);
  const update = useBuilder((s) => s.update);
  if (!recipe) return null;
  const patch = (i: number, change: Partial<Parameter>) => update((r) => void Object.assign(r.parameters[i] as Parameter, change));

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Things you type every time you generate, like the month. They become a column in the combined data, and a formula can read one with <code>PARAM(&quot;Month&quot;)</code>.
      </p>
      {recipe.parameters.map((p, i) => (
        <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[10rem_8rem_1fr_10rem_auto]">
          <Input value={p.name} onChange={(e) => patch(i, { name: e.target.value })} aria-label="Parameter name" placeholder="Name, e.g. Month" aria-invalid={p.name.trim() === ''} />
          <NativeSelect value={p.type} onChange={(e) => patch(i, { type: e.target.value as Parameter['type'] })} aria-label="Parameter type">
            <option value="text">Text</option>
            <option value="number">Number</option>
            <option value="date">Date</option>
          </NativeSelect>
          <Input value={p.label} onChange={(e) => patch(i, { label: e.target.value })} aria-label="Question to ask" placeholder="Question, e.g. Report month (e.g. Oct-2026)" />
          <Input value={p.default ?? ''} onChange={(e) => patch(i, { default: e.target.value || undefined })} aria-label="Default value" placeholder="Default" />
          <Button variant="ghost" size="icon" aria-label={`Remove ${p.name || 'parameter'}`} onClick={() => update((r) => void r.parameters.splice(i, 1))}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button variant="outline" size="sm" onClick={() => update((r) => void r.parameters.push({ name: '', type: 'text', label: '' }))}>
        <Plus className="size-4" /> Add a parameter
      </Button>
    </div>
  );
}
