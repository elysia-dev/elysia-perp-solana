/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
  CustomIndicator,
  PineJS,
  StudyMetaInfo,
} from "@/public/static/charting_library/charting_library"
import type { ExecutionBucket } from "./executionMarkers"

// "Executions" — a custom price-overlay study that draws the account's own
// fills as OKX-style pentagon badges: a green "B" label below the candle for
// buys, a red "S" label above it for sells (plot types `shape_label_up` /
// `shape_label_down`). The badge SHAPES are TradingView-native, so they pan,
// zoom, and scale with the chart; the DATA comes from the owning chart's
// marker map via `getMarker` (keyed by candle-start ms), so each widget
// instance reads only its own fills.

const BUY_COLOR = "#0dbb92"
const SELL_COLOR = "#f15044"

export function createExecutionsIndicator(
  pine: PineJS,
  getMarker: (timeMs: number) => ExecutionBucket | undefined
): CustomIndicator {
  return {
    name: "Executions",
    metainfo: {
      _metainfoVersion: 51,
      id: "Executions@tv-basicstudies-1" as never,
      name: "Executions",
      description: "Executions",
      shortDescription: "My Trades",
      is_price_study: true,
      isCustomIndicator: true,
      linkedToSeries: true,
      format: { type: "inherit" },
      plots: [
        { id: "plot_buy", type: "shapes" as never },
        { id: "plot_sell", type: "shapes" as never },
      ],
      styles: {
        plot_buy: { title: "Buy fills", text: "B", isHidden: false },
        plot_sell: { title: "Sell fills", text: "S", isHidden: false },
      },
      defaults: {
        styles: {
          plot_buy: {
            plottype: "shape_label_up",
            location: "BelowBar",
            color: BUY_COLOR,
            textColor: "#0a0a0a",
            visible: true,
            transparency: 0,
          },
          plot_sell: {
            plottype: "shape_label_down",
            location: "AboveBar",
            color: SELL_COLOR,
            textColor: "#0a0a0a",
            visible: true,
            transparency: 0,
          },
        },
        inputs: {},
      },
      inputs: [],
    } as unknown as StudyMetaInfo,
    constructor: function (this: any) {
      this.main = function (this: any, ctx: any) {
        this._context = ctx
        const timeMs = pine.Std.time(this._context)
        const bucket = getMarker(timeMs)
        return [bucket?.buy ? 1 : NaN, bucket?.sell ? 1 : NaN]
      }
    } as never,
  }
}
