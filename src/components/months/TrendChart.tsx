import ReactEChartsCore from 'echarts-for-react/lib/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components';
import * as echarts from 'echarts/core';
import { CanvasRenderer } from 'echarts/renderers';
import type { Trend } from '@/core/history';
import type { MeasureCode } from '@/core/types';
import { trendOption } from './trendOption';

// Only the parts of ECharts a line chart needs (keeps the download small).
echarts.use([LineChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

/** A line chart over months. Loaded on demand, because ECharts is large. */
export default function TrendChart({ trend, code, label }: { trend: Trend; code: MeasureCode; label: string }) {
  return (
    <div role="img" aria-label={label}>
      <ReactEChartsCore echarts={echarts} option={trendOption(trend, code)} style={{ height: 380 }} notMerge />
    </div>
  );
}
