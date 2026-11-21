import { Upload } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = {
  /** Called with the chosen or dropped files. */
  onFiles: (files: File[]) => void;
  multiple?: boolean;
  accept?: string;
  title?: string;
  hint?: ReactNode;
  disabled?: boolean;
  compact?: boolean;
};

/** Tap to choose files (works on phones) or drop them here (desktop). */
export function FileDrop({ onFiles, multiple = true, accept = '.xlsx,.xlsm,.xls', title = 'Choose files', hint, disabled, compact }: Props) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  const take = (list: FileList | null) => {
    const files = list ? [...list] : [];
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (!disabled) take(e.dataTransfer.files);
      }}
      className={cn(
        'flex flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed text-center transition-colors',
        compact ? 'p-3' : 'p-6',
        over ? 'border-primary bg-primary/5' : 'border-border',
        disabled && 'opacity-50',
      )}
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => input.current?.click()}
        className="inline-flex min-h-10 items-center gap-2 rounded-lg px-3 text-sm font-medium text-primary hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <Upload className="size-4" aria-hidden />
        {title}
      </button>
      <p className="text-xs text-muted-foreground">{hint ?? 'or drop Excel files here'}</p>
      <input
        ref={input}
        type="file"
        multiple={multiple}
        accept={accept}
        className="hidden"
        aria-label={title}
        onChange={(e) => {
          take(e.target.files);
          e.target.value = ''; // lets the same file be chosen again
        }}
      />
    </div>
  );
}
