import { ethers, Contract, type Signer } from "ethers";
import { CONTRACT_ADDRESSES } from "./config";
import { getVerifiedSepoliaProvider } from "./contractVerification";

// Full ABI fragments for read & write operations
const ISSUER_REGISTRY_ABI = [
  "function isIssuerActive(address issuer) external view returns (bool)",
  "function getIssuerStatus(address issuer) external view returns (uint8)",
  "function getIssuerByAddress(address issuer) external view returns (tuple(address issuerAddress, string name, string accreditingBody, uint256 accreditationExpiry, string attestedBy, string source, string sourceID, address verifiedOwner, bool isRevoked, bool exists))",
  "function getIssuerBySourceID(string sourceID) external view returns (tuple(address issuerAddress, string name, string accreditingBody, uint256 accreditationExpiry, string attestedBy, string source, string sourceID, address verifiedOwner, bool isRevoked, bool exists))"
];

const CERTIFICATE_REGISTRY_ABI = [
  "function issueCertificate(string certificateID, string standardID, address holder, uint256 certifiedQuantityGrams, uint256 validFrom, uint256 validUntil, string source, string sourceID) external",
  "function getCertificate(string certificateID) external view returns (tuple(string certificateID, address issuer, string standardID, address holder, uint256 certifiedQuantityGrams, uint256 remainingQuantityGrams, uint256 validFrom, uint256 validUntil, bool isRevoked, string revocationReason, address revokedBy, string attestedBy, string source, string sourceID))",
  "function getCertificateStatus(string certificateID) external view returns (uint8)",
  "function getRemainingQuantity(string certificateID) external view returns (uint256)",
  "function revokeCertificate(string certificateID, string reason) external",
  "function ARBITRATION_ROLE() external view returns (bytes32)",
  "function hasRole(bytes32 role, address account) external view returns (bool)"
];

const CONSIGNMENT_REGISTRY_ABI = [
  "function createRootConsignment(string lotID, string certificateID, uint256 quantityGrams) external",
  "function splitLot(string parentLotID, string[] childLotIDs, uint256[] childQuantitiesGrams) external",
  "function mergeLots(string[] parentLotIDs, string newLotID) external",
  "function processLot(string parentLotID, string newLotID, uint256 outputQuantityGrams, string processDetails) external",
  "function transferLot(string lotID, address newOwner) external",
  "function getLot(string lotID) external view returns (tuple(string lotID, string certificateID, uint256 quantityGrams, address currentOwner, uint8 status, uint256 createdAt, string[] parentLotIDs, string[] childLotIDs))",
  "function getLotStatus(string lotID) external view returns (uint8)"
];

export interface OnChainIssuerInfo {
  isActive: boolean;
  statusCode: number;
  statusLabel: string;
  name?: string;
  sourceID?: string;
}

export interface OnChainCertificateDetails {
  certificateID: string;
  issuer: string;
  standardID: string;
  holder: string;
  certifiedQuantityGrams: bigint;
  remainingQuantityGrams: bigint;
  validFrom: number;
  validUntil: number;
  isRevoked: boolean;
  status: "NOT_YET_ACTIVE" | "VALID" | "EXPIRED" | "REVOKED" | "NONE";
  source: string;
  sourceID: string;
}

export interface OnChainLotDetails {
  lotID: string;
  certificateID: string;
  quantityGrams: bigint;
  currentOwner: string;
  status: "ACTIVE" | "CONSUMED" | "NONE";
  createdAt: number;
  parentLotIDs: string[];
  childLotIDs: string[];
}

export interface IssueCertificateParams {
  certificateID: string;
  standardID: string;
  holder: string;
  certifiedQuantityKg: number;
  validFromTimestamp: number;
  validUntilTimestamp: number;
  source: string;
  sourceID: string;
}

export interface CreateRootConsignmentParams {
  lotID: string;
  certificateID: string;
  quantityKg: number;
}

export interface SplitLotParams {
  parentLotID: string;
  childLotIDs: string[];
  childQuantitiesKg: number[];
}

export interface MergeLotsParams {
  parentLotIDs: string[];
  newLotID: string;
}

export interface ProcessLotParams {
  parentLotID: string;
  newLotID: string;
  outputQuantityKg: number;
  processDetails: string;
}

export interface TransferLotParams {
  lotID: string;
  newOwner: string;
}

/**
 * Deterministically converts kg to integer grams.
 * e.g. 25,000 kg -> 25,000,000 g
 */
export function kgToIntegerGrams(kg: number | string): bigint {
  const numeric = typeof kg === "string" ? parseFloat(kg) : kg;
  if (isNaN(numeric) || numeric <= 0) {
    throw new Error("Quantity must be a positive number.");
  }
  // Convert strictly to integer grams (no decimals)
  return BigInt(Math.round(numeric * 1000));
}

/**
 * Formats canonical integer grams to kg for presentation.
 */
export function integerGramsToKg(grams: bigint | number | string): number {
  const g = BigInt(grams);
  return Number(g) / 1000;
}

/**
 * Queries on-chain IssuerRegistry directly to evaluate active accreditation.
 * Does NOT use Phase 3 backend or cache.
 */
export async function checkOnChainIssuerStatus(issuerAddress: string): Promise<OnChainIssuerInfo> {
  if (!issuerAddress || !ethers.isAddress(issuerAddress)) {
    return { isActive: false, statusCode: 0, statusLabel: "INACTIVE" };
  }

  const { provider } = await getVerifiedSepoliaProvider();
  const contract = new Contract(CONTRACT_ADDRESSES.ISSUER_REGISTRY, ISSUER_REGISTRY_ABI, provider);

  try {
    const isActive = await contract.isIssuerActive(issuerAddress);
    const statusCode = Number(await contract.getIssuerStatus(issuerAddress));
    const statusLabels = ["INACTIVE", "ACTIVE", "EXPIRED", "REVOKED"];
    const statusLabel = statusLabels[statusCode] || "UNKNOWN";

    let name = "";
    let sourceID = "";
    if (isActive || statusCode !== 0) {
      try {
        const record = await contract.getIssuerByAddress(issuerAddress);
        name = record.name;
        sourceID = record.sourceID;
      } catch {
        // Unclaimed or unlinked address
      }
    }

    return {
      isActive,
      statusCode,
      statusLabel,
      name,
      sourceID,
    };
  } catch (err) {
    console.error("Failed to query on-chain IssuerRegistry:", err);
    return { isActive: false, statusCode: 0, statusLabel: "UNAVAILABLE" };
  }
}

/**
 * Reads live certificate details and remaining certified capacity directly from CertificateRegistry.
 */
export async function lookupOnChainCertificate(
  certificateID: string
): Promise<OnChainCertificateDetails | null> {
  const { provider } = await getVerifiedSepoliaProvider();
  const contract = new Contract(CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY, CERTIFICATE_REGISTRY_ABI, provider);

  try {
    const raw = await contract.getCertificate(certificateID);
    const statusCode = Number(await contract.getCertificateStatus(certificateID));
    const statusMap = ["NONE", "NOT_YET_ACTIVE", "VALID", "EXPIRED", "REVOKED"] as const;
    const status = statusMap[statusCode] || "NONE";

    return {
      certificateID: raw.certificateID,
      issuer: raw.issuer,
      standardID: raw.standardID,
      holder: raw.holder,
      certifiedQuantityGrams: BigInt(raw.certifiedQuantityGrams),
      remainingQuantityGrams: BigInt(raw.remainingQuantityGrams),
      validFrom: Number(raw.validFrom),
      validUntil: Number(raw.validUntil),
      isRevoked: Boolean(raw.isRevoked),
      status,
      source: raw.source,
      sourceID: raw.sourceID,
    };
  } catch {
    return null;
  }
}

/**
 * Reads live lot details directly from ConsignmentRegistry.
 */
export async function lookupOnChainLot(lotID: string): Promise<OnChainLotDetails | null> {
  const { provider } = await getVerifiedSepoliaProvider();
  const contract = new Contract(CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY, CONSIGNMENT_REGISTRY_ABI, provider);

  try {
    const raw = await contract.getLot(lotID);
    const statusCode = Number(await contract.getLotStatus(lotID));
    const statusMap = ["NONE", "ACTIVE", "CONSUMED"] as const;
    const status = statusMap[statusCode] || "NONE";

    return {
      lotID: raw.lotID,
      certificateID: raw.certificateID,
      quantityGrams: BigInt(raw.quantityGrams),
      currentOwner: raw.currentOwner,
      status,
      createdAt: Number(raw.createdAt),
      parentLotIDs: Array.from(raw.parentLotIDs),
      childLotIDs: Array.from(raw.childLotIDs),
    };
  } catch {
    return null;
  }
}

/**
 * State-changing: Issues an ethical sourcing certificate.
 * Caller must have active accreditation in IssuerRegistry.
 */
export async function executeIssueCertificate(
  params: IssueCertificateParams,
  signer: Signer
): Promise<{ transactionHash: string; certificateID: string; blockNumber: number }> {
  const contract = new Contract(CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY, CERTIFICATE_REGISTRY_ABI, signer);
  const quantityGrams = kgToIntegerGrams(params.certifiedQuantityKg);

  const tx = await contract.issueCertificate(
    params.certificateID,
    params.standardID,
    params.holder,
    quantityGrams,
    params.validFromTimestamp,
    params.validUntilTimestamp,
    params.source,
    params.sourceID
  );

  const receipt = await tx.wait(1);

  return {
    transactionHash: receipt.hash || tx.hash,
    certificateID: params.certificateID,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * State-changing: Creates a root consignment.
 * Single-point mass-balance consumption: deducts from Certificate remaining capacity.
 */
export async function executeCreateRootConsignment(
  params: CreateRootConsignmentParams,
  signer: Signer
): Promise<{ transactionHash: string; lotID: string; quantityGrams: bigint; blockNumber: number }> {
  const contract = new Contract(CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY, CONSIGNMENT_REGISTRY_ABI, signer);
  const quantityGrams = kgToIntegerGrams(params.quantityKg);

  const tx = await contract.createRootConsignment(
    params.lotID,
    params.certificateID,
    quantityGrams
  );

  const receipt = await tx.wait(1);

  return {
    transactionHash: receipt.hash || tx.hash,
    lotID: params.lotID,
    quantityGrams,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * State-changing: Splits an active lot into multiple child lots.
 */
export async function executeSplitLot(
  params: SplitLotParams,
  signer: Signer
): Promise<{ transactionHash: string; parentLotID: string; childLotIDs: string[]; blockNumber: number }> {
  const contract = new Contract(CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY, CONSIGNMENT_REGISTRY_ABI, signer);
  const childQuantitiesGrams = params.childQuantitiesKg.map((kg) => kgToIntegerGrams(kg));

  const tx = await contract.splitLot(
    params.parentLotID,
    params.childLotIDs,
    childQuantitiesGrams
  );

  const receipt = await tx.wait(1);

  return {
    transactionHash: receipt.hash || tx.hash,
    parentLotID: params.parentLotID,
    childLotIDs: params.childLotIDs,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * State-changing: Merges multiple lots originating from the same certificate.
 */
export async function executeMergeLots(
  params: MergeLotsParams,
  signer: Signer
): Promise<{ transactionHash: string; newLotID: string; blockNumber: number }> {
  const contract = new Contract(CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY, CONSIGNMENT_REGISTRY_ABI, signer);

  const tx = await contract.mergeLots(
    params.parentLotIDs,
    params.newLotID
  );

  const receipt = await tx.wait(1);

  return {
    transactionHash: receipt.hash || tx.hash,
    newLotID: params.newLotID,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * State-changing: Processes an active lot (permits yield loss, rejects yield expansion).
 */
export async function executeProcessLot(
  params: ProcessLotParams,
  signer: Signer
): Promise<{ transactionHash: string; newLotID: string; outputQuantityGrams: bigint; blockNumber: number }> {
  const contract = new Contract(CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY, CONSIGNMENT_REGISTRY_ABI, signer);
  const outputGrams = kgToIntegerGrams(params.outputQuantityKg);

  const tx = await contract.processLot(
    params.parentLotID,
    params.newLotID,
    outputGrams,
    params.processDetails
  );

  const receipt = await tx.wait(1);

  return {
    transactionHash: receipt.hash || tx.hash,
    newLotID: params.newLotID,
    outputQuantityGrams: outputGrams,
    blockNumber: receipt.blockNumber,
  };
}

/**
 * State-changing: Transfers custody/ownership of an active lot.
 */
export async function executeTransferLot(
  params: TransferLotParams,
  signer: Signer
): Promise<{ transactionHash: string; lotID: string; newOwner: string; blockNumber: number }> {
  const contract = new Contract(CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY, CONSIGNMENT_REGISTRY_ABI, signer);

  const tx = await contract.transferLot(
    params.lotID,
    params.newOwner
  );

  const receipt = await tx.wait(1);

  return {
    transactionHash: receipt.hash || tx.hash,
    lotID: params.lotID,
    newOwner: params.newOwner,
    blockNumber: receipt.blockNumber,
  };
}

export interface RevocationAuthorizationInfo {
  isAuthorized: boolean;
  isIssuer: boolean;
  isArbitrator: boolean;
  currentStatus: string;
  statusCode: number;
  issuerAddress: string;
  holderAddress: string;
}

/**
 * Checks on-chain authorization for revoking a certificate:
 * Either the connected wallet is the certificate issuer, OR
 * the connected wallet holds ARBITRATION_ROLE on CertificateRegistry.
 *
 * CRITICAL RULE: NEVER hardcode the deployer as permanent arbitration authority.
 * We query contract.ARBITRATION_ROLE() and contract.hasRole(role, walletAddress) dynamically on-chain.
 */
export async function checkRevocationAuthorization(
  certificateID: string,
  walletAddress: string,
  customContract?: any
): Promise<RevocationAuthorizationInfo> {
  if (!certificateID || !walletAddress) {
    return {
      isAuthorized: false,
      isIssuer: false,
      isArbitrator: false,
      currentStatus: "NONE",
      statusCode: 0,
      issuerAddress: "",
      holderAddress: "",
    };
  }

  let contract = customContract;
  if (!contract) {
    const { provider } = await getVerifiedSepoliaProvider();
    contract = new Contract(CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY, CERTIFICATE_REGISTRY_ABI, provider);
  }

  const statusCode = Number(await contract.getCertificateStatus(certificateID));
  const statusLabels = ["NONE", "NOT_YET_ACTIVE", "VALID", "EXPIRED", "REVOKED"];
  const currentStatus = statusLabels[statusCode] || "UNKNOWN";

  const cert = await contract.getCertificate(certificateID);
  const issuerAddress = cert.issuer || "";
  const holderAddress = cert.holder || "";

  let isArbitrator = false;
  try {
    let arbitrationRole: string;
    try {
      arbitrationRole = await contract.ARBITRATION_ROLE();
    } catch {
      arbitrationRole = ethers.id("ARBITRATION_ROLE");
    }
    isArbitrator = Boolean(await contract.hasRole(arbitrationRole, walletAddress));
  } catch {
    isArbitrator = false;
  }

  const isIssuer = Boolean(
    walletAddress &&
    issuerAddress &&
    walletAddress.toLowerCase() === issuerAddress.toLowerCase()
  );

  return {
    isAuthorized: isIssuer || isArbitrator,
    isIssuer,
    isArbitrator,
    currentStatus,
    statusCode,
    issuerAddress,
    holderAddress,
  };
}

/**
 * Executes state-changing on-chain revocation: CertificateRegistry.revokeCertificate(certificateID, reason).
 * Waits for transaction to be mined and directly verifies that live on-chain status is REVOKED.
 */
export async function executeRevokeCertificate(
  certificateID: string,
  reason: string,
  signer: Signer,
  customContract?: any
): Promise<{
  transactionHash: string;
  blockNumber: number;
  resultingStatus: "REVOKED";
}> {
  const contract = customContract || new Contract(
    CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY,
    CERTIFICATE_REGISTRY_ABI,
    signer
  );

  const tx = await contract.revokeCertificate(certificateID, reason);
  const receipt = await tx.wait(1);

  // Directly verify on-chain status via contract read post-mining
  const statusCode = Number(await contract.getCertificateStatus(certificateID));
  if (statusCode !== 4) { // 4 is Revoked in enum CertificateStatus
    throw new Error(`On-chain revocation verification failed: expected status code 4 (REVOKED), got ${statusCode}`);
  }

  return {
    transactionHash: receipt.hash || tx.hash,
    blockNumber: receipt.blockNumber,
    resultingStatus: "REVOKED",
  };
}

