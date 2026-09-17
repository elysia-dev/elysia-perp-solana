import { NextRequest, NextResponse } from "next/server"
import { testRouteDisabled } from "@/lib/api/testRouteGuard"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

export async function POST(request: NextRequest) {
  const disabled = testRouteDisabled()
  if (disabled) return disabled
  try {
    const { market, order, cookies } = await request.json()

    if (!cookies) {
      return NextResponse.json(
        { error: "Cookies are required" },
        { status: 400 }
      )
    }

    const orderUrl = `${API_URL}/perp/order`

    let orderResponse = await fetch(orderUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
      },
      body: JSON.stringify({
        market: market === "100" ? "BTC-PERP" : "ETH-PERP",
        side: order.side,
        is_ask: order.side === "Short" || order.side === "sell",
        price: order.price.toString(),
        size: order.size.toString(),
        base_amount: order.size.toString(),
        leverage: order.leverage,
      }),
    })

    // Handle ACCESS_TOKEN_EXPIRED error
    if (!orderResponse.ok) {
      const errorText = await orderResponse.text()
      let errorBody: { error?: string; code?: string }
      try {
        errorBody = JSON.parse(errorText)
      } catch {
        errorBody = { error: errorText }
      }

      // Check if it's an access token expired error
      if (
        orderResponse.status === 401 ||
        errorBody.code === "ACCESS_TOKEN_EXPIRED"
      ) {
        // Try to refresh token
        const refreshResponse = await fetch(`${API_URL}/auth/refresh`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: cookies,
          },
        })

        if (refreshResponse.ok) {
          // Extract new cookies from refresh response and merge with existing
          const setCookieHeaders =
            refreshResponse.headers.getSetCookie?.() || []
          let newSetCookies: string[] = []

          if (setCookieHeaders.length > 0) {
            newSetCookies = setCookieHeaders.map((c) => c.split(";")[0])
          } else {
            const setCookieHeader = refreshResponse.headers.get("set-cookie")
            if (setCookieHeader) {
              newSetCookies = (
                Array.isArray(setCookieHeader)
                  ? setCookieHeader
                  : [setCookieHeader]
              ).map((c) => c.split(";")[0])
            }
          }

          // Merge: start with existing cookies, override with new ones
          const cookieMap = new Map<string, string>()
          for (const pair of cookies.split("; ")) {
            const eqIdx = pair.indexOf("=")
            if (eqIdx > 0)
              cookieMap.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1))
          }
          for (const pair of newSetCookies) {
            const eqIdx = pair.indexOf("=")
            if (eqIdx > 0)
              cookieMap.set(pair.slice(0, eqIdx), pair.slice(eqIdx + 1))
          }
          const refreshedCookies = Array.from(cookieMap.entries())
            .map(([k, v]) => `${k}=${v}`)
            .join("; ")

          // Retry original request with new cookies
          orderResponse = await fetch(orderUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Cookie: refreshedCookies,
            },
            body: JSON.stringify({
              market: market === "100" ? "BTC-PERP" : "ETH-PERP",
              side: order.side,
              is_ask: order.side === "Short" || order.side === "sell",
              price: order.price.toString(),
              size: order.size.toString(),
              base_amount: order.size.toString(),
              leverage: order.leverage,
            }),
          })

          if (orderResponse.ok) {
            const orderData = await orderResponse.json()
            return NextResponse.json({
              success: true,
              orderData,
              cookies: refreshedCookies,
            })
          }

          // Retry failed but still return refreshed cookies so client stays authenticated
          let retryErrorText = ""
          try {
            retryErrorText = await orderResponse.text()
          } catch {
            retryErrorText = errorText
          }
          return NextResponse.json(
            {
              success: false,
              error: retryErrorText || "Order failed after token refresh",
              code: "ORDER_FAILED_AFTER_REFRESH",
              cookies: refreshedCookies,
            },
            { status: orderResponse.status }
          )
        }

        // Refresh itself failed
        return NextResponse.json(
          {
            success: false,
            error: "Token refresh failed",
            code: "REFRESH_FAILED",
          },
          { status: 401 }
        )
      }

      // Other errors
      return NextResponse.json(
        {
          success: false,
          error: errorText,
          code: errorBody.code,
        },
        { status: orderResponse.status }
      )
    }

    // Success
    const orderData = await orderResponse.json()
    return NextResponse.json({
      success: true,
      orderData,
      cookies: cookies, // Return same cookies if no refresh was needed
    })
  } catch (error) {
    console.error("Error creating order:", error)
    return NextResponse.json(
      {
        success: false,
        error: "Failed to create order",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
