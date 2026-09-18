//! The Solana half of the custody vault, functionally equivalent to
//! `contracts/src/ElysiaPerp.sol`.
//!
//! The Solidity contract is an ESCROW, not a rollup: deposits emit an event the
//! indexer credits, withdrawals are driven by an operator key behind a
//! leaky-bucket cap, and the rest is token config, pause and roles. Everything
//! here is that same shape.
//!
//! # What is deliberately NOT ported
//!
//! * `ReentrancyGuard`. Solana serialises access to an account for the duration
//!   of a transaction and bounds CPI depth, so the EVM reentrancy pattern has no
//!   analogue. A `bool` guard here would be imitation, not defence.
//! * `UUPSUpgradeable`. Programs upgrade natively through the BPF loader's
//!   upgrade authority -- that IS the analogue, and it belongs to a Squads
//!   multisig for the same reason `owner` became a Safe multisig on L1. There is
//!   nothing to express in program code.
//!
//! # Who gets credited
//!
//! `credit_to` is a SOLANA PUBKEY, and the ledger resolves it through the
//! account's linked credentials — the same link a withdrawal destination must
//! already satisfy. A wallet that is not linked to anything gets an account of
//! its own, reachable by logging in with that same wallet.
//!
//! It was a 20-byte EVM address until identity moved off `users.address`. A
//! pubkey is strictly better here: it is something the depositor CONTROLS rather
//! than a string a frontend fills in from a session, and the program already has
//! the depositor as a signer, so the common case needs no argument at all.
//!
//! The warning that remains: `credit_to` still has no refund path. Crediting a
//! key nobody holds puts the funds in an account nobody can open. Pass the
//! connected wallet unless you specifically mean to deposit on someone's
//! behalf.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token_interface::{self, Mint, TokenAccount, TokenInterface, TransferChecked};

declare_id!("6Q6A6yRtTh9EyANQdcFqXUn9zBCgMayyvTojnC2cRFWy");

/// Marks the native-SOL "mint" in [`TokenConfig`] seeds.
///
/// The Solidity contract uses `address(0)` as its native sentinel; the default
/// pubkey is the same idea, and it lets native SOL reuse one code path for
/// support, minimums and withdrawal caps instead of duplicating all three.
pub const NATIVE_MINT_SENTINEL: Pubkey = Pubkey::new_from_array([0u8; 32]);

#[program]
pub mod elysia_perp {
    use super::*;

    /// Create the vault config. Mirrors `initialize(address initialOwner)`,
    /// including its choice to default `withdrawer` to the owner so a fresh
    /// deployment can withdraw before the roles are split.
    ///
    /// Only the program's UPGRADE AUTHORITY may call it. `config` is a PDA with
    /// fixed seeds, so it can be created exactly once, and whoever creates it
    /// becomes owner and withdrawer. Left open, anyone watching for the deploy
    /// could initialize first and own the vault; the deploy and `init` are
    /// separate transactions, so that window always exists. The ProgramData
    /// account is the one on-chain record of who deployed this program, which
    /// makes it the natural gate: nobody else can hold that key, and the
    /// deployer is already trusted with everything the owner can do.
    pub fn initialize(ctx: Context<Initialize>) -> Result<()> {
        // The owner is whoever signed, NOT a free argument. An argument lets a
        // caller install a key that is not their own, so a mistyped one strands
        // the vault under a key nobody holds -- and that key also appoints the
        // withdrawer. `transfer_ownership` exists to move it afterwards, in two
        // steps, which is the safe way to do it.
        let owner = ctx.accounts.payer.key();
        let config = &mut ctx.accounts.config;
        config.owner = owner;
        config.pending_owner = Pubkey::default();
        config.withdrawer = owner;
        config.guardian = Pubkey::default();
        config.paused = false;
        config.bump = ctx.bumps.config;
        emit!(WithdrawerUpdated {
            previous: Pubkey::default(),
            current: owner
        });
        Ok(())
    }

    // ------------------------------------------------------------------
    // Deposits
    // ------------------------------------------------------------------

    /// Move SPL tokens into the vault and credit `credit_to` off-chain.
    ///
    /// `credit_to` is a Solana pubkey — pass the depositor's own key unless
    /// depositing on another wallet's behalf.
    ///
    /// `amount` is what we ASK the token program to move; `received` is what the
    /// vault balance actually grew by, and only `received` is emitted or checked
    /// against the minimum. The Solidity contract measures the same delta for
    /// fee-on-transfer ERC20s, and the concern is sharper here: Token-2022 makes
    /// transfer fees a first-class mint extension rather than an oddity.
    pub fn deposit(
        ctx: Context<Deposit>,
        amount: u64,
        route_type: RouteType,
        credit_to: Pubkey,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, VaultError::Paused);
        require!(
            ctx.accounts.token_config.supported,
            VaultError::UnsupportedToken
        );
        require!(amount > 0, VaultError::ZeroAmount);
        require!(credit_to != Pubkey::default(), VaultError::ZeroAddress);

        let before = ctx.accounts.vault.amount;
        token_interface::transfer_checked(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.depositor_token_account.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.vault.to_account_info(),
                    authority: ctx.accounts.depositor.to_account_info(),
                },
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;
        ctx.accounts.vault.reload()?;
        let received = ctx
            .accounts
            .vault
            .amount
            .checked_sub(before)
            .ok_or(VaultError::ZeroAmount)?;

        require!(received > 0, VaultError::ZeroAmount);
        require!(
            received >= ctx.accounts.token_config.min_deposit,
            VaultError::DepositBelowMinimum
        );

        emit_cpi!(DepositEvent {
            credit_to,
            depositor: ctx.accounts.depositor.key(),
            mint: ctx.accounts.mint.key(),
            amount: received,
            route_type,
        });
        Ok(())
    }

    /// Native-SOL deposit. The lamports land in a PDA that holds nothing else,
    /// so the vault's balance is the deposits plus its rent-exempt minimum --
    /// a floor with no EVM counterpart, and the reason [`withdraw_sol`] refuses
    /// to spend below it.
    pub fn deposit_sol(
        ctx: Context<DepositSol>,
        amount: u64,
        route_type: RouteType,
        credit_to: Pubkey,
    ) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, VaultError::Paused);
        require!(
            ctx.accounts.token_config.supported,
            VaultError::UnsupportedToken
        );
        require!(amount > 0, VaultError::ZeroAmount);
        require!(credit_to != Pubkey::default(), VaultError::ZeroAddress);
        require!(
            amount >= ctx.accounts.token_config.min_deposit,
            VaultError::DepositBelowMinimum
        );

        // System transfer, not a direct lamport assignment: the depositor is a
        // system-owned account and only the system program may debit it.
        invoke(
            &system_instruction::transfer(
                &ctx.accounts.depositor.key(),
                &ctx.accounts.sol_vault.key(),
                amount,
            ),
            &[
                ctx.accounts.depositor.to_account_info(),
                ctx.accounts.sol_vault.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;

        // No fee-on-transfer equivalent for lamports, so `amount` IS `received`.
        emit_cpi!(DepositEvent {
            credit_to,
            depositor: ctx.accounts.depositor.key(),
            mint: NATIVE_MINT_SENTINEL,
            amount,
            route_type,
        });
        Ok(())
    }

    // ------------------------------------------------------------------
    // Withdrawals
    // ------------------------------------------------------------------

    /// Pay SPL tokens out. Restricted to `withdrawer`, never `owner`: the key
    /// that signs withdrawals all day is deliberately not the key that can
    /// upgrade the program or change its config.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64, withdrawal_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.withdrawer.key(),
            config.withdrawer,
            VaultError::NotWithdrawer
        );
        require!(amount > 0, VaultError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        ctx.accounts
            .token_config
            .consume_withdraw_limit(amount, now)?;

        let bump = [config.bump];
        let signer: &[&[&[u8]]] = &[&[CONFIG_SEED, &bump]];
        token_interface::transfer_checked(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                TransferChecked {
                    from: ctx.accounts.vault.to_account_info(),
                    mint: ctx.accounts.mint.to_account_info(),
                    to: ctx.accounts.recipient_token_account.to_account_info(),
                    authority: ctx.accounts.config.to_account_info(),
                },
                signer,
            ),
            amount,
            ctx.accounts.mint.decimals,
        )?;

        emit_cpi!(WithdrawEvent {
            withdrawal_id,
            recipient: ctx.accounts.recipient_token_account.key(),
            mint: ctx.accounts.mint.key(),
            amount,
        });
        Ok(())
    }

    /// Native-SOL withdrawal. Moves lamports by direct assignment rather than a
    /// system transfer, because the source is program-owned; the rent-exempt
    /// floor is enforced explicitly since nothing else would.
    pub fn withdraw_sol(ctx: Context<WithdrawSol>, amount: u64, withdrawal_id: u64) -> Result<()> {
        let config = &ctx.accounts.config;
        require!(!config.paused, VaultError::Paused);
        require_keys_eq!(
            ctx.accounts.withdrawer.key(),
            config.withdrawer,
            VaultError::NotWithdrawer
        );
        require!(amount > 0, VaultError::ZeroAmount);

        let now = Clock::get()?.unix_timestamp;
        ctx.accounts
            .token_config
            .consume_withdraw_limit(amount, now)?;

        let vault = ctx.accounts.sol_vault.to_account_info();
        let rent_floor = Rent::get()?.minimum_balance(vault.data_len());
        let spendable = vault.lamports().saturating_sub(rent_floor);
        require!(amount <= spendable, VaultError::InsufficientVaultBalance);

        **vault.try_borrow_mut_lamports()? -= amount;
        **ctx.accounts.recipient.try_borrow_mut_lamports()? += amount;

        emit_cpi!(WithdrawEvent {
            withdrawal_id,
            recipient: ctx.accounts.recipient.key(),
            mint: NATIVE_MINT_SENTINEL,
            amount,
        });
        Ok(())
    }

    // ------------------------------------------------------------------
    // Token configuration (owner only)
    // ------------------------------------------------------------------

    /// Create or re-enable a token's config, and with it the vault that token
    /// will be paid into. One account carries support, the minimum and the
    /// withdrawal cap -- where the Solidity contract's three parallel
    /// `mapping(address token => ...)` collapse to.
    ///
    /// The vault is created HERE rather than on first deposit. A token account
    /// at a PDA can only be created by this program signing for it, so leaving
    /// it to the depositor would mean either an instruction anyone may call to
    /// conjure vaults, or a first deposit that fails for reasons the depositor
    /// cannot fix.
    pub fn add_token(ctx: Context<AddToken>) -> Result<()> {
        require_mint_is_safe_to_custody(&ctx.accounts.mint.to_account_info())?;
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = ctx.accounts.mint.key();
        token_config.supported = true;
        token_config.bump = ctx.bumps.token_config;
        emit!(TokenAdded {
            mint: token_config.mint
        });
        Ok(())
    }

    /// The native-SOL counterpart of [`add_token`]: the sentinel config plus the
    /// lamport vault.
    ///
    /// The vault must be created and owned by THIS program, not left as an
    /// unopened system-owned address. A program may only debit accounts it owns,
    /// so a system-owned PDA could take deposits and never pay them out.
    pub fn add_native_token(ctx: Context<AddNativeToken>) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = NATIVE_MINT_SENTINEL;
        token_config.supported = true;
        token_config.bump = ctx.bumps.token_config;
        emit!(TokenAdded {
            mint: NATIVE_MINT_SENTINEL
        });
        Ok(())
    }

    /// Stop accepting deposits of a token. Does NOT block withdrawals: funds
    /// already in the vault must still be payable out, exactly as removing a
    /// token on L1 leaves `withdraw` working.
    pub fn remove_token(ctx: Context<MutateTokenConfig>, mint: Pubkey) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = mint;
        token_config.bump = ctx.bumps.token_config;
        token_config.supported = false;
        emit!(TokenRemoved { mint });
        Ok(())
    }

    pub fn set_min_deposit(
        ctx: Context<MutateTokenConfig>,
        mint: Pubkey,
        min_amount: u64,
    ) -> Result<()> {
        let token_config = &mut ctx.accounts.token_config;
        token_config.mint = mint;
        token_config.bump = ctx.bumps.token_config;
        let previous = token_config.min_deposit;
        token_config.min_deposit = min_amount;
        emit!(MinDepositUpdated {
            mint,
            previous,
            current: min_amount
        });
        Ok(())
    }

    /// Configure the rolling-window cap. `cap == 0` removes the limit.
    ///
    /// Reconfiguring CARRIES the usage forward rather than zeroing it. L1 resets
    /// the window here, which means any cap change -- even re-submitting the
    /// same cap -- refills the bucket: drain it, reconfigure, drain it again.
    /// The usage is first settled under the OLD rate as of now, then clamped to
    /// the new cap, so lowering the cap below what was just withdrawn leaves the
    /// bucket empty rather than negative.
    ///
    /// `cap == 0` is the exception, on purpose: it means usage is not managed at
    /// all. Nothing is recorded while it holds, so setting a cap afterwards
    /// starts from an empty bucket.
    pub fn set_withdraw_limit(
        ctx: Context<MutateTokenConfig>,
        mint: Pubkey,
        cap: u64,
        window_seconds: u64,
    ) -> Result<()> {
        require!(
            cap == 0 || window_seconds > 0,
            VaultError::InvalidWithdrawLimit
        );
        let now = Clock::get()?.unix_timestamp;
        let token_config = &mut ctx.accounts.token_config;
        let used = token_config.usage_at(now);
        token_config.mint = mint;
        token_config.bump = ctx.bumps.token_config;
        token_config.cap = cap;
        token_config.window_seconds = window_seconds;
        token_config.window_start = now;
        token_config.withdrawn_in_window = if cap == 0 { 0 } else { used.min(cap) };
        emit!(WithdrawLimitUpdated {
            mint,
            cap,
            window_seconds
        });
        Ok(())
    }

    // ------------------------------------------------------------------
    // Roles and pause
    // ------------------------------------------------------------------

    pub fn set_withdrawer(ctx: Context<OwnerOnly>, new_withdrawer: Pubkey) -> Result<()> {
        require_keys_neq!(new_withdrawer, Pubkey::default(), VaultError::ZeroAddress);
        let config = &mut ctx.accounts.config;
        emit!(WithdrawerUpdated {
            previous: config.withdrawer,
            current: new_withdrawer
        });
        config.withdrawer = new_withdrawer;
        Ok(())
    }

    /// Appoint or clear the guardian. No zero-check: the default pubkey is a
    /// valid "no guardian" state, and clearing it bricks nothing because the
    /// owner can always pause.
    pub fn set_guardian(ctx: Context<OwnerOnly>, new_guardian: Pubkey) -> Result<()> {
        let config = &mut ctx.accounts.config;
        emit!(GuardianUpdated {
            previous: config.guardian,
            current: new_guardian
        });
        config.guardian = new_guardian;
        Ok(())
    }

    /// Pause deposits and withdrawals. Guardian OR owner, for fast incident
    /// response. Unpausing is owner-only, so a compromised guardian can stop the
    /// vault but never restart it.
    pub fn pause(ctx: Context<Pause>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        let signer = ctx.accounts.authority.key();
        require!(
            signer == config.owner
                || (config.guardian != Pubkey::default() && signer == config.guardian),
            VaultError::NotGuardianOrOwner
        );
        config.paused = true;
        emit!(PauseUpdated { paused: true });
        Ok(())
    }

    pub fn unpause(ctx: Context<OwnerOnly>) -> Result<()> {
        ctx.accounts.config.paused = false;
        emit!(PauseUpdated { paused: false });
        Ok(())
    }

    /// Two-step ownership handover (`Ownable2Step`): nominate here, and the
    /// nominee must accept. One step would let a typo strand the vault with an
    /// owner nobody holds the key for -- and here that key is also the one that
    /// appoints the withdrawer.
    pub fn transfer_ownership(ctx: Context<OwnerOnly>, new_owner: Pubkey) -> Result<()> {
        ctx.accounts.config.pending_owner = new_owner;
        emit!(OwnershipTransferStarted {
            current: ctx.accounts.config.owner,
            pending: new_owner
        });
        Ok(())
    }

    pub fn accept_ownership(ctx: Context<AcceptOwnership>) -> Result<()> {
        let config = &mut ctx.accounts.config;
        require_keys_eq!(
            ctx.accounts.new_owner.key(),
            config.pending_owner,
            VaultError::NotPendingOwner
        );
        let previous = config.owner;
        config.owner = config.pending_owner;
        config.pending_owner = Pubkey::default();
        emit!(OwnershipTransferred {
            previous,
            current: config.owner
        });
        Ok(())
    }
}

/// Custody classic SPL Token mints only.
///
/// Token-2022 is refused WHOLESALE, not extension by extension. The narrower gate
/// (refuse `PermanentDelegate`, `TransferHook`, `NonTransferable`,
/// `ConfidentialTransferMint`, `Pausable`; allow `TransferFeeConfig`) is in this
/// file's history if Token-2022 is ever wanted -- but an allow-list has to be
/// right about every extension that exists AND every one added later, and the
/// downside of being wrong is the vault being drained:
///
/// * `PermanentDelegate` names a key that may transfer or burn from ANY account
///   of the mint -- the vault included -- with no signature from `config`. It
///   defeats `withdrawer`, the leaky bucket and `pause` at once. A blacklisting
///   ERC20 can freeze our L1 vault; it cannot drain it.
/// * `TransferHook` needs the hook program and its extra accounts on every
///   transfer, and `transfer_checked` builds a fixed four-account CPI, so deposit
///   AND withdraw fail -- stranding anything already sent.
///
/// Nothing is lost today: the first asset is native SOL and USDC is a classic
/// SPL mint. This check has no L1 counterpart and not because it was forgotten
/// there -- an ERC20's powers are not introspectable, so Solidity CANNOT do it.
fn require_mint_is_safe_to_custody(mint: &AccountInfo) -> Result<()> {
    require!(
        mint.owner == &anchor_spl::token::ID,
        VaultError::UnsafeMintExtension
    );
    Ok(())
}

// ======================================================================
// State
// ======================================================================

pub const CONFIG_SEED: &[u8] = b"config";
pub const TOKEN_CONFIG_SEED: &[u8] = b"token";
pub const VAULT_SEED: &[u8] = b"vault";
pub const SOL_VAULT_SEED: &[u8] = b"sol_vault";

#[account]
#[derive(InitSpace)]
pub struct Config {
    pub owner: Pubkey,
    /// Nominated owner awaiting `accept_ownership`; default = none pending.
    pub pending_owner: Pubkey,
    /// The only key allowed to withdraw.
    pub withdrawer: Pubkey,
    /// May pause but never unpause. Default = unset.
    pub guardian: Pubkey,
    pub paused: bool,
    pub bump: u8,
}

#[account]
#[derive(InitSpace)]
pub struct TokenConfig {
    /// The SPL mint, or [`NATIVE_MINT_SENTINEL`] for native SOL.
    pub mint: Pubkey,
    pub supported: bool,
    /// In the token's own base units. `0` = no floor.
    pub min_deposit: u64,
    /// Leaky-bucket capacity. `0` = unlimited, and usage is not tracked.
    pub cap: u64,
    /// Seconds for a full refill.
    pub window_seconds: u64,
    /// Unix seconds of the last withdrawal.
    pub window_start: i64,
    pub withdrawn_in_window: u64,
    pub bump: u8,
}

impl TokenConfig {
    /// What the bucket holds at `now`: the recorded usage minus what has leaked
    /// back since the last withdrawal. Zero with no cap, since nothing is
    /// tracked then.
    fn usage_at(&self, now: i64) -> u64 {
        if self.cap == 0 {
            return 0;
        }
        // Saturating: a validator clock that steps backwards must not wrap the
        // elapsed time into a huge refill that empties the bucket for free.
        let elapsed = now.saturating_sub(self.window_start).max(0) as u128;
        let refilled = elapsed
            .saturating_mul(self.cap as u128)
            .checked_div(self.window_seconds as u128)
            .unwrap_or(0);
        // Never above `withdrawn_in_window`, so the cast back cannot truncate.
        (self.withdrawn_in_window as u128).saturating_sub(refilled) as u64
    }

    /// Charge `amount` against the leaky bucket, refilling `cap` over
    /// `window_seconds` since the last withdrawal. A direct port of
    /// `_consumeWithdrawLimit`, including its choice to refill continuously
    /// rather than snap to window boundaries.
    fn consume_withdraw_limit(&mut self, amount: u64, now: i64) -> Result<()> {
        if self.cap == 0 {
            return Ok(());
        }
        let used = self.usage_at(now) as u128;

        let new_used = used
            .checked_add(amount as u128)
            .ok_or(VaultError::WithdrawCapExceeded)?;
        require!(
            new_used <= self.cap as u128,
            VaultError::WithdrawCapExceeded
        );

        self.withdrawn_in_window = new_used as u64;
        self.window_start = now;
        Ok(())
    }
}

// ======================================================================
// Accounts
// ======================================================================

#[derive(Accounts)]
pub struct Initialize<'info> {
    #[account(
        init,
        payer = payer,
        space = 8 + Config::INIT_SPACE,
        seeds = [CONFIG_SEED],
        bump
    )]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub payer: Signer<'info>,
    /// THIS program's ProgramData, pinned by address: the loader derives it from
    /// the program id. The type alone only proves it is SOME program's
    /// ProgramData, and one from a program the caller deployed would name the
    /// caller as its upgrade authority.
    #[account(
        seeds = [crate::ID.as_ref()],
        bump,
        seeds::program = anchor_lang::solana_program::bpf_loader_upgradeable::ID,
        constraint = program_data.upgrade_authority_address == Some(payer.key())
            @ VaultError::NotUpgradeAuthority
    )]
    pub program_data: Account<'info, ProgramData>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [TOKEN_CONFIG_SEED, mint.key().as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = config,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub depositor_token_account: InterfaceAccount<'info, TokenAccount>,
    pub depositor: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct DepositSol<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        seeds = [TOKEN_CONFIG_SEED, NATIVE_MINT_SENTINEL.as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    /// CHECK: lamport-only vault PDA; it holds no data and is never deserialised.
    #[account(mut, seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub depositor: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, mint.key().as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        mut,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = config,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut, token::mint = mint)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,
    pub withdrawer: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
}

#[event_cpi]
#[derive(Accounts)]
pub struct WithdrawSol<'info> {
    #[account(seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    #[account(
        mut,
        seeds = [TOKEN_CONFIG_SEED, NATIVE_MINT_SENTINEL.as_ref()],
        bump = token_config.bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    /// CHECK: lamport-only vault PDA; it holds no data and is never deserialised.
    #[account(mut, seeds = [SOL_VAULT_SEED], bump)]
    pub sol_vault: UncheckedAccount<'info>,
    /// CHECK: any address may receive lamports; the withdrawer chooses it, the
    /// same latitude `withdraw(address user, ...)` has on L1.
    #[account(mut)]
    pub recipient: UncheckedAccount<'info>,
    pub withdrawer: Signer<'info>,
}

#[derive(Accounts)]
pub struct AddToken<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = owner @ VaultError::NotOwner
    )]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + TokenConfig::INIT_SPACE,
        seeds = [TOKEN_CONFIG_SEED, mint.key().as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    pub mint: InterfaceAccount<'info, Mint>,
    #[account(
        init_if_needed,
        payer = owner,
        seeds = [VAULT_SEED, mint.key().as_ref()],
        bump,
        token::mint = mint,
        token::authority = config,
        token::token_program = token_program,
    )]
    pub vault: InterfaceAccount<'info, TokenAccount>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub token_program: Interface<'info, TokenInterface>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddNativeToken<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = owner @ VaultError::NotOwner
    )]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + TokenConfig::INIT_SPACE,
        seeds = [TOKEN_CONFIG_SEED, NATIVE_MINT_SENTINEL.as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    /// CHECK: lamport-only vault. Created with zero data and owned by this
    /// program so that `withdraw_sol` is able to debit it at all.
    #[account(
        init_if_needed,
        payer = owner,
        space = 0,
        owner = crate::ID,
        seeds = [SOL_VAULT_SEED],
        bump
    )]
    pub sol_vault: UncheckedAccount<'info>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

/// Owner-only configuration of one token's limits.
///
/// `init_if_needed`, and the mint comes in as an INSTRUCTION ARGUMENT rather than
/// being read back off `token_config.mint`. Two reasons:
///
/// 1. A cap can now be set BEFORE the token is listed. Previously the config had
///    to exist first, which only `add_token` could do -- and that sets
///    `supported = true` immediately, so every listing opened with an unlimited
///    bucket. On L1 the mapping always exists, so `setWithdrawLimit` can precede
///    `addToken`; this restores that ordering. Creating a config here leaves
///    `supported` false, so configuring is not listing.
/// 2. The seed no longer derives from data inside the account being validated.
///    That was sound, but only because of an invariant maintained in a different
///    instruction; naming the mint makes the check local.
#[derive(Accounts)]
#[instruction(mint: Pubkey)]
pub struct MutateTokenConfig<'info> {
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = owner @ VaultError::NotOwner
    )]
    pub config: Account<'info, Config>,
    #[account(
        init_if_needed,
        payer = owner,
        space = 8 + TokenConfig::INIT_SPACE,
        seeds = [TOKEN_CONFIG_SEED, mint.as_ref()],
        bump
    )]
    pub token_config: Account<'info, TokenConfig>,
    #[account(mut)]
    pub owner: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct OwnerOnly<'info> {
    #[account(
        mut,
        seeds = [CONFIG_SEED],
        bump = config.bump,
        has_one = owner @ VaultError::NotOwner
    )]
    pub config: Account<'info, Config>,
    pub owner: Signer<'info>,
}

#[derive(Accounts)]
pub struct Pause<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub authority: Signer<'info>,
}

#[derive(Accounts)]
pub struct AcceptOwnership<'info> {
    #[account(mut, seeds = [CONFIG_SEED], bump = config.bump)]
    pub config: Account<'info, Config>,
    pub new_owner: Signer<'info>,
}

// ======================================================================
// Events
// ======================================================================

/// Deposits and withdrawals go out with `emit_cpi!`, not `emit!`.
///
/// `emit!` writes to the transaction log, and logs are truncated by validators
/// and dropped by RPC providers under load. Our entire deposit accounting is
/// "the indexer saw the event", so a lost Deposit is a user's money not
/// credited. `emit_cpi!` self-invokes the program so the payload lands in
/// INSTRUCTION DATA, which is part of the transaction and always retrievable.
///
/// Admin events below stay on `emit!`: losing one costs an operator a log line,
/// not a user their balance.
#[event]
pub struct DepositEvent {
    /// The Solana pubkey credited in our ledger. Resolved through the account's
    /// linked credentials; an unlinked key gets an account of its own.
    ///
    /// Usually equal to `depositor`. It is a separate field so a deposit can be
    /// made on another wallet's behalf, which is the analogue of the Solidity
    /// contract's `depositTo`.
    pub credit_to: Pubkey,
    /// Who actually paid, kept for support and forensics only.
    pub depositor: Pubkey,
    /// [`NATIVE_MINT_SENTINEL`] for SOL.
    pub mint: Pubkey,
    /// What the vault actually received, after any transfer fee.
    pub amount: u64,
    pub route_type: RouteType,
}

#[event]
pub struct WithdrawEvent {
    /// The submitter's own row id for this payout, echoed back so the ledger and
    /// the chain can be reconciled exactly.
    ///
    /// Without it the two share only `(mint, amount)`, which cannot distinguish
    /// two equal payouts to the same token -- and on L1 there is no equivalent
    /// problem, because `Withdraw(user, ...)` names the payee EOA and the EOA IS
    /// the ledger key. Here `recipient` is a token-account pubkey the ledger
    /// cannot represent.
    ///
    /// The program does not interpret or enforce uniqueness on it: it is an
    /// opaque correlation id. Replay protection is the submitter's job, as it is
    /// on L1.
    pub withdrawal_id: u64,
    pub recipient: Pubkey,
    pub mint: Pubkey,
    pub amount: u64,
}

#[event]
pub struct WithdrawerUpdated {
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct GuardianUpdated {
    pub previous: Pubkey,
    pub current: Pubkey,
}

#[event]
pub struct MinDepositUpdated {
    pub mint: Pubkey,
    pub previous: u64,
    pub current: u64,
}

#[event]
pub struct WithdrawLimitUpdated {
    pub mint: Pubkey,
    pub cap: u64,
    pub window_seconds: u64,
}

#[event]
pub struct TokenAdded {
    pub mint: Pubkey,
}

#[event]
pub struct TokenRemoved {
    pub mint: Pubkey,
}

#[event]
pub struct PauseUpdated {
    pub paused: bool,
}

#[event]
pub struct OwnershipTransferStarted {
    pub current: Pubkey,
    pub pending: Pubkey,
}

#[event]
pub struct OwnershipTransferred {
    pub previous: Pubkey,
    pub current: Pubkey,
}

/// Which book the credited balance lands in, mirroring the Solidity enum's
/// ordering so the two chains' events decode to the same values.
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum RouteType {
    Perp,
    Spot,
}

// ======================================================================
// Errors
// ======================================================================

#[error_code]
pub enum VaultError {
    #[msg("Token is not supported")]
    UnsupportedToken,
    #[msg("Amount must be non-zero")]
    ZeroAmount,
    #[msg("Address must be non-zero")]
    ZeroAddress,
    #[msg("Signer is not the withdrawer")]
    NotWithdrawer,
    #[msg("Signer is not the owner")]
    NotOwner,
    #[msg("Signer is not the pending owner")]
    NotPendingOwner,
    #[msg("Signer is neither guardian nor owner")]
    NotGuardianOrOwner,
    #[msg("Withdrawal exceeds the rolling-window cap")]
    WithdrawCapExceeded,
    #[msg("A non-zero cap requires a non-zero window")]
    InvalidWithdrawLimit,
    #[msg("Deposit is below the token's minimum")]
    DepositBelowMinimum,
    #[msg("Vault cannot pay out below its rent-exempt minimum")]
    InsufficientVaultBalance,
    #[msg("Vault is paused")]
    Paused,
    #[msg("Only classic SPL Token mints can be custodied (Token-2022 is refused)")]
    UnsafeMintExtension,
    // Appended, never inserted: the codes are positional and the server matches
    // on the names in transaction logs.
    #[msg("Signer is not the program's upgrade authority")]
    NotUpgradeAuthority,
}
