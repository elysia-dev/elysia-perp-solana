import { NextResponse } from "next/server"
import { SHOW_TEST_UI } from "@/lib/constants/network"

/**
 * Guard for QA/test-only API routes (the `/api/trade-bot/*` helpers).
 *
 * These routes proxy authenticated calls / mint dev accounts for the QA
 * trade-bot and must NOT exist on the real prod deployment. Their UI trigger
 * (the Dev toolbar) is already gated behind `SHOW_TEST_UI`, but the route
 * handlers themselves stay reachable by direct request — so we gate the
 * handlers too. Returns a 404 (not 403) so the endpoint is indistinguishable
 * from one that was never deployed.
 *
 * `SHOW_TEST_UI` is fail-closed (opt-in via `NEXT_PUBLIC_ENABLE_TEST_UI=true`):
 * any environment that doesn't explicitly enable QA tooling — including a
 * brand-new or misconfigured deploy — gets 404 here by default.
 */
export function testRouteDisabled(): NextResponse | null {
  if (SHOW_TEST_UI) return null
  return NextResponse.json({ error: "Not found" }, { status: 404 })
}
