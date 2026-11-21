import { X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { plural } from '@/lib/plural';

type Props = {
  aliases: readonly string[];
  /** When set, each spelling gets an unlink button. */
  onRemove?: (alias: string) => void;
};

/** A collapsible list of the spellings that belong to one name. */
export function AliasList({ aliases, onRemove }: Props) {
  return (
    <details className="text-xs text-muted-foreground">
      <summary className="cursor-pointer select-none">
        {plural(aliases.length, 'spelling')}
      </summary>
      <ul className="mt-1 space-y-0.5">
        {aliases.map((a) => (
          <li key={a} className="flex items-center gap-1">
            <span className="font-mono">“{a}”</span>
            {onRemove && (
              <Button variant="ghost" size="icon-xs" aria-label={`Unlink “${a}”`} onClick={() => onRemove(a)}>
                <X />
              </Button>
            )}
          </li>
        ))}
      </ul>
    </details>
  );
}
