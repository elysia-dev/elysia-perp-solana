import { NextRequest, NextResponse } from "next/server"
import { cookies } from "next/headers"

/**
 * Returns the access_token from httpOnly cookie so the client
 * can pass it as a query param when opening a cross-origin WebSocket.
 *
 * This is safe because:
 * - The cookie is already scoped to this origin
 * - We only return it to the same authenticated browser session
 */
export async function GET(_request: NextRequest) {
  const cookieStore = await cookies()
  const token = cookieStore.get("access_token")?.value

  if (!token) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 })
  }

  return NextResponse.json({ token })
}
