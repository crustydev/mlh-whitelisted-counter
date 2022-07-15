import * as anchor from "@project-serum/anchor";
import { AnchorError, Program } from "@project-serum/anchor";
import { assert, expect } from "chai";
import chai from "chai";
import { Whitelist } from "../target/types/whitelist";


async function airdropSol(connection, destinationWallet, amount) {
    const airdropSignature = await connection.requestAirdrop(destinationWallet.publicKey, 
      amount * anchor.web3.LAMPORTS_PER_SOL);
    
    const latestBlockHash = await connection.getLatestBlockhash();

    const tx = await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSignature
    });
}

describe("whitelist", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Whitelist as Program<Whitelist>;
  const authority = anchor.web3.Keypair.generate();
  const seed = "bzQgtUIrfkl";

  let whitelistAddress = anchor.web3.Keypair.generate();

  let whitelistWallets: Array<anchor.web3.Keypair> = [];
  for(let i = 0; i < 5; ++i) {
    let address = anchor.web3.Keypair.generate();
    whitelistWallets.push(address);
  }


  it("Creates a whitelist", async () => {

    // Airdrop sol to authority to pay for transactions
    await airdropSol(provider.connection, authority, 2);
    console.log("Airdrop to authority complete!");

    await program.methods
      .createWhitelist()
      .accounts({
        authority: authority.publicKey,
        whitelistConfig: whitelistAddress.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([whitelistAddress, authority])
      .rpc();

    console.log("\nStarted new whitelist!");

    let config = await program.account.whitelistConfig.fetch(whitelistAddress.publicKey);

    assert.ok(config.authority.equals(authority.publicKey));
    assert.equal(config.counter.toNumber(), 0);
  });


  it("Adds wallets to whitelist", async () => {

    for(let i = 0; i < whitelistWallets.length; ++i) {
      let wallet = whitelistWallets[i];
      let [walletPDA, _] = await anchor.web3.PublicKey.findProgramAddress(
        [whitelistAddress.publicKey.toBuffer(), wallet.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .addWallet(wallet.publicKey)
        .accounts({
          whitelistConfig: whitelistAddress.publicKey,
          walletPda: walletPDA,
          authority: authority.publicKey,
          feePayer: authority.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId
        })
        .signers([authority])
        .rpc();
    }

    let config = await program.account.whitelistConfig.fetch(whitelistAddress.publicKey);
    assert.equal(config.counter.toNumber(), 5);

    // Tests adding a wallet that has already been added
    let duplicateWallet = whitelistWallets[2];
    let [duplicateWalletPDA, _] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAddress.publicKey.toBuffer(), duplicateWallet.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
      .addWallet(duplicateWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        walletPda: duplicateWalletPDA,
        authority: authority.publicKey,
        feePayer: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId 
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "Should fail due to PDA already being initialized");
    } catch(_err) {
      assert.equal(_err.message, "failed to send transaction: Transaction simulation failed: Error processing Instruction 0: custom program error: 0x0");
    }

    assert.equal(config.counter.toNumber(), 5);
  });


  it("Checks if wallets are whitelisted", async () => {
    // Tests checking a valid whitelisted wallet
    let whitelistedWallet = whitelistWallets[0];
    let [whitelistedWalletPDA, bump] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAddress.publicKey.toBuffer(), whitelistedWallet.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .checkWallet(whitelistedWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        authority: authority.publicKey,
        walletPda: whitelistedWalletPDA,
      })
      .signers([])
      .rpc();
    chai.assert(true);

    // Tests checking a non-whitelisted wallet
    let nonWhitelistedWallet = anchor.web3.Keypair.generate();
    let [nonWhitelistedWalletPDA, _] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAddress.publicKey.toBuffer(), nonWhitelistedWallet.publicKey.toBuffer()],
      program.programId
    ); 

    try {
      await program.methods
      .checkWallet(nonWhitelistedWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        authority: authority.publicKey,
        walletPda: nonWhitelistedWalletPDA,
      })
      .signers([])
      .rpc();
    chai.assert(false, "Should fail due to wallet not being whitelisted");
    } catch(_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
      expect(err.error.errorCode.number).to.equal(3012);
      expect(err.error.errorMessage).to.equal("The program expected this account to be already initialized");
      expect(err.program.equals(program.programId)).is.true;
    }


    // Tests passing a wallet in the instruction that doesn't match the wallet seed for the PDA in accounts
    let randomWallet = anchor.web3.Keypair.generate();
    try {
      await program.methods
      .checkWallet(randomWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        authority: authority.publicKey,
        walletPda: nonWhitelistedWalletPDA,
      })
      .signers([])
      .rpc();
    chai.assert(false, "Should fail due to wallet not being whitelisted");
    } catch(_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
      expect(err.error.errorCode.number).to.equal(3012);
      expect(err.error.errorMessage).to.equal("The program expected this account to be already initialized");
      expect(err.program.equals(program.programId)).is.true;
    }
  });

  it("Removes wallets from whitelist", async () => {
    // Tests deleting whitelisted wallets.
    // Deletes 2nd, 3rd and 4th entries of whitelist addresses from whitelist
    for(let i = 1; i < 4; ++i) {
      let walletToRemove = whitelistWallets[i];

      let [removeWalletPDA,] = await anchor.web3.PublicKey.findProgramAddress(
        [whitelistAddress.publicKey.toBuffer(), walletToRemove.publicKey.toBuffer()],
        program.programId
      );
  
      await program.methods
        .removeWallet(walletToRemove.publicKey)
        .accounts({
          whitelistConfig: whitelistAddress.publicKey,
          walletPda: removeWalletPDA,
          authority: authority.publicKey,
          refundWallet: authority.publicKey,
        })
        .signers([authority])
        .rpc();
    }

    // Checks that 2nd, 3rd and 4th wallets were actually removed
    for(let i = 1; i < 4; ++ i) {

      try {
        let wallet = whitelistWallets[i];

        let [walletPDA, bump] = await anchor.web3.PublicKey.findProgramAddress(
          [whitelistAddress.publicKey.toBuffer(), wallet.publicKey.toBuffer()],
          program.programId
        );
  
        await program.methods
        .checkWallet(wallet.publicKey)
        .accounts({
          whitelistConfig: whitelistAddress.publicKey,
          authority: authority.publicKey,
          walletPda: walletPDA,
        })
        .signers([])
        .rpc();
        chai.assert(false);
      } catch(_err) {
        expect(_err).to.be.instanceOf(AnchorError);
        const err: AnchorError = _err;
        expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
        expect(err.error.errorCode.number).to.equal(3012);
        expect(err.error.errorMessage).to.equal("The program expected this account to be already initialized");
        expect(err.program.equals(program.programId)).is.true;
      }
    }

    let config = await program.account.whitelistConfig.fetch(whitelistAddress.publicKey); 
    assert.equal(config.counter.toNumber(), 2);

    
    // Tests deleting an already deleted wallet
    let removedWallet = whitelistWallets[2];
    let [removedWalletPDA, ] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAddress.publicKey.toBuffer(), removedWallet.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
      .removeWallet(removedWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        walletPda: removedWalletPDA,
        authority: authority.publicKey,
        refundWallet: authority.publicKey
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "Should fail. Can't remove a non-whitelisted wallet");
    } catch(_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
      expect(err.error.errorCode.number).to.equal(3012);
      expect(err.program.equals(program.programId)).is.true;
    }
    assert.equal(config.counter.toNumber(), 2);

    // Tests deleting a wallet that never was whitelisted
    let neverWhitelisted = anchor.web3.Keypair.generate();
    let [neverWhitelistedPDA, ] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAddress.publicKey.toBuffer(), neverWhitelisted.publicKey.toBuffer()],
      program.programId
    );

    try {
      await program.methods
      .removeWallet(neverWhitelisted.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        walletPda: neverWhitelistedPDA,
        authority: authority.publicKey,
        refundWallet: authority.publicKey,
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "Should fail. Can't remove a non-whitelisted wallet");
    } catch(_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
      expect(err.error.errorCode.number).to.equal(3012);
      expect(err.program.equals(program.programId)).is.true;
    }
    assert.equal(config.counter.toNumber(), 2);
  });

  // Tests changing the whitelist's authority
  it("Sets a new whitelist authority", async () => {
    let newAuthority = anchor.web3.Keypair.generate();
    await airdropSol(provider.connection, newAuthority, 2);

    await program.methods
      .setAuthority(newAuthority.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        currentAuthority: authority.publicKey
      })
      .signers([authority])
      .rpc();

    let config = await program.account.whitelistConfig.fetch(whitelistAddress.publicKey);
    assert.ok(config.authority.equals(newAuthority.publicKey));

    let newWallet = anchor.web3.Keypair.generate();
    let [newWalletPDA, _] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAddress.publicKey.toBuffer(), newWallet.publicKey.toBuffer()],
      program.programId
    );

    // Try adding wallet using new authority, should pass
    await program.methods
      .addWallet(newWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        walletPda: newWalletPDA,
        authority: newAuthority.publicKey,
        feePayer: newAuthority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([newAuthority])
      .rpc();

    // Confirm that the previous transaction was successful, should pass
    await program.methods
      .checkWallet(newWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        authority: newAuthority.publicKey,
        walletPda: newWalletPDA,
      })
      .signers([])
      .rpc();

    try {
      await program.methods
      .addWallet(newWallet.publicKey)
      .accounts({
        whitelistConfig: whitelistAddress.publicKey,
        walletPda: newWalletPDA,
        authority: authority.publicKey,
        feePayer: authority.publicKey,
        systemProgram: anchor.web3.SystemProgram.programId
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "Should fail, wrong authority")
    } catch(_err) {
      
    }

  });
});
