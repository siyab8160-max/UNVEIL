import { Contract, JsonRpcProvider } from "ethers";
import {
  SEPOLIA_CHAIN_ID,
  CONTRACT_ADDRESSES,
  CONFIGURED_SEPOLIA_RPCS,
} from "./config";

export const CONSIGNMENT_REGISTRY_ABI = [
  "function getLot(string calldata lotID) external view returns (tuple(string lotID, string certificateID, uint256 quantityGrams, address currentOwner, uint8 status, uint256 createdAt, string[] parentLotIDs, string[] childLotIDs))",
  "error LotNotFound(string lotID)",
] as const;

export const CERTIFICATE_REGISTRY_ABI = [
  "function getCertificateStatus(string calldata certificateID) external view returns (uint8)",
  "function getCertificate(string calldata certificateID) external view returns (tuple(string certificateID, address issuer, string standardID, address holder, uint256 certifiedQuantityGrams, uint256 remainingQuantityGrams, uint256 validFrom, uint256 validUntil, bool isRevoked, string revocationReason, address revokedBy, string attestedBy, string source, string sourceID))",
  "error CertificateNotFound(string certificateID)",
] as const;

export type AuthoritativeCertificateStatus = "VALID" | "EXPIRED" | "REVOKED" | "NOT_YET_ACTIVE";

export interface OnChainLot {
  lotID: string;
  certificateID: string;
  quantityGrams: bigint;
  currentOwner: string;
  status: "ACTIVE" | "CONSUMED" | "UNKNOWN";
  createdAt: number;
  parentLotIDs: string[];
  childLotIDs: string[];
}

export interface OnChainCertificate {
  certificateID: string;
  issuer: string;
  standardID: string;
  holder: string;
  certifiedQuantityGrams: bigint;
  remainingQuantityGrams: bigint;
  validFrom: Date;
  validUntil: Date;
  isRevoked: boolean;
  revocationReason?: string;
  attestedBy: string;
  source: string;
  sourceID: string;
}

export interface BlockchainVerificationResult {
  isAvailable: boolean;
  status: AuthoritativeCertificateStatus | null;
  lot: OnChainLot | null;
  certificate: OnChainCertificate | null;
  chainId: number | null;
  providerUrl: string | null;
  error: string | null;
}

/**
 * Validates that an RPC provider is connected to Ethereum Sepolia (chainId === 11155111)
 * RPC fallback is strictly restricted to verified Sepolia endpoints.
 */
export async function getVerifiedSepoliaProvider(customProvider?: any): Promise<{ provider: any; url: string }> {
  if (customProvider) {
    await customProvider.getNetwork();
    return { provider: customProvider, url: "custom-test-provider" };
  }

  // Iterate over explicitly configured Sepolia RPC providers
  for (const url of CONFIGURED_SEPOLIA_RPCS) {
    try {
      const provider = new JsonRpcProvider(url, undefined, { staticNetwork: true });
      const network = await Promise.race([
        provider.getNetwork(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("RPC timeout")), 3000)
        ),
      ]);

      if (Number(network.chainId) === SEPOLIA_CHAIN_ID) {
        return { provider, url };
      }
    } catch {
      // Continue to next provider in the fallback list
      continue;
    }
  }

  throw new Error("Unable to connect to any verified Sepolia RPC provider");
}

/**
 * Authoritative on-chain verification pipeline:
 * lotID -> ConsignmentRegistry -> certificateID -> CertificateRegistry.getCertificateStatus()
 *
 * CRITICAL ARCHITECTURAL RULES:
 * 1. Smart contracts are the SOLE authoritative arbiter for VALID / EXPIRED / REVOKED.
 * 2. PostgreSQL / indexer is NEVER queried for certificate validity.
 * 3. An RPC failure returns isAvailable = false; it is NEVER converted to EXPIRED or REVOKED.
 */
export async function verifyOnChain(
  lotID: string,
  options?: {
    customProvider?: any;
    consignmentAddress?: string;
    certificateAddress?: string;
  }
): Promise<BlockchainVerificationResult> {
  const normalizedLotID = lotID.trim();
  if (!normalizedLotID) {
    return {
      isAvailable: true,
      status: null,
      lot: null,
      certificate: null,
      chainId: null,
      providerUrl: null,
      error: "Please enter a valid lot identifier",
    };
  }

  let provider: any;
  let activeUrl: string;

  try {
    const verified = await getVerifiedSepoliaProvider(options?.customProvider);
    provider = verified.provider;
    activeUrl = verified.url;
  } catch {
    // Network / RPC connection error
    return {
      isAvailable: false,
      status: null,
      lot: null,
      certificate: null,
      chainId: null,
      providerUrl: null,
      error: "Verification unavailable — unable to read the blockchain right now.",
    };
  }

  const consignmentAddr = options?.consignmentAddress || CONTRACT_ADDRESSES.CONSIGNMENT_REGISTRY;
  const certificateAddr = options?.certificateAddress || CONTRACT_ADDRESSES.CERTIFICATE_REGISTRY;

  try {
    const consignmentContract = new Contract(consignmentAddr, CONSIGNMENT_REGISTRY_ABI, provider);
    const certificateContract = new Contract(certificateAddr, CERTIFICATE_REGISTRY_ABI, provider);

    // 1. Query ConsignmentRegistry for lot
    const rawLot = await consignmentContract.getLot(normalizedLotID);
    if (!rawLot || !rawLot.lotID || rawLot.lotID === "") {
      return {
        isAvailable: true,
        status: null,
        lot: null,
        certificate: null,
        chainId: SEPOLIA_CHAIN_ID,
        providerUrl: activeUrl,
        error: `Consignment lot "${normalizedLotID}" was not found on the blockchain.`,
      };
    }

    const lot: OnChainLot = {
      lotID: rawLot.lotID,
      certificateID: rawLot.certificateID,
      quantityGrams: BigInt(rawLot.quantityGrams.toString()),
      currentOwner: rawLot.currentOwner,
      status: Number(rawLot.status) === 1 ? "ACTIVE" : Number(rawLot.status) === 2 ? "CONSUMED" : "UNKNOWN",
      createdAt: Number(rawLot.createdAt),
      parentLotIDs: Array.from(rawLot.parentLotIDs || []),
      childLotIDs: Array.from(rawLot.childLotIDs || []),
    };

    // 2. Query CertificateRegistry for authoritative status
    const statusCodeRaw = await certificateContract.getCertificateStatus(lot.certificateID);
    const statusCode = Number(statusCodeRaw);

    let status: AuthoritativeCertificateStatus | null = null;
    switch (statusCode) {
      case 1:
        status = "NOT_YET_ACTIVE";
        break;
      case 2:
        status = "VALID";
        break;
      case 3:
        status = "EXPIRED";
        break;
      case 4:
        status = "REVOKED";
        break;
      default:
        // FIX 4: Never default unknown status codes or None (0) to REVOKED
        status = null;
    }

    if (status === null) {
      return {
        isAvailable: true,
        status: null,
        lot,
        certificate: null,
        chainId: SEPOLIA_CHAIN_ID,
        providerUrl: activeUrl,
        error: statusCode === 0
          ? `Certificate "${lot.certificateID}" does not exist on the blockchain.`
          : `Unknown certificate status code (${statusCode}) returned from blockchain.`,
      };
    }

    // 3. Query full certificate metadata
    const rawCert = await certificateContract.getCertificate(lot.certificateID);
    const certificate: OnChainCertificate = {
      certificateID: rawCert.certificateID,
      issuer: rawCert.issuer,
      standardID: rawCert.standardID,
      holder: rawCert.holder,
      certifiedQuantityGrams: BigInt(rawCert.certifiedQuantityGrams.toString()),
      remainingQuantityGrams: BigInt(rawCert.remainingQuantityGrams.toString()),
      validFrom: new Date(Number(rawCert.validFrom) * 1000),
      validUntil: new Date(Number(rawCert.validUntil) * 1000),
      isRevoked: rawCert.isRevoked,
      revocationReason: rawCert.revocationReason || undefined,
      attestedBy: rawCert.attestedBy,
      source: rawCert.source,
      sourceID: rawCert.sourceID,
    };

    return {
      isAvailable: true,
      status,
      lot,
      certificate,
      chainId: SEPOLIA_CHAIN_ID,
      providerUrl: activeUrl,
      error: null,
    };
  } catch (err: any) {
    // FIX 1: Robustly decode LotNotFound custom error (name, selector, or message)
    const isLotNotFound =
      err?.revert?.name === "LotNotFound" ||
      (typeof err?.message === "string" && err.message.includes("LotNotFound")) ||
      (typeof err?.data === "string" && err.data.startsWith("0x6ca8d60f")) ||
      (typeof err?.info?.error?.data === "string" && err.info.error.data.startsWith("0x6ca8d60f"));

    if (isLotNotFound) {
      return {
        isAvailable: true,
        status: null,
        lot: null,
        certificate: null,
        chainId: SEPOLIA_CHAIN_ID,
        providerUrl: activeUrl,
        error: `Consignment lot "${normalizedLotID}" was not found on the blockchain.`,
      };
    }

    // Decode CertificateNotFound if certificate query fails
    const isCertNotFound =
      err?.revert?.name === "CertificateNotFound" ||
      (typeof err?.message === "string" && err.message.includes("CertificateNotFound")) ||
      (typeof err?.data === "string" && err.data.startsWith("0x4f2ad22a")) ||
      (typeof err?.info?.error?.data === "string" && err.info.error.data.startsWith("0x4f2ad22a"));

    if (isCertNotFound) {
      return {
        isAvailable: true,
        status: null,
        lot: null,
        certificate: null,
        chainId: SEPOLIA_CHAIN_ID,
        providerUrl: activeUrl,
        error: `Certificate for consignment lot "${normalizedLotID}" was not found on the blockchain.`,
      };
    }

    return {
      isAvailable: false,
      status: null,
      lot: null,
      certificate: null,
      chainId: null,
      providerUrl: null,
      error: "Verification unavailable — unable to read the blockchain right now.",
    };
  }
}
