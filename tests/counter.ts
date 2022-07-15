import * as anchor from "@project-serum/anchor";
import { AnchorError, Program } from "@project-serum/anchor";
import { program } from "@project-serum/anchor/dist/cjs/spl/token";
import { publicKey } from "@project-serum/anchor/dist/cjs/utils";
import { assert, expect } from "chai";
import { Counter } from "../target/types/counter";
import { Whitelist } from "../target/types/whitelist";

async function airdrop(connection, destinationWallet, amount) {
    const airdropSignature = await connection.requestAirdrop(destinationWallet.publicKey, amount * anchor.web3.LAMPORTS_PER_SOL);
    const latestBlockHash = await connection.getLatestBlockhash();

    await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: airdropSignature,
    });
}


async function createWrongWhitelist(program, seed, authority) {
  let whitelistAccount = anchor.web3.Keypair.generate();

  await program.methods
    .createWhitelist()
    .accounts({
      authority: authority.publicKey,
      whitelistConfig: whitelistAccount.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId,
    })
    .signers([whitelistAccount,authority])
    .rpc();

  return whitelistAccount;
}

async function addToWhitelist(program, addressToAdd, whitelistAddress, whitelistAuthority, whitelistSeed) {
  let [walletPDA, _] = await anchor.web3.PublicKey.findProgramAddress(
    [whitelistAddress.toBuffer(), addressToAdd.toBuffer()],
    program.programId
  );

  await program.methods
    .addWallet(whitelistSeed)
    .accounts({
      whitelistConfig: whitelistAddress,
      walletPda: walletPDA,
      authority: whitelistAuthority.publicKey,
      systemProgram: anchor.web3.SystemProgram.programId
    })
    .signers([whitelistAuthority])
    .rpc();
}

describe("counter", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  
  const counterProgram = anchor.workspace.Counter as Program<Counter>;
  const whitelistProgram = anchor.workspace.Whitelist as Program<Whitelist>;

  
  let authority = anchor.web3.Keypair.generate();

  let counterPDA: anchor.web3.PublicKey;
  let counterBump: number;

  let whitelistAccount = anchor.web3.Keypair.generate();

  let user1 = anchor.web3.Keypair.generate();
  let user1PDA: anchor.web3.PublicKey;
  let user2 = anchor.web3.Keypair.generate();
  let user2PDA: anchor.web3.PublicKey;


  let notUser = anchor.web3.Keypair.generate();
  let notUserPDA: anchor.web3.PublicKey;

  it("creates a counter", async () => {
    await airdrop(provider.connection, authority, 2);

    [counterPDA, counterBump]= await anchor.web3.PublicKey.findProgramAddress(
      [Buffer.from(anchor.utils.bytes.utf8.encode("counter")), authority.publicKey.toBuffer()],
      counterProgram.programId
    );

    await counterProgram.methods
      .createCounter(counterBump)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA, 
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
      
    let counter = await counterProgram.account.counter.fetch(counterPDA);
    console.log("Your counter keypair: ",counterPDA.toString());
    assert.equal(counter.count.toNumber(), 0);
    assert.ok(counter.authority.equals(authority.publicKey));
    assert.ok(counter.whitelist.equals(anchor.web3.PublicKey.default))
    assert.equal(counter.bump, counterBump);
  });

  it("adds an associated whitelist to the counter", async () => {

    await counterProgram.methods
      .createCounterWhitelist()
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        whitelistAccount: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority, whitelistAccount])
      .rpc();

    let counter = await counterProgram.account.counter.fetch(counterPDA);
    let whitelistData = await whitelistProgram.account.whitelistConfig.fetch(whitelistAccount.publicKey);

    assert.ok(counter.whitelist.equals(whitelistAccount.publicKey));
    assert.ok(whitelistData.authority.equals(counterPDA));
    assert.equal(whitelistData.counter.toNumber(), 0);
  });

  it("grants access to authorized users", async () => {
    [user1PDA,] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAccount.publicKey.toBuffer(), user1.publicKey.toBuffer()],
      whitelistProgram.programId
    );

    [user2PDA,] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAccount.publicKey.toBuffer(), user2.publicKey.toBuffer()],
      whitelistProgram.programId
    );

    await counterProgram.methods
      .grantAccess(user1.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user1PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();

    await counterProgram.methods
      .grantAccess(user2.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user2PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
    
    let whitelist = await whitelistProgram.account.whitelistConfig.fetch(whitelistAccount.publicKey);
    assert.equal(whitelist.counter.toNumber(), 2);
  });

  it("updates counter with authorized user1 and user 2", async () => {
    await counterProgram.methods
      .updateCounter()
      .accounts({
        user: user1.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: user1PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([user1])
      .rpc();

    let counter = await counterProgram.account.counter.fetch(counterPDA);
    assert.equal(counter.count.toNumber(), 1);

    await counterProgram.methods
      .updateCounter()
      .accounts({
        user: user2.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: user2PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([user2])
      .rpc();

    counter = await counterProgram.account.counter.fetch(counterPDA);
    assert.equal(counter.count.toNumber(), 2);
  });

  it("fails trying to update counter with unauthorized user", async () => {
    [notUserPDA,] = await anchor.web3.PublicKey.findProgramAddress(
      [whitelistAccount.publicKey.toBuffer(), notUser.publicKey.toBuffer()],
      whitelistProgram.programId
    );

    try {
      await counterProgram.methods
      .updateCounter()
      .accounts({
        user: notUser.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: notUserPDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([notUser])
      .rpc();
    chai.assert(false, "Should fail due to non-whitelisted attempt to update")
    } catch(_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
      expect(err.error.errorCode.number).to.equal(3012);
      expect(err.error.errorMessage).to.equal("The program expected this account to be already initialized");
      expect(err.program.equals(whitelistProgram.programId)).is.true;
    }

    let counter = await counterProgram.account.counter.fetch(counterPDA);
    assert.equal(counter.count.toNumber(), 2);
  });

  it("removes user 2 from counter and then tries to update counter with user(should fail)", async () => {
    await counterProgram.methods
      .retractAccess(user2.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user2PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([authority])
      .rpc();
  
    let whitelist = await whitelistProgram.account.whitelistConfig.fetch(whitelistAccount.publicKey);
    assert.equal(whitelist.counter.toNumber(), 1);

    try {
      await counterProgram.methods
      .updateCounter()
      .accounts({
        user: user2.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: user2PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId
      })
      .signers([user2])
      .rpc();
      chai.assert(false, "should fail because whitelist access retracted");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("AccountNotInitialized");
      expect(err.error.errorCode.number).to.equal(3012);
      expect(err.error.errorMessage).to.equal("The program expected this account to be already initialized");
      expect(err.program.equals(whitelistProgram.programId)).is.true;
    }

    let counter = await counterProgram.account.counter.fetch(counterPDA);
    assert.equal(counter.count.toNumber(), 2);
  });

  it("tries to pass wrong whitelists(should fail)", async () => {
    // try to pass in default pubkey as whitelist address
    
    try {
      await counterProgram.methods
      .grantAccess(user1.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user1PDA,
        whitelist: anchor.web3.PublicKey.default,
        whitelistProgram: whitelistProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "should fail because of wrong whitelist");
    } catch(_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;
    }

    try {
      await counterProgram.methods
      .updateCounter()
      .accounts({
        user: user1.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: user1PDA,
        whitelist: anchor.web3.PublicKey.default,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([user1])
      .rpc();
      chai.assert(false, "should fail because wrong whitelist");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;    
    }

    // Create wrong whitelist
    let wrongWhitelist = await createWrongWhitelist(whitelistProgram, "random", authority);
   
    // try adding user2(not unauthorized) to wrong whitelist to cheat our way into access
    addToWhitelist(whitelistProgram, user2, wrongWhitelist, authority, "random");

    try {
      await counterProgram.methods
      .retractAccess(user1.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user1PDA,
        whitelist: wrongWhitelist.publicKey,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([authority])
      .rpc();
      chai.assert("false, should fail due to wrong whitelist");
    } catch (_err) {
      //console.log(_err);
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;
    }

    try {
      await counterProgram.methods
      .grantAccess(user2.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user2PDA,
        whitelist: wrongWhitelist.publicKey,
        whitelistProgram: whitelistProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "Should fail due to wrong whitelist");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;
    }

    try {
      await counterProgram.methods
      .updateCounter()
      .accounts({
        user: user2.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: user2PDA,
        whitelist: wrongWhitelist.publicKey,
        whitelistProgram: whitelistProgram.programId
      })
      .signers([user2])
      .rpc();
      chai.assert(false, "should fail because wrong whitelist");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;
    } 
  });

  it("tries to pass previously valid whitelist but whitelist set to default", async () => {
    await counterProgram.methods
      .resetWhitelist()
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA
      })
      .signers([authority])
      .rpc();

    let counter = await counterProgram.account.counter.fetch(counterPDA);
    assert.ok(counter.whitelist.equals(anchor.web3.PublicKey.default));

    // tries to pass in our "valid whitelist" which has now been retracted
    try {
      await counterProgram.methods
      .grantAccess(user2.publicKey)
      .accounts({
        authority: authority.publicKey,
        counter: counterPDA,
        walletPda: user2PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .signers([authority])
      .rpc();
      chai.assert(false, "Should fail due to retracted whitelist");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;
    }

    try {
      await counterProgram.methods
      .updateCounter()
      .accounts({
        user: user1.publicKey,
        authority: authority.publicKey,
        counter: counterPDA,
        userWalletPda: user1PDA,
        whitelist: whitelistAccount.publicKey,
        whitelistProgram: whitelistProgram.programId,
      })
      .signers([user1])
      .rpc();
      chai.assert(false, "should fail because retracted whitelist");
    } catch (_err) {
      expect(_err).to.be.instanceOf(AnchorError);
      const err: AnchorError = _err;
      expect(err.error.errorCode.code).to.equal("ConstraintHasOne");
      expect(err.error.errorCode.number).to.equal(2001);
      expect(err.error.errorMessage).to.equal("A has one constraint was violated");
      expect(err.program.equals(counterProgram.programId)).is.true;
    }

    counter = await counterProgram.account.counter.fetch(counterPDA);
    assert.equal(counter.count.toNumber(), 2);
    console.log(`count is still ${counter.count}!`);
    console.log("ending");
    console.log("ending..");
    console.log("ending....");
    console.log("ending......");
    console.log("ending........");
    console.log("ending..........");
  });
});
