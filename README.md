## Description
Demonstrates the use of a whitelisting contract that other applications can use to restrict wallet access. This example sets up a simple counter application and adds wallet-whitelisting capabilities to it.


## Requirements
- [Rust](https://www.rust-lang.org/tools/install)
- [Solana](https://docs.solana.com/cli/install-solana-cli-tools)
- [Yarn](https://yarnpkg.com/getting-started/install)
- [Anchor](https://book.anchor-lang.com/getting_started/installation.html)

View the full steps [here.](https://book.anchor-lang.com/getting_started/installation.html)

## Build and Testing
Deploy the contract to the devnet by following these steps on your cli:

#### Generate wallet
- Run ` solana-keygen new ` to create a wallet keypair
- Run ` solana airdrop 2 ` to airdrop sol to your wallet
#### Build
- Clone the repo and change into its root directory
- Run ` anchor build ` to generate a new public key for your program
- Run ` anchor keys list ` .Copy the new pubkeys into your declare_id!
macro at the top of their respective `lib.rs` files and replace the 
default keys in `Anchor.toml`
- Change the `provider.cluster` variable in `Anchor.toml` to `devnet`
#### Deploy and test
- Run ` anchor deploy `
- Run ` anchor run test `









