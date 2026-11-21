import { Upload } from 'lucide-react';
import { useRef, useState, type DragEvent } from 'react';
import { Button } from '@/components/ui/button';
import { loadFiles } from '@/app/fileLoader';

/** Drop or pick HIS Excel exports. Files are read on this laptop; nothing is uploaded. */
export function FileDropZone() {
  const [dragging, setDragging] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    loadFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={onDrop}
      className={`flex flex-col items-center justify-center gap-3 rounded-lg border border-dashed px-6 py-8 text-center transition-colors ${dragging ? 'border-primary bg-muted' : ''}`}
    >
      <Upload className="size-6 text-muted-foreground" />
      <p className="text-sm text-muted-foreground">Drag this month’s Excel files here (one or many), or</p>
      <Button variant="outline" onClick={() => input.current?.click()}>
        Choose files
      </Button>
      <input
        ref={input}
        type="file"
        multiple
        accept=".xlsx,.xlsm,.xls"
        className="hidden"
        aria-label="Choose Excel files"
        onChange={(e) => {
          if (e.target.files) loadFiles(Array.from(e.target.files));
          e.target.value = '';
        }}
      />
    </div>
  );
}
