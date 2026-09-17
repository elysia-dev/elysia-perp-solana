import { useQuery } from "@tanstack/react-query"

// OHLC data type
export interface OHLCData {
  time: number // Unix timestamp (seconds)
  open: number
  high: number
  low: number
  close: number
  volume?: number // Volume data
}

// Binance Kline response type
interface BinanceKline {
  0: number // Open time
  1: string // Open price
  2: string // High price
  3: string // Low price
  4: string // Close price
  5: string // Volume
  6: number // Close time
  7: string // Quote asset volume
  8: number // Number of trades
  9: string // Taker buy base asset volume
  10: string // Taker buy quote asset volume
  11: string // Ignore
}

/**
 * Fetch chart data from Binance API using the symbol and interval
 * @param symbol - trading symbol (e.g. "BTCUSDT")
 * @param interval - time interval (1m, 3m, 5m, 15m, 30m, 1h, 2h, 4h, 6h, 8h, 12h, 1d, 3d, 1w, 1M)
 * @param limit - candlesticks (maximum 1000)
 */
export function useChartData(
  symbol: string = "BTCUSDT",
  interval: string = "1d",
  limit: number = 30
) {
  return useQuery({
    queryKey: ["chartData", symbol, interval, limit],
    queryFn: async (): Promise<OHLCData[]> => {
      // Binance API endpoint
      const response = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
      )

      if (!response.ok) {
        throw new Error(`Failed to fetch chart data: ${response.statusText}`)
      }

      const data: BinanceKline[] = await response.json()

      // Convert OHLC data (including Volume)
      return data.map((kline) => ({
        time: Math.floor(kline[0] / 1000), // Convert milliseconds to seconds
        open: parseFloat(kline[1]),
        high: parseFloat(kline[2]),
        low: parseFloat(kline[3]),
        close: parseFloat(kline[4]),
        volume: parseFloat(kline[5]), // Volume data
      }))
    },
    refetchInterval: 60000, // Update every 1 minute
    staleTime: 30000, // Cache for 30 seconds
  })
}
