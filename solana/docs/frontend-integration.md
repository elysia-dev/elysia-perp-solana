# Calling the vault from a frontend

The client-side half of `programs/elysia_perp`. Deposits are a transaction the
user signs; withdrawals are not — see below.

## The IDL

`solana/idl/elysia_perp.json` is the committed copy. `anchor build` regenerates
`target/idl/elysia_perp.json`, which is gitignored, so **after any change to the
program interface, copy it over**:

```
anchor build && cp target/idl/elysia_perp.json idl/elysia_perp.json
```

A frontend consuming this program reads the committed copy. If the two drift,
the client builds instructions the program will reject at deserialization.

## Deployed

| cluster | program id | tokens |
| -- | -- | -- |
| devnet | [`6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy`](https://explorer.solana.com/address/6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy?cluster=devnet) | SOL, MEME `SPYDv38dP1pKpXN6EUo6FHibBgjoJmFxhWbetsoA9VH` |
| mainnet-beta | [`6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy`](https://explorer.solana.com/address/6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy) | MEME `MEME8wrHLaa2ByDN2rHKtJsZh2grZU8ACR7r3VMM82x` only — no SOL |

Same program id on both clusters, so pick the cluster by the `connection`, not
the address. Roles, caps and every PDA: [deployments.md](deployments.md).

```ts
import * as anchor from "@coral-xyz/anchor";
import { PublicKey } from "@solana/web3.js";
import idl from "./idl/elysia_perp.json";

const PROGRAM_ID = new PublicKey("6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy");
const program = new anchor.Program(idl as anchor.Idl, { connection });
```

## Signing in

Three ways in, and the account is the same one however you got there — same
user id, same balances, same positions. Nothing downstream can tell which key
opened the session.

### With a Solana wallet, no EVM wallet at all

```ts
import bs58 from "bs58";

const provider = (window as any).phantom?.solana ?? (window as any).solana;
await provider.connect();
const address = provider.publicKey.toBase58();

const timestamp = Date.now();
const message =
  `Access Elysia Perp account.\n\n` +
  `Solana address: ${address}\n\n` +
  `Timestamp: ${timestamp}`;

const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");

await fetch("/api/v1/auth/solana/login", {
  method: "POST",
  credentials: "include",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address, signature: bs58.encode(signature), timestamp }),
});
```

An unknown wallet **creates an account**. There is no separate signup call.

Such an account has no EVM address, which means no EVM withdrawals and **no
forced withdrawal from L1** — `escapeWithdraw` can only pay an Ethereum address.
Surface that rather than leaving it to be discovered: "add an L1 address to
enable emergency withdrawal".

### Linking a Solana wallet to an existing EVM account

Requires an authenticated EVM session. The message names **both** addresses, so
one signature authorises exactly one pairing and cannot be replayed into another
account.

```ts
const me = await fetch("/api/v1/account", { credentials: "include" }).then(r => r.json());
const evmAddress = me.accounts[0].l1_address;      // take it from the SERVER

const timestamp = Date.now();
const message =
  `Link this Solana wallet to Elysia Perp.\n\n` +
  `EVM address: ${evmAddress}\n\n` +
  `Solana address: ${address}\n\n` +
  `Timestamp: ${timestamp}`;

const { signature } = await provider.signMessage(new TextEncoder().encode(message), "utf8");

await fetch("/api/v1/auth/solana/link", {
  method: "POST",
  credentials: "include",                          // the EVM session authorises this
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address, signature: bs58.encode(signature), timestamp }),
});
```

**Take the EVM address from `/api/v1/account`, not from wagmi.** The server
builds the message with the EIP-55 **checksummed** form; rebuild it lowercased
and the signature will not verify, reported only as `Invalid Solana signature`.

### Managing credentials

```
GET    /api/v1/auth/credentials        every credential, each with its `type`
DELETE /api/v1/auth/credentials/{id}   204 | 404 | 409
```

`409` for the EVM row (it is the ledger identity and the L1 payout address) and
for the **last remaining** credential — removing it would leave an account
nobody can sign in to, holding a balance nobody can withdraw.

### Four things that will bite

1. The message must be **byte-identical**, double newlines included. The server
   rebuilds its own and never accepts one from the client.
2. The signature is **base58**, from a `Uint8Array(64)`. The EVM path uses hex.
3. A proof is **single-use and lives 60 seconds**. Same timestamp in the message
   and the body; replaying gets `Signed message already used`.
4. A session opened with a linked wallet is always role `user`, never `admin` —
   the admin whitelist is a list of EVM addresses.

## Deposit: SOL

```ts
// credit_to is a SOLANA wallet — normally the connected one. The ledger
// resolves it through that account's linked credentials.
const creditTo = provider.publicKey;   // PublicKey

const lamports = new anchor.BN(0.25 * anchor.web3.LAMPORTS_PER_SOL);

const sig = await program.methods
  .depositSol(lamports, { perp: {} }, creditTo)
  .accounts({ depositor: wallet.publicKey })
  .rpc();
```

The PDAs (`config`, `token_config`, `sol_vault`, `event_authority`) and the
self-reference `program` account carry their seeds in the IDL, so Anchor
resolves them. To pass them explicitly:

```ts
const [config]   = PublicKey.findProgramAddressSync([Buffer.from("config")], PROGRAM_ID);
const [solVault] = PublicKey.findProgramAddressSync([Buffer.from("sol_vault")], PROGRAM_ID);
// SOL's token_config uses 32 zero bytes where a mint would go (NATIVE_MINT_SENTINEL)
const [tokenConfig] = PublicKey.findProgramAddressSync(
  [Buffer.from("token"), PublicKey.default.toBuffer()], PROGRAM_ID);
```

## Deposit: SPL

```ts
const mint = new PublicKey("...");
const depositorTokenAccount = getAssociatedTokenAddressSync(mint, wallet.publicKey);

const sig = await program.methods
  .deposit(new anchor.BN(amountInBaseUnits), { perp: {} }, creditTo)
  .accounts({
    mint,
    depositorTokenAccount,
    depositor: wallet.publicKey,
    tokenProgram: TOKEN_PROGRAM_ID,
  })
  .rpc();
```

`tokenProgram` is always the legacy SPL Token program. The vault rejects every
Token-2022 mint (`require_mint_is_safe_to_custody`), so passing the Token-2022
program id fails rather than silently custodying a mint whose authority can move
the vault's balance out from under it.

## Two rules that cost real money

**`credit_to` should be the connected wallet, never a text input.** The ledger
resolves it through that account's linked credentials, so the usual case needs
no thought — pass `provider.publicKey`. A typo is still unrecoverable: an
unlinked key gets an account of its own, so the funds land somewhere only the
holder of *that* key can open, and there is no refund path.

**Deposit before linking, and you get a second account.** If a user already has
an EVM account and deposits from a wallet they have not linked, the deposit
creates a new Solana-native account holding those funds. Not lost — they can
open it by logging in with that wallet — but not where they expected. Prompt to
link first.

**Two scales AND a price.** The chain is lamports (9 decimals); the ledger is
6 **and denominated in dollars**. A deposit is converted at the configured peg
(`[deposit.solana] rate_num/rate_den`, currently $100/SOL on devnet), so
250,000,000 lamports — 0.25 SOL — appears as 25,000,000, i.e. $25.00. The value
handed to the program is lamports.

## Withdrawal is not a client-side transaction

Not symmetric with deposit. Only the `withdrawer` key can move funds out of the
vault, and the server holds it. The client asks the server; the server pays.

```ts
await fetch("/api/v1/account/withdraw", {
  method: "POST",
  credentials: "include",            // access_token cookie
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    asset_id: 5426,
    amount: "10",                    // USD, not SOL
    route_type: "perp",
    destination: "9XCQkp5wGdw9pqq4BwFULEYmoB3bmSXt4SAaAgfkv4FA",
  }),
});
```

`destination` is required for SOL and **refused** for EVM assets.

**It must be a wallet this account has linked.** Not any base58 address — one
that appears in `GET /api/v1/auth/credentials` for the caller. That restores the
property EVM has for free: the payout can only go somewhere the user proved they
control, so a stolen session cannot drain to an attacker's key and a typo cannot
reach an address nobody owns. Link first (see below), then withdraw.

Rejected: not linked to this account, non-base58, wrong length, the all-zero
system program, and the vault program itself.

On EVM there is no field because the payout is the account's **stored** address
(`users.address`), not the session's credential — those differ for system and
vault accounts, where paying the credential would burn the funds. An account
with no EVM address is refused with a message saying to add one, which is also
what enables emergency withdrawal from L1.

The server then drives `Pending -> Submitted -> Confirmed`. Every withdrawal
enters admin approval first (`AUTO_APPROVE_LIMIT = 0`), so expect
`pending_approval` before `pending`. The client polls the withdrawal list for
the status and `tx_hash`.

### Amounts are dollars, not SOL

`amount` is denominated in USD, like every other asset. At the configured peg of
$100/SOL, `"10"` pays out 0.1 SOL. The $10 minimum is a dollar minimum.

### A full round trip, as actually run

```
deposit   0.5 SOL          -> credited 50,000,000 internal ($50.00)
withdraw  "10" -> 9XCQ…    -> paid 100,000,000 lamports (0.1 SOL)
ledger    $50.00 -> $40.00
vault     0.50065 -> 0.40065 SOL
```

Ledger and chain agree exactly.

## Verification status

The instruction names, account order, PDA seeds and argument types are read from
the committed IDL, and the deposit/withdraw round trip above was run end to end
against devnet with a local server — the numbers in it are measured, not
illustrative.

The auth flows were exercised against a running server — signup with a wallet
that never had an EVM address, link, login, replay refusal, and the credential
guards — but through a Rust helper, not this TypeScript.

The TypeScript itself has not been executed against a cluster or a browser
wallet. Treat it as a correct description of the interface rather than as tested
code.

## Running a local server against the devnet program

For frontend work you want the real deployed program and a server you control.
The devnet vault at `6Q6A6yRt…` is already initialized, SOL and MEME are listed,
and their caps are set — nothing on-chain needs doing. Never point a local server
at the mainnet program with a withdrawer key: two ledgers crediting the same
deposits would each let the user withdraw them.

### 1. Database

```
createdb vex_dev1
DATABASE_URL=postgres://postgres:1q2w3e4r@localhost:5432/vex_dev1 \
  cargo run -p migration -- up
```

A Solana signature is 87-88 base58 characters and a mint is 44; the pre-Solana
schema sized those columns for EVM (`varchar(66)` / `varchar(42)`). Without the
migrations the first real deposit fails to insert forever, and because the
failure is retriable the cursor never advances — the watcher spins on the same
row. If deposits are silently absent, check this first.

### 2. Config

`config.dev.toml` already carries the block:

```toml
[deposit.solana]
program_id = "6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy"
chain_id = 40168                      # LayerZero endpoint id, not EIP-155
alchemy_network = "solana-devnet"
genesis_hash = "EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG"
poll_interval_ms = 5000
page_limit = 100
```

The presence of the block is the only switch — no `enabled` flag. Staging, prod
and testnet deliberately have no such block, so nothing is turned on by
deploying this code.

`genesis_hash` is checked at startup against what the RPC reports, and the
server refuses to start on a mismatch. That is not paranoia about typos (though
it caught one): the failure it prevents is mainnet deposits recorded as devnet
rows under the devnet cursor.

### 3. Environment

```
export DATABASE_URL=postgres://postgres:1q2w3e4r@localhost:5432/vex_dev1
export ALCHEMY_API_KEY=...          # RPC is https://solana-devnet.g.alchemy.com/v2/$KEY
export VEX_ENV=dev
cargo run -p server
```

Do not point this at `api.devnet.solana.com`. It throttles hard enough to
matter, and a throttled watcher falls BEHIND rather than failing — the failure
mode you notice last. `SOLANA_RPC_URL` overrides the Alchemy URL if you need a
local validator, but it cannot enable the watcher on its own.

Deposits work with only the above. Withdrawals additionally need
`SOLANA_WITHDRAWER_KEY`: the withdrawer keypair's JSON byte array itself, or a
path to that file. The server signs in-process, so no `vault` binary is needed.
Without the key the submitter stays off and withdrawal rows sit in PENDING,
which is a supported deposits-only configuration, not a bug.

### 4. Exercise it

Devnet SOL: `solana airdrop 2 <your-wallet> --url devnet`.

Deposit through the UI, or without a wallet at all:

```
cd solana
cargo run -p vault-cli -- deposit-sol 0.25 <20-byte-evm-address-hex>
```

Then confirm the credit landed, remembering both conversions — 0.25 SOL is
250,000,000 lamports on chain and, at the $100 peg, 25,000,000 in the ledger
($25.00):

```sql
SELECT user_id, asset_id, available FROM balances WHERE asset_id = 5426;
SELECT tx_hash, user_address, amount FROM deposit_events ORDER BY id DESC LIMIT 5;
```

`user_address` there is the base58 wallet you passed as `credit_to`, and it is
what links the on-chain transfer to a ledger account. If it is an address no
user has logged in as, the deposit still credits — to a user row created on
demand. That is the whole reason `credit_to` must not come from a text input.
