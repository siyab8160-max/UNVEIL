import { ethers } from "ethers";
import * as dotenv from "dotenv";

dotenv.config();

const ISSUER_REGISTRY_ADDR = "0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA";
const CERT_REGISTRY_ADDR = "0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b";
const CONSIGNMENT_REGISTRY_ADDR = "0xC1fF045DCB2731AaFee1d398509b022Ed1F51688";

const ISSUER_REGISTRY_ABI = [
  "function MULTISIG_ROLE() view returns (bytes32)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function grantRole(bytes32, address) external",
  "function revokeRole(bytes32, address) external",
  "function registerIssuer(string sourceID, address issuerAddress, string name, string accreditingBody, uint256 accreditationExpiry, string source) external",
  "function isIssuerActive(address) view returns (bool)",
];

const CERT_REGISTRY_ABI = [
  "function issueCertificate(string certificateID, string standardID, address holder, uint256 certifiedQuantityGrams, uint256 validFrom, uint256 validUntil, string source, string sourceID) external",
  "function revokeCertificate(string certificateID, string reason) external",
  "function getCertificateStatus(string certificateID) view returns (uint8)",
  "function getCertificate(string certificateID) view returns (tuple(string certificateID, address issuer, string standardID, address holder, uint256 certifiedQuantityGrams, uint256 remainingQuantityGrams, uint256 validFrom, uint256 validUntil, bool isRevoked, string revocationReason, address revokedBy, string attestedBy, string source, string sourceID))",
  "function ARBITRATION_ROLE() view returns (bytes32)",
  "function hasRole(bytes32, address) view returns (bool)",
];

const CONSIGNMENT_REGISTRY_ABI = [
  "function createRootConsignment(string lotID, string certificateID, uint256 quantityGrams) external",
  "function getLot(string lotID) view returns (tuple(string lotID, string certificateID, uint256 quantityGrams, address currentOwner, uint8 status, uint256 createdAt, string[] parentLotIDs, string[] childLotIDs))",
  "function getLotStatus(string lotID) view returns (uint8)",
];

async function main() {
  console.log("===============================================================");
  console.log("    CertLedger Phase 6 — Controlled Sepolia Revocation Loop    ");
  console.log("===============================================================");

  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const rawPk = process.env.SEPOLIA_PRIVATE_KEY?.trim() || "";
  const pk = rawPk.startsWith("0x") ? rawPk : "0x" + rawPk;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);

  const network = await provider.getNetwork();
  console.log("Network:        Sepolia (Chain ID:", Number(network.chainId), ")");
  console.log("Caller Account: ", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Account Balance:", ethers.formatEther(balance), "ETH");

  const issuerContract = new ethers.Contract(ISSUER_REGISTRY_ADDR, ISSUER_REGISTRY_ABI, wallet);
  const certContract = new ethers.Contract(CERT_REGISTRY_ADDR, CERT_REGISTRY_ABI, wallet);
  const consignmentContract = new ethers.Contract(CONSIGNMENT_REGISTRY_ADDR, CONSIGNMENT_REGISTRY_ABI, wallet);

  // 1. Verify / Enable active issuer role for wallet
  const isCurrentlyActive = await issuerContract.isIssuerActive(wallet.address);
  console.log("\n[1] Issuer Active Status for wallet:", isCurrentlyActive);

  if (!isCurrentlyActive) {
    console.log("Wallet is not yet registered as active issuer. Checking MULTISIG_ROLE...");
    const multisigRole = await issuerContract.MULTISIG_ROLE();
    const hasMultisigRole = await issuerContract.hasRole(multisigRole, wallet.address);

    if (!hasMultisigRole) {
      console.log("Granting MULTISIG_ROLE via DEFAULT_ADMIN_ROLE to register test certifier...");
      const grantTx = await issuerContract.grantRole(multisigRole, wallet.address);
      await grantTx.wait(1);
      console.log("MULTISIG_ROLE granted. Tx:", grantTx.hash);
    }

    const twoYearsFromNow = Math.floor(Date.now() / 1000) + 2 * 365 * 86400;
    console.log("Registering accredited issuer CCOF-SEPOLIA for wallet...");
    const regTx = await issuerContract.registerIssuer(
      "CCOF-SEPOLIA",
      wallet.address,
      "CCOF Certification Services (Sepolia Deployer)",
      "USDA Agricultural Marketing Service (AMS)",
      twoYearsFromNow,
      "USDA Organic INTEGRITY Database"
    );
    await regTx.wait(1);
    console.log("Issuer registered successfully. Tx:", regTx.hash);
  }

  // 2. Setup Primary Demo Certificate (PRESERVED - UNTOUCHED)
  const PRIMARY_CERT_ID = "CERT-SEPOLIA-DEMO-001";
  const PRIMARY_LOT_ID = "LOT-SEPOLIA-DEMO-001";
  const primaryStatus = Number(await certContract.getCertificateStatus(PRIMARY_CERT_ID));

  if (primaryStatus === 0) { // None
    console.log(`\n[2] Issuing PRIMARY demo certificate (${PRIMARY_CERT_ID})...`);
    const now = Math.floor(Date.now() / 1000) - 3600;
    const expiry = now + 365 * 86400;
    const issueTx = await certContract.issueCertificate(
      PRIMARY_CERT_ID,
      "USDA-NOP-ORGANIC",
      wallet.address,
      50000000n, // 50,000 kg in grams
      now,
      expiry,
      "USDA Organic INTEGRITY Database",
      "CCOF-SEPOLIA"
    );
    await issueTx.wait(1);
    console.log(`Primary certificate issued. Tx: ${issueTx.hash}`);

    console.log(`Creating root consignment for primary lot (${PRIMARY_LOT_ID})...`);
    const lotTx = await consignmentContract.createRootConsignment(
      PRIMARY_LOT_ID,
      PRIMARY_CERT_ID,
      25000000n // 25,000 kg in grams
    );
    await lotTx.wait(1);
    console.log(`Primary root lot created. Tx: ${lotTx.hash}`);
  } else {
    console.log(`\n[2] Primary demo certificate (${PRIMARY_CERT_ID}) already exists. Status: ${primaryStatus}`);
  }

  // 3. Setup DISPOSABLE Revocation Certificate specifically for VALID -> REVOKED test
  const DISPOSABLE_CERT_ID = "CERT-DISPOSABLE-REVOKE-001";
  const DISPOSABLE_LOT_ID = "LOT-DISPOSABLE-REVOKE-001";
  const disposableStatus = Number(await certContract.getCertificateStatus(DISPOSABLE_CERT_ID));

  if (disposableStatus === 0) { // None
    console.log(`\n[3] Issuing DISPOSABLE test certificate (${DISPOSABLE_CERT_ID})...`);
    const now = Math.floor(Date.now() / 1000) - 3600;
    const expiry = now + 180 * 86400;
    const issueTx = await certContract.issueCertificate(
      DISPOSABLE_CERT_ID,
      "USDA-NOP-ORGANIC",
      wallet.address,
      10000000n, // 10,000 kg in grams
      now,
      expiry,
      "USDA Organic INTEGRITY Database",
      "CCOF-SEPOLIA"
    );
    await issueTx.wait(1);
    console.log(`Disposable certificate issued. Tx: ${issueTx.hash}`);

    console.log(`Creating root consignment for disposable lot (${DISPOSABLE_LOT_ID})...`);
    const lotTx = await consignmentContract.createRootConsignment(
      DISPOSABLE_LOT_ID,
      DISPOSABLE_CERT_ID,
      5000000n // 5,000 kg in grams
    );
    await lotTx.wait(1);
    console.log(`Disposable root lot created. Tx: ${lotTx.hash}`);
  }

  // 4. Verify initial on-chain status of disposable certificate (MUST BE VALID = 2)
  const preRevokeStatus = Number(await certContract.getCertificateStatus(DISPOSABLE_CERT_ID));
  console.log(`\n[4] PRE-REVOCATION on-chain status for ${DISPOSABLE_CERT_ID}:`, preRevokeStatus, "(2 = VALID)");
  if (preRevokeStatus !== 2) {
    throw new Error(`Expected disposable certificate to be VALID (2), but found ${preRevokeStatus}`);
  }

  // 5. Verify ARBITRATION_ROLE on CertificateRegistry
  const arbitrationRole = await certContract.ARBITRATION_ROLE();
  const isArbitrator = await certContract.hasRole(arbitrationRole, wallet.address);
  console.log(`\n[5] Caller has ARBITRATION_ROLE on CertificateRegistry:`, isArbitrator);
  if (!isArbitrator) {
    throw new Error(`Wallet ${wallet.address} lacks ARBITRATION_ROLE on CertificateRegistry`);
  }

  // 6. Execute On-Chain Revocation via CertificateRegistry.revokeCertificate()
  console.log(`\n[6] Submitting on-chain revocation: CertificateRegistry.revokeCertificate(${DISPOSABLE_CERT_ID})...`);
  const revocationReason = "Severe mass-balance violation confirmed by Phase 6 regulatory arbitration order";
  const revokeTx = await certContract.revokeCertificate(DISPOSABLE_CERT_ID, revocationReason);
  console.log(`Revocation Tx Submitted: ${revokeTx.hash}`);
  console.log("Waiting for block confirmation on Sepolia...");

  const receipt = await revokeTx.wait(1);
  console.log(`\n===============================================================`);
  console.log(`REVOCATION CONFIRMED ON SEPOLIA BLOCKCHAIN!`);
  console.log(`Block Number:     ${receipt.blockNumber}`);
  console.log(`Transaction Hash: ${receipt.hash}`);
  console.log(`Gas Used:         ${receipt.gasUsed.toString()}`);
  console.log(`Explorer Link:    https://sepolia.etherscan.io/tx/${receipt.hash}`);
  console.log(`===============================================================`);

  // 7. Directly verify on-chain status post-mining (MUST BE REVOKED = 4)
  const postRevokeStatus = Number(await certContract.getCertificateStatus(DISPOSABLE_CERT_ID));
  console.log(`\n[7] POST-REVOCATION on-chain status for ${DISPOSABLE_CERT_ID}:`, postRevokeStatus, "(4 = REVOKED)");
  if (postRevokeStatus !== 4) {
    throw new Error(`Expected post-revocation status to be REVOKED (4), but found ${postRevokeStatus}`);
  }

  // 8. Verify PRIMARY demo certificate is completely UNTOUCHED and STILL VALID
  const finalPrimaryStatus = Number(await certContract.getCertificateStatus(PRIMARY_CERT_ID));
  console.log(`\n[8] PRIMARY DEMO CERTIFICATE STATUS (${PRIMARY_CERT_ID}):`, finalPrimaryStatus, "(2 = VALID - UNTOUCHED!)");
  if (finalPrimaryStatus !== 2) {
    throw new Error(`CRITICAL: Primary demo certificate was modified! Status: ${finalPrimaryStatus}`);
  }

  console.log("\n>>> LIVE PROPAGATION DEMONSTRATION SUCCESSFUL! <<<");
  console.log("Disposable Certificate: VALID -> REVOKED on Sepolia.");
  console.log("Primary Certificate:    Untouched, VALID on Sepolia.");
}

main().catch((err) => {
  console.error("\nExecution failed with error:", err);
  process.exit(1);
});
