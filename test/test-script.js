// QA Seed Preset Script
// Usage: node seed.js [preset]
// Presets: orderbook, liquidation, insurance, adl, funding
//
// 기존 API만 사용하여 QA 테스트 환경을 구성합니다.
// 인증 패턴: elysia-perp-ui/scripts/simulate-realtime-trade.js 참고

const API_URL = process.env.API_URL || "http://localhost:3001"
const ADMIN_KEY = process.env.ADMIN_SECRET || "changeme"
const EL_ASSET_ID = 5382
const MARKET = "BTC-PERP"
const ORACLE_PRICE = 60000

// MM Bot addresses (valid hex, deterministic for debugging)
const MM1_ADDR = "0x00000000000000000000000000000000000a0001"
const MM2_ADDR = "0x00000000000000000000000000000000000a0002"
const ADL_ADDR = "0x00000000000000000000000000000000000ad100"
const COUNTER_ADDR = "0x00000000000000000000000000000000000c0001"

// ============================================================
// Helper Functions
// ============================================================

async function extractCookies(response) {
  const setCookieHeaders = response.headers.getSetCookie?.() || []
  if (setCookieHeaders.length > 0) {
    return setCookieHeaders.map((c) => c.split(";")[0]).join("; ")
  }
  const header = response.headers.get("set-cookie")
  if (header) {
    return (Array.isArray(header) ? header : [header])
      .map((c) => c.split(";")[0])
      .join("; ")
  }
  return ""
}

async function devToken(address) {
  const res = await fetch(`${API_URL}/dev/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": ADMIN_KEY },
    body: JSON.stringify({ address }),
  })
  if (!res.ok) throw new Error(`Token failed for ${address}: ${res.status}`)
  return extractCookies(res)
}

async function deposit(cookies, amount) {
  const res = await fetch(`${API_URL}/dev/account/deposit`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: cookies,
      "X-Api-Key": ADMIN_KEY,
    },
    body: JSON.stringify({ asset_id: EL_ASSET_ID, amount: String(amount) }),
  })
  if (!res.ok) throw new Error(`Deposit failed: ${await res.text()}`)
}

async function setLeverage(cookies, imf) {
  const res = await fetch(`${API_URL}/perp/leverage`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({
      market: MARKET,
      initial_margin_fraction: imf,
      margin_mode: 1,
    }),
  })
  if (!res.ok) throw new Error(`Leverage failed: ${await res.text()}`)
}

async function placeOrder(cookies, side, price, size, orderType = 0) {
  const res = await fetch(`${API_URL}/perp/order`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({
      market: MARKET,
      side,
      price: String(price),
      base_amount: String(size),
      order_type: orderType,
    }),
  })
  // Retry on 429
  if (res.status === 429) {
    const wait = 1000
    console.log(`  ⏳ Rate limited, waiting ${wait}ms...`)
    await new Promise((r) => setTimeout(r, wait))
    return placeOrder(cookies, side, price, size, orderType)
  }
  if (!res.ok) {
    const errorText = await res.text()
    throw new Error(`Order failed (${res.status}): ${errorText}`)
  }
  const data = await res.json()
  const typeLabel = orderType === 1 ? "Market" : "Limit"
  console.log(
    `  ${side.padEnd(5)} ${String(size).padStart(5)} BTC @ $${String(price).padStart(7)} (${typeLabel}) -> order_id: ${data.order_id}, status: ${data.status}`
  )
  // 서버 rate limit 방지
  await new Promise((r) => setTimeout(r, 300))
  return data
}

async function reset() {
  const res = await fetch(`${API_URL}/dev/reset`, {
    method: "POST",
    headers: { "X-Api-Key": ADMIN_KEY },
  })
  if (!res.ok) throw new Error(`Reset failed: ${res.status}`)
}

async function oraclePause() {
  const res = await fetch(`${API_URL}/dev/oracle/pause`, {
    method: "POST",
    headers: { "X-Api-Key": ADMIN_KEY },
  })
  if (!res.ok) throw new Error(`Oracle pause failed: ${res.status}`)
}

async function oraclePrice(price) {
  const res = await fetch(`${API_URL}/dev/oracle/price`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": ADMIN_KEY },
    body: JSON.stringify({ symbol: MARKET, price }),
  })
  if (!res.ok) throw new Error(`Oracle price failed: ${res.status}`)
}

async function oraclePrices(markPrice, indexPrice) {
  const res = await fetch(`${API_URL}/dev/oracle/prices`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": ADMIN_KEY },
    body: JSON.stringify({
      symbol: MARKET,
      mark_price: markPrice,
      index_price: indexPrice,
    }),
  })
  console.log(res)
  if (!res.ok) throw new Error(`Oracle prices failed: ${res.status}`)
}

async function insuranceFundDeposit(amount) {
  const res = await fetch(`${API_URL}/dev/insurance-fund/deposit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Api-Key": ADMIN_KEY },
    body: JSON.stringify({ amount: String(amount) }),
  })
  if (!res.ok) throw new Error(`IF deposit failed: ${res.status}`)
}

// ============================================================
// Common Prologue
// ============================================================

async function prologue() {
  console.log("[1/3] Reset")
  await reset()
  console.log("[2/3] Oracle pause")
  await oraclePause()
  console.log(`[3/3] Oracle price: $${ORACLE_PRICE}`)
  await oraclePrice(ORACLE_PRICE)
}

async function createBot(label, address, depositAmount, imf = 1000) {
  console.log(`\n--- ${label} ---`)
  console.log(`  Address: ${address}`)
  const cookies = await devToken(address)
  console.log(`  Token: OK`)
  await deposit(cookies, depositAmount)
  console.log(`  Deposit: ${depositAmount} EL$`)
  await setLeverage(cookies, imf)
  const leverage = 10000 / imf
  console.log(`  Leverage: ${leverage}x (IMF=${imf})`)
  return cookies
}

// ============================================================
// Preset: orderbook
// ============================================================

async function seedOrderbook() {
  console.log("=== Seed: orderbook ===\n")
  await prologue()

  // MM Bot 1
  const mm1 = await createBot("MM Bot 1", MM1_ADDR, 500000)
  console.log("\n  Orders (MM1):")
  await placeOrder(mm1, "Short", 60100, 0.5)
  await placeOrder(mm1, "Short", 60300, 1.5)
  await placeOrder(mm1, "Short", 61000, 3.0)
  await placeOrder(mm1, "Long", 59800, 1.0)
  await placeOrder(mm1, "Long", 59000, 2.0)

  // MM Bot 2
  const mm2 = await createBot("MM Bot 2", MM2_ADDR, 500000)
  console.log("\n  Orders (MM2):")
  await placeOrder(mm2, "Short", 60200, 1.0)
  await placeOrder(mm2, "Short", 60500, 2.0)
  await placeOrder(mm2, "Long", 59900, 0.5)
  await placeOrder(mm2, "Long", 59500, 1.5)
  await placeOrder(mm2, "Long", 58500, 3.0)
}

// ============================================================
// Preset: liquidation
// ============================================================

async function seedLiquidation() {
  console.log("=== Seed: liquidation ===\n")
  await prologue()

  const mm1 = await createBot("MM Bot 1", MM1_ADDR, 500000)
  console.log("\n  Orders:")
  // Ask (유저 Long 오픈용)
  await placeOrder(mm1, "Short", 60100, 0.5)
  await placeOrder(mm1, "Short", 60200, 1.0)
  // Bid (청산 IOC 체결용 — 저가)
  await placeOrder(mm1, "Long", 56500, 0.5)
  await placeOrder(mm1, "Long", 56000, 0.5)
  await placeOrder(mm1, "Long", 55000, 1.0)
}

// ============================================================
// Preset: insurance
// ============================================================

async function seedInsurance() {
  console.log("=== Seed: insurance ===\n")
  await prologue()

  const mm1 = await createBot("MM Bot 1", MM1_ADDR, 500000)
  console.log("\n  Orders (Ask only — no Bid for IOC failure):")
  await placeOrder(mm1, "Short", 60100, 0.5)
  await placeOrder(mm1, "Short", 60200, 1.0)

  // Insurance Fund 입금
  console.log("\n  Insurance Fund deposit: 10,000 EL$")
  await insuranceFundDeposit(10000)
}

// ============================================================
// Preset: adl
// ============================================================

async function seedAdl() {
  console.log("=== Seed: adl ===\n")
  await prologue()

  // Step 1: MM Bot places Bid (ADL counter가 매칭할 대상)
  const mm1 = await createBot("MM Bot 1", MM1_ADDR, 500000)
  console.log("\n  Step 1: MM1 Bid (ADL counter 매칭 대상)")
  await placeOrder(mm1, "Long", 59900, 0.5)

  // Step 2: ADL counter — Market Short → Bid 체결 → Short 포지션 + Bid 소진
  const adl = await createBot("ADL Counter", ADL_ADDR, 10000, 2000) // 5x (IMF=2000)
  console.log("\n  Step 2: ADL Counter Market Short (Bid 소진)")
  // Market Short: price = 슬리피지 한도 (mark * 0.9 = 54000)
  await placeOrder(adl, "Short", 54000, 0.5, 1)

  // Step 3: MM Bot Ask (유저 Long 오픈용) — Bid는 이미 소진됨
  console.log("\n  Step 3: MM1 Ask (유저 Long 오픈용)")
  await placeOrder(mm1, "Short", 60100, 1.0)
  await placeOrder(mm1, "Short", 60200, 1.0)

  // IF = 0 (deposit 안 함)
  console.log("\n  Insurance Fund: $0 (no deposit)")
}

// ============================================================
// Preset: funding
// ============================================================

async function seedFunding() {
  console.log("=== Seed: funding ===\n")

  console.log("[1/3] Reset")
  await reset()

  // funding 전용 프롤로그: mark ≠ index로 premium 생성
  console.log("[2/3] Oracle pause")
  await oraclePause()
  console.log(
    "[3/3] Oracle prices: mark=$60,100 / index=$60,000 (premium ≈ 0.167%)"
  )
  await oraclePrices(60100, 60000)

  // Step 1: MM2 Bid 먼저 (Counter가 매칭할 대상)
  const mm2 = await createBot("MM Bot 2", MM2_ADDR, 500000)
  console.log("\n  Step 1: MM2 Bid (Counter 매칭 대상)")
  await placeOrder(mm2, "Long", 59900, 0.5)

  // Step 2: Counter — Market Short 0.005 BTC → Bid 체결 → Short 포지션
  const counter = await createBot("Counter", COUNTER_ADDR, 10000)
  console.log("\n  Step 2: Counter Market Short (OI 불균형 생성)")
  // Market Short: price = 슬리피지 한도 (mark * 0.9 = 54000)
  await placeOrder(counter, "Short", 54000, 0.005, 1)

  // Step 3: MM1 주문
  const mm1 = await createBot("MM Bot 1", MM1_ADDR, 500000)
  console.log("\n  Step 3: MM1 Orders")
  await placeOrder(mm1, "Short", 60100, 0.5)
  await placeOrder(mm1, "Short", 60300, 1.5)
  await placeOrder(mm1, "Short", 61000, 3.0)
  await placeOrder(mm1, "Long", 59800, 1.0)
  await placeOrder(mm1, "Long", 59000, 2.0)

  // Step 4: MM2 나머지 주문
  console.log("\n  Step 4: MM2 Remaining Orders")
  await placeOrder(mm2, "Short", 60200, 1.0)
  await placeOrder(mm2, "Short", 60500, 2.0)
  await placeOrder(mm2, "Long", 59500, 1.5)
  await placeOrder(mm2, "Long", 58500, 3.0)
}

// ============================================================
// Main
// ============================================================

const PRESETS = {
  orderbook: seedOrderbook,
  liquidation: seedLiquidation,
  insurance: seedInsurance,
  adl: seedAdl,
  funding: seedFunding,
}

async function main() {
  const preset = process.argv[2]

  if (!preset || !PRESETS[preset]) {
    console.log("Usage: node seed.js [preset]\n")
    console.log("Presets:")
    for (const name of Object.keys(PRESETS)) {
      console.log(`  ${name}`)
    }
    process.exit(1)
  }

  console.log(`API: ${API_URL}\n`)

  try {
    await PRESETS[preset]()
    console.log(`\n✅ Seed "${preset}" complete`)
  } catch (err) {
    console.error(`\n❌ Seed "${preset}" failed: ${err.message}`)
    process.exit(1)
  }
}

main()
