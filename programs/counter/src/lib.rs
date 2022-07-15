use anchor_lang::prelude::*;
//use whitelist::{self, WhitelistConfig, Wallet};
use whitelist::{self};
use whitelist::cpi::accounts::{
    CreateWhitelist,
    CheckWallet,
    AddWallet,
    RemoveWallet,
    SetAuthority,
};
use whitelist::program::Whitelist;

declare_id!("Bt86r9ytWScWYfVd6sNefoVcow1TRw3ncvYPQ93BZgWP");

const DISCRIMINATOR_LENGTH: usize = 8;
const PUBKEY_LENGTH: usize = 32;
const UNSIGNED64_LENGTH: usize = 8;
const UNSIGNED8_LENGTH: usize = 8;


#[program]
pub mod counter {
    use super::*;

    pub fn create_counter(ctx: Context<CreateCounter>, bump: u8) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.authority = ctx.accounts.authority.key();
        counter.count = 0;
        counter.whitelist = Pubkey::default();
        counter.bump = bump;
        Ok(())
    }

    pub fn create_counter_whitelist(ctx: Context<CreateCounterWhitelist>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;

        require_keys_eq!(counter.whitelist, Pubkey::default(),
            CounterError::AssociatedWhitelistAlreadyExists);

        counter.whitelist = ctx.accounts.whitelist_account.key();

        let create_cpi_ctx = ctx.accounts.into_create_whitelist_context();
        _ = whitelist::cpi::create_whitelist(create_cpi_ctx);

        
        let set_authority_ctx = ctx.accounts.into_set_authority_context();
        _ = whitelist::cpi::set_authority(set_authority_ctx, 
            ctx.accounts.counter.key());

        Ok(())
    }

    #[access_control(whitelist_initialized(&ctx.accounts.counter))]
    pub fn reset_whitelist(ctx: Context<ResetWhitelist>) -> Result<()> {
        let counter = &mut ctx.accounts.counter;
        counter.whitelist = Pubkey::default();
        Ok(())
    }

    #[access_control(whitelist_initialized(&ctx.accounts.counter))]
    pub fn update_counter(ctx: Context<UpdateCounter>) -> Result<()> {
        let present_count = ctx.accounts.counter.count;
        let user = &ctx.accounts.user;
        let authority_key = ctx.accounts.authority.key();
        let bump = *ctx.bumps.get("counter").unwrap();

        let counter_seeds = &["counter".as_bytes().as_ref(), authority_key.as_ref(), &[bump]];
        let signer = &[&counter_seeds[..]];
        let cpi_ctx = ctx.accounts.into_check_wallet_context()
            .with_signer(signer);

        match whitelist::cpi::check_wallet(cpi_ctx, user.key()) {
            Ok(()) => {
                ctx.accounts.counter.count = present_count.checked_add(1).unwrap();
                Ok(())
            },
            Err(_) => Err(CounterError::UserIsNotWhitelisted.into()),
        }
    }

    #[access_control(whitelist_initialized(&ctx.accounts.counter))]
    pub fn grant_access(ctx: Context<GrantAccess>, wallet_address: Pubkey) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let bump = *ctx.bumps.get("counter").unwrap();

        let counter_seeds = &["counter".as_bytes().as_ref(), authority_key.as_ref(), &[bump]];
        let signer = &[&counter_seeds[..]];

        let cpi_ctx = ctx.accounts.into_add_wallet_context().with_signer(signer);

        _ = whitelist::cpi::add_wallet(cpi_ctx, wallet_address);
        Ok(())
    }

    #[access_control(whitelist_initialized(&ctx.accounts.counter))]
    pub fn retract_access(ctx: Context<RetractAccess>, wallet_address: Pubkey) -> Result<()> {
        let authority_key = ctx.accounts.authority.key();
        let bump = *ctx.bumps.get("counter").unwrap();

        let counter_seeds = &["counter".as_bytes().as_ref(), authority_key.as_ref(), &[bump]];
        let signer = &[&counter_seeds[..]];

        let cpi_ctx = ctx.accounts.into_remove_wallet_context()
            .with_signer(signer);

        _ = whitelist::cpi::remove_wallet(cpi_ctx, wallet_address);
        Ok(())
    }
}


#[derive(Accounts)]
pub struct CreateCounter<'info> {
    #[account(mut)]
    authority: Signer<'info>,
    #[account(
        init,
        seeds = ["counter".as_bytes().as_ref(), authority.key().as_ref()],
        bump,
        payer = authority, 
        space = Counter::LEN,

    )]
    counter: Account<'info, Counter>,
    system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateCounterWhitelist<'info> {
    #[account(mut)]
    authority: Signer<'info>,
    #[account(
        mut,
        seeds = ["counter".as_bytes().as_ref(), authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    counter: Account<'info, Counter>,
    #[account(mut, signer)]
    /// CHECK: Checks are done by the whitelist program via CPI
    whitelist_account: AccountInfo<'info>,
    whitelist_program: Program<'info, Whitelist>,
    system_program: Program<'info, System>,
}

impl <'info> CreateCounterWhitelist <'info> {
    pub fn into_create_whitelist_context(&self) -> CpiContext<'_, '_, '_, 'info, CreateWhitelist<'info>> {
        let whitelist_program = self.whitelist_program.to_account_info();

        let create_whitelist_accounts = CreateWhitelist {
            authority: self.authority.to_account_info(),
            whitelist_config: self.whitelist_account.to_account_info(),
            system_program: self.system_program.to_account_info(),
        };
    
        CpiContext::new(whitelist_program, create_whitelist_accounts)
    }

    pub fn into_set_authority_context(&self) -> CpiContext<'_, '_, '_, 'info, SetAuthority<'info>> {
        let whitelist_program = self.whitelist_program.to_account_info();

        let set_authority_accounts = SetAuthority {
            whitelist_config: self.whitelist_account.to_account_info(),
            current_authority: self.authority.to_account_info(),
        };

        CpiContext::new(whitelist_program, set_authority_accounts)
    }
}

#[derive(Accounts)]
//#[instruction(wallet_address: Pubkey)]
pub struct GrantAccess<'info> {
    #[account(mut)]
    authority: Signer<'info>,
    #[account(
        seeds = ["counter".as_bytes().as_ref(), authority.key().as_ref()],
        bump,
        has_one = authority,
        has_one = whitelist,
    )]
    counter: Account<'info, Counter>,
    #[account(mut)]
    /// CHECK: todo
    wallet_pda: AccountInfo<'info>,
    #[account(mut)]
    /// CHECK: todo
    whitelist: AccountInfo<'info>,
    whitelist_program: Program<'info, Whitelist>,
    system_program: Program<'info, System>,
}

impl <'info> GrantAccess <'info> {
    pub fn into_add_wallet_context(&self) -> CpiContext<'_, '_, '_, 'info, AddWallet<'info>> {
        let whitelist_program = self.whitelist_program.to_account_info();
        let add_wallet_accounts = AddWallet {
            fee_payer: self.authority.to_account_info(),
            whitelist_config: self.whitelist.to_account_info(),
            wallet_pda: self.wallet_pda.to_account_info(),
            authority: self.counter.to_account_info(),
            system_program: self.system_program.to_account_info(),
        };
        CpiContext::new(whitelist_program, add_wallet_accounts)
    }
}

#[derive(Accounts)]
pub struct RetractAccess<'info> {
    #[account(mut)]
    authority: Signer<'info>,
    #[account(
        seeds = ["counter".as_bytes().as_ref(), authority.key().as_ref()],
        bump,
        has_one = authority,
        has_one = whitelist,
        constraint = counter.whitelist != Pubkey::default()
    )]
    counter: Account<'info, Counter>,
    #[account(mut)]
    /// CHECK: todo
    wallet_pda: AccountInfo<'info>,
    /// CHECK: todo
    #[account(mut)]
    whitelist: AccountInfo<'info>,
    whitelist_program: Program<'info, Whitelist>,
}

impl <'info> RetractAccess<'info> {
    pub fn into_remove_wallet_context(&self) -> CpiContext<'_, '_, '_,  'info, RemoveWallet<'info>> {
        let whitelist_program = self.whitelist_program.to_account_info();
        let remove_wallet_accounts = RemoveWallet {
            whitelist_config: self.whitelist.to_account_info(),
            wallet_pda: self.wallet_pda.to_account_info(),
            authority: self.counter.to_account_info(),
            refund_wallet: self.authority.to_account_info(),
        };
        CpiContext::new(whitelist_program, remove_wallet_accounts)
    }
}


#[derive(Accounts)]
pub struct ResetWhitelist<'info> {
    authority: Signer<'info>,
    #[account(
        mut,
        seeds = ["counter".as_bytes().as_ref(), authority.key().as_ref()],
        bump,
        has_one = authority,
    )]
    counter: Account<'info, Counter>,
}

#[derive(Accounts)]
pub struct UpdateCounter<'info> {
    user: Signer<'info>,
    /// CHECK: We validate this account by comparing it to counter.authority
    #[account(constraint = authority.key() == counter.authority)]
    authority: AccountInfo<'info>,
    #[account(
        mut,
        seeds = ["counter".as_bytes().as_ref(), authority.key().as_ref()],
        bump,
        has_one = authority,
        has_one = whitelist,
        constraint = counter.whitelist != Pubkey::default()
    )]
    counter: Account<'info, Counter>,
    /// CHECK: todo
    user_wallet_pda: AccountInfo<'info>,
    /// CHECK: todo
    whitelist: AccountInfo<'info>,
    whitelist_program: Program<'info, Whitelist>,
}

impl<'info> UpdateCounter <'info> {
    pub fn into_check_wallet_context(&self) -> CpiContext<'_, '_, '_, 'info, CheckWallet<'info>> {
        let whitelist_program = self.whitelist_program.to_account_info();
        let check_wallet_accounts = CheckWallet {
            whitelist_config: self.whitelist.to_account_info(),
            authority: self.counter.to_account_info(),
            wallet_pda: self.user_wallet_pda.to_account_info(),
        };
        CpiContext::new(whitelist_program, check_wallet_accounts)
    }
}

#[account]
pub struct Counter {
    authority: Pubkey,
    whitelist: Pubkey,
    count: u64,
    bump: u8
}

impl Counter {
    const LEN: usize = DISCRIMINATOR_LENGTH + (PUBKEY_LENGTH) * 2 + UNSIGNED64_LENGTH + UNSIGNED8_LENGTH;
}


#[error_code]
pub enum CounterError {
    AssociatedWhitelistAlreadyExists,
    WhitelistNotInitialized,
    UserIsNotWhitelisted,
}

// Checks that whitelist is not set to default pubkey
fn whitelist_initialized(counter: &Counter) -> Result<()> {
    require_keys_neq!(counter.whitelist, Pubkey::default(),
        CounterError::WhitelistNotInitialized);
    Ok(())
}
