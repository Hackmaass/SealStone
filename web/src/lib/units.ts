import { MST } from "./mstNetwork";
import { NET } from "./network";

/** The coin's name on screen: ETH on the local test chain, tMSTC (MST's test coin, also 18 decimals) in wallet mode. */
export const UNIT: string = NET === "wallet" ? MST.symbol : "ETH";
