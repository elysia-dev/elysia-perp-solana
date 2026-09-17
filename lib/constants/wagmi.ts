import { cookieStorage, createStorage } from "@wagmi/core"
import { WagmiAdapter } from "@reown/appkit-adapter-wagmi"
import { networkConfig } from "@network-config"

// Reown/WalletConnect project id. Public client identifier (NOT a secret), so
// it ships in the bundle either way — env-driven only to allow a different
// project per environment (e.g. a prod project whose Allowed Domains include
// app.elysia.finance). Falls back to the shared default when unset.
export const projectId =
  process.env.NEXT_PUBLIC_REOWN_PROJECT_ID || "4904537e8592e7bd77c13800298adf15"

if (!projectId) {
  throw new Error("Project ID is not defined")
}

// The wallet network set for this build comes from the env-selected config
// module (`@network-config`): mainnet mode → Ethereum mainnet only; testnet
// mode → Sepolia / Arbitrum Sepolia / Giwa Sepolia. See
// lib/config/network-config.types.ts for the alias mechanism and ordering
// notes.
export const networks = networkConfig.appKitNetworks

//Set up the Wagmi Adapter (Config)
export const wagmiAdapter = new WagmiAdapter({
  storage: createStorage({
    storage: cookieStorage,
  }),
  ssr: true,
  projectId,
  networks,
})

export const config = wagmiAdapter.wagmiConfig
