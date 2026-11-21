import ReactEChartsCore from 'echarts-for-react/lib/core';
import { BarChart, LineChart, PieChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { TileData } from '@/core/dashboard';
import type { Tile } from '@/core/schemas';
import { tileOption } from './tileOption';

// Only the parts of ECharts the tiles need (keeps the download small).
echarts.use([BarChart, LineChart, PieChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

type Props = {
  tile: Tile;
  data: TileData;
  /** Called with a function that returns the chart as a PNG data URL, once the chart is ready. */
  onReady?: (toPng: () => string) => void;
};

/** A bar, stacked bar, line or pie chart. Loaded on demand, because ECharts is large. */
export default function TileChart({ tile, data, onReady }: Props) {
  return (
    <div role="img" aria-label={tile.title}>
      <ReactEChartsCore
        echarts={echarts}
        option={tileOption(tile, data)}
        notMerge
        style={{ height: 320 }}
        onChartReady={(chart) => onReady?.(() => chart.getDataURL({ type: 'png', pixelRatio: 2, backgroundColor: '#ffffff' }))}
      />
    </div>
  );
}
