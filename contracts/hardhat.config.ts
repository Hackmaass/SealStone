import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import path from "node:path";

// The repo-root .env holds MST_RPC / DEPLOYER_KEY (gitignored). Optional: local commands never need it.
try {
  process.loadEnvFile(path.join(__dirname, "..", ".env"));
} catch {
  /* no .env yet */
}

// MST testnet (chainId 91562037, token tMSTC). Registered only when a deployer key is set, so `hardhat test`,
// `hardhat node` and the local demo are identical with or without it. The TEAM runs `--network mst`; mainnet (4646) is not configured.
const MST_RPC = process.env.MST_RPC ?? "https://testnetrpc.mstblockchain.com";
const mstAccounts = process.env.DEPLOYER_KEY ? [process.env.DEPLOYER_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      evmVersion: "cancun",
    },
  },
  networks: {
    localhost: { url: "http://127.0.0.1:8545" },
    ...(mstAccounts.length ? { mst: { url: MST_RPC, chainId: 91562037, accounts: mstAccounts } } : {}),
  },
  mocha: { timeout: 120000 },
};

export default config;
