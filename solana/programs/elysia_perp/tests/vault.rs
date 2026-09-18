//! Behavioural tests against the built program, run on litesvm.
//!
//! litesvm rather than `anchor test`: these are pure Rust with no validator and
//! no node toolchain, which matters in a repo whose CI already builds Rust and
//! nothing else.
//!
//! The cases chosen are the ones where the vault either holds the line or loses
//! money -- key separation, the withdrawal cap, the pause asymmetry, and who a
//! deposit actually credits. Ordinary happy paths are covered incidentally by
//! the setup every test shares.

// `solana_sdk::system_instruction` is deprecated in favour of the standalone
// `solana-system-interface` crate. Kept here rather than pulling a third crate
// into dev-dependencies for two calls in test scaffolding; it moves when the
// pinned solana version does.
#![allow(deprecated)]

use anchor_lang::{AnchorSerialize, InstructionData, ToAccountMetas};
use elysia_perp::{
    RouteType, VaultError, CONFIG_SEED, NATIVE_MINT_SENTINEL, SOL_VAULT_SEED, TOKEN_CONFIG_SEED,
    VAULT_SEED,
};
use litesvm::LiteSVM;
use solana_sdk::{
    account::Account,
    bpf_loader_upgradeable::{self, UpgradeableLoaderState},
    clock::Clock,
    instruction::{Instruction, InstructionError},
    program_pack::Pack,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_instruction,
    transaction::{Transaction, TransactionError},
};

const PROGRAM_ID: Pubkey = elysia_perp::ID;
/// An arbitrary EVM address: the credit target our ledger understands.
/// The wallet a deposit credits. A Solana pubkey since identity moved off
/// `users.address` — resolved through the account's linked credentials, so it is
/// something the depositor controls rather than a string typed into a form.
const ALICE_WALLET: Pubkey = Pubkey::new_from_array([0x11; 32]);
/// The submitter's correlation id, echoed back in `WithdrawEvent`.
const TEST_WITHDRAWAL_ID: u64 = 987_654_321;

// ----------------------------------------------------------------------
// Harness
// ----------------------------------------------------------------------

struct Env {
    svm: LiteSVM,
    owner: Keypair,
    mint: Pubkey,
    /// Mint authority and funder for everything in the test.
    payer: Keypair,
}

fn config_pda() -> Pubkey {
    Pubkey::find_program_address(&[CONFIG_SEED], &PROGRAM_ID).0
}
fn token_config_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[TOKEN_CONFIG_SEED, mint.as_ref()], &PROGRAM_ID).0
}
fn vault_pda(mint: &Pubkey) -> Pubkey {
    Pubkey::find_program_address(&[VAULT_SEED, mint.as_ref()], &PROGRAM_ID).0
}
fn sol_vault_pda() -> Pubkey {
    Pubkey::find_program_address(&[SOL_VAULT_SEED], &PROGRAM_ID).0
}
fn event_authority() -> Pubkey {
    Pubkey::find_program_address(&[b"__event_authority"], &PROGRAM_ID).0
}
fn program_data_address() -> Pubkey {
    Pubkey::find_program_address(&[PROGRAM_ID.as_ref()], &bpf_loader_upgradeable::ID).0
}

/// Install the built program the way `solana program deploy` leaves it: a
/// Program account under the upgradeable loader pointing at a ProgramData
/// account that records `upgrade_authority`.
///
/// `add_program_from_file` uses the non-upgradeable loader, which has no
/// ProgramData at all -- and `initialize` is gated on exactly that account.
fn load_upgradeable_program(svm: &mut LiteSVM, upgrade_authority: &Pubkey) {
    let elf = std::fs::read("../../target/deploy/elysia_perp.so")
        .expect("built .so -- run `anchor build` first");
    let program_data = program_data_address();
    let metadata_len = UpgradeableLoaderState::size_of_programdata_metadata();

    let mut data_account = Account::new_data_with_space(
        svm.minimum_balance_for_rent_exemption(metadata_len + elf.len()),
        &UpgradeableLoaderState::ProgramData {
            slot: 0,
            upgrade_authority_address: Some(*upgrade_authority),
        },
        metadata_len + elf.len(),
        &bpf_loader_upgradeable::ID,
    )
    .unwrap();
    data_account.data[metadata_len..].copy_from_slice(&elf);
    // ProgramData first: loading the Program account reads the ELF out of it.
    svm.set_account(program_data, data_account).unwrap();

    let mut program_account = Account::new_data(
        svm.minimum_balance_for_rent_exemption(UpgradeableLoaderState::size_of_program()),
        &UpgradeableLoaderState::Program {
            programdata_address: program_data,
        },
        &bpf_loader_upgradeable::ID,
    )
    .unwrap();
    program_account.executable = true;
    svm.set_account(PROGRAM_ID, program_account).unwrap();
}

impl Env {
    /// Program loaded, config initialised, one 6-decimal mint supported, and a
    /// funded vault. 6 decimals because that is what USDC uses on both chains,
    /// so the numbers here read the same as the ledger's.
    fn new() -> Self {
        let mut env = Self::deployed();
        let owner = env.owner.insecure_clone();
        env.initialize(&owner).expect("initialize");
        env.mint = env.create_mint(6);
        env.add_token(env.mint);
        env
    }

    /// Program deployed, nothing initialised. `owner` is the upgrade authority,
    /// as the deployer is on a real cluster.
    fn deployed() -> Self {
        let mut svm = LiteSVM::new();
        let payer = Keypair::new();
        let owner = Keypair::new();
        load_upgradeable_program(&mut svm, &owner.pubkey());
        svm.airdrop(&payer.pubkey(), 100_000_000_000).unwrap();
        svm.airdrop(&owner.pubkey(), 100_000_000_000).unwrap();

        Env {
            svm,
            owner,
            mint: Pubkey::default(),
            payer,
        }
    }

    /// Sends, returning the program's own error code on failure.
    ///
    /// The code, not the message: litesvm surfaces `Custom(6003)` and never the
    /// variant name, so asserting on strings would silently pass against the
    /// wrong error. Comparing to [`VaultError`] keeps the assertion honest and
    /// survives anyone reordering the enum.
    fn send(&mut self, ixs: &[Instruction], signers: &[&Keypair]) -> Result<(), VaultFailure> {
        let payer = signers[0].pubkey();
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer),
            signers,
            self.svm.latest_blockhash(),
        );
        let result = self
            .svm
            .send_transaction(tx)
            .map(|_| ())
            .map_err(|e| VaultFailure(e.err));
        // Retrying a refused instruction verbatim -- deposit, get Paused,
        // unpause, deposit again -- produces a byte-identical transaction that
        // the SVM dedups as AlreadyProcessed. Expiring here makes every send its
        // own transaction, so a test asserting "and now it works" is testing the
        // program rather than the cache.
        self.svm.expire_blockhash();
        result
    }

    /// Like [`Self::send`] but hands back the transaction metadata, so a test can
    /// read the emitted events out of the inner instructions.
    fn send_meta(
        &mut self,
        ixs: &[Instruction],
        signers: &[&Keypair],
    ) -> Result<litesvm::types::TransactionMetadata, VaultFailure> {
        let payer = signers[0].pubkey();
        let tx = Transaction::new_signed_with_payer(
            ixs,
            Some(&payer),
            signers,
            self.svm.latest_blockhash(),
        );
        let result = self
            .svm
            .send_transaction(tx)
            .map_err(|e| VaultFailure(e.err));
        self.svm.expire_blockhash();
        result
    }

    fn initialize(&mut self, signer: &Keypair) -> Result<(), VaultFailure> {
        self.initialize_with(signer, program_data_address())
    }

    /// `initialize` naming an arbitrary ProgramData account, for the test that
    /// tries to substitute one.
    fn initialize_with(
        &mut self,
        signer: &Keypair,
        program_data: Pubkey,
    ) -> Result<(), VaultFailure> {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::Initialize {
                config: config_pda(),
                payer: signer.pubkey(),
                program_data,
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::Initialize {}.data(),
        };
        self.send(&[ix], &[signer])
    }

    /// Owner-only token-config mutation. Shared by every limit setter so the
    /// account list lives in one place.
    fn mutate_token_config(&self, mint: Pubkey, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::MutateTokenConfig {
                config: config_pda(),
                token_config: token_config_pda(&mint),
                owner: self.owner.pubkey(),
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data,
        }
    }

    fn create_mint(&mut self, decimals: u8) -> Pubkey {
        let mint = Keypair::new();
        let rent = self
            .svm
            .minimum_balance_for_rent_exemption(spl_token::state::Mint::LEN);
        let ixs = [
            system_instruction::create_account(
                &self.payer.pubkey(),
                &mint.pubkey(),
                rent,
                spl_token::state::Mint::LEN as u64,
                &spl_token::ID,
            ),
            spl_token::instruction::initialize_mint2(
                &spl_token::ID,
                &mint.pubkey(),
                &self.payer.pubkey(),
                None,
                decimals,
            )
            .unwrap(),
        ];
        let payer = self.payer.insecure_clone();
        self.send(&ixs, &[&payer, &mint]).expect("create mint");
        mint.pubkey()
    }

    fn add_token(&mut self, mint: Pubkey) {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::AddToken {
                config: config_pda(),
                token_config: token_config_pda(&mint),
                mint,
                vault: vault_pda(&mint),
                owner: self.owner.pubkey(),
                token_program: spl_token::ID,
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::AddToken {}.data(),
        };
        let owner = self.owner.insecure_clone();
        self.send(&[ix], &[&owner]).expect("add_token");
    }

    /// An ATA holding `amount` more of the test mint.
    ///
    /// Idempotent creation, because several tests top the same holder up twice
    /// and a plain create would fail on the second call for a reason that has
    /// nothing to do with what is being tested.
    fn funded_ata(&mut self, holder: &Pubkey, amount: u64) -> Pubkey {
        let ata = spl_associated_token_account::get_associated_token_address(holder, &self.mint);
        let ixs = [
            spl_associated_token_account::instruction::create_associated_token_account_idempotent(
                &self.payer.pubkey(),
                holder,
                &self.mint,
                &spl_token::ID,
            ),
            spl_token::instruction::mint_to(
                &spl_token::ID,
                &self.mint,
                &ata,
                &self.payer.pubkey(),
                &[],
                amount,
            )
            .unwrap(),
        ];
        let payer = self.payer.insecure_clone();
        self.send(&ixs, &[&payer]).expect("fund ata");
        ata
    }

    fn deposit_ix(&self, depositor: &Pubkey, depositor_ata: &Pubkey, amount: u64) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::Deposit {
                config: config_pda(),
                token_config: token_config_pda(&self.mint),
                mint: self.mint,
                vault: vault_pda(&self.mint),
                depositor_token_account: *depositor_ata,
                depositor: *depositor,
                token_program: spl_token::ID,
                event_authority: event_authority(),
                program: PROGRAM_ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::Deposit {
                amount,
                route_type: RouteType::Perp,
                credit_to: ALICE_WALLET,
            }
            .data(),
        }
    }

    fn withdraw_ix(&self, signer: &Pubkey, recipient_ata: &Pubkey, amount: u64) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::Withdraw {
                config: config_pda(),
                token_config: token_config_pda(&self.mint),
                mint: self.mint,
                vault: vault_pda(&self.mint),
                recipient_token_account: *recipient_ata,
                withdrawer: *signer,
                token_program: spl_token::ID,
                event_authority: event_authority(),
                program: PROGRAM_ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::Withdraw {
                amount,
                withdrawal_id: TEST_WITHDRAWAL_ID,
            }
            .data(),
        }
    }

    fn owner_ix(&self, data: Vec<u8>) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::OwnerOnly {
                config: config_pda(),
                owner: self.owner.pubkey(),
            }
            .to_account_metas(None),
            data,
        }
    }

    fn token_balance(&self, ata: &Pubkey) -> u64 {
        let acc: Account = self.svm.get_account(ata).expect("token account");
        spl_token::state::Account::unpack(&acc.data).unwrap().amount
    }

    fn warp_seconds(&mut self, secs: i64) {
        let mut clock: Clock = self.svm.get_sysvar();
        clock.unix_timestamp += secs;
        self.svm.set_sysvar(&clock);
    }

    /// A Token-2022 mint carrying `extensions`, initialised in the order the
    /// token program requires (extensions first, then the mint).
    fn create_t22_mint(&mut self, extensions: &[T22Ext]) -> Pubkey {
        use spl_token_2022::extension::ExtensionType;
        let mint = Keypair::new();
        let len = ExtensionType::try_calculate_account_len::<spl_token_2022::state::Mint>(
            &extensions.iter().map(|e| e.ty()).collect::<Vec<_>>(),
        )
        .unwrap();
        let rent = self.svm.minimum_balance_for_rent_exemption(len);

        let mut ixs = vec![system_instruction::create_account(
            &self.payer.pubkey(),
            &mint.pubkey(),
            rent,
            len as u64,
            &spl_token_2022::ID,
        )];
        for ext in extensions {
            ixs.push(ext.init_ix(&mint.pubkey(), &self.payer.pubkey()));
        }
        ixs.push(
            spl_token_2022::instruction::initialize_mint2(
                &spl_token_2022::ID,
                &mint.pubkey(),
                &self.payer.pubkey(),
                None,
                6,
            )
            .unwrap(),
        );
        let payer = self.payer.insecure_clone();
        self.send(&ixs, &[&payer, &mint])
            .expect("create token-2022 mint");
        mint.pubkey()
    }

    /// `add_token` for an arbitrary mint under an arbitrary token program.
    fn add_token_result(
        &mut self,
        mint: Pubkey,
        token_program: Pubkey,
    ) -> Result<(), VaultFailure> {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::AddToken {
                config: config_pda(),
                token_config: token_config_pda(&mint),
                mint,
                vault: vault_pda(&mint),
                owner: self.owner.pubkey(),
                token_program,
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::AddToken {}.data(),
        };
        let owner = self.owner.insecure_clone();
        self.send(&[ix], &[&owner])
    }

    // --- native SOL --------------------------------------------------

    fn add_native(&mut self) {
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::AddNativeToken {
                config: config_pda(),
                token_config: token_config_pda(&NATIVE_MINT_SENTINEL),
                sol_vault: sol_vault_pda(),
                owner: self.owner.pubkey(),
                system_program: solana_sdk::system_program::ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::AddNativeToken {}.data(),
        };
        let owner = self.owner.insecure_clone();
        self.send(&[ix], &[&owner]).expect("add_native_token");
    }

    fn deposit_sol_ix(&self, depositor: &Pubkey, amount: u64) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::DepositSol {
                config: config_pda(),
                token_config: token_config_pda(&NATIVE_MINT_SENTINEL),
                sol_vault: sol_vault_pda(),
                depositor: *depositor,
                system_program: solana_sdk::system_program::ID,
                event_authority: event_authority(),
                program: PROGRAM_ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::DepositSol {
                amount,
                route_type: RouteType::Perp,
                credit_to: ALICE_WALLET,
            }
            .data(),
        }
    }

    fn withdraw_sol_ix(&self, signer: &Pubkey, recipient: &Pubkey, amount: u64) -> Instruction {
        Instruction {
            program_id: PROGRAM_ID,
            accounts: elysia_perp::accounts::WithdrawSol {
                config: config_pda(),
                token_config: token_config_pda(&NATIVE_MINT_SENTINEL),
                sol_vault: sol_vault_pda(),
                recipient: *recipient,
                withdrawer: *signer,
                event_authority: event_authority(),
                program: PROGRAM_ID,
            }
            .to_account_metas(None),
            data: elysia_perp::instruction::WithdrawSol {
                amount,
                withdrawal_id: TEST_WITHDRAWAL_ID,
            }
            .data(),
        }
    }

    /// Set the rolling cap on a token config (the SOL sentinel included).
    fn set_cap(&mut self, mint: Pubkey, cap: u64, window_seconds: u64) {
        let ix = self.mutate_token_config(
            mint,
            elysia_perp::instruction::SetWithdrawLimit {
                mint,
                cap,
                window_seconds,
            }
            .data(),
        );
        let owner = self.owner.insecure_clone();
        self.send(&[ix], &[&owner]).expect("set_withdraw_limit");
    }

    /// Load the vault with `amount` so withdrawal tests have something to move.
    fn fund_vault(&mut self, amount: u64) {
        let depositor = Keypair::new();
        self.svm
            .airdrop(&depositor.pubkey(), 10_000_000_000)
            .unwrap();
        let ata = self.funded_ata(&depositor.pubkey(), amount);
        let ix = self.deposit_ix(&depositor.pubkey(), &ata, amount);
        self.send(&[ix], &[&depositor]).expect("seed vault");
    }
}

/// A failed transaction, comparable against the program's error enum.
#[derive(Debug)]
struct VaultFailure(TransactionError);

impl VaultFailure {
    fn code(&self) -> Option<u32> {
        match &self.0 {
            TransactionError::InstructionError(_, InstructionError::Custom(code)) => Some(*code),
            _ => None,
        }
    }
}

/// Asserts a transaction failed with exactly `expected`.
#[track_caller]
fn assert_err(result: Result<(), VaultFailure>, expected: VaultError) {
    let failure = result.expect_err("expected this to be refused");
    let want = expected as u32 + anchor_lang::error::ERROR_CODE_OFFSET;
    assert_eq!(
        failure.code(),
        Some(want),
        "expected {expected:?} ({want}), got {:?}",
        failure.0
    );
}

// ----------------------------------------------------------------------
// Tests
// ----------------------------------------------------------------------

/// A deposit credits an EVM ADDRESS, not the Solana signer that paid.
///
/// This is the whole reason the instruction does not mirror `deposit()`: our
/// ledger keys users by Ethereum address, and the payer's ed25519 key has
/// nowhere to go. The event must carry the address, and the depositor only as
/// forensics.
#[test]
fn a_deposit_credits_the_evm_address_not_the_solana_signer() {
    let mut env = Env::new();
    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata = env.funded_ata(&depositor.pubkey(), 5_000_000);

    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 5_000_000);
    env.send(&[ix], &[&depositor]).expect("deposit");

    assert_eq!(env.token_balance(&vault_pda(&env.mint)), 5_000_000);
    assert_eq!(env.token_balance(&ata), 0);
}

/// The withdrawer may move funds and the OWNER may not.
///
/// The split is the point of the role: the key that signs withdrawals all day
/// must not be the key that can upgrade the program. A version of this contract
/// where `owner` can also withdraw silently undoes that, and nothing else in the
/// test suite would notice.
#[test]
fn the_withdrawer_may_withdraw_and_the_owner_may_not() {
    let mut env = Env::new();
    env.fund_vault(10_000_000);

    // Split the roles: owner appoints a separate withdrawer.
    let withdrawer = Keypair::new();
    env.svm
        .airdrop(&withdrawer.pubkey(), 10_000_000_000)
        .unwrap();
    let ix = env.owner_ix(
        elysia_perp::instruction::SetWithdrawer {
            new_withdrawer: withdrawer.pubkey(),
        }
        .data(),
    );
    let owner = env.owner.insecure_clone();
    env.send(&[ix], &[&owner]).expect("set_withdrawer");

    let recipient = Keypair::new();
    env.svm
        .airdrop(&recipient.pubkey(), 10_000_000_000)
        .unwrap();
    let recipient_ata = env.funded_ata(&recipient.pubkey(), 0);

    // The owner is now NOT the withdrawer, and must be refused.
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1_000_000);
    assert_err(env.send(&[ix], &[&owner]), VaultError::NotWithdrawer);

    // The appointed withdrawer can.
    let ix = env.withdraw_ix(&withdrawer.pubkey(), &recipient_ata, 1_000_000);
    env.send(&[ix], &[&withdrawer])
        .expect("withdrawer withdraws");
    assert_eq!(env.token_balance(&recipient_ata), 1_000_000);
}

/// The rolling cap bounds a drain, and refills over time rather than snapping to
/// a window boundary.
///
/// Both halves matter: a cap that never refills would brick withdrawals after
/// the first busy day, and a cap that refills by resetting on a boundary would
/// let a leaked key take `2 x cap` across one boundary.
#[test]
fn the_rolling_cap_bounds_a_drain_and_refills_over_time() {
    let mut env = Env::new();
    env.fund_vault(100_000_000);

    // 10 tokens per hour.
    env.set_cap(env.mint, 10_000_000, 3600);
    let owner = env.owner.insecure_clone();

    let recipient = Keypair::new();
    env.svm
        .airdrop(&recipient.pubkey(), 10_000_000_000)
        .unwrap();
    let recipient_ata = env.funded_ata(&recipient.pubkey(), 0);

    // Drain the bucket exactly.
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 10_000_000);
    env.send(&[ix], &[&owner])
        .expect("first withdrawal fills the bucket");

    // One more unit is refused.
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);

    // Half a window later, half the bucket is back -- and no more than half.
    env.warp_seconds(1800);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 5_000_000);
    env.send(&[ix], &[&owner]).expect("half refilled");

    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1_000_000);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);

    assert_eq!(env.token_balance(&recipient_ata), 15_000_000);
}

/// The guardian can pause but cannot unpause; the owner can do both.
///
/// The asymmetry is deliberate: a compromised guardian should be able to stop
/// the vault (cheap, reversible) and never to restart it (which would hand an
/// attacker the ability to un-stop an incident response).
#[test]
fn the_guardian_can_pause_but_only_the_owner_can_unpause() {
    let mut env = Env::new();
    let guardian = Keypair::new();
    env.svm.airdrop(&guardian.pubkey(), 10_000_000_000).unwrap();

    let owner = env.owner.insecure_clone();
    let ix = env.owner_ix(
        elysia_perp::instruction::SetGuardian {
            new_guardian: guardian.pubkey(),
        }
        .data(),
    );
    env.send(&[ix], &[&owner]).expect("set_guardian");

    let pause_ix = |signer: &Pubkey| Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::Pause {
            config: config_pda(),
            authority: *signer,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Pause {}.data(),
    };

    // Guardian pauses.
    let ix = pause_ix(&guardian.pubkey());
    env.send(&[ix], &[&guardian]).expect("guardian pauses");

    // Deposits are refused while paused.
    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata = env.funded_ata(&depositor.pubkey(), 1_000_000);
    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 1_000_000);
    assert_err(env.send(&[ix], &[&depositor]), VaultError::Paused);

    // The guardian cannot lift it -- unpause is OwnerOnly, so the guardian fails
    // the `has_one = owner` constraint.
    let unpause_as_guardian = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::OwnerOnly {
            config: config_pda(),
            owner: guardian.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Unpause {}.data(),
    };
    env.send(&[unpause_as_guardian], &[&guardian])
        .expect_err("guardian must not unpause");

    // The owner can.
    let ix = env.owner_ix(elysia_perp::instruction::Unpause {}.data());
    env.send(&[ix], &[&owner]).expect("owner unpauses");
    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 1_000_000);
    env.send(&[ix], &[&depositor]).expect("deposits resume");
}

/// A deposit under the token's minimum is refused.
#[test]
fn a_deposit_below_the_minimum_is_refused() {
    let mut env = Env::new();
    let ix = env.mutate_token_config(
        env.mint,
        elysia_perp::instruction::SetMinDeposit {
            mint: env.mint,
            min_amount: 1_000_000,
        }
        .data(),
    );
    let owner = env.owner.insecure_clone();
    env.send(&[ix], &[&owner]).expect("set_min_deposit");

    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata = env.funded_ata(&depositor.pubkey(), 5_000_000);

    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 999_999);
    assert_err(
        env.send(&[ix], &[&depositor]),
        VaultError::DepositBelowMinimum,
    );

    // Exactly the minimum is fine -- the check is `>=`, as on L1.
    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 1_000_000);
    env.send(&[ix], &[&depositor]).expect("at the minimum");
}

/// Removing a token stops deposits but must NOT strand funds already held.
///
/// Same posture as L1, where `removeToken` leaves `withdraw` working. A vault
/// that could be configured into refusing to give money back would be worse than
/// one that keeps accepting it.
#[test]
fn removing_a_token_stops_deposits_but_not_withdrawals() {
    let mut env = Env::new();
    env.fund_vault(10_000_000);

    let owner = env.owner.insecure_clone();
    let ix = env.mutate_token_config(
        env.mint,
        elysia_perp::instruction::RemoveToken { mint: env.mint }.data(),
    );
    env.send(&[ix], &[&owner]).expect("remove_token");

    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata = env.funded_ata(&depositor.pubkey(), 1_000_000);
    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 1_000_000);
    assert_err(env.send(&[ix], &[&depositor]), VaultError::UnsupportedToken);

    let recipient_ata = env.funded_ata(&depositor.pubkey(), 0);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 10_000_000);
    env.send(&[ix], &[&owner]).expect("withdrawals still work");
}

/// Ownership moves in two steps, and the nominee must accept.
///
/// One-step transfer would let a typo strand the vault under a key nobody holds
/// -- and that key is also the one that appoints the withdrawer, so the funds go
/// with it.
#[test]
fn ownership_transfers_only_when_the_nominee_accepts() {
    let mut env = Env::new();
    let new_owner = Keypair::new();
    env.svm
        .airdrop(&new_owner.pubkey(), 10_000_000_000)
        .unwrap();
    let owner = env.owner.insecure_clone();

    let ix = env.owner_ix(
        elysia_perp::instruction::TransferOwnership {
            new_owner: new_owner.pubkey(),
        }
        .data(),
    );
    env.send(&[ix], &[&owner]).expect("nominate");

    // Still the old owner until acceptance: the nominee cannot yet act.
    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::OwnerOnly {
            config: config_pda(),
            owner: new_owner.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::SetGuardian {
            new_guardian: new_owner.pubkey(),
        }
        .data(),
    };
    env.send(&[ix], &[&new_owner])
        .expect_err("nominee cannot act before accepting");

    let accept = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::AcceptOwnership {
            config: config_pda(),
            new_owner: new_owner.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::AcceptOwnership {}.data(),
    };
    env.send(&[accept], &[&new_owner]).expect("accept");

    // And now the OLD owner cannot.
    let ix = env.owner_ix(elysia_perp::instruction::Unpause {}.data());
    env.send(&[ix], &[&owner])
        .expect_err("old owner is no longer owner");
}

/// Native SOL round-trips, and the vault refuses to spend below its
/// rent-exempt floor -- a constraint with no EVM counterpart, and the one that
/// would otherwise let a withdrawal delete the vault account mid-operation.
#[test]
fn native_sol_round_trips_and_keeps_its_rent_floor() {
    let mut env = Env::new();
    let owner = env.owner.insecure_clone();

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::AddNativeToken {
            config: config_pda(),
            token_config: token_config_pda(&NATIVE_MINT_SENTINEL),
            sol_vault: sol_vault_pda(),
            owner: owner.pubkey(),
            system_program: solana_sdk::system_program::ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::AddNativeToken {}.data(),
    };
    env.send(&[ix], &[&owner]).expect("add_native_token");

    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let deposit = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::DepositSol {
            config: config_pda(),
            token_config: token_config_pda(&NATIVE_MINT_SENTINEL),
            sol_vault: sol_vault_pda(),
            depositor: depositor.pubkey(),
            system_program: solana_sdk::system_program::ID,
            event_authority: event_authority(),
            program: PROGRAM_ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::DepositSol {
            amount: 1_000_000_000,
            route_type: RouteType::Perp,
            credit_to: ALICE_WALLET,
        }
        .data(),
    };
    env.send(&[deposit], &[&depositor]).expect("deposit_sol");

    let recipient = Keypair::new();
    let withdraw_sol = |amount: u64| Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::WithdrawSol {
            config: config_pda(),
            token_config: token_config_pda(&NATIVE_MINT_SENTINEL),
            sol_vault: sol_vault_pda(),
            recipient: recipient.pubkey(),
            withdrawer: owner.pubkey(),
            event_authority: event_authority(),
            program: PROGRAM_ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::WithdrawSol {
            amount,
            withdrawal_id: TEST_WITHDRAWAL_ID,
        }
        .data(),
    };

    // The whole vault balance includes the rent floor, so asking for all of it
    // must be refused rather than deleting the account.
    let whole = env.svm.get_account(&sol_vault_pda()).unwrap().lamports;
    assert_err(
        env.send(&[withdraw_sol(whole)], &[&owner]),
        VaultError::InsufficientVaultBalance,
    );

    env.send(&[withdraw_sol(1_000_000_000)], &[&owner])
        .expect("deposited amount comes back");
    assert_eq!(
        env.svm.get_account(&recipient.pubkey()).unwrap().lamports,
        1_000_000_000
    );
}

/// The `RouteType` discriminants match the Solidity enum's ordering.
///
/// Both chains' deposit events feed the same indexer, so a divergence here would
/// silently route perp deposits into spot balances. Cheap to assert, invisible
/// if it ever broke.
#[test]
fn route_type_discriminants_match_the_solidity_enum() {
    let mut perp = Vec::new();
    let mut spot = Vec::new();
    RouteType::Perp.serialize(&mut perp).unwrap();
    RouteType::Spot.serialize(&mut spot).unwrap();
    assert_eq!(perp, vec![0], "PERP is 0 in ElysiaPerp.sol");
    assert_eq!(spot, vec![1], "SPOT is 1 in ElysiaPerp.sol");
}

// ----------------------------------------------------------------------
// Native SOL
//
// SOL is the first asset this vault will take, so its path gets the same
// scrutiny the SPL path does rather than riding on the round-trip test alone.
// ----------------------------------------------------------------------

/// The rolling cap binds native SOL exactly as it binds SPL.
///
/// Worth its own test because `withdraw_sol` is a separate handler with its own
/// call to `consume_withdraw_limit`; the SPL cap test says nothing about it, and
/// SOL is what launches first.
#[test]
fn the_rolling_cap_binds_native_sol_too() {
    let mut env = Env::new();
    env.add_native();

    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 100_000_000_000)
        .unwrap();
    env.send(
        &[env.deposit_sol_ix(&depositor.pubkey(), 50_000_000_000)],
        &[&depositor],
    )
    .expect("deposit_sol");

    // 10 SOL per hour.
    env.set_cap(NATIVE_MINT_SENTINEL, 10_000_000_000, 3600);

    let owner = env.owner.insecure_clone();
    let recipient = Keypair::new();
    env.svm.airdrop(&recipient.pubkey(), 1_000_000_000).unwrap();

    env.send(
        &[env.withdraw_sol_ix(&owner.pubkey(), &recipient.pubkey(), 10_000_000_000)],
        &[&owner],
    )
    .expect("fills the bucket");
    assert_err(
        env.send(
            &[env.withdraw_sol_ix(&owner.pubkey(), &recipient.pubkey(), 1)],
            &[&owner],
        ),
        VaultError::WithdrawCapExceeded,
    );

    // Half a window later, half the bucket is back and no more.
    env.warp_seconds(1800);
    env.send(
        &[env.withdraw_sol_ix(&owner.pubkey(), &recipient.pubkey(), 5_000_000_000)],
        &[&owner],
    )
    .expect("half refilled");
    assert_err(
        env.send(
            &[env.withdraw_sol_ix(&owner.pubkey(), &recipient.pubkey(), 1_000_000_000)],
            &[&owner],
        ),
        VaultError::WithdrawCapExceeded,
    );
}

/// Pause stops native SOL in BOTH directions.
///
/// `deposit_sol` and `withdraw_sol` each carry their own `paused` check; a pause
/// that only bit the SPL path would be a silent hole on the asset we launch with.
#[test]
fn pause_stops_native_sol_in_both_directions() {
    let mut env = Env::new();
    env.add_native();

    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 100_000_000_000)
        .unwrap();
    env.send(
        &[env.deposit_sol_ix(&depositor.pubkey(), 10_000_000_000)],
        &[&depositor],
    )
    .expect("deposit before pause");

    let owner = env.owner.insecure_clone();
    let pause = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::Pause {
            config: config_pda(),
            authority: owner.pubkey(),
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Pause {}.data(),
    };
    env.send(&[pause], &[&owner]).expect("pause");

    assert_err(
        env.send(
            &[env.deposit_sol_ix(&depositor.pubkey(), 1_000_000_000)],
            &[&depositor],
        ),
        VaultError::Paused,
    );
    let recipient = Keypair::new();
    env.svm.airdrop(&recipient.pubkey(), 1_000_000_000).unwrap();
    assert_err(
        env.send(
            &[env.withdraw_sol_ix(&owner.pubkey(), &recipient.pubkey(), 1_000_000_000)],
            &[&owner],
        ),
        VaultError::Paused,
    );
}

/// A SOL withdrawal to a brand-new address must leave that address able to exist.
///
/// Direct lamport assignment does not go through the system program, so nothing
/// checks that the recipient ends up rent-exempt. A payout too small to cover
/// rent on a fresh 0-data account is the first thing a SOL-denominated user
/// hits, and this pins whatever the runtime actually does with it rather than
/// leaving it to be discovered in production.
#[test]
fn a_small_sol_withdrawal_to_a_fresh_address_behaves_predictably() {
    let mut env = Env::new();
    env.add_native();

    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 100_000_000_000)
        .unwrap();
    env.send(
        &[env.deposit_sol_ix(&depositor.pubkey(), 10_000_000_000)],
        &[&depositor],
    )
    .expect("deposit_sol");

    let owner = env.owner.insecure_clone();
    let fresh = Keypair::new();
    let rent_floor = env.svm.minimum_balance_for_rent_exemption(0);
    let dust = rent_floor / 2;

    let result = env.send(
        &[env.withdraw_sol_ix(&owner.pubkey(), &fresh.pubkey(), dust)],
        &[&owner],
    );
    match result {
        Ok(()) => {
            // Accepted: the account exists and holds the dust. Recorded so a
            // future runtime change that starts reaping it is caught here.
            let acc = env
                .svm
                .get_account(&fresh.pubkey())
                .expect("recipient exists");
            assert_eq!(acc.lamports, dust);
        }
        Err(e) => panic!(
            "a sub-rent SOL payout to a fresh address was REFUSED ({:?}). \
             The withdrawal submitter must top up to {} lamports or batch.",
            e.0, rent_floor
        ),
    }
}

// ----------------------------------------------------------------------
// Token-2022 extension gating
// ----------------------------------------------------------------------

/// Which Token-2022 extensions the tests build mints with.
enum T22Ext {
    PermanentDelegate,
    TransferFee,
}

impl T22Ext {
    fn ty(&self) -> spl_token_2022::extension::ExtensionType {
        use spl_token_2022::extension::ExtensionType;
        match self {
            T22Ext::PermanentDelegate => ExtensionType::PermanentDelegate,
            T22Ext::TransferFee => ExtensionType::TransferFeeConfig,
        }
    }

    fn init_ix(&self, mint: &Pubkey, authority: &Pubkey) -> Instruction {
        match self {
            T22Ext::PermanentDelegate => {
                spl_token_2022::instruction::initialize_permanent_delegate(
                    &spl_token_2022::ID,
                    mint,
                    authority,
                )
                .unwrap()
            }
            T22Ext::TransferFee => {
                spl_token_2022::extension::transfer_fee::instruction::initialize_transfer_fee_config(
                    &spl_token_2022::ID,
                    mint,
                    Some(authority),
                    Some(authority),
                    100, // 1%
                    u64::MAX,
                )
                .unwrap()
            }
        }
    }
}

/// The extension that motivated the policy: a `PermanentDelegate` mint.
///
/// The extension names a key that may move tokens out of ANY account of the
/// mint, the vault included, with no signature from `config` -- bypassing the
/// withdrawer, the cap and the pause together. Nothing downstream can defend
/// against it, so the only place to stop it is here.
#[test]
fn a_permanent_delegate_mint_cannot_be_listed() {
    let mut env = Env::new();
    let hostile = env.create_t22_mint(&[T22Ext::PermanentDelegate]);
    assert_err(
        env.add_token_result(hostile, spl_token_2022::ID),
        VaultError::UnsafeMintExtension,
    );
}

/// Token-2022 is refused WHOLESALE, including benign mints.
///
/// A transfer-fee mint is not dangerous -- the deposit path measures the received
/// delta precisely so it would be credited correctly. It is refused anyway,
/// because the policy is "classic SPL only" rather than an allow-list that has to
/// stay right about every extension that exists and every one added later.
///
/// This test is the one that would catch the policy being quietly loosened.
#[test]
fn even_a_benign_token_2022_mint_is_refused() {
    let mut env = Env::new();
    let fee_mint = env.create_t22_mint(&[T22Ext::TransferFee]);
    assert_err(
        env.add_token_result(fee_mint, spl_token_2022::ID),
        VaultError::UnsafeMintExtension,
    );
}

/// A withdrawal cap can be set BEFORE the token is listed.
///
/// Previously impossible: the config had to exist, and only `add_token` could
/// create it -- and that lists the token in the same instruction, so every
/// listing opened with an unlimited bucket. Matters most for the first asset,
/// which for this vault is SOL.
#[test]
fn a_cap_can_be_set_before_the_token_is_listed() {
    let mut env = Env::new();
    let mint = env.create_mint(6);

    // No add_token yet.
    env.set_cap(mint, 1_000_000, 3600);

    // Configuring is not listing: deposits are still refused.
    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata =
        spl_associated_token_account::get_associated_token_address(&depositor.pubkey(), &mint);
    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: elysia_perp::accounts::Deposit {
            config: config_pda(),
            token_config: token_config_pda(&mint),
            mint,
            vault: vault_pda(&mint),
            depositor_token_account: ata,
            depositor: depositor.pubkey(),
            token_program: spl_token::ID,
            event_authority: event_authority(),
            program: PROGRAM_ID,
        }
        .to_account_metas(None),
        data: elysia_perp::instruction::Deposit {
            amount: 1,
            route_type: RouteType::Perp,
            credit_to: ALICE_WALLET,
        }
        .data(),
    };
    // Refused -- and note WHERE: the vault account for this mint does not exist
    // yet, so Anchor's account validation rejects it (AccountNotInitialized)
    // before the `supported` flag is ever read. Listing is what creates the
    // vault, so an unlisted token has nowhere for a deposit to land. Defence in
    // depth, one layer earlier than the flag.
    let failure = env
        .send(&[ix], &[&depositor])
        .expect_err("configuring a token must not make it depositable");
    assert_eq!(failure.code(), Some(3012), "expected AccountNotInitialized");

    // And listing afterwards does NOT reset the cap that was set first.
    env.add_token(mint);
    let acc = env.svm.get_account(&token_config_pda(&mint)).unwrap();
    // cap sits after: discriminator(8) + mint(32) + supported(1) + min_deposit(8)
    let cap = u64::from_le_bytes(acc.data[49..57].try_into().unwrap());
    assert_eq!(cap, 1_000_000, "listing must not clear a pre-set cap");
}

/// `initialize` makes the SIGNER the owner; there is no owner argument to get
/// wrong. A mistyped one would have stranded the vault under a key nobody holds
/// -- and that key also appoints the withdrawer.
#[test]
fn initialize_makes_the_signer_the_owner() {
    let env = Env::new();
    let acc = env.svm.get_account(&config_pda()).unwrap();
    let owner = Pubkey::try_from(&acc.data[8..40]).unwrap();
    assert_eq!(owner, env.owner.pubkey());
}

/// Between the deploy and `init` the config does not exist, and whoever creates
/// it owns the vault. Only the upgrade authority -- the deployer -- may.
#[test]
fn only_the_upgrade_authority_can_initialize() {
    let mut env = Env::deployed();
    let squatter = Keypair::new();
    env.svm.airdrop(&squatter.pubkey(), 10_000_000_000).unwrap();

    assert_err(env.initialize(&squatter), VaultError::NotUpgradeAuthority);
    assert!(
        env.svm.get_account(&config_pda()).is_none(),
        "a refused initialize must leave no config behind"
    );

    let owner = env.owner.insecure_clone();
    env.initialize(&owner)
        .expect("the upgrade authority initializes");
}

/// The gate reads the ProgramData account the caller passes, so it must be THIS
/// program's. A squatter who deploys their own program is its upgrade authority,
/// and that ProgramData account is a genuine loader account -- just not ours.
#[test]
fn another_programs_program_data_cannot_stand_in() {
    let mut env = Env::deployed();
    let squatter = Keypair::new();
    env.svm.airdrop(&squatter.pubkey(), 10_000_000_000).unwrap();

    // A ProgramData account naming the squatter, at an address that is not ours.
    let forged = Pubkey::new_unique();
    let metadata_len = UpgradeableLoaderState::size_of_programdata_metadata();
    let account = Account::new_data_with_space(
        env.svm.minimum_balance_for_rent_exemption(metadata_len),
        &UpgradeableLoaderState::ProgramData {
            slot: 0,
            upgrade_authority_address: Some(squatter.pubkey()),
        },
        metadata_len,
        &bpf_loader_upgradeable::ID,
    )
    .unwrap();
    env.svm.set_account(forged, account).unwrap();

    // Refused on the address, before the authority is ever read.
    let failure = env
        .initialize_with(&squatter, forged)
        .expect_err("another program's ProgramData must not stand in");
    assert_eq!(
        failure.code(),
        Some(anchor_lang::error::ErrorCode::ConstraintSeeds as u32),
        "expected ConstraintSeeds, got {:?}",
        failure.0
    );
    assert!(env.svm.get_account(&config_pda()).is_none());
}

/// Changing the cap must not refill the bucket. If it did, an owner key -- or
/// anyone holding it -- could drain a full cap, re-submit the same cap, and
/// drain again, as many times as it likes inside one window.
#[test]
fn reconfiguring_the_cap_does_not_refill_the_bucket() {
    let mut env = Env::new();
    env.fund_vault(100_000_000);
    env.set_cap(env.mint, 10_000_000, 3600);
    let owner = env.owner.insecure_clone();

    let recipient = Keypair::new();
    let recipient_ata = env.funded_ata(&recipient.pubkey(), 0);

    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 10_000_000);
    env.send(&[ix], &[&owner]).expect("drain the bucket");

    // Same cap again: still empty.
    env.set_cap(env.mint, 10_000_000, 3600);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);

    // Raising the cap frees only the difference.
    env.set_cap(env.mint, 12_000_000, 3600);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 2_000_000);
    env.send(&[ix], &[&owner]).expect("the raise is available");
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);

    // Lowering it below the usage leaves the bucket empty, not negative, and it
    // refills at the NEW rate: 6 tokens/hour, so 30 minutes returns 3.
    env.set_cap(env.mint, 6_000_000, 3600);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);
    env.warp_seconds(1800);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 3_000_000);
    env.send(&[ix], &[&owner])
        .expect("half the new cap refilled");
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);

    assert_eq!(env.token_balance(&recipient_ata), 15_000_000);
}

/// Usage that has already leaked back is not carried into a new cap: settling
/// happens at the OLD rate before the new one applies.
#[test]
fn reconfiguring_the_cap_keeps_what_has_already_refilled() {
    let mut env = Env::new();
    env.fund_vault(100_000_000);
    env.set_cap(env.mint, 10_000_000, 3600);
    let owner = env.owner.insecure_clone();

    let recipient = Keypair::new();
    let recipient_ata = env.funded_ata(&recipient.pubkey(), 0);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 10_000_000);
    env.send(&[ix], &[&owner]).expect("drain the bucket");

    // Half refilled at 10/hour, then the window doubles: 5 used remains, and the
    // 5 that came back must still be withdrawable.
    env.warp_seconds(1800);
    env.set_cap(env.mint, 10_000_000, 7200);
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 5_000_000);
    env.send(&[ix], &[&owner])
        .expect("the refilled half survives");
    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1);
    assert_err(env.send(&[ix], &[&owner]), VaultError::WithdrawCapExceeded);
}

// ----------------------------------------------------------------------
// Event wire format
//
// These events ARE the program's contract with the off-chain indexer, which
// credits real balances from them. Nothing else in this file reads the bytes, so
// without these a field reorder or a type change ships green and is discovered
// as mis-credited deposits.
// ----------------------------------------------------------------------

/// Pull every `T` out of a transaction's `emit_cpi!` self-invocations.
///
/// `emit_cpi!` encodes each event as an inner instruction whose data is
/// `[EVENT_IX_TAG_LE][event discriminator][borsh payload]` -- which is the whole
/// point of using it over `emit!`: it lands in instruction data rather than in
/// logs that validators truncate and RPC providers drop. Decoding it exactly the
/// way an indexer must is the only way to know the layout is what we think.
fn events_of<T: anchor_lang::Discriminator + anchor_lang::AnchorDeserialize>(
    meta: &litesvm::types::TransactionMetadata,
) -> Vec<T> {
    let mut found = Vec::new();
    for inner in &meta.inner_instructions {
        for ix in inner {
            let data = &ix.instruction.data;
            if data.len() < 16 || &data[..8] != anchor_lang::event::EVENT_IX_TAG_LE {
                continue;
            }
            if &data[8..16] != T::DISCRIMINATOR {
                continue;
            }
            found.push(T::deserialize(&mut &data[16..]).expect("event payload decodes"));
        }
    }
    found
}

/// A deposit's event carries the EVM credit target, the RECEIVED amount and the
/// route -- decoded off the wire, not read back off a struct we built.
#[test]
fn the_deposit_event_decodes_to_what_the_indexer_needs() {
    let mut env = Env::new();
    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata = env.funded_ata(&depositor.pubkey(), 5_000_000);

    let ix = env.deposit_ix(&depositor.pubkey(), &ata, 5_000_000);
    let meta = env.send_meta(&[ix], &[&depositor]).expect("deposit");

    let events: Vec<elysia_perp::DepositEvent> = events_of(&meta);
    assert_eq!(events.len(), 1, "exactly one DepositEvent per deposit");
    let e = &events[0];
    assert_eq!(
        e.credit_to, ALICE_WALLET,
        "credits the EVM address, not the signer"
    );
    assert_eq!(e.depositor, depositor.pubkey());
    assert_eq!(e.mint, env.mint);
    assert_eq!(e.amount, 5_000_000);
    assert_eq!(e.route_type, RouteType::Perp);
}

/// A native-SOL deposit decodes the same way, with the sentinel mint.
#[test]
fn the_sol_deposit_event_decodes_with_the_native_sentinel() {
    let mut env = Env::new();
    env.add_native();
    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 100_000_000_000)
        .unwrap();

    let ix = env.deposit_sol_ix(&depositor.pubkey(), 2_000_000_000);
    let meta = env.send_meta(&[ix], &[&depositor]).expect("deposit_sol");

    let events: Vec<elysia_perp::DepositEvent> = events_of(&meta);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].mint, NATIVE_MINT_SENTINEL);
    assert_eq!(events[0].amount, 2_000_000_000);
    assert_eq!(events[0].credit_to, ALICE_WALLET);
}

/// A withdrawal's event echoes the submitter's correlation id.
///
/// Without it the ledger row and the chain event share only `(mint, amount)`,
/// which cannot tell two equal payouts apart -- and L1 has no such gap, because
/// `Withdraw(user, ...)` names the payee EOA and that IS the ledger key.
#[test]
fn the_withdraw_event_carries_the_correlation_id() {
    let mut env = Env::new();
    env.fund_vault(10_000_000);
    let owner = env.owner.insecure_clone();
    let recipient = Keypair::new();
    env.svm
        .airdrop(&recipient.pubkey(), 10_000_000_000)
        .unwrap();
    let recipient_ata = env.funded_ata(&recipient.pubkey(), 0);

    let ix = env.withdraw_ix(&owner.pubkey(), &recipient_ata, 1_000_000);
    let meta = env.send_meta(&[ix], &[&owner]).expect("withdraw");

    let events: Vec<elysia_perp::WithdrawEvent> = events_of(&meta);
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].withdrawal_id, TEST_WITHDRAWAL_ID);
    assert_eq!(events[0].amount, 1_000_000);
    assert_eq!(events[0].mint, env.mint);
    assert_eq!(events[0].recipient, recipient_ata);
}

/// Two deposits in ONE transaction emit TWO distinct events.
///
/// This is the case that decides the indexer's dedup key. A key of
/// `(signature, mint, amount)` collapses these into one and under-credits; the
/// key has to reach the per-instruction index. Pinned here so the watcher is
/// written against a demonstrated fact rather than an assumption.
#[test]
fn two_deposits_in_one_transaction_emit_two_events() {
    let mut env = Env::new();
    let depositor = Keypair::new();
    env.svm
        .airdrop(&depositor.pubkey(), 10_000_000_000)
        .unwrap();
    let ata = env.funded_ata(&depositor.pubkey(), 5_000_000);

    let a = env.deposit_ix(&depositor.pubkey(), &ata, 1_000_000);
    let b = env.deposit_ix(&depositor.pubkey(), &ata, 2_000_000);
    let meta = env.send_meta(&[a, b], &[&depositor]).expect("two deposits");

    let events: Vec<elysia_perp::DepositEvent> = events_of(&meta);
    assert_eq!(events.len(), 2, "one event per deposit instruction");
    assert_eq!(events[0].amount, 1_000_000);
    assert_eq!(events[1].amount, 2_000_000);
}
