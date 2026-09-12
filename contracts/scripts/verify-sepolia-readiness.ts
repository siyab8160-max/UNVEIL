import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const GNOSIS_SAFE_ABI = [
  "function getThreshold() view returns (uint256)",
  "function getOwners() view returns (address[])",
  "function isOwner(address owner) view returns (bool)",
  "function nonce() view returns (uint256)",
];

export interface SepoliaReadinessResult {
  rpcConnected: boolean;
  rpcUrl: string;
  chainId: string | null;
  hasDeployerKey: boolean;
  deployerAddress: string | null;
  deployerBalanceEth: string | null;
  hasSafeAddress: boolean;
  safeAddress: string | null;
  safeContractDeployed: boolean;
  safeThreshold: number | null;
  safeOwnerCount: number | null;
  safeOwners: string[];
  hasEtherscanApiKey: boolean;
  missingRequirements: string[];
  isReadyForDeployment: boolean;
}

export async function checkSepoliaReadiness(): Promise<SepoliaReadinessResult> {
  const result: SepoliaReadinessResult = {
    rpcConnected: false,
    rpcUrl: process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com",
    chainId: null,
    hasDeployerKey: false,
    deployerAddress: null,
    deployerBalanceEth: null,
    hasSafeAddress: false,
    safeAddress: process.env.SAFE_MULTISIG_ADDRESS || null,
    safeContractDeployed: false,
    safeThreshold: null,
    safeOwnerCount: null,
    safeOwners: [],
    hasEtherscanApiKey: Boolean(process.env.ETHERSCAN_API_KEY && process.env.ETHERSCAN_API_KEY.trim().length > 0),
    missingRequirements: [],
    isReadyForDeployment: false,
  };

  // 1. Check RPC Connectivity
  let provider: ethers.JsonRpcProvider | null = null;
  try {
    provider = new ethers.JsonRpcProvider(result.rpcUrl);
    const network = await provider.getNetwork();
    result.chainId = network.chainId.toString();
    result.rpcConnected = true;
  } catch (err: any) {
    result.missingRequirements.push(`Sepolia RPC connection failed: ${err.message}`);
  }

  // 2. Check Deployer Key & Address & Balance
  const privateKey = process.env.SEPOLIA_PRIVATE_KEY?.trim();
  if (privateKey && privateKey !== "" && !privateKey.startsWith("0x0000000000000000000000000000000000000000000000000000000000000000")) {
    try {
      result.hasDeployerKey = true;
      if (provider) {
        const wallet = new ethers.Wallet(privateKey, provider);
        result.deployerAddress = wallet.address;
        const balance = await provider.getBalance(wallet.address);
        result.deployerBalanceEth = ethers.formatEther(balance);
        if (balance === 0n) {
          result.missingRequirements.push(`Deployer account ${wallet.address} has 0.0 ETH balance on Sepolia.`);
        }
      }
    } catch (err: any) {
      result.missingRequirements.push(`Invalid SEPOLIA_PRIVATE_KEY format: ${err.message}`);
    }
  } else {
    result.missingRequirements.push("SEPOLIA_PRIVATE_KEY is not set or contains default template zeroes.");
  }

  // 3. Check Safe Multisig on Sepolia
  const safeAddress = process.env.SAFE_MULTISIG_ADDRESS?.trim();
  if (safeAddress && ethers.isAddress(safeAddress) && safeAddress !== ethers.ZeroAddress) {
    result.hasSafeAddress = true;
    result.safeAddress = safeAddress;
    if (provider) {
      try {
        const code = await provider.getCode(safeAddress);
        if (code === "0x") {
          result.missingRequirements.push(`Safe address ${safeAddress} has no bytecode deployed on Sepolia (EOA or non-existent).`);
        } else {
          result.safeContractDeployed = true;
          const safeContract = new ethers.Contract(safeAddress, GNOSIS_SAFE_ABI, provider);
          const threshold = await safeContract.getThreshold();
          const owners = await safeContract.getOwners();
          result.safeThreshold = Number(threshold);
          result.safeOwnerCount = owners.length;
          result.safeOwners = owners;

          if (result.safeThreshold !== 3) {
            result.missingRequirements.push(`Safe threshold is ${result.safeThreshold}, expected 3.`);
          }
          if (result.safeOwnerCount !== 5) {
            result.missingRequirements.push(`Safe has ${result.safeOwnerCount} owners, expected 5.`);
          }
        }
      } catch (err: any) {
        result.missingRequirements.push(`Failed querying Safe contract at ${safeAddress}: ${err.message}`);
      }
    }
  } else {
    result.missingRequirements.push("SAFE_MULTISIG_ADDRESS is not set or is address(0).");
  }

  // 4. Check Etherscan API Key
  if (!result.hasEtherscanApiKey) {
    result.missingRequirements.push("ETHERSCAN_API_KEY is not set (required for contract source verification).");
  }

  result.isReadyForDeployment = result.missingRequirements.length === 0;
  return result;
}

async function main() {
  console.log("===============================================================");
  console.log("      CertLedger Sepolia Testnet Non-Broadcast Audit           ");
  console.log("===============================================================");

  const audit = await checkSepoliaReadiness();

  console.log(`RPC Connected:         ${audit.rpcConnected ? "✔ YES" : "✖ NO"} (${audit.rpcUrl})`);
  console.log(`Chain ID:              ${audit.chainId || "N/A"} (Target Sepolia: 11155111)`);
  console.log(`Deployer Key Present:  ${audit.hasDeployerKey ? "✔ YES" : "✖ NO"}`);
  console.log(`Deployer Address:      ${audit.deployerAddress || "NOT AVAILABLE"}`);
  console.log(`Deployer ETH Balance:  ${audit.deployerBalanceEth !== null ? audit.deployerBalanceEth + " ETH" : "NOT AVAILABLE"}`);
  console.log(`Safe Address Present:  ${audit.hasSafeAddress ? "✔ YES" : "✖ NO"}`);
  console.log(`Safe Address:          ${audit.safeAddress || "NOT SET"}`);
  console.log(`Safe Bytecode Exists:  ${audit.safeContractDeployed ? "✔ YES" : "✖ NO"}`);
  console.log(`Safe Threshold:        ${audit.safeThreshold !== null ? audit.safeThreshold : "N/A"} (Target: 3)`);
  console.log(`Safe Owners Count:     ${audit.safeOwnerCount !== null ? audit.safeOwnerCount : "N/A"} (Target: 5)`);
  if (audit.safeOwners.length > 0) {
    console.log(`Safe Owners:`);
    audit.safeOwners.forEach((owner, idx) => console.log(`  [${idx + 1}] ${owner}`));
  }
  console.log(`Etherscan Key Present: ${audit.hasEtherscanApiKey ? "✔ YES" : "✖ NO"}`);
  console.log("---------------------------------------------------------------");

  if (audit.isReadyForDeployment) {
    console.log("STATUS: READY FOR USER APPROVAL");
  } else {
    console.log("STATUS: NOT READY — PENDING TESTNET SECRETS / SAFE PROVISIONING");
    console.log("\nPending Requirements:");
    audit.missingRequirements.forEach((req, idx) => console.log(`  ${idx + 1}. ${req}`));
  }
  console.log("===============================================================");
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Audit script failed:", err);
    process.exitCode = 1;
  });
}
