import { networkConfig } from "@network-config"

/**
 * Single source of truth for "which family of chains does this build talk
 * to" — driven by the build-time public env `NEXT_PUBLIC_NETWORK`.
 *
 * | env value     | mode    | Wallet network(s)                 | Deposit collateral |
 * | ------------- | ------- | --------------------------------- | ------------------ |
 * | `mainnet`     | mainnet | Ethereum mainnet (chain id 1)     | EL only (MockEL @ `0x9B08…3723`) |
 * | anything else | testnet | Sepolia + Arbitrum Sepolia        | EL, USDT (Sepolia), ARB (ArbSep) |
 *
 * Deploy expectation: staging sets `NEXT_PUBLIC_NETWORK=mainnet`; dev / v0 /
 * local leave it unset (or `=testnet`) and keep using testnet rails. Flipping
 * a single deploy env switch is the *only* thing that should be needed to
 * move an environment between testnet and mainnet — every other file in
 * `lib/constants/`, `lib/contracts/`, and the wallet provider reads from
 * this module to stay aligned.
 */
const RAW = process.env.NEXT_PUBLIC_NETWORK

export const IS_MAINNET = RAW === "mainnet"
export const NETWORK_MODE: "mainnet" | "testnet" = IS_MAINNET
  ? "mainnet"
  : "testnet"

/**
 * Chain id used as a fallback / "primary" anchor when an asset doesn't have
 * an explicit `ASSET_ID_TO_CHAIN_ID` entry (unknown asset, dropdown default
 * before pair data arrives, …) and as the canonical "right network" for
 * the connected wallet in the current mode.
 *
 * - mainnet mode → `1` (Ethereum mainnet)
 * - testnet mode → `11155111` (Sepolia)
 *
 * Note: Arbitrum Sepolia is also "supported" in testnet mode for ARB
 * deposits, but it's a secondary deposit chain; the *primary* (default)
 * chain remains Sepolia.
 */
export const PRIMARY_CHAIN_ID = networkConfig.primaryChainId

/**
 * Whether to show test/QA-only UI (Mint faucet, Dev toolbar, …) AND enable the
 * dangerous QA API routes (`/api/trade-bot/*`, which mint funded dev accounts).
 *
 * FAIL-CLOSED / opt-in: OFF unless `NEXT_PUBLIC_ENABLE_TEST_UI` is exactly
 * `"true"`. This is deliberate — the guarded routes create funded accounts and
 * relay orders, so a NEW or misconfigured deployment that simply forgets the
 * flag must be SAFE, not exposed. We can NOT gate on `VERCEL_ENV`/`NODE_ENV`:
 * every environment (dev / v0 / staging / prod) is a production BUILD shipped as
 * a Vercel Preview, so neither signal singles out prod. The explicit opt-in is
 * the only reliable per-branch control.
 *
 * → prod needs NO variable (absence = off). The QA environments (dev / v0 /
 *   staging) must set `NEXT_PUBLIC_ENABLE_TEST_UI=true` to keep their tooling.
 */
export const SHOW_TEST_UI = process.env.NEXT_PUBLIC_ENABLE_TEST_UI === "true"

/**
 * Whether search engines may index this deployment — drives the `robots` tag.
 *
 * Its OWN dedicated opt-in (`NEXT_PUBLIC_ALLOW_INDEXING=true`), NOT derived from
 * `NEXT_PUBLIC_ENABLE_TEST_UI`. Reusing that var overloaded one flag with two
 * opposite-polarity meanings: test tooling wants "off unless opted in", but
 * indexing wants "off unless we're SURE it's prod". A single var can't fail
 * safe for both — e.g. a prod deploy that (correctly, per SHOW_TEST_UI) leaves
 * the var unset would have been noindexed, deindexing the live site.
 *
 * FAIL-CLOSED for SEO: indexing is OFF unless a deployment explicitly sets
 * `NEXT_PUBLIC_ALLOW_INDEXING=true`. Only prod sets it; every QA env and any
 * misconfigured/new deploy stays noindexed by default (a QA site leaking into
 * Google is the failure to avoid).
 */
export const ALLOW_INDEXING = process.env.NEXT_PUBLIC_ALLOW_INDEXING === "true"
