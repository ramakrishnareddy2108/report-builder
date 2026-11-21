import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import { chartOption } from '@/dashboard/chartOption';
import type { Tile } from '@/dashboard/schema';
import type { TileResult } from '@/dashboard/tiles';

// Only the parts of ECharts the tiles need (keeps the download small).
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type Props = {
  tile: Tile;
  result: Extract<TileResult, { kind: 'chart' }>;
  /** Called with a function that returns the chart as a PNG data URL, once the chart is ready. */
  onReady?: (toPng: () => string) => void;
};

/** A bar, stacked bar, line or pie chart. Loaded on demand, because ECharts is large. */
export default function TileChart({ tile, result, onReady }: Props) {
  return (
    <div role="img" aria-label={`${tile.title}: ${result.series.map((s) => s.name).join(', ')} by ${result.categories.length} groups`}>
      <ReactEChartsCore
        echarts={echarts}
        option={chartOption(tile, result)}
        notMerge
        style={{ height: 300 }}
        onChartReady={(chart) => onReady?.(() => chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }))}
      />
    </div>
  );
}
