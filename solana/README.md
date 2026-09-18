# Solana custody vault

The Solana counterpart of `contracts/src/ElysiaPerp.sol`. Same job: hold user
deposits, emit an event the indexer credits, and pay out under an operator key
that is bounded by a rolling cap.

## Build and test

```
cd solana
anchor build          # produces target/deploy/elysia_perp.so + target/idl
cargo test -p elysia_perp
```

The tests run on [litesvm] — no validator, no node toolchain, just Rust. They
load the built `.so`, so **`anchor build` has to run first** and again after any
change to the program; a stale `.so` fails in ways that look like logic errors
(a changed instruction signature surfaces as `InstructionDidNotDeserialize`).

[litesvm]: https://github.com/LiteSVM/litesvm

## Why this is a separate cargo workspace

`solana/` is listed under `exclude` in the root `Cargo.toml`. Anchor pins
`solana-program`, which pins `borsh`, `bytemuck` and `curve25519` versions that
conflict with `sea-orm` and `actix` in the main tree. One resolver cannot satisfy
both, and the split costs nothing since no crate here is shared.

## Differences from the Solidity contract

Deliberate, and each one has a comment at its site in `src/lib.rs`:

| Solidity | here | why |
| --- | --- | --- |
| `ReentrancyGuard` | dropped | Solana serialises account access and bounds CPI depth; there is no EVM-style reentrancy to guard |
| `UUPSUpgradeable` | dropped | programs upgrade through the BPF loader's upgrade authority — that *is* the analogue, and it belongs to a Squads multisig |
| `deposit()` | no analogue | our ledger keys users by Ethereum address; a Solana signer has nowhere to go in it |
| `depositTo(to, ...)` | `deposit(..., credit_to: Pubkey)` | the credit target is a Solana wallet, resolved through that account's linked credentials |
| `address(0)` native sentinel | `NATIVE_MINT_SENTINEL` | the default pubkey, so native SOL reuses one code path for support/minimum/cap |
| `emit Deposit(...)` | `emit_cpi!` | Anchor's `emit!` writes to transaction logs, which validators truncate and RPC providers drop; deposits must be recoverable |
| `Withdraw(user, token, amount)` | `+ withdrawal_id` | on L1 `user` is the payee EOA, which IS the ledger key. Here `recipient` is a token account the ledger cannot represent, so the event carries the submitter's row id instead |
| (not expressible) | mint extension gate | `add_token` refuses Token-2022 mints with `PermanentDelegate`, `TransferHook`, `NonTransferable`, `ConfidentialTransferMint` or `Pausable`. An ERC20's powers are not introspectable, so L1 *cannot* do this; a `PermanentDelegate` mint could drain the vault past the withdrawer, the cap and the pause |

Native SOL also carries a rent-exempt floor the vault refuses to spend below,
which has no EVM counterpart.

## Operational invariants

**`owner` and the program's upgrade authority are two different keys, and both
must move together.** On L1 they are one key: `owner` is also `_authorizeUpgrade`,
so `Ownable2Step` rotates both at once. Here `transfer_ownership` rotates only the
config owner. The BPF upgrade authority is separate, is not touched by any
instruction in this program, and can replace the entire program — including the
parts that honour `withdrawer`, the withdrawal cap and `pause`.

So rotating ownership is TWO steps, and doing only the first is the dangerous half:

```
# 1. on-chain, two-step
transfer_ownership(new_owner) ; accept_ownership()   # signed by new_owner
# 2. off-chain, and DO NOT SKIP
solana program set-upgrade-authority <program-id> --new-upgrade-authority <new_owner>
```

Both should be the same Squads multisig, mirroring the Safe multisig the L1 owner
moved to. `pause` offers no protection against a compromised upgrade authority.

**Only the upgrade authority can `initialize`.** The config is a PDA that can be
created once, and its creator becomes owner and withdrawer. Deploy and `init` are
separate transactions, so an open `initialize` would let anyone watching for the
deploy take the vault; the program checks the signer against the ProgramData
account's upgrade authority instead.

**Set a token's withdrawal cap before listing it.** `set_withdraw_limit` works on
an unlisted token (it creates the config with `supported = false`), so the cap can
and should be in place before `add_token` makes the token depositable. Listing
does not reset a cap that was set first, and changing a cap does not refill the
bucket: usage carries over, clamped to the new cap. A cap of `0` means usage is
not managed at all — nothing is recorded while it holds, so setting a cap again
starts from an empty bucket.

## Calling it from a frontend

See [docs/frontend-integration.md](docs/frontend-integration.md) — deposit
examples, the PDA seeds, and why withdrawal is a server call rather than a
transaction the user signs.

## Program id and deploying

The program id is `6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy`, committed in
both `declare_id!` and `Anchor.toml`. It is repo-level and shared — every PDA in
the program derives from it, so it must be identical for everyone.

It is deployed at that same id on **devnet and mainnet-beta**. Roles, listed
tokens, caps and PDAs per cluster: [docs/deployments.md](docs/deployments.md).

**The program keypair (`target/deploy/elysia_perp-keypair.json`) is gitignored and
exists on one machine.** It is only needed to claim the address on first deploy;
upgrades afterwards are authorised by the upgrade authority, not by this key. But
if it is lost BEFORE the first deploy, the id changes and every reference above
has to change with it — so back it up somewhere shared and secret (a password
manager), never in this repo.

`[provider]` is deliberately left on the Anchor defaults, because a wallet path
is per-developer and a cluster is per-task. Deploy with explicit flags:

```
anchor build
anchor deploy --provider.cluster devnet \
  --provider.wallet ~/.config/solana/elysia-devnet.json \
  -- --max-len 779600
```

`--max-len` sizes the programdata account with room to grow. Without it the
account fits today's binary exactly and a larger upgrade will not fit — the only
way out then is a redeploy under a new id, which changes the address everything
points at. Roughly 3.96 SOL of rent at 2x versus 1.98 at exact size; the headroom
is worth it.

### After deploying: bring it into service

`anchor deploy` publishes the program but leaves it **inert** — no config, no
token listed, no vault. `cli/` drives the rest, in the one order that is safe:

```
cargo run -p vault-cli -- status            # what exists right now
cargo run -p vault-cli -- init              # config; the SIGNER becomes owner
                                            # (must be the upgrade authority)
cargo run -p vault-cli -- set-sol-cap 50 3600   # 50 SOL/hour, BEFORE listing
cargo run -p vault-cli -- add-sol           # list SOL + create the lamport vault
cargo run -p vault-cli -- status            # expect: "ready: SOL listed with a rolling cap"
```

**The cap goes before the listing.** `add_native_token` sets `supported = true`
immediately and a fresh config has `cap = 0`, which means UNLIMITED — so listing
first opens a window where the only funded asset has no withdrawal rate limit.
`set_withdraw_limit` works on an unlisted token precisely so the cap can be in
place first, and `add-sol` refuses to run until it is.

Reads `SOLANA_RPC_URL`, `SOLANA_PROGRAM_ID` and `SOLANA_KEYPAIR`, defaulting to
devnet, the `declare_id!` above, and `~/.config/solana/elysia-devnet.json`.

Whoever signs the deploy becomes the **upgrade authority** — the key that can
replace this program wholesale, past `withdrawer`, the cap and `pause`. See the
operational invariants above.

### Mainnet: MEME only, no native SOL

Mainnet lists MEME and never runs `add-sol`: a fixed SOL peg would price real SOL
at a number we do not control. `config.testnet.toml` matches with
`native_sol = false`.

```
export SOLANA_RPC_URL=<mainnet RPC>
export SOLANA_KEYPAIR=~/.config/solana/elysia-mainnet-deployer.json
MEME=MEME8wrHLaa2ByDN2rHKtJsZh2grZU8ACR7r3VMM82x

anchor build
solana program deploy --url "$SOLANA_RPC_URL" --keypair "$SOLANA_KEYPAIR" \
  --program-id target/deploy/elysia_perp-keypair.json target/deploy/elysia_perp.so

cargo run -p vault-cli -- init                          # the deployer, as upgrade authority
cargo run -p vault-cli -- set-withdrawer <withdrawer>   # a separate hot key
cargo run -p vault-cli -- set-guardian <guardian>       # may pause, never unpause
cargo run -p vault-cli -- set-token-cap $MEME <tokens> <window seconds>
cargo run -p vault-cli -- add-token $MEME
cargo run -p vault-cli -- status $MEME
```

### Incident response

```
cargo run -p vault-cli -- pause                 # guardian or owner: stops deposits AND withdrawals
cargo run -p vault-cli -- set-withdrawer <new>  # owner: rotate a leaked withdrawer key
cargo run -p vault-cli -- unpause               # owner only
```
