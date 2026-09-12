import { ethers } from "ethers";
import * as dotenv from "dotenv";
import prisma from "../../indexer/src/db";
import { createApp } from "../../indexer/src/server";

dotenv.config();

const ISSUER_REGISTRY_ADDR = "0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA";
const CERT_REGISTRY_ADDR = "0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b";
const CONSIGNMENT_REGISTRY_ADDR = "0xC1fF045DCB2731AaFee1d398509b022Ed1F51688";

const ISSUER_REGISTRY_ABI = [
  "function isIssuerActive(address) view returns (bool)",
  "function registerIssuer(string sourceID, address issuerAddress, string name, string accreditingBody, uint256 accreditationExpiry, string source) external",
  "function MULTISIG_ROLE() view returns (bytes32)",
  "function hasRole(bytes32, address) view returns (bool)",
  "function grantRole(bytes32, address) external",
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

const STATUS_NAMES: Record<number, string> = {
  0: "NONE",
  1: "NOT_YET_ACTIVE",
  2: "VALID",
  3: "EXPIRED",
  4: "REVOKED",
};

async function main() {
  console.log("=========================================================================");
  console.log("   UNVEIL Phase 6 — Demonstration: UI-to-UI Revocation Workflow Flow     ");
  console.log("=========================================================================");

  const rpcUrl = process.env.SEPOLIA_RPC_URL || "https://ethereum-sepolia-rpc.publicnode.com";
  const rawPk = process.env.SEPOLIA_PRIVATE_KEY?.trim() || "";
  const pk = rawPk.startsWith("0x") ? rawPk : "0x" + rawPk;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const wallet = new ethers.Wallet(pk, provider);
  const network = await provider.getNetwork();

  console.log("Network:        Sepolia (Chain ID:", Number(network.chainId), ")");
  console.log("Wallet:         ", wallet.address);

  const balance = await provider.getBalance(wallet.address);
  console.log("Balance:        ", ethers.formatEther(balance), "ETH");

  const certContract = new ethers.Contract(CERT_REGISTRY_ADDR, CERT_REGISTRY_ABI, wallet);
  const consignmentContract = new ethers.Contract(CONSIGNMENT_REGISTRY_ADDR, CONSIGNMENT_REGISTRY_ABI, wallet);

  // -------------------------------------------------------------------------
  // 1. Verify Primary Demo Certificate Remains Untouched & VALID
  // -------------------------------------------------------------------------
  const PRIMARY_CERT = "CERT-SEPOLIA-DEMO-001";
  const PRIMARY_LOT = "LOT-SEPOLIA-DEMO-001";
  const primaryStatus = Number(await certContract.getCertificateStatus(PRIMARY_CERT));
  console.log(`\n[STEP 1] Checking Primary Demo Certificate (${PRIMARY_CERT}):`);
  console.log(`         Status: ${primaryStatus} (${STATUS_NAMES[primaryStatus] || "UNKNOWN"})`);
  if (primaryStatus !== 2) {
    throw new Error(`CRITICAL: Primary demo certificate ${PRIMARY_CERT} is not VALID! Aborting.`);
  }
  console.log("         Confirmed: Primary demo certificate remains untouched and VALID.");

  // -------------------------------------------------------------------------
  // 2. Provision Fresh Disposable Certificate & Lot on Sepolia
  // -------------------------------------------------------------------------
  const DISPOSABLE_CERT = "CERT-UI-REVOKE-DEMO-003";
  const DISPOSABLE_LOT = "LOT-UI-REVOKE-DEMO-003";
  let dispStatus = Number(await certContract.getCertificateStatus(DISPOSABLE_CERT));
  console.log(`\n[STEP 2] Inspecting Disposable Certificate (${DISPOSABLE_CERT}):`);
  console.log(`         Status on chain: ${dispStatus} (${STATUS_NAMES[dispStatus] || "NONE"})`);

  if (dispStatus === 0) {
    console.log(`         Issuing fresh disposable certificate on Sepolia...`);
    const now = Math.floor(Date.now() / 1000) - 3600;
    const expiry = now + 180 * 86400; // 180 days
    const issueTx = await certContract.issueCertificate(
      DISPOSABLE_CERT,
      "USDA-NOP-ORGANIC",
      wallet.address,
      25000000n, // 25,000 kg
      now,
      expiry,
      "USDA Organic INTEGRITY Database",
      "CCOF"
    );
    console.log(`         Issuance tx sent: ${issueTx.hash}. Awaiting block confirmation...`);
    await issueTx.wait(1);
    console.log(`         Certificate issued on Sepolia.`);

    console.log(`         Creating root lot ${DISPOSABLE_LOT} (10,000 kg)...`);
    const lotTx = await consignmentContract.createRootConsignment(
      DISPOSABLE_LOT,
      DISPOSABLE_CERT,
      10000000n // 10,000 kg
    );
    console.log(`         Root lot tx sent: ${lotTx.hash}. Awaiting block confirmation...`);
    await lotTx.wait(1);
    console.log(`         Root lot created on Sepolia.`);
  }

  dispStatus = Number(await certContract.getCertificateStatus(DISPOSABLE_CERT));
  console.log(`         Disposable certificate verified status: ${dispStatus} (${STATUS_NAMES[dispStatus]})`);

  // -------------------------------------------------------------------------
  // 3. Tab B (Pre-Revocation): Verify Consumer Blockchain Verification Reads VALID
  // -------------------------------------------------------------------------
  console.log(`\n[TAB B - BEFORE REVOCATION] Consumer Page /verify/${DISPOSABLE_LOT}:`);
  const lotData = await consignmentContract.getLot(DISPOSABLE_LOT);
  const certFromLot = lotData.certificateID;
  const directBlockchainStatusBefore = Number(await certContract.getCertificateStatus(certFromLot));
  console.log(`  -> ConsignmentRegistry.getLot("${DISPOSABLE_LOT}")`);
  console.log(`     Certificate ID: ${certFromLot}`);
  console.log(`     Current Owner:  ${lotData.currentOwner}`);
  console.log(`     Quantity:       ${Number(lotData.quantityGrams) / 1000} kg`);
  console.log(`  -> CertificateRegistry.getCertificateStatus("${certFromLot}")`);
  console.log(`     Authoritative Live Status: ${STATUS_NAMES[directBlockchainStatusBefore]} (Code ${directBlockchainStatusBefore})`);

  if (directBlockchainStatusBefore !== 2) {
    throw new Error(`Expected disposable certificate to be VALID before revocation, but got ${STATUS_NAMES[directBlockchainStatusBefore]}`);
  }
  console.log("  >>> TAB B VERIFICATION: Pre-revocation status is strictly VALID on-chain.");

  // -------------------------------------------------------------------------
  // 4. Tab A (Regulator Dashboard): Initialize Case & Execute Reviewer Workflow
  // -------------------------------------------------------------------------
  console.log(`\n[TAB A] Regulator Dashboard /regulator:`);
  const app = createApp();
  const PORT = 4002;
  const server = app.listen(PORT);
  const BASE_URL = `http://127.0.0.1:${PORT}`;

  let token = "";
  let demoRevokeTxHash = "";
  let demoReceiptBlock = 0;
  let demoGasUsed = "";

  try {
    // 4.1 Authenticate Reviewer via SIWE
    console.log(`  4.1. Requesting SIWE nonce from /api/auth/nonce...`);
    const nonceFetch = await fetch(`${BASE_URL}/api/auth/nonce`);
    const nonceData = await nonceFetch.json() as { nonce: string };
    const nonce = nonceData.nonce;
    console.log(`       Nonce received: ${nonce}`);

    const issuedAt = new Date().toISOString();
    const siweMessage =
      `localhost:5173 wants you to sign in with your Ethereum account:\n` +
      `${wallet.address}\n\n` +
      `Sign in to UNVEIL to access the Regulator & Auditor Dashboard.\n\n` +
      `URI: http://localhost:5173\n` +
      `Version: 1\n` +
      `Chain ID: 11155111\n` +
      `Nonce: ${nonce}\n` +
      `Issued At: ${issuedAt}`;

    console.log(`       Signing EIP-4361 challenge with reviewer wallet...`);
    const signature = await wallet.signMessage(siweMessage);

    console.log(`       Submitting signature to /api/auth/verify...`);
    const authFetch = await fetch(`${BASE_URL}/api/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message: siweMessage, signature }),
    });

    const authData = await authFetch.json() as any;
    if (!authFetch.ok || !authData.session) {
      throw new Error(`SIWE authentication failed: ${authData.error}`);
    }
    token = authData.session.token;
    console.log(`       SIWE Session Established! Token: ${token.slice(0, 16)}...`);

    // 4.2 Seed or fetch Investigation Case in database
    const CASE_ID = "CASE-UI-REVOKE-DEMO-003";
    let caseRecord = await prisma.case.findUnique({ where: { caseID: CASE_ID } });
    if (!caseRecord) {
      caseRecord = await prisma.case.create({
        data: {
          caseID: CASE_ID,
          lotID: DISPOSABLE_LOT,
          certificateID: DISPOSABLE_CERT,
          anomalyType: "RULE_YIELD_IMPLAUSIBILITY",
          riskScore: 88,
          status: "OPEN",
          assignedRole: "ARBITRATION_REGULATOR",
          evidence: {
            reason: "Agricultural inspection detected non-compliant synthetic fertilizer application.",
            reportedYieldKgPerHa: 4800,
            benchmarkThreshold: 2500,
          },
        },
      });
      console.log(`  4.2. Created Case ${CASE_ID} with status OPEN.`);
    } else {
      // Reset to OPEN if previously run
      caseRecord = await prisma.case.update({
        where: { caseID: CASE_ID },
        data: {
          status: "OPEN",
          resolution: null,
          resolvedAt: null,
          reviewer: null,
        },
      });
      console.log(`  4.2. Reset Case ${CASE_ID} to status OPEN for clean demonstration.`);
    }

    // 4.3 Move case from OPEN -> UNDER_REVIEW
    console.log(`  4.3. Reviewer claims case: OPEN -> UNDER_REVIEW...`);
    const reviewFetch = await fetch(`${BASE_URL}/api/cases/${CASE_ID}/transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actor: wallet.address,
        newStatus: "UNDER_REVIEW",
        notes: "Auditor initiating deep inspection of lot records and lab analysis.",
      }),
    });
    const reviewData = await reviewFetch.json() as any;
    console.log(`       Case status updated to: ${reviewData.case.status}`);

    // 4.4 Reviewer clicks "Confirm Violation" -> transitions to REVOCATION_PENDING
    console.log(`  4.4. Reviewer clicks Confirm: UNDER_REVIEW -> REVOCATION_PENDING...`);
    const pendingFetch = await fetch(`${BASE_URL}/api/cases/${CASE_ID}/transition`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actor: wallet.address,
        newStatus: "REVOCATION_PENDING",
        notes: "Lab analysis confirmed synthetic pesticide presence. Preparing on-chain revocation.",
      }),
    });
    const pendingData = await pendingFetch.json() as any;
    console.log(`       Case status updated to: ${pendingData.case.status}`);

    // 4.5 Dynamic Authorization Check (ARBITRATION_ROLE / Issuer check)
    console.log(`  4.5. Performing on-chain authorization validation...`);
    const arbitrationRole = await certContract.ARBITRATION_ROLE();
    const hasArbitration = await certContract.hasRole(arbitrationRole, wallet.address);
    const certDetails = await certContract.getCertificate(DISPOSABLE_CERT);
    const isIssuer = certDetails.issuer.toLowerCase() === wallet.address.toLowerCase();

    console.log(`       Arbitration Role Hash: ${arbitrationRole}`);
    console.log(`       Wallet has ARBITRATION_ROLE: ${hasArbitration}`);
    console.log(`       Wallet is Certificate Issuer: ${isIssuer}`);
    if (!hasArbitration && !isIssuer) {
      throw new Error("Connected wallet is not authorized on-chain to revoke this certificate!");
    }
    console.log(`       Authorization Confirmed. Reviewer is authorized on-chain.`);

    // 4.6 Submit on-chain revocation transaction
    console.log(`  4.6. Submitting on-chain revocation transaction to Sepolia...`);
    const revokeReason = "Confirmed prohibited synthetic inputs during on-site inspection";
    const revokeTx = await certContract.revokeCertificate(DISPOSABLE_CERT, revokeReason);
    console.log(`       Tx Broadcasted! Hash: ${revokeTx.hash}`);
    console.log(`       Waiting for block inclusion on Ethereum Sepolia...`);

    const receipt = await revokeTx.wait(1);
    console.log(`       Transaction Mined!`);
    console.log(`       Block Number: ${receipt.blockNumber}`);
    console.log(`       Gas Used:     ${receipt.gasUsed.toString()}`);
    console.log(`       Etherscan:    https://sepolia.etherscan.io/tx/${revokeTx.hash}`);

    // 4.7 Verify post-mining on-chain status
    const postStatusOnChain = Number(await certContract.getCertificateStatus(DISPOSABLE_CERT));
    console.log(`  4.7. Live on-chain status after mining: ${STATUS_NAMES[postStatusOnChain]} (Code ${postStatusOnChain})`);
    if (postStatusOnChain !== 4) {
      throw new Error(`Expected on-chain status to be REVOKED (4), but received ${postStatusOnChain}`);
    }

    // 4.8 Finalize Case to RESOLVED in backend
    console.log(`  4.8. Finalizing case: REVOCATION_PENDING -> RESOLVED...`);
    const resolveFetch = await fetch(`${BASE_URL}/api/cases/${CASE_ID}/resolve`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        actor: wallet.address,
        resolution: `REVOCATION_CONFIRMED: Tx ${revokeTx.hash}`,
        notes: `Certificate revoked on Sepolia in block #${receipt.blockNumber}.`,
      }),
    });
    const resolveData = await resolveFetch.json() as any;
    console.log(`       Case status finalized: ${resolveData.case.status}`);
    console.log(`       Resolution: ${resolveData.case.resolution}`);

    // Store tx details for summary
    demoRevokeTxHash = revokeTx.hash;
    demoReceiptBlock = receipt.blockNumber;
    demoGasUsed = receipt.gasUsed.toString();
  } finally {
    server.close();
  }

  // -------------------------------------------------------------------------
  // 5. Tab B (Post-Revocation): Verify Consumer Verification Reads REVOKED Directly
  // -------------------------------------------------------------------------
  console.log(`\n[TAB B - AFTER REVOCATION] Consumer Page /verify/${DISPOSABLE_LOT}:`);
  console.log(`  -> Reading directly from Sepolia JSON-RPC (zero indexer cache dependency):`);
  const finalLotData = await consignmentContract.getLot(DISPOSABLE_LOT);
  const finalCertStatus = Number(await certContract.getCertificateStatus(finalLotData.certificateID));
  console.log(`     Consignment: ${DISPOSABLE_LOT}`);
  console.log(`     Certificate: ${finalLotData.certificateID}`);
  console.log(`     Live On-Chain Status: ${STATUS_NAMES[finalCertStatus]} (Code ${finalCertStatus})`);

  if (finalCertStatus !== 4) {
    throw new Error(`CRITICAL FAILURE: Consumer direct contract query returned ${finalCertStatus}, expected 4 (REVOKED)!`);
  }

  console.log(`\n=========================================================================`);
  console.log(`                     UI-TO-UI DEMONSTRATION SUCCESS!                     `);
  console.log(`=========================================================================`);
  console.log(`  Primary Demo Lot:          ${PRIMARY_LOT} -> VALID (Preserved)`);
  console.log(`  Disposable Demo Lot:       ${DISPOSABLE_LOT}`);
  console.log(`  Disposable Certificate:    ${DISPOSABLE_CERT}`);
  console.log(`  Before Revocation Status:  VALID (Code 2)`);
  console.log(`  After Revocation Status:   REVOKED (Code 4)`);
  console.log(`  Revocation Tx Hash:        ${demoRevokeTxHash}`);
  console.log(`  Block Number:              ${demoReceiptBlock}`);
  console.log(`  Gas Used:                  ${demoGasUsed}`);
  console.log(`  Etherscan Link:            https://sepolia.etherscan.io/tx/${demoRevokeTxHash}`);
  console.log(`=========================================================================\n`);
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("\nExecution failed:", err);
    process.exit(1);
  });
