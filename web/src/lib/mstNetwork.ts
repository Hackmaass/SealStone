/**
 * MST testnet, the only public chain Sealstone can talk to. Mainnet (chainId 4646) is deliberately not representable here:
 * nothing in the app can add it, switch to it, or sign for it.
 */
export const MST = {
  chainId: 91562037,
  chainIdHex: "0x5752035",
  name: "MST Testnet",
  rpc: "https://testnetrpc.mstblockchain.com",
  symbol: "tMSTC",
  explorer: "https://testnet.mstscan.com",
  faucet: "https://faucet.mstblockchain.com/",
} as const;

export const explorerAddress = (address: string): string => `${MST.explorer}/address/${address}`;
export const explorerTx = (hash: string): string => `${MST.explorer}/tx/${hash}`;
