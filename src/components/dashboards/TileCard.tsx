import { ArrowDown, ArrowUp, FileDown, ImageDown, Pencil, Trash2 } from 'lucide-react';
import { useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { TileData } from '@/core/dashboard';
import { tileTable } from '@/core/dashboardTable';
import type { Tile } from '@/core/schemas';
import { downloadFile } from '@/storage/backup';
import { exportTableInWorker } from '@/worker/client';
import { TileBody } from './TileBody';

type Props = {
  tile: Tile;
  data: TileData;
  first: boolean;
  last: boolean;
  onMove: (direction: 'up' | 'down') => void;
  onEdit: () => void;
  onDelete: () => void;
};

const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const fileSafe = (s: string) => s.replace(/[^A-Za-z0-9 _-]+/g, '').trim().replace(/\s+/g, '_') || 'tile';
const isChart = (t: Tile) => t.type === 'bar' || t.type === 'stackedBar' || t.type === 'line' || t.type === 'pie';

/** A tile with its controls: move up or down, edit, delete, and export (PNG for charts, data to Excel). */
export function TileCard({ tile, data, first, last, onMove, onEdit, onDelete }: Props) {
  const toPng = useRef<(() => string) | null>(null);

  async function exportExcel() {
    try {
      const bytes = await exportTableInWorker({ title: tile.title, table: tileTable(tile, data) });
      downloadFile(bytes, `${fileSafe(tile.title)}.xlsx`, XLSX);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    }
  }

  function exportPng() {
    const url = toPng.current?.();
    if (!url) return void toast.error('The chart is not ready yet.');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${fileSafe(tile.title)}.png`;
    a.click();
  }

  const label = (what: string) => `${what}: ${tile.title}`;
  return (
    <Card className={tile.type === 'kpi' ? '' : 'md:col-span-1'}>
      <CardHeader>
        <CardTitle className="truncate">{tile.title}</CardTitle>
        {data.status === 'ok' && (
          <p className="text-xs text-muted-foreground">
            {data.monthsUsed.length === 1 ? data.monthsUsed[0] : `${data.monthsUsed[0]} to ${data.monthsUsed.at(-1)}`}
          </p>
        )}
        <CardAction className="flex gap-0.5">
          <Button variant="ghost" size="icon-sm" disabled={first} onClick={() => onMove('up')} aria-label={label('Move up')} title="Move up">
            <ArrowUp />
          </Button>
          <Button variant="ghost" size="icon-sm" disabled={last} onClick={() => onMove('down')} aria-label={label('Move down')} title="Move down">
            <ArrowDown />
          </Button>
          {isChart(tile) && (
            <Button variant="ghost" size="icon-sm" disabled={data.status !== 'ok'} onClick={exportPng} aria-label={label('Download picture')} title="Download as a picture (PNG)">
              <ImageDown />
            </Button>
          )}
          <Button variant="ghost" size="icon-sm" disabled={data.status !== 'ok'} onClick={() => void exportExcel()} aria-label={label('Export data to Excel')} title="Export the data to Excel">
            <FileDown />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onEdit} aria-label={label('Edit')} title="Edit">
            <Pencil />
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onDelete} aria-label={label('Delete')} title="Delete">
            <Trash2 />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="space-y-2">
        <TileBody tile={tile} data={data} onChartReady={(fn) => (toPng.current = fn)} />
        {data.notes.map((n, i) => (
          <p key={i} className="text-xs text-amber-700">
            {n}
          </p>
        ))}
      </CardContent>
    </Card>
  );
}
