import type { ColDef, ColGroupDef } from 'ag-grid-community';
import { FileDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { DataGrid } from '@/components/DataGrid';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { change, changePercent, compareMonths, GROUP_LEVELS, LEVEL_LABELS, topMovers, type CompareRow, type GroupLevel, type Mover } from '@/core/history';
import { MEASURES, getMeasure } from '@/core/measures';
import { formatINR } from '@/core/money';
import type { MeasureCode } from '@/core/types';
import { downloadFile } from '@/storage/backup';
import type { MonthOverview } from '@/storage/history';
import { exportCompareInWorker } from '@/worker/client';

type Props = { overviews: readonly MonthOverview[] };

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
/** Measures where a rise is not good news: they are not coloured. */
const COST_LIKE = new Set<MeasureCode>(['OP_PHARMACY_COST', 'IP_PHARMACY_COST', 'DEPT_ISSUES', 'SALARY', 'INCENTIVES', 'PROF_FEE']);

const showAmount = (code: MeasureCode, v: number | null | undefined) =>
  v === null || v === undefined ? '' : getMeasure(code).kind === 'count' ? String(v) : formatINR(v, { symbol: false });
const showPercent = (p: number | null) => (p === null ? 'new' : `${p > 0 ? '+' : ''}${p.toFixed(1)}%`);

/** Month A against month B at doctor, department or sponsor level, with the biggest movers. */
export function CompareView({ overviews }: Props) {
  // Months with data from their best run (newest Final, else newest), newest first.
  const months = useMemo(() => overviews.filter((o) => o.bestData !== null), [overviews]);
  const finals = months.filter((o) => o.bestData?.status === 'Final');
  const [monthA, setMonthA] = useState(() => (finals[0] ?? months[0])?.month ?? '');
  const [monthB, setMonthB] = useState(() => (finals[1] ?? months[1])?.month ?? '');
  const [level, setLevel] = useState<GroupLevel>('doctor');
  const [measure, setMeasure] = useState<MeasureCode>('TOTAL_REVENUE');
  const [exporting, setExporting] = useState(false);

  const a = months.find((o) => o.month === monthA)?.bestData ?? null;
  const b = months.find((o) => o.month === monthB)?.bestData ?? null;
  const rows = useMemo(() => (a && b ? compareMonths(a.levels[level], b.levels[level]) : []), [a, b, level]);
  const measures = useMemo(() => MEASURES.filter((m) => level !== 'sponsor' || m.sponsorHeader !== null), [level]);
  const movers = useMemo(() => topMovers(rows, measure), [rows, measure]);

  const columns = useMemo<(ColDef<CompareRow> | ColGroupDef<CompareRow>)[]>(
    () => [
      { headerName: LEVEL_LABELS[level], field: 'name', pinned: 'left', width: 230 },
      ...measures.map((m): ColGroupDef<CompareRow> => ({
        headerName: m.label,
        marryChildren: true,
        children: [
          { headerName: 'A', colId: `${m.code}-a`, type: 'rightAligned', width: 120, valueGetter: (p) => p.data?.a?.[m.code] ?? null, valueFormatter: (p) => showAmount(m.code, p.value as number | null) },
          { headerName: 'B', colId: `${m.code}-b`, type: 'rightAligned', width: 120, valueGetter: (p) => p.data?.b?.[m.code] ?? null, valueFormatter: (p) => showAmount(m.code, p.value as number | null) },
          {
            headerName: 'Change',
            colId: `${m.code}-c`,
            type: 'rightAligned',
            width: 120,
            valueGetter: (p) => (p.data ? change(p.data, m.code) : null),
            valueFormatter: (p) => showAmount(m.code, p.value as number | null),
            cellClass: (p) => (COST_LIKE.has(m.code) || !p.value ? '' : (p.value as number) > 0 ? 'text-emerald-700' : 'text-red-700'),
          },
          {
            headerName: '%',
            colId: `${m.code}-p`,
            type: 'rightAligned',
            width: 90,
            valueGetter: (p) => (p.data ? changePercent(p.data, m.code) : null),
            valueFormatter: (p) => (p.data && p.data.b === null ? 'new' : p.value === null || p.value === undefined ? '' : showPercent(p.value as number)),
          },
        ],
      })),
    ],
    [level, measures],
  );

  if (months.length < 2) {
    return <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Compare needs at least two saved months. Run a month and save it, or import a past DRR.</p>;
  }

  async function exportExcel() {
    setExporting(true);
    try {
      const bytes = await exportCompareInWorker({ monthA, monthB, level, measures: measures.map((m) => m.code), rows });
      downloadFile(bytes, `Compare_${monthA}_vs_${monthB}_${level}.xlsx`, XLSX_MIME);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(false);
    }
  }

  const monthSelect = (value: string, onChange: (m: string) => void, label: string) => (
    <label className="flex items-center gap-2 text-sm">
      <span className="font-medium">{label}</span>
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="w-44" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {months.map((o) => (
            <SelectItem key={o.month} value={o.month}>
              {o.month} {o.bestData?.status === 'Draft' ? '(Draft)' : o.bestData?.kind === 'summary' ? '(Imported)' : ''}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        {monthSelect(monthA, setMonthA, 'Month A')}
        {monthSelect(monthB, setMonthB, 'Month B')}
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Level</span>
          <Select value={level} onValueChange={(v) => setLevel(v as GroupLevel)}>
            <SelectTrigger className="w-40" aria-label="Level">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {GROUP_LEVELS.map((l) => (
                <SelectItem key={l} value={l} disabled={l === 'sponsor' && (a?.levels.sponsor.length === 0 || b?.levels.sponsor.length === 0)}>
                  {LEVEL_LABELS[l]}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <Button variant="outline" className="ml-auto" onClick={() => void exportExcel()} disabled={exporting || rows.length === 0}>
          <FileDown />
          {exporting ? 'Making…' : 'Export to Excel'}
        </Button>
      </div>

      {monthA === monthB && <p className="text-sm text-amber-700">Month A and Month B are the same month, so every change is 0.</p>}
      <p className="text-xs text-muted-foreground">
        A is the later month, B the earlier. Change = A − B, and % is the change as a share of B (“new” when B had nothing). Amounts in rupees. Each month uses its newest Final run.
      </p>

      <DataGrid rows={rows} columns={columns} height={Math.min(560, 150 + rows.length * 42)} getRowId={(r) => r.key} />

      <div className="space-y-3">
        <label className="flex items-center gap-2 text-sm">
          <span className="font-medium">Biggest movers in</span>
          <Select value={measure} onValueChange={(v) => setMeasure(v as MeasureCode)}>
            <SelectTrigger className="w-60" aria-label="Measure for the biggest movers">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {measures.filter((m) => m.kind !== 'count').map((m) => (
                <SelectItem key={m.code} value={m.code}>
                  {m.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
        <div className="grid gap-4 md:grid-cols-2">
          <MoverList title="Top 10 risers" movers={movers.risers} code={measure} />
          <MoverList title="Top 10 fallers" movers={movers.fallers} code={measure} />
        </div>
      </div>
    </div>
  );
}

function MoverList({ title, movers, code }: { title: string; movers: Mover[]; code: MeasureCode }) {
  return (
    <section aria-label={title}>
      <h3 className="mb-1 text-sm font-medium">{title}</h3>
      {movers.length === 0 ? (
        <p className="text-sm text-muted-foreground">None.</p>
      ) : (
        <ol className="divide-y rounded-lg border text-sm">
          {movers.map((m) => (
            <li key={m.key} className="flex items-center gap-3 px-3 py-2">
              <span className="min-w-0 flex-1 truncate">{m.name}</span>
              <span className="tabular-nums">{showAmount(code, m.change)}</span>
              <span className="w-16 text-right text-xs text-muted-foreground tabular-nums">{showPercent(m.percent)}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
