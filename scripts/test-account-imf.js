const { createWalletClient, http } = require("viem")
const { privateKeyToAccount } = require("viem/accounts")
const { mainnet } = require("viem/chains")

const API_URL = "https://elysia-perp-dev.up.railway.app"

function getRandomPrivateKey() {
  let key = "0x"
  for (let j = 0; j < 64; j++)
    key += Math.floor(Math.random() * 16).toString(16)
  return key
}

async function main() {
  const privateKey = getRandomPrivateKey()
  const client = createWalletClient({
    chain: mainnet,
    transport: http("https://eth.llamarpc.com"),
  })
  const account = privateKeyToAccount(privateKey)

  // Login
  const nonceRes = await fetch(
    `${API_URL}/auth/nonce?address=${account.address}`
  )
  const { nonce } = await nonceRes.json()
  const signature = await client.signTypedData({
    account,
    domain: { name: "ELSIA_PERP", version: "1", chainId: 11155111n },
    types: {
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
      ],
      LoginMessage: [
        { name: "user", type: "address" },
        { name: "nonce", type: "string" },
      ],
    },
    primaryType: "LoginMessage",
    message: { user: account.address, nonce },
  })
  const loginRes = await fetch(`${API_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ address: account.address, signature, nonce }),
  })
  const cookies = (loginRes.headers.getSetCookie?.() || [])
    .map((c) => c.split(";")[0])
    .join("; ")

  // Test 1: New user
  console.log("=== New user /account ===")
  const acc1 = await (
    await fetch(`${API_URL}/account`, { headers: { Cookie: cookies } })
  ).json()
  const pos1 = acc1?.accounts?.[0]?.positions || []
  pos1.forEach((p) =>
    console.log(
      `  ${p.symbol}: initial_margin_fraction = ${p.initial_margin_fraction} (type: ${typeof p.initial_margin_fraction})`
    )
  )

  // Test 2: Change leverage to 20x (IMF = 500 in basis points)
  console.log("\n=== After PUT /perp/leverage (20x, IMF=500) ===")
  const levRes = await fetch(`${API_URL}/perp/leverage`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookies },
    body: JSON.stringify({
      market: "BTC-PERP",
      initial_margin_fraction: 500,
      margin_mode: 1,
    }),
  })
  console.log("Leverage response:", levRes.status, await levRes.text())

  const acc2 = await (
    await fetch(`${API_URL}/account`, { headers: { Cookie: cookies } })
  ).json()
  const pos2 = acc2?.accounts?.[0]?.positions || []
  pos2.forEach((p) =>
    console.log(
      `  ${p.symbol}: initial_margin_fraction = ${p.initial_margin_fraction} (type: ${typeof p.initial_margin_fraction})`
    )
  )
}

main().catch(console.error)
