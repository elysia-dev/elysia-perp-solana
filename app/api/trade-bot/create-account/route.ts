import { NextResponse } from "next/server"
import { privateKeyToAccount } from "viem/accounts"
import { LOGIN_CHAIN_ID, buildLoginMessage } from "@/lib/constants/auth-message"
import { testRouteDisabled } from "@/lib/api/testRouteGuard"

const API_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8080"

function getRandomPrivateKey(): `0x${string}` {
  let randomPrivateKey = "0x"
  for (let j = 0; j < 64; j++) {
    randomPrivateKey += Math.floor(Math.random() * 16).toString(16)
  }
  return randomPrivateKey as `0x${string}`
}

export async function POST() {
  const disabled = testRouteDisabled()
  if (disabled) return disabled
  try {
    const privateKey = getRandomPrivateKey()

    const account = privateKeyToAccount(privateKey)

    // 1. Sign the EIP-191 login message (personal_sign). The client-generated
    // timestamp doubles as the single-use nonce — there is no `GET /nonce`.
    // `LOGIN_CHAIN_ID` matches the backend env (this dev tool hits the same
    // API_URL), and the blank lines in the message are part of the signed
    // bytes (see lib/constants/auth-message.ts).
    const timestamp = Date.now()
    const message = buildLoginMessage(LOGIN_CHAIN_ID, timestamp)

    const signature = await account.signMessage({ message })

    // 2. Login - 서버가 ecrecover로 signer를 복원하고 쿠키를 내려줌
    const loginResponse = await fetch(`${API_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        signature,
        timestamp,
      }),
    })

    if (!loginResponse.ok) {
      const errorText = await loginResponse.text()
      return NextResponse.json(
        { error: "Login failed", details: errorText },
        { status: loginResponse.status }
      )
    }

    // 3. Extract cookies from response headers
    const setCookieHeaders = loginResponse.headers.getSetCookie?.() || []
    let cookies = ""

    if (setCookieHeaders.length > 0) {
      cookies = setCookieHeaders
        .map((cookie) => cookie.split(";")[0])
        .join("; ")
    } else {
      const setCookieHeader = loginResponse.headers.get("set-cookie")
      if (setCookieHeader) {
        const cookieStrings = Array.isArray(setCookieHeader)
          ? setCookieHeader
          : [setCookieHeader]

        cookies = cookieStrings.map((cookie) => cookie.split(";")[0]).join("; ")
      }
    }

    // 4. Deposit assets
    const depositAmount = 1000000000000
    const PERP_USD_ID = 5382

    const depositUrl = `${API_URL}/dev/account/deposit`

    await fetch(depositUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: cookies,
      },
      body: JSON.stringify({
        asset_id: PERP_USD_ID,
        amount: depositAmount.toString(),
      }),
    })

    return NextResponse.json({
      success: true,
      address: account.address,
      cookies: cookies,
    })
  } catch (error) {
    console.error("Error creating account:", error)
    return NextResponse.json(
      {
        error: "Failed to create account",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    )
  }
}
