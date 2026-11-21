import { ArrowDown, ArrowUp, Download, EllipsisVertical, Image, Pencil, Trash2 } from 'lucide-react';
import { useMemo, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { tileToTable } from '@/dashboard/export';
import type { DashboardData } from '@/dashboard/data';
import type { Tile } from '@/dashboard/schema';
import { computeTile, type Filters } from '@/dashboard/tiles';
import { downloadFile, XLSX_MIME } from '@/lib/download';
import { exportTableInWorker } from '@/worker/client';
import { TileBody } from './TileBody';

type Props = {
  tile: Tile;
  data: DashboardData;
  filters: Filters;
  first: boolean;
  last: boolean;
  onEdit: () => void;
  onMove: (by: -1 | 1) => void;
  onDelete: () => void;
};

const safeName = (s: string) => s.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'tile';

export function TileCard({ tile, data, filters, first, last, onEdit, onMove, onDelete }: Props) {
  const result = useMemo(() => computeTile(tile, data, filters), [tile, data, filters]);
  const toPng = useRef<(() => string) | null>(null);
  const isChart = result.status === 'ok' && result.kind === 'chart';

  function savePng() {
    if (!toPng.current) return toast.error('The picture is not ready yet.');
    const a = document.createElement('a');
    a.href = toPng.current();
    a.download = `${safeName(tile.title)}.png`;
    a.click();
  }

  async function saveExcel() {
    const table = tileToTable(tile, result);
    if (!table) return toast.error('There is no data in this tile to save.');
    try {
      downloadFile(`${safeName(tile.title)}.xlsx`, (await exportTableInWorker(table)) as unknown as BlobPart, XLSX_MIME);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not make the file.');
    }
  }

  return (
    <Card className="min-w-0">
      <CardContent className="space-y-3">
        <div className="flex items-start justify-between gap-2">
          <h3 className="min-w-0 flex-1 break-words text-sm font-semibold">{tile.title}</h3>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label={`Options for ${tile.title}`} className="-mt-1 -mr-2 shrink-0">
                <EllipsisVertical className="size-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={onEdit}>
                <Pencil className="size-4" /> Edit
              </DropdownMenuItem>
              <DropdownMenuItem disabled={first} onSelect={() => onMove(-1)}>
                <ArrowUp className="size-4" /> Move up
              </DropdownMenuItem>
              <DropdownMenuItem disabled={last} onSelect={() => onMove(1)}>
                <ArrowDown className="size-4" /> Move down
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled={!isChart} onSelect={savePng}>
                <Image className="size-4" /> Download picture (PNG)
              </DropdownMenuItem>
              <DropdownMenuItem disabled={result.status !== 'ok'} onSelect={() => void saveExcel()}>
                <Download className="size-4" /> Download data (Excel)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={onDelete} className="text-destructive">
                <Trash2 className="size-4" /> Delete tile
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <TileBody tile={tile} result={result} onChartReady={(fn) => (toPng.current = fn)} />
      </CardContent>
    </Card>
  );
}
