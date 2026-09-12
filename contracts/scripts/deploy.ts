import { ethers, network } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * @notice UNVEIL Core Contracts Deployment Script
 * Deploys:
 * 1. IssuerRegistry
 * 2. CertificateRegistry
 * 3. ConsignmentRegistry
 * Wires:
 * - CertificateRegistry grants CONSIGNMENT_REGISTRY_ROLE to ConsignmentRegistry
 * - IssuerRegistry assigns MULTISIG_ROLE to the designated Gnosis Safe 3-of-5 multisig
 */
async function main() {
  const [deployer] = await ethers.getSigners();
  const chainId = (await ethers.provider.getNetwork()).chainId;

  console.log("===============================================================");
  console.log("              UNVEIL Core Deployment — Phase 2                 ");
  console.log("===============================================================");
  console.log(`Network Name:  ${network.name}`);
  console.log(`Chain ID:      ${chainId}`);
  console.log(`Deployer:      ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:       ${ethers.formatEther(balance)} ETH`);
  console.log("---------------------------------------------------------------");

  // Determine Gnosis Safe address
  let safeMultisigAddress = process.env.SAFE_MULTISIG_ADDRESS;
  const isLocalNetwork = network.name === "hardhat" || network.name === "localhost";

  if (!safeMultisigAddress || safeMultisigAddress === ethers.ZeroAddress || !ethers.isAddress(safeMultisigAddress)) {
    if (!isLocalNetwork) {
      throw new Error(
        `CRITICAL ERROR: SAFE_MULTISIG_ADDRESS environment variable must be explicitly provided as a valid non-zero Gnosis Safe address for network '${network.name}'. Silent fallback to deployer is strictly prohibited.`
      );
    }
    // For local test/hardhat runs, use deployer as demo Safe
    console.log("LOCAL SIMULATION ONLY: SAFE_MULTISIG_ADDRESS not set. Using deployer for local simulation ONLY.");
    safeMultisigAddress = deployer.address;
  }

  // Determine Arbitration address
  let arbitrationAddress = process.env.ARBITRATION_ROLE_ADDRESS;
  if (!arbitrationAddress || arbitrationAddress === ethers.ZeroAddress || !ethers.isAddress(arbitrationAddress)) {
    arbitrationAddress = deployer.address;
  }

  console.log(`Multisig Safe Address:  ${safeMultisigAddress}`);
  console.log(`Arbitration Address:    ${arbitrationAddress}`);
  console.log("---------------------------------------------------------------");

  // 1. Deploy IssuerRegistry
  console.log("\n[1/4] Deploying IssuerRegistry...");
  const IssuerRegistryFactory = await ethers.getContractFactory("IssuerRegistry");
  const issuerRegistry = await IssuerRegistryFactory.deploy(
    deployer.address,
    safeMultisigAddress
  );
  await issuerRegistry.waitForDeployment();
  const issuerRegistryAddress = await issuerRegistry.getAddress();
  const issuerTxHash = issuerRegistry.deploymentTransaction()?.hash;
  console.log(`✔ IssuerRegistry deployed to: ${issuerRegistryAddress} (tx: ${issuerTxHash})`);

  // 2. Deploy CertificateRegistry
  console.log("\n[2/4] Deploying CertificateRegistry...");
  const CertificateRegistryFactory = await ethers.getContractFactory("CertificateRegistry");
  const certificateRegistry = await CertificateRegistryFactory.deploy(
    deployer.address,
    issuerRegistryAddress,
    arbitrationAddress
  );
  await certificateRegistry.waitForDeployment();
  const certificateRegistryAddress = await certificateRegistry.getAddress();
  const certTxHash = certificateRegistry.deploymentTransaction()?.hash;
  console.log(`✔ CertificateRegistry deployed to: ${certificateRegistryAddress} (tx: ${certTxHash})`);

  // 3. Deploy ConsignmentRegistry
  console.log("\n[3/4] Deploying ConsignmentRegistry...");
  const ConsignmentRegistryFactory = await ethers.getContractFactory("ConsignmentRegistry");
  const consignmentRegistry = await ConsignmentRegistryFactory.deploy(
    certificateRegistryAddress
  );
  await consignmentRegistry.waitForDeployment();
  const consignmentRegistryAddress = await consignmentRegistry.getAddress();
  const consignTxHash = consignmentRegistry.deploymentTransaction()?.hash;
  console.log(`✔ ConsignmentRegistry deployed to: ${consignmentRegistryAddress} (tx: ${consignTxHash})`);

  // 4. Wire Roles
  console.log("\n[4/4] Configuring Inter-Contract Roles...");
  const CONSIGNMENT_REGISTRY_ROLE = ethers.keccak256(
    ethers.toUtf8Bytes("CONSIGNMENT_REGISTRY_ROLE")
  );
  const roleTx = await certificateRegistry.grantRole(
    CONSIGNMENT_REGISTRY_ROLE,
    consignmentRegistryAddress
  );
  await roleTx.wait();
  console.log(`✔ Granted CONSIGNMENT_REGISTRY_ROLE to ConsignmentRegistry (tx: ${roleTx.hash})`);

  console.log("\n===============================================================");
  console.log("                  Deployment Completed Successfully            ");
  console.log("===============================================================");
  console.log(`IssuerRegistry:       ${issuerRegistryAddress}`);
  console.log(`CertificateRegistry:  ${certificateRegistryAddress}`);
  console.log(`ConsignmentRegistry:  ${consignmentRegistryAddress}`);
  console.log(`Safe Trust Root:      ${safeMultisigAddress}`);
  console.log("===============================================================");

  // Output record
  const deploymentRecord = {
    network: network.name,
    chainId: chainId.toString(),
    timestamp: new Date().toISOString(),
    deployer: deployer.address,
    safeMultisigAddress,
    arbitrationAddress,
    contracts: {
      IssuerRegistry: {
        address: issuerRegistryAddress,
        txHash: issuerTxHash,
      },
      CertificateRegistry: {
        address: certificateRegistryAddress,
        txHash: certTxHash,
      },
      ConsignmentRegistry: {
        address: consignmentRegistryAddress,
        txHash: consignTxHash,
      },
    },
  };

  const deploymentPath = path.join(__dirname, "../deployment-output.json");
  fs.writeFileSync(deploymentPath, JSON.stringify(deploymentRecord, null, 2));
  console.log(`Deployment manifest saved to ${deploymentPath}`);

  return deploymentRecord;
}

main().catch((error) => {
  console.error("Deployment failed:", error);
  process.exitCode = 1;
});
