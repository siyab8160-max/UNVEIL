import { ethers, network } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

/**
 * @notice Real Certifier Seeding Script via Gnosis Safe 3-of-5 Multisig
 *
 * Sourced directly from:
 * USDA Organic INTEGRITY Database (OID) - https://organic.ams.usda.gov/Integrity/
 *
 * Intended Safe Execution Architecture:
 * 1. Build calldata for IssuerRegistry.registerIssuer()
 * 2. 3 of 5 Safe signers generate signatures for the Safe transaction hash
 * 3. Safe.execTransaction(...) executes the payload
 * 4. IssuerRegistry validates msg.sender == safeAddress (MULTISIG_ROLE)
 *
 * IDENTITY SEPARATION NOTE:
 * Real certifying agents do not own Ethereum addresses. Records are registered
 * with `issuerAddress = address(0)` (unclaimed). Real issuers may later claim
 * their record on-chain via `claimIssuerRecord()` using cryptographic proof.
 */
export const REAL_USDA_CERTIFIERS = [
  {
    sourceID: "CCOF",
    issuerAddress: ethers.ZeroAddress, // Unclaimed mirrored record
    name: "CCOF Certification Services, LLC",
    accreditingBody: "USDA Agricultural Marketing Service (National Organic Program)",
    // 5-year accreditation audit renewal cycle (NOP 2000 benchmark)
    accreditationExpiry: Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600,
    source: "USDA Organic INTEGRITY Database",
  },
  {
    sourceID: "OTCO",
    issuerAddress: ethers.ZeroAddress, // Unclaimed mirrored record
    name: "Oregon Tilth Certified Organic",
    accreditingBody: "USDA Agricultural Marketing Service (National Organic Program)",
    accreditationExpiry: Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600,
    source: "USDA Organic INTEGRITY Database",
  },
  {
    sourceID: "MAYACERT",
    issuerAddress: ethers.ZeroAddress, // Unclaimed mirrored record
    name: "Mayacert, S.A.",
    accreditingBody: "USDA Agricultural Marketing Service (National Organic Program)",
    accreditationExpiry: Math.floor(Date.now() / 1000) + 5 * 365 * 24 * 3600,
    source: "USDA Organic INTEGRITY Database",
  },
];

async function main() {
  const [deployer] = await ethers.getSigners();
  const issuerRegistryAddress = process.env.ISSUER_REGISTRY_ADDRESS;
  const safeAddress = process.env.SAFE_MULTISIG_ADDRESS;

  if (!issuerRegistryAddress) {
    throw new Error("ISSUER_REGISTRY_ADDRESS environment variable must be set.");
  }
  if (!safeAddress) {
    throw new Error("SAFE_MULTISIG_ADDRESS environment variable must be set.");
  }

  console.log("===============================================================");
  console.log("      CertLedger Real Issuer Seeding via Gnosis Safe           ");
  console.log("===============================================================");
  console.log(`Target IssuerRegistry: ${issuerRegistryAddress}`);
  console.log(`Authorized Safe:       ${safeAddress}`);
  console.log(`Executing Account:     ${deployer.address}`);
  console.log("---------------------------------------------------------------");

  const IssuerRegistry = await ethers.getContractFactory("IssuerRegistry");
  const issuerRegistry = IssuerRegistry.attach(issuerRegistryAddress);

  for (const certifier of REAL_USDA_CERTIFIERS) {
    console.log(`\nPreparing Safe transaction for certifier: ${certifier.name} (${certifier.sourceID})...`);

    // Encode the transaction calldata
    const calldata = issuerRegistry.interface.encodeFunctionData("registerIssuer", [
      certifier.sourceID,
      certifier.issuerAddress,
      certifier.name,
      certifier.accreditingBody,
      certifier.accreditationExpiry,
      certifier.source,
    ]);

    console.log(`Calldata: ${calldata}`);
    console.log(`To:       ${issuerRegistryAddress}`);
    console.log(`Target:   registerIssuer("${certifier.sourceID}", address(0), "${certifier.name}")`);

    // When executing against an active Safe with 3-of-5 threshold,
    // the transaction is submitted to the Safe or Safe Transaction Service.
    console.log(`✔ Payload prepared for 3-of-5 Safe approval and execution.`);
  }

  console.log("\n===============================================================");
  console.log("Seeding payload generation complete.");
  console.log("===============================================================");
}

if (require.main === module) {
  main().catch((error) => {
    console.error("Seeding script failed:", error);
    process.exitCode = 1;
  });
}
