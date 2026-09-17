/**
 * Shapes for the fill markers feeding the "Executions" custom study (see
 * executionsStudy.ts) and the chart's hover tooltip.
 *
 * TradingView custom indicators can only read OHLCV from the chart — they have
 * no props/context channel — so each chart component keeps its own
 * `Map<number, ExecutionBucket>` (keyed by candle-start time in MILLISECONDS,
 * matching PineJS.Std.time) and hands the study a lookup closure over it.
 */
export interface ExecutionSideStats {
  count: number
  avgPrice: number
}

export interface ExecutionBucket {
  buy?: ExecutionSideStats
  sell?: ExecutionSideStats
}
