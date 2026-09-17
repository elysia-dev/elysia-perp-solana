import { NextRequest, NextResponse } from "next/server"
import { testRouteDisabled } from "@/lib/api/testRouteGuard"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

export async function POST(request: NextRequest) {
  const disabled = testRouteDisabled()
  if (disabled) return disabled
  try {
    const { market, cookies } = await request.json()

    if (!cookies) {
      return NextResponse.json(
        { error: "Cookies are required" },
        { status: 400 }
      )
    }

    // Get trades from account
    const tradesUrl = `${API_URL}/account/trades`
    const tradesResponse = await fetch(tradesUrl, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
      },
    })

    if (!tradesResponse.ok) {
      const errorText = await tradesResponse.text()
      return NextResponse.json(
        { error: "Failed to fetch trades", details: errorText },
        { status: tradesResponse.status }
      )
    }

    const tradesData = await tradesResponse.json()

    // Filter trades by market_id if provided
    let filteredTrades = tradesData.trades || []
    if (market) {
      filteredTrades = filteredTrades.filter(
        (trade: { market: string }) => trade.market === market.toString()
      )
    }

    // Sort by id descending to get latest trades first
    filteredTrades.sort((a: { id: number }, b: { id: number }) => b.id - a.id)

    return NextResponse.json({
      success: true,
      trades: filteredTrades,
    })
  } catch (error) {
    console.error("Error fetching trades:", error)
    return NextResponse.json(
      {
        error: "Failed to fetch trades",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
