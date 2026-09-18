//! Bring a freshly deployed custody vault into service, and inspect one.
//!
//! `anchor deploy` publishes the program but leaves it INERT: there is no config
//! account, no token is listed, and no vault exists. This does that sequence in
//! the one order that is safe, and records it — the alternative is typing it from
//! memory at the moment it matters.
//!
//! ```text
//!   vault status                 # what exists on chain right now
//!   vault init                   # create config; the SIGNER becomes owner
//!                                # (must be the program's upgrade authority)
//!   vault set-sol-cap <sol> <s>  # rolling cap, BEFORE listing
//!   vault add-sol                # list native SOL + create the lamport vault
//! ```
//!
//! An SPL token follows the same shape, with the mint named at every step:
//!
//! ```text
//!   vault status <mint>                   # that token's config and vault
//!   vault set-token-cap <mint> <amt> <s>  # rolling cap, BEFORE listing
//!   vault add-token <mint>                # list it + create its vault PDA
//! ```
//!
//! Roles and incident response:
//!
//! ```text
//!   vault set-withdrawer <pubkey>         # the key the server signs payouts with
//!   vault set-guardian <pubkey|none>      # may pause, never unpause
//!   vault pause                           # guardian or owner
//!   vault unpause                         # owner only
//!   vault transfer-ownership <pubkey>     # step 1, signed by the owner
//!   vault accept-ownership                # step 2, signed by the nominee
//! ```
//!
//! # The cap goes before the listing, and it is not cosmetic
//!
//! `add_native_token` sets `supported = true` immediately, and a fresh config has
//! `cap = 0`, which means UNLIMITED. Listing first therefore opens a window where
//! the only funded asset has no withdrawal rate limit at all. `set_withdraw_limit`
//! deliberately works on an unlisted token (it creates the config with
//! `supported` false), precisely so the cap can be in place first. `status`
//! refuses to call a vault ready while that ordering has not been honoured.
//!
//! # Why the instructions are built from the program crate
//!
//! `elysia_perp::{accounts, instruction}` are the generated types, so an
//! instruction assembled here cannot drift from the deployed program's layout.
//! A hand-written account list would compile happily and fail on chain.

use std::str::FromStr;

use anchor_lang::{InstructionData, ToAccountMetas};
use base64::Engine;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    signer::EncodableKey,
    transaction::Transaction,
};

const NATIVE_SENTINEL: Pubkey = Pubkey::new_from_array([0u8; 32]);
const LAMPORTS_PER_SOL: u64 = 1_000_000_000;

/// The classic SPL Token program. NOT Token-2022: `require_mint_is_safe_to_custody`
/// refuses any mint owned by anything else, because the 2022 extensions include
/// transfer fees, transfer hooks and permanent delegates — each of which lets a
/// third party change what a custody vault actually holds.
fn spl_token_program() -> Pubkey {
    Pubkey::from_str("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA").expect("valid program id")
}

/// Host only. Premium endpoints carry the API key in the path
/// (`.../v2/<KEY>`), and this binary's output is folded into the server's logs.
/// Duplicated from the server rather than shared: `solana/` is a separate cargo
/// workspace precisely because it cannot link the server's crates.
fn mask_rpc_url(url: &str) -> String {
    match url.split_once("://") {
        Some((scheme, rest)) => {
            let host = rest.split('/').next().unwrap_or(rest);
            format!("{scheme}://{host}")
        }
        None => url.split('/').next().unwrap_or(url).to_string(),
    }
}

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let cmd = args.first().map(String::as_str).unwrap_or("status");

    let rpc = std::env::var("SOLANA_RPC_URL")
        .unwrap_or_else(|_| "https://api.devnet.solana.com".to_string());
    let program_id = Pubkey::from_str(
        &std::env::var("SOLANA_PROGRAM_ID").unwrap_or_else(|_| elysia_perp::ID.to_string()),
    )
    .expect("SOLANA_PROGRAM_ID is not a valid pubkey");

    let client = Rpc::new(rpc.clone());
    println!("rpc     {}", mask_rpc_url(&rpc));
    println!("program {program_id}\n");

    match cmd {
        // `status <mint>` reports that token instead of native SOL.
        "status" => match args.get(1) {
            Some(mint) => token_status(&client, &program_id, &parse_mint(mint)),
            None => status(&client, &program_id),
        },
        "init" => init(&client, &program_id, &keypair()),
        "set-sol-cap" => {
            let sol: f64 = args
                .get(1)
                .and_then(|v| v.parse().ok())
                .expect("usage: vault set-sol-cap <SOL per window> <window seconds>");
            let window: u64 = args
                .get(2)
                .and_then(|v| v.parse().ok())
                .expect("usage: vault set-sol-cap <SOL per window> <window seconds>");
            set_sol_cap(&client, &program_id, &keypair(), sol, window)
        }
        "add-sol" => add_sol(&client, &program_id, &keypair()),
        "set-token-cap" => {
            let usage = "usage: vault set-token-cap <mint> <tokens per window> <window seconds>";
            let mint = parse_mint(args.get(1).expect(usage));
            let amount: f64 = args.get(2).and_then(|v| v.parse().ok()).expect(usage);
            let window: u64 = args.get(3).and_then(|v| v.parse().ok()).expect(usage);
            set_token_cap(&client, &program_id, &keypair(), &mint, amount, window)
        }
        "deposit-token" => {
            let usage = "usage: vault deposit-token <mint> <amount> [credit-to pubkey]";
            let mint = parse_mint(args.get(1).expect(usage));
            let amount: f64 = args.get(2).and_then(|v| v.parse().ok()).expect(usage);
            deposit_token(
                &client,
                &program_id,
                &keypair(),
                &mint,
                amount,
                args.get(3).map(String::as_str),
            )
        }
        "withdraw-token" => {
            let usage =
                "usage: vault withdraw-token <mint> <destination wallet> <base units> <withdrawal id>";
            let mint = parse_mint(args.get(1).expect(usage));
            let dest = args.get(2).expect(usage);
            let base: u64 = args.get(3).and_then(|v| v.parse().ok()).expect(usage);
            let withdrawal_id: u64 = args.get(4).and_then(|v| v.parse().ok()).expect(usage);
            withdraw_token(
                &client,
                &program_id,
                &keypair(),
                &mint,
                dest,
                base,
                withdrawal_id,
            )
        }
        "set-metadata" => {
            let usage = "usage: vault set-metadata <mint> <name> <symbol> [uri]";
            let mint = parse_mint(args.get(1).expect(usage));
            let name = args.get(2).expect(usage);
            let symbol = args.get(3).expect(usage);
            set_metadata(
                &client,
                &keypair(),
                &mint,
                name,
                symbol,
                args.get(4).map(String::as_str).unwrap_or(""),
            )
        }
        "remove-token" => {
            let mint = parse_mint(args.get(1).expect("usage: vault remove-token <mint>"));
            remove_token(&client, &program_id, &keypair(), &mint)
        }
        "add-token" => {
            let mint = parse_mint(args.get(1).expect("usage: vault add-token <mint>"));
            add_token(&client, &program_id, &keypair(), &mint)
        }
        "set-withdrawer" => {
            let new_withdrawer = args.get(1).expect("usage: vault set-withdrawer <pubkey>");
            set_withdrawer(&client, &program_id, &keypair(), new_withdrawer)
        }
        "set-guardian" => {
            let raw = args
                .get(1)
                .expect("usage: vault set-guardian <pubkey|none>");
            set_guardian(&client, &program_id, &keypair(), raw)
        }
        "pause" => pause(&client, &program_id, &keypair()),
        "unpause" => unpause(&client, &program_id, &keypair()),
        "transfer-ownership" => {
            let raw = args
                .get(1)
                .expect("usage: vault transfer-ownership <pubkey>");
            transfer_ownership(&client, &program_id, &keypair(), raw)
        }
        "accept-ownership" => accept_ownership(&client, &program_id, &keypair()),
        "withdraw-sol" => {
            let dest = args.get(1).expect(
                "usage: vault withdraw-sol <destination pubkey> <lamports> <withdrawal id>",
            );
            let lamports: u64 = args
                .get(2)
                .and_then(|v| v.parse().ok())
                .expect("usage: vault withdraw-sol <destination> <lamports> <withdrawal id>");
            let withdrawal_id: u64 = args
                .get(3)
                .and_then(|v| v.parse().ok())
                .expect("usage: vault withdraw-sol <destination> <lamports> <withdrawal id>");
            withdraw_sol(
                &client,
                &program_id,
                &keypair(),
                dest,
                lamports,
                withdrawal_id,
            )
        }
        "deposit-sol" => {
            let sol: f64 = args
                .get(1)
                .and_then(|v| v.parse().ok())
                .expect("usage: vault deposit-sol <SOL> [credit-to pubkey]");
            // Omitted means the signer's own key, which is the case that needs
            // no thought and cannot be typo'd.
            deposit_sol(
                &client,
                &program_id,
                &keypair(),
                sol,
                args.get(2).map(String::as_str),
            )
        }
        other => {
            eprintln!("unknown command '{other}'");
            eprintln!("usage: vault status");
            eprintln!("             init");
            eprintln!("             set-sol-cap <sol> <window seconds>");
            eprintln!("             add-sol");
            eprintln!("             status <mint>");
            eprintln!("             set-token-cap <mint> <tokens> <window seconds>");
            eprintln!("             add-token <mint>");
            eprintln!("             remove-token <mint>");
            eprintln!("             set-metadata <mint> <name> <symbol> [uri]");
            eprintln!("             deposit-token <mint> <amount> [credit-to pubkey]");
            eprintln!("             withdraw-token <mint> <destination> <base units> <id>");
            eprintln!("             deposit-sol <sol> [credit-to pubkey, default: signer]");
            eprintln!("             set-withdrawer <pubkey>");
            eprintln!("             set-guardian <pubkey|none>");
            eprintln!("             pause");
            eprintln!("             unpause");
            eprintln!("             transfer-ownership <pubkey>");
            eprintln!("             accept-ownership");
            eprintln!("             withdraw-sol <destination> <lamports> <withdrawal id>");
            std::process::exit(2);
        }
    }
}

fn parse_mint(raw: &str) -> Pubkey {
    Pubkey::from_str(raw).unwrap_or_else(|e| panic!("mint is not a Solana address: {e}"))
}

/// The signer. Becomes the OWNER on `init` — the key that appoints the
/// withdrawer and can pause. `init` only accepts the program's upgrade authority,
/// so on a fresh deployment the two start as the same key; no instruction here
/// can move the upgrade authority afterwards (see the README's operational
/// invariants).
fn keypair() -> Keypair {
    let path = std::env::var("SOLANA_KEYPAIR").unwrap_or_else(|_| {
        format!(
            "{}/.config/solana/elysia-devnet.json",
            std::env::var("HOME").unwrap_or_default()
        )
    });
    Keypair::read_from_file(&path).unwrap_or_else(|e| panic!("cannot read keypair {path}: {e}"))
}

// ----------------------------------------------------------------------
// PDAs
// ----------------------------------------------------------------------

fn config_pda(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[elysia_perp::CONFIG_SEED], program).0
}
fn token_config_pda(program: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[elysia_perp::TOKEN_CONFIG_SEED, mint.as_ref()], program).0
}
fn vault_pda(program: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[elysia_perp::VAULT_SEED, mint.as_ref()], program).0
}
/// The associated token account for a wallet and mint.
///
/// The ledger stores a WALLET address, never an ATA, so every SPL amount that
/// moves in or out is addressed this way: the wallet is the user's identity and
/// the ATA is derived from it. Deriving beats storing — an ATA passed around by
/// hand is an address that can be wrong in a way no one notices until the money
/// is in it.
fn ata(wallet: &Pubkey, mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[wallet.as_ref(), spl_token_program().as_ref(), mint.as_ref()],
        &associated_token_program(),
    )
    .0
}

fn associated_token_program() -> Pubkey {
    Pubkey::from_str("ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL").expect("valid program id")
}

/// `CreateIdempotent` on the Associated Token Account program: make `wallet`'s
/// ATA for `mint` if it is not there, and succeed quietly if it is.
///
/// The vault's `withdraw` requires `recipient_token_account` to EXIST — the
/// program will not create it, and a first-time recipient has no ATA. Without
/// this the very first payout to any wallet fails on chain, which is the worst
/// possible moment to discover it. `payer` funds the rent (~0.002 SOL), so on
/// the server path that cost lands on the withdrawer key.
fn create_ata_idempotent_ix(payer: &Pubkey, wallet: &Pubkey, mint: &Pubkey) -> Instruction {
    use solana_sdk::instruction::AccountMeta;
    Instruction {
        program_id: associated_token_program(),
        accounts: vec![
            AccountMeta::new(*payer, true),
            AccountMeta::new(ata(wallet, mint), false),
            AccountMeta::new_readonly(*wallet, false),
            AccountMeta::new_readonly(*mint, false),
            AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            AccountMeta::new_readonly(spl_token_program(), false),
        ],
        data: vec![1],
    }
}

fn sol_vault_pda(program: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[elysia_perp::SOL_VAULT_SEED], program).0
}

/// Where the upgradeable loader keeps the program's bytes and its upgrade
/// authority.
fn program_data_pda(program: &Pubkey) -> Pubkey {
    // The upgradeable loader (v3). Spelled out rather than imported: solana-sdk's
    // module for it is deprecated in favour of a crate this tool does not need.
    let loader = Pubkey::from_str("BPFLoaderUpgradeab1e11111111111111111111111").expect("valid id");
    Pubkey::find_program_address(&[program.as_ref()], &loader).0
}

/// The program's upgrade authority: `None` when frozen, or when the account is
/// not an upgradeable ProgramData at all.
///
/// Layout: variant tag u32 (4) = 3, slot u64 (8), Option<Pubkey> tag (1), key (32).
fn upgrade_authority(client: &Rpc, program: &Pubkey) -> Option<Pubkey> {
    let d = client.account_data(&program_data_pda(program))?;
    if d.len() < 45 || d[..4] != [3, 0, 0, 0] || d[12] != 1 {
        return None;
    }
    Some(Pubkey::new_from_array(arr(&d[13..45])))
}

// ----------------------------------------------------------------------
// Commands
// ----------------------------------------------------------------------

/// Read-only. Safe to run against anything, including a vault in service.
fn status(client: &Rpc, program: &Pubkey) {
    let config = config_pda(program);
    let sol_cfg = token_config_pda(program, &NATIVE_SENTINEL);
    let vault = sol_vault_pda(program);

    match upgrade_authority(client, program) {
        Some(authority) => println!("upgrade authority {authority}\n"),
        None => println!("upgrade authority (none — frozen, or not an upgradeable program)\n"),
    }

    println!("config      {config}");
    let config_data = client.account_data(&config);
    match &config_data {
        None => {
            println!("            NOT INITIALISED — run `vault init` with the upgrade authority");
            println!("\nnot ready: no config");
            return;
        }
        Some(d) if d.len() >= 8 + 32 * 4 + 2 => {
            // Config: disc(8) owner(32) pending(32) withdrawer(32) guardian(32) paused(1) bump(1)
            println!("  owner      {}", Pubkey::new_from_array(arr(&d[8..40])));
            let pending = Pubkey::new_from_array(arr(&d[40..72]));
            if pending != Pubkey::default() {
                println!("  pending    {pending} (must run `vault accept-ownership`)");
            }
            println!("  withdrawer {}", Pubkey::new_from_array(arr(&d[72..104])));
            let guardian = Pubkey::new_from_array(arr(&d[104..136]));
            println!(
                "  guardian   {}",
                if guardian == Pubkey::default() {
                    "(unset)".to_string()
                } else {
                    guardian.to_string()
                }
            );
            println!("  paused     {}", d[136] != 0);
        }
        Some(d) => println!("            UNREADABLE ({} bytes)", d.len()),
    }

    println!("\nSOL config  {sol_cfg}");
    let sol_data = client.account_data(&sol_cfg);
    let (listed, cap) = match &sol_data {
        None => {
            println!("            absent — SOL is neither configured nor listed");
            (false, 0u64)
        }
        // disc(8) mint(32) supported(1) min(8) cap(8) window(8) start(8) drawn(8) bump(1)
        Some(d) if d.len() >= 82 => {
            // TokenConfig: disc(8) mint(32) supported(1) min(8) cap(8)
            //              window_seconds(8) window_start(8) withdrawn(8) bump(1)
            let supported = d[40] != 0;
            let min = u64::from_le_bytes(arr8(&d[41..49]));
            let cap = u64::from_le_bytes(arr8(&d[49..57]));
            let window = u64::from_le_bytes(arr8(&d[57..65]));
            println!("  listed     {supported}");
            println!("  min dep    {} SOL", lamports(min));
            println!(
                "  cap        {}",
                if cap == 0 {
                    "UNLIMITED".to_string()
                } else {
                    format!("{} SOL / {}s", lamports(cap), window)
                }
            );
            (supported, cap)
        }
        Some(d) => {
            println!("            UNREADABLE ({} bytes)", d.len());
            (false, 0)
        }
    };

    println!("\nSOL vault   {vault}");
    match client.lamports(&vault) {
        Some(l) => println!("  balance    {} SOL", lamports(l)),
        None => println!("            absent — run `vault add-sol`"),
    }

    // The verdict, so nobody has to infer it from the fields above.
    println!();
    if config_data.is_none() {
        println!("not ready: no config");
    } else if !listed {
        println!("not ready: SOL not listed — set the cap, then `vault add-sol`");
    } else if cap == 0 {
        println!("LISTED WITH NO CAP — withdrawals are rate-unlimited. Set a cap now.");
    } else {
        println!("ready: SOL listed with a rolling cap");
    }
}

fn init(client: &Rpc, program: &Pubkey, signer: &Keypair) {
    if client.account_data(&config_pda(program)).is_some() {
        println!("config already exists; `initialize` can only run once. Nothing to do.");
        return;
    }
    // The program refuses anyone else; checking here turns a failed transaction
    // into a message that says which key to use.
    match upgrade_authority(client, program) {
        Some(authority) if authority == signer.pubkey() => {}
        Some(authority) => {
            eprintln!(
                "refusing: `initialize` only accepts the upgrade authority {authority}, \
                 but the signer is {}. Set SOLANA_KEYPAIR to the deployer's key.",
                signer.pubkey()
            );
            std::process::exit(1);
        }
        None => {
            eprintln!(
                "refusing: the program has no upgrade authority (frozen, or not deployed \
                 with the upgradeable loader), so nobody can initialize it."
            );
            std::process::exit(1);
        }
    }
    println!("initialising — owner will be {}", signer.pubkey());
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::Initialize {
            config: config_pda(program),
            payer: signer.pubkey(),
            program_data: program_data_pda(program),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Initialize {}.data(),
    };
    client.send(&[ix], signer);
}

/// Set the rolling cap. Works BEFORE the token is listed, which is the point.
fn set_sol_cap(client: &Rpc, program: &Pubkey, signer: &Keypair, sol: f64, window_seconds: u64) {
    let cap = (sol * LAMPORTS_PER_SOL as f64) as u64;
    assert!(
        cap == 0 || window_seconds > 0,
        "a non-zero cap needs a non-zero window"
    );
    println!("cap -> {sol} SOL per {window_seconds}s ({cap} lamports)");
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::MutateTokenConfig {
            config: config_pda(program),
            token_config: token_config_pda(program, &NATIVE_SENTINEL),
            owner: signer.pubkey(),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::SetWithdrawLimit {
            mint: NATIVE_SENTINEL,
            cap,
            window_seconds,
        }
        .data(),
    };
    client.send(&[ix], signer);
}

/// List native SOL and create the lamport vault. Deposits become possible the
/// moment this lands, so it goes LAST.
fn add_sol(client: &Rpc, program: &Pubkey, signer: &Keypair) {
    // Refuse to open deposits with no rate limit. The program permits it; this
    // tool does not, because the ordering is the whole reason it exists.
    match client.account_data(&token_config_pda(program, &NATIVE_SENTINEL)) {
        Some(d) if d.len() > 57 && u64::from_le_bytes(arr8(&d[49..57])) > 0 => {}
        _ => {
            eprintln!(
                "refusing: no withdrawal cap is set for SOL.\n\
                 Listing sets supported = true immediately, and cap = 0 means UNLIMITED.\n\
                 Run `vault set-sol-cap <sol> <window seconds>` first."
            );
            std::process::exit(1);
        }
    }

    println!("listing native SOL and creating the lamport vault");
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::AddNativeToken {
            config: config_pda(program),
            token_config: token_config_pda(program, &NATIVE_SENTINEL),
            sol_vault: sol_vault_pda(program),
            owner: signer.pubkey(),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::AddNativeToken {}.data(),
    };
    client.send(&[ix], signer);
}

/// Deposit native SOL, crediting a Solana wallet.
///
/// Exists so the whole path can be exercised without a wallet UI: the watcher
/// credits whatever `credit_to` names, and that is the thing worth testing.
///
/// `credit_to` DEFAULTS TO THE SIGNER, which is the safe and usual case — the
/// depositor's own key, something they provably control. Passing a different one
/// deposits on that wallet's behalf, and there is no refund path if it is wrong:
/// crediting a key nobody holds puts the funds in an account nobody can open.
fn deposit_sol(
    client: &Rpc,
    program: &Pubkey,
    signer: &Keypair,
    sol: f64,
    credit_to: Option<&str>,
) {
    let credit_to = match credit_to {
        Some(raw) => raw
            .parse::<Pubkey>()
            .unwrap_or_else(|e| panic!("credit_to is not a Solana address: {e}")),
        None => signer.pubkey(),
    };

    let lamports = (sol * LAMPORTS_PER_SOL as f64) as u64;
    assert!(lamports > 0, "amount must be non-zero");
    println!("depositing {sol} SOL ({lamports} lamports), crediting {credit_to}");

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], program).0;

    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::DepositSol {
            config: config_pda(program),
            token_config: token_config_pda(program, &NATIVE_SENTINEL),
            sol_vault: sol_vault_pda(program),
            depositor: signer.pubkey(),
            system_program: solana_sdk::system_program::ID,
            event_authority,
            program: *program,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::DepositSol {
            amount: lamports,
            route_type: elysia_perp::RouteType::Perp,
            credit_to,
        }
        .data(),
    };
    client.send(&[ix], signer);
    println!("  the watcher should credit {credit_to} within one poll interval");
}

/// Appoint the key allowed to call `withdraw` / `withdraw_sol`.
///
/// Owner-only, and the point of the role: `initialize` defaults the withdrawer to
/// the owner so a fresh deployment can pay out at all, but leaving it there means
/// the key signing withdrawals all day is also the key that configures the vault
/// — and, on this deployment, the one that deployed the program. Appointing a
/// separate hot key is what makes the separation real.
///
/// The program refuses the zero address, so the vault can never be left with no
/// withdrawer.
fn set_withdrawer(client: &Rpc, program: &Pubkey, owner: &Keypair, new_withdrawer: &str) {
    let new = Pubkey::from_str(new_withdrawer).unwrap_or_else(|e| panic!("not a pubkey: {e}"));
    println!("withdrawer -> {new}");
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::OwnerOnly {
            config: config_pda(program),
            owner: owner.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::SetWithdrawer {
            new_withdrawer: new,
        }
        .data(),
    };
    client.send(&[ix], owner);
    println!("  the withdrawer key now needs a little SOL of its own for tx fees");
}

fn owner_only_ix(program: &Pubkey, owner: &Keypair, data: Vec<u8>) -> Instruction {
    Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::OwnerOnly {
            config: config_pda(program),
            owner: owner.pubkey(),
        }
        .to_account_metas(None),
        data,
    }
}

/// Appoint the guardian, or clear it with `none`. The guardian can pause and
/// never unpause, so it can live on a key that is handier than the owner's.
fn set_guardian(client: &Rpc, program: &Pubkey, owner: &Keypair, raw: &str) {
    let new_guardian = if raw == "none" {
        Pubkey::default()
    } else {
        Pubkey::from_str(raw).unwrap_or_else(|e| panic!("not a pubkey: {e}"))
    };
    println!(
        "guardian -> {}",
        if raw == "none" { "(unset)" } else { raw }
    );
    let ix = owner_only_ix(
        program,
        owner,
        elysia_perp::instruction::SetGuardian { new_guardian }.data(),
    );
    client.send(&[ix], owner);
}

/// Stop deposits AND withdrawals. Signed by the guardian or the owner.
///
/// The incident switch: if the withdrawer key leaks, this is what stops the
/// bleeding while `set-withdrawer` rotates it. The server treats `Paused` as a
/// terminal refusal and backs off, so payouts queue rather than fail.
fn pause(client: &Rpc, program: &Pubkey, signer: &Keypair) {
    println!("pausing the vault as {}", signer.pubkey());
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::Pause {
            config: config_pda(program),
            authority: signer.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Pause {}.data(),
    };
    client.send(&[ix], signer);
    println!("  paused: deposits and withdrawals are refused until the OWNER runs `vault unpause`");
}

/// Owner only, by design: a compromised guardian can stop the vault but never
/// restart it.
fn unpause(client: &Rpc, program: &Pubkey, owner: &Keypair) {
    println!("unpausing the vault");
    let ix = owner_only_ix(program, owner, elysia_perp::instruction::Unpause {}.data());
    client.send(&[ix], owner);
    println!("  withdrawals the server queued while paused resume on its next retry");
}

/// Step one of the two-step handover: nominate. Nothing changes until the
/// nominee signs `accept-ownership`, so a mistyped key strands nothing — run
/// this again with the right one.
fn transfer_ownership(client: &Rpc, program: &Pubkey, owner: &Keypair, raw: &str) {
    let new_owner = Pubkey::from_str(raw).unwrap_or_else(|e| panic!("not a pubkey: {e}"));
    println!("nominating {new_owner} as owner");
    let ix = owner_only_ix(
        program,
        owner,
        elysia_perp::instruction::TransferOwnership { new_owner }.data(),
    );
    client.send(&[ix], owner);
    println!("  now run `vault accept-ownership` with SOLANA_KEYPAIR set to the nominee's key");
}

/// Step two, signed by the nominee.
///
/// This moves the VAULT owner only. The program's upgrade authority is a
/// separate key held by the loader: move it with `solana program
/// set-upgrade-authority`.
fn accept_ownership(client: &Rpc, program: &Pubkey, nominee: &Keypair) {
    println!("accepting ownership as {}", nominee.pubkey());
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::AcceptOwnership {
            config: config_pda(program),
            new_owner: nominee.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::AcceptOwnership {}.data(),
    };
    client.send(&[ix], nominee);
}

/// Pay native SOL out of the vault by hand, signed by the withdrawer.
///
/// The server does not use this: it builds and signs the same instruction
/// in-process. This is for an operator settling a payout manually. On success
/// the LAST line is `SIGNATURE <base58>` and the exit code is 0; any failure
/// exits non-zero.
///
/// `withdrawal_id` is the ledger's row id, echoed back in `WithdrawEvent` so the
/// two sides reconcile exactly.
fn withdraw_sol(
    client: &Rpc,
    program: &Pubkey,
    signer: &Keypair,
    destination: &str,
    lamports: u64,
    withdrawal_id: u64,
) {
    let dest = Pubkey::from_str(destination)
        .unwrap_or_else(|e| panic!("destination is not a pubkey: {e}"));
    assert!(lamports > 0, "amount must be non-zero");

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], program).0;
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::WithdrawSol {
            config: config_pda(program),
            token_config: token_config_pda(program, &NATIVE_SENTINEL),
            sol_vault: sol_vault_pda(program),
            recipient: dest,
            withdrawer: signer.pubkey(),
            event_authority,
            program: *program,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::WithdrawSol {
            amount: lamports,
            withdrawal_id,
        }
        .data(),
    };
    let sig = client.send_returning(&[ix], signer);
    // The machine-readable line, last and alone.
    println!("SIGNATURE {sig}");
}

/// A mint's decimals, read from the chain rather than assumed.
///
/// Every amount below is typed by a human in whole tokens; the chain wants base
/// units. Guessing the scale is how a cap meant to be 10,000 tokens becomes
/// 10,000 base units — a cap of one cent — or a thousand times too large.
///
/// Classic SPL `Mint` layout: mint_authority COption<Pubkey> (36), supply u64
/// (8), decimals u8 at 44.
fn mint_decimals(client: &Rpc, mint: &Pubkey) -> u8 {
    let data = client
        .account_data(mint)
        .unwrap_or_else(|| panic!("mint {mint} does not exist on this cluster"));
    assert!(
        data.len() >= 45,
        "account {mint} is not an SPL mint ({} bytes)",
        data.len()
    );
    data[44]
}

/// Base units for a human amount of a token, e.g. 2.5 of a 6dp token -> 2_500_000.
fn base_units(amount: f64, decimals: u8) -> u64 {
    (amount * 10f64.powi(decimals as i32)) as u64
}

fn ui_amount(base: u64, decimals: u8) -> String {
    format!(
        "{:.*}",
        decimals as usize,
        base as f64 / 10f64.powi(decimals as i32)
    )
}

/// An SPL token's config and vault. The `status` verdict for one mint.
fn token_status(client: &Rpc, program: &Pubkey, mint: &Pubkey) {
    let token_config = token_config_pda(program, mint);
    let vault = vault_pda(program, mint);
    let decimals = mint_decimals(client, mint);

    println!("mint        {mint}");
    println!("  decimals   {decimals}");
    let owner_is_classic = client
        .account_owner(mint)
        .map(|o| o == spl_token_program())
        .unwrap_or(false);
    if !owner_is_classic {
        println!("  program    NOT the classic SPL Token program — `add-token` will be REFUSED");
    }

    println!("\ntoken config {token_config}");
    let (listed, cap) = match client.account_data(&token_config) {
        None => {
            println!("            absent — neither configured nor listed");
            (false, 0u64)
        }
        // disc(8) mint(32) supported(1) min(8) cap(8) window(8) start(8) drawn(8) bump(1)
        Some(d) if d.len() >= 82 => {
            let supported = d[40] != 0;
            let min = u64::from_le_bytes(arr8(&d[41..49]));
            let cap = u64::from_le_bytes(arr8(&d[49..57]));
            let window = u64::from_le_bytes(arr8(&d[57..65]));
            println!("  listed     {supported}");
            println!("  min dep    {}", ui_amount(min, decimals));
            println!(
                "  cap        {}",
                if cap == 0 {
                    "UNLIMITED".to_string()
                } else {
                    format!("{} / {}s", ui_amount(cap, decimals), window)
                }
            );
            (supported, cap)
        }
        Some(d) => {
            println!("            UNREADABLE ({} bytes)", d.len());
            (false, 0)
        }
    };

    println!("\nvault       {vault}");
    match client.account_data(&vault) {
        // SPL TokenAccount: mint(32) owner(32) amount u64 at 64.
        Some(d) if d.len() >= 72 => println!(
            "  balance    {}",
            ui_amount(u64::from_le_bytes(arr8(&d[64..72])), decimals)
        ),
        Some(_) => println!("            UNREADABLE"),
        None => println!("            absent — run `vault add-token <mint>`"),
    }

    println!();
    if !listed {
        println!("not ready: not listed — set the cap, then `vault add-token {mint}`");
    } else if cap == 0 {
        println!("LISTED WITH NO CAP — withdrawals are rate-unlimited. Set a cap now.");
    } else {
        println!("ready: listed with a rolling cap");
    }
}

/// Set an SPL token's rolling cap. Works BEFORE the token is listed — same
/// reason as `set-sol-cap`, and the same ordering rule.
fn set_token_cap(
    client: &Rpc,
    program: &Pubkey,
    signer: &Keypair,
    mint: &Pubkey,
    amount: f64,
    window_seconds: u64,
) {
    let decimals = mint_decimals(client, mint);
    let cap = base_units(amount, decimals);
    assert!(
        cap == 0 || window_seconds > 0,
        "a non-zero cap needs a non-zero window"
    );
    println!("cap -> {amount} tokens per {window_seconds}s ({cap} base units, {decimals}dp)");
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::MutateTokenConfig {
            config: config_pda(program),
            token_config: token_config_pda(program, mint),
            owner: signer.pubkey(),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::SetWithdrawLimit {
            mint: *mint,
            cap,
            window_seconds,
        }
        .data(),
    };
    client.send(&[ix], signer);
}

/// List an SPL token and create its vault PDA. Deposits of this mint become
/// possible the moment it lands, so it goes LAST — and the vault is created here
/// rather than on first deposit, because only this program can sign for a token
/// account at its own PDA.
fn add_token(client: &Rpc, program: &Pubkey, signer: &Keypair, mint: &Pubkey) {
    // Fail here rather than on chain, where the error is a bare custom code.
    match client.account_owner(mint) {
        Some(owner) if owner == spl_token_program() => {}
        Some(owner) => {
            eprintln!(
                "refusing: mint {mint} is owned by {owner}, not the classic SPL Token program.\n\
                 The vault rejects any other owner — Token-2022 extensions (transfer fees,\n\
                 hooks, permanent delegates) let a third party change what custody holds."
            );
            std::process::exit(1);
        }
        None => {
            eprintln!("refusing: mint {mint} does not exist on this cluster");
            std::process::exit(1);
        }
    }

    // Same refusal as `add-sol`: listing sets supported = true immediately, and
    // cap = 0 means UNLIMITED.
    match client.account_data(&token_config_pda(program, mint)) {
        Some(d) if d.len() > 57 && u64::from_le_bytes(arr8(&d[49..57])) > 0 => {}
        _ => {
            eprintln!(
                "refusing: no withdrawal cap is set for {mint}.\n\
                 Listing sets supported = true immediately, and cap = 0 means UNLIMITED.\n\
                 Run `vault set-token-cap <mint> <amount> <window seconds>` first."
            );
            std::process::exit(1);
        }
    }

    println!("listing {mint} and creating its vault");
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::AddToken {
            config: config_pda(program),
            token_config: token_config_pda(program, mint),
            mint: *mint,
            vault: vault_pda(program, mint),
            owner: signer.pubkey(),
            token_program: spl_token_program(),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::AddToken {}.data(),
    };
    client.send(&[ix], signer);
    println!("  vault {}", vault_pda(program, mint));
}

/// Metaplex Token Metadata. Where every explorer and wallet reads a token's
/// name and symbol from.
///
/// An SPL mint account holds mint_authority, supply, decimals, is_initialized
/// and freeze_authority — and nothing else. There is no name field, which is why
/// a fresh mint shows as "Unknown Token" everywhere. The name lives in a
/// separate account owned by this program, derived from the mint.
///
/// Token-2022 can carry metadata inside the mint itself and would need none of
/// this, but the vault refuses Token-2022 mints: its extensions include transfer
/// fees, transfer hooks and permanent delegates, each of which lets a third
/// party change what custody actually holds. Choosing the safer mint is what
/// puts the metadata over here.
fn token_metadata_program() -> Pubkey {
    Pubkey::from_str("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s").expect("valid program id")
}

fn metadata_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(
        &[
            b"metadata",
            token_metadata_program().as_ref(),
            mint.as_ref(),
        ],
        &token_metadata_program(),
    )
    .0
}

/// Borsh `String`: a u32 length, then the bytes.
fn push_borsh_string(out: &mut Vec<u8>, value: &str) {
    out.extend_from_slice(&(value.len() as u32).to_le_bytes());
    out.extend_from_slice(value.as_bytes());
}

/// The `DataV2` body shared by create and update: name, symbol, uri, then three
/// `None`s for the NFT-only fields (creators, collection, uses).
fn push_data_v2(out: &mut Vec<u8>, name: &str, symbol: &str, uri: &str) {
    push_borsh_string(out, name);
    push_borsh_string(out, symbol);
    push_borsh_string(out, uri);
    out.extend_from_slice(&0u16.to_le_bytes()); // seller_fee_basis_points
    out.push(0); // creators: None
    out.push(0); // collection: None
    out.push(0); // uses: None
}

/// Give a mint a name and symbol, or change the ones it has.
///
/// Instructions are hand-encoded rather than pulled from `mpl-token-metadata`:
/// this workspace already exists because Anchor's pinned dependencies conflict
/// with the server's, and adding another program's crate to resolve against
/// anchor 0.32 is a fight worth avoiding for two instructions whose layouts have
/// been stable for years.
///
/// `is_mutable` stays true, so a rename later is this same command again. An
/// empty `uri` is fine — explorers show the name and symbol and simply have no
/// logo to draw.
fn set_metadata(
    client: &Rpc,
    signer: &Keypair,
    mint: &Pubkey,
    name: &str,
    symbol: &str,
    uri: &str,
) {
    // Metaplex's own limits. Exceeding them fails on chain with a bare code.
    assert!(name.len() <= 32, "name must be 32 bytes or fewer");
    assert!(symbol.len() <= 10, "symbol must be 10 bytes or fewer");
    assert!(uri.len() <= 200, "uri must be 200 bytes or fewer");

    let metadata = metadata_pda(mint);
    let exists = client.account_data(&metadata).is_some();

    use solana_sdk::instruction::AccountMeta;
    let ix = if exists {
        // UpdateMetadataAccountV2. Only the update authority signs.
        println!("updating metadata for {mint} -> {symbol} ({name})");
        let mut data = vec![15u8];
        data.push(1); // data: Some(DataV2)
        push_data_v2(&mut data, name, symbol, uri);
        data.push(0); // new_update_authority: None
        data.push(0); // primary_sale_happened: None
        data.push(1); // is_mutable: Some(..)
        data.push(1); // .. = true
        Instruction {
            program_id: token_metadata_program(),
            accounts: vec![
                AccountMeta::new(metadata, false),
                AccountMeta::new_readonly(signer.pubkey(), true),
            ],
            data,
        }
    } else {
        // CreateMetadataAccountV3. The MINT AUTHORITY signs, which is why this
        // is an owner-key operation and not something the withdrawer can do.
        println!("creating metadata for {mint} -> {symbol} ({name})");
        let mut data = vec![33u8];
        push_data_v2(&mut data, name, symbol, uri);
        data.push(1); // is_mutable = true
        data.push(0); // collection_details: None
        Instruction {
            program_id: token_metadata_program(),
            accounts: vec![
                AccountMeta::new(metadata, false),
                AccountMeta::new_readonly(*mint, false),
                AccountMeta::new_readonly(signer.pubkey(), true), // mint authority
                AccountMeta::new(signer.pubkey(), true),          // payer
                AccountMeta::new_readonly(signer.pubkey(), false), // update authority
                AccountMeta::new_readonly(solana_sdk::system_program::ID, false),
            ],
            data,
        }
    };

    client.send(&[ix], signer);
    println!("  metadata account {metadata}");
}

/// Stop accepting deposits of a token. Withdrawals keep working.
///
/// The counterpart of listing, and the step that retires a mint. A mint the
/// server no longer has in `[[deposit.solana.tokens]]` is still depositable on
/// chain until this runs: the vault takes the transfer, the watcher refuses to
/// credit it, and the depositor is left with funds in custody and no balance.
/// Refusing it on chain puts the failure where the user can still act on it.
///
/// `remove_token` deliberately does NOT block withdrawals — funds already in the
/// vault must remain payable, exactly as removing a token on L1 leaves
/// `withdraw` working.
fn remove_token(client: &Rpc, program: &Pubkey, signer: &Keypair, mint: &Pubkey) {
    println!("de-listing {mint} (withdrawals stay open)");
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::MutateTokenConfig {
            config: config_pda(program),
            token_config: token_config_pda(program, mint),
            owner: signer.pubkey(),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::RemoveToken { mint: *mint }.data(),
    };
    client.send(&[ix], signer);
}

/// Deposit an SPL token, crediting a Solana wallet. The SPL counterpart of
/// `deposit-sol`, including its `credit_to` defaulting rule.
fn deposit_token(
    client: &Rpc,
    program: &Pubkey,
    signer: &Keypair,
    mint: &Pubkey,
    amount: f64,
    credit_to: Option<&str>,
) {
    let credit_to = match credit_to {
        Some(raw) => parse_mint(raw),
        None => signer.pubkey(),
    };
    let decimals = mint_decimals(client, mint);
    let base = base_units(amount, decimals);
    assert!(base > 0, "amount must be non-zero");

    let depositor_token_account = ata(&signer.pubkey(), mint);
    if client.account_data(&depositor_token_account).is_none() {
        panic!("{} holds no {mint} — nothing to deposit", signer.pubkey());
    }
    println!("depositing {amount} ({base} base units) of {mint}, crediting {credit_to}");

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], program).0;
    let ix = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::Deposit {
            config: config_pda(program),
            token_config: token_config_pda(program, mint),
            mint: *mint,
            vault: vault_pda(program, mint),
            depositor_token_account,
            depositor: signer.pubkey(),
            token_program: spl_token_program(),
            event_authority,
            program: *program,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Deposit {
            amount: base,
            route_type: elysia_perp::RouteType::Perp,
            credit_to,
        }
        .data(),
    };
    client.send(&[ix], signer);
    println!("  the watcher should credit {credit_to} within one poll interval");
}

/// Pay an SPL token out of the vault to a WALLET by hand, signed by the
/// withdrawer. The SPL counterpart of `withdraw-sol`, with the same output:
/// `SUBMITTED <sig>` at broadcast, `SIGNATURE <sig>` only once finalized.
///
/// `amount` is in BASE UNITS, not whole tokens, so a manual settlement can use
/// the exact integer the ledger debited. `withdraw-sol` takes lamports for the
/// same reason.
///
/// The recipient's ATA is created in the same transaction when missing, so a
/// first withdrawal to a fresh wallet works. Idempotent: if it already exists
/// nothing happens and the transfer proceeds.
fn withdraw_token(
    client: &Rpc,
    program: &Pubkey,
    signer: &Keypair,
    mint: &Pubkey,
    destination: &str,
    base: u64,
    withdrawal_id: u64,
) {
    let wallet = Pubkey::from_str(destination)
        .unwrap_or_else(|e| panic!("destination is not a pubkey: {e}"));
    assert!(base > 0, "amount must be non-zero");
    let recipient_token_account = ata(&wallet, mint);

    let event_authority = Pubkey::find_program_address(&[b"__event_authority"], program).0;
    let withdraw = Instruction {
        program_id: *program,
        accounts: elysia_perp::accounts::Withdraw {
            config: config_pda(program),
            token_config: token_config_pda(program, mint),
            mint: *mint,
            vault: vault_pda(program, mint),
            recipient_token_account,
            withdrawer: signer.pubkey(),
            token_program: spl_token_program(),
            event_authority,
            program: *program,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Withdraw {
            amount: base,
            withdrawal_id,
        }
        .data(),
    };

    let sig = client.send_returning(
        &[
            create_ata_idempotent_ix(&signer.pubkey(), &wallet, mint),
            withdraw,
        ],
        signer,
    );
    println!("SIGNATURE {sig}");
}

// ----------------------------------------------------------------------
// Minimal RPC
// ----------------------------------------------------------------------

struct Rpc {
    url: String,
    http: reqwest::blocking::Client,
}

impl Rpc {
    fn new(url: String) -> Self {
        Self {
            url,
            http: reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .expect("http client"),
        }
    }

    /// Like [`Self::call`] but returns the error instead of panicking. Used
    /// after a broadcast, where dying would lose the signature.
    fn try_call(
        &self,
        method: &str,
        params: serde_json::Value,
    ) -> Result<serde_json::Value, String> {
        let body = serde_json::json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
        let resp: serde_json::Value = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .map_err(|e| format!("{method}: {e}"))?
            .json()
            .map_err(|e| format!("{method}: decode: {e}"))?;
        if let Some(err) = resp.get("error").filter(|e| !e.is_null()) {
            return Err(format!("{method}: {err}"));
        }
        Ok(resp["result"].clone())
    }

    fn call(&self, method: &str, params: serde_json::Value) -> serde_json::Value {
        let body = serde_json::json!({"jsonrpc":"2.0","id":1,"method":method,"params":params});
        let resp: serde_json::Value = self
            .http
            .post(&self.url)
            .json(&body)
            .send()
            .unwrap_or_else(|e| panic!("{method}: {e}"))
            .json()
            .unwrap_or_else(|e| panic!("{method}: decode: {e}"));
        if let Some(err) = resp.get("error") {
            panic!("{method}: {err}");
        }
        resp["result"].clone()
    }

    fn account(&self, key: &Pubkey) -> Option<serde_json::Value> {
        let r = self.call(
            "getAccountInfo",
            serde_json::json!([key.to_string(), {"encoding":"base64","commitment":"confirmed"}]),
        );
        let v = r.get("value")?;
        if v.is_null() {
            None
        } else {
            Some(v.clone())
        }
    }

    fn account_data(&self, key: &Pubkey) -> Option<Vec<u8>> {
        let v = self.account(key)?;
        let b64 = v.get("data")?.get(0)?.as_str()?;
        base64::engine::general_purpose::STANDARD.decode(b64).ok()
    }

    fn lamports(&self, key: &Pubkey) -> Option<u64> {
        self.account(key)?.get("lamports")?.as_u64()
    }

    /// The program that owns an account. For a mint this says whether it is a
    /// classic SPL token or a Token-2022 one, which the vault treats differently.
    fn account_owner(&self, key: &Pubkey) -> Option<Pubkey> {
        Pubkey::from_str(self.account(key)?.get("owner")?.as_str()?).ok()
    }

    /// Sign, submit, and wait for confirmation. Panics on failure — this is a
    /// bring-up tool run by a human watching the output, so a loud stop beats a
    /// half-configured vault.
    fn send(&self, ixs: &[Instruction], signer: &Keypair) {
        let _ = self.send_returning(ixs, signer);
    }

    fn send_returning(&self, ixs: &[Instruction], signer: &Keypair) -> String {
        let blockhash: String = self.call(
            "getLatestBlockhash",
            serde_json::json!([{"commitment":"finalized"}]),
        )["value"]["blockhash"]
            .as_str()
            .expect("blockhash")
            .to_string();
        let hash = blockhash.parse().expect("blockhash parses");

        let tx = Transaction::new_signed_with_payer(ixs, Some(&signer.pubkey()), &[signer], hash);
        let wire = base64::engine::general_purpose::STANDARD
            .encode(bincode::serialize(&tx).expect("serialize"));

        let sig = self.call(
            "sendTransaction",
            serde_json::json!([wire, {"encoding":"base64","preflightCommitment":"confirmed"}]),
        );
        let sig = sig.as_str().expect("signature").to_string();
        // MACHINE-READABLE, and printed the instant the broadcast is accepted --
        // before any confirmation wait. The caller needs to distinguish "never
        // broadcast" from "broadcast, outcome unknown", because the second is
        // NOT safe to retry: the blockhash stays valid ~60s and RPC nodes keep
        // retry-forwarding, so a transaction unconfirmed when we give up
        // routinely lands afterwards.
        println!("SUBMITTED {sig}");

        // Poll rather than assume. A submitted transaction is not a landed one,
        // and a bring-up step that silently failed would be discovered later as
        // a mysteriously missing account.
        // 45s: `finalized` is roughly 31 slots behind `confirmed`, ~13s more.
        for _ in 0..45 {
            std::thread::sleep(std::time::Duration::from_secs(1));
            // Errors here must NOT abort: the transaction is already broadcast,
            // and exiting non-zero would tell the caller nothing was paid.
            let Ok(st) = self.try_call(
                "getSignatureStatuses",
                serde_json::json!([[sig.clone()], {"searchTransactionHistory": true}]),
            ) else {
                continue;
            };
            let v = &st["value"][0];
            if v.is_null() {
                continue;
            }
            let status = v["confirmationStatus"].as_str().unwrap_or("");
            if !v["err"].is_null() {
                // Landed and reverted: nothing moved, and this IS safe to retry.
                // Distinct from the timeout path below. A revert at `confirmed`
                // is not reported as final either — waiting costs one poll and
                // avoids calling a fork's view of the world settled.
                if status == "finalized" {
                    eprintln!("FAILED_ON_CHAIN {}", v["err"]);
                    std::process::exit(3);
                }
                continue;
            }
            // ONLY `finalized`. `confirmed` is optimistic — supermajority vote,
            // not a rooted block — and can still be dropped in a fork. The
            // deposit watcher has always read at `finalized`; accepting less
            // here would mean crediting a deposit only once it cannot be undone
            // while debiting a withdrawal for a payment that still can be.
            if status == "finalized" {
                println!("  {status} ✓");
                return sig;
            }
        }
        // Broadcast, outcome unknown. Exit non-zero so the caller does not treat
        // it as settled -- but the `SUBMITTED` line above already told it the
        // transaction exists, which is what stops it being paid again.
        eprintln!("UNCONFIRMED {sig}");
        std::process::exit(4);
    }
}

// ----------------------------------------------------------------------

fn arr(s: &[u8]) -> [u8; 32] {
    let mut a = [0u8; 32];
    a.copy_from_slice(s);
    a
}
fn arr8(s: &[u8]) -> [u8; 8] {
    let mut a = [0u8; 8];
    a.copy_from_slice(s);
    a
}
fn lamports(l: u64) -> String {
    format!("{:.9}", l as f64 / LAMPORTS_PER_SOL as f64)
}
