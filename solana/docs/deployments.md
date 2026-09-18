# Deployments

The custody vault runs at the **same program id on devnet and mainnet**. An
address is a public key, not cluster state, so every PDA below is also identical
across clusters — what differs is who holds each role, which tokens are listed,
and their caps. Always say which cluster you mean.

Read any row back with the CLI (`SOLANA_RPC_URL` selects the cluster; unset means
devnet):

```
cargo run -q -p vault-cli -- status          # roles, SOL config
cargo run -q -p vault-cli -- status <mint>   # one token's config, cap and vault
```

## Program and config

| | devnet | mainnet-beta |
| -- | -- | -- |
| Program id | `6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy` | `6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy` |
| ProgramData | `4a6uHKXGJWTLZhMN22MFJrHTky3n6BYoJ2D5CQeFrcgM` | `4a6uHKXGJWTLZhMN22MFJrHTky3n6BYoJ2D5CQeFrcgM` |
| Config | `C8t4rG1odcDQiwfRB2YfZE1D6kekEZ4eFJxZH8CSapr9` | `C8t4rG1odcDQiwfRB2YfZE1D6kekEZ4eFJxZH8CSapr9` |
| Event authority | `8eVmbmWSvqqkPowmSwgDXL6QP2JkPh4khPkCaXC7WFfQ` | `8eVmbmWSvqqkPowmSwgDXL6QP2JkPh4khPkCaXC7WFfQ` |
| Upgrade authority | `9XCQkp5wGdw9pqq4BwFULEYmoB3bmSXt4SAaAgfkv4FA` | `AbfVCNLFZRM2nJcxjJwy1RhUTCbm7xhhikUiaEczFMCg` |
| Owner | `9XCQkp5wGdw9pqq4BwFULEYmoB3bmSXt4SAaAgfkv4FA` | `AbfVCNLFZRM2nJcxjJwy1RhUTCbm7xhhikUiaEczFMCg` |
| Withdrawer | `6FCp7QG5r8R4GEeTmNKjTeMcuirsFAg5dfJEVZot5uZG` | `AbfVCNLFZRM2nJcxjJwy1RhUTCbm7xhhikUiaEczFMCg` (temporary, see below) |
| Guardian | unset | unset |
| LayerZero chain id (`deposit_events.chain_id`) | 40168 | 30168 |
| Server config | `config.dev.toml` | `config.testnet.toml` |

Mainnet was deployed and initialized on 2026-09-17 from commit `9904ce8b`
(`elysia_perp.so` sha256 `ffb7f87377b1142738ed4982774a9c99998c1ef601b2350208e80190a1d6cf8f`,
451,168 bytes, slot 447706798).

**Mainnet roles are not final.** Owner, withdrawer and upgrade authority are all
the deployer for now. Before the server pays out on mainnet the withdrawer moves to
a separate key (`vault set-withdrawer`) — the deployer key must never be the
server's `SOLANA_WITHDRAWER_KEY`, because it can also upgrade the program and mint
MEME. Owner and upgrade authority then move to a multisig together.

## Listed tokens and withdrawal caps

The cap is a leaky bucket per token: at most `cap` may leave the vault in any
rolling `window`, refilling continuously. `0` would mean unlimited and usage
untracked; no listed token has it.

### devnet

| Token | Mint | Asset id | Decimals | Cap | Token config | Vault |
| -- | -- | -- | -- | -- | -- | -- |
| SOL (native) | — (all-zero sentinel) | 5426 | 9 | 50 SOL / 3600 s | `6AU6ZzU8J4Eebi3a4pfCKpjqr4GvaoZHVdEnG96EZDsX` | `AMDiTtgr2yawhSZw8uGGsEk6LEyZzvTP1QBsuGhGbwbK` |
| MEME (devnet) | `SPYDv38dP1pKpXN6EUo6FHibBgjoJmFxhWbetsoA9VH` | 9004 | 6 | 100,000 MEME / 3600 s | `EsX1VAJLCmoyAJ5TGVWkdxHTdjsVwNspT18bd2YKmdxC` | `AzWUmm64T58cwAeGUubFCpcvpG3HyPbKGkrwiLH1Gzn1` |

Minimum deposit is 0 for both.

### mainnet-beta

| Token | Mint | Asset id | Decimals | Cap | Token config | Vault |
| -- | -- | -- | -- | -- | -- | -- |
| MEME | `MEME8wrHLaa2ByDN2rHKtJsZh2grZU8ACR7r3VMM82x` | 9004 | 6 | 10,000,000 MEME / 3600 s | `4nKEui2ykxhohH1f6FQKsMQfJm4iouvcy3WU1b4bSFnM` | `2m2Kv8iMq1LCFSfvN3fNhnvvUhrPnVCGoA5P7gceqYTF` |

Minimum deposit is 0. **Native SOL is not listed on mainnet and must not be**
(`add-sol` is never run; the server has `native_sol = false`): a fixed SOL peg
would price real SOL at a number we do not control.

MEME mint authority on mainnet is the deployer (`AbfV…`); no freeze authority;
classic SPL Token program.

## Changing any of this

Every change here is an on-chain transaction by the owner. Update this file in the
same PR as the config change it goes with, and re-read the values with `status`
rather than copying them from a command's intent.

| Change | Command |
| -- | -- |
| Cap | `vault set-token-cap <mint> <tokens> <window seconds>` (usage carries over) |
| List a token | `vault set-token-cap …` first, then `vault add-token <mint>`, then `[[deposit.solana.tokens]]` in the server config |
| Delist | `vault remove-token <mint>` (withdrawals keep working) |
| Withdrawer | `vault set-withdrawer <pubkey>`, then the server's `SOLANA_WITHDRAWER_KEY` |
| Guardian | `vault set-guardian <pubkey\|none>` |
| Owner | `vault transfer-ownership <pubkey>` → `vault accept-ownership` (nominee), **and** `solana program set-upgrade-authority` |
