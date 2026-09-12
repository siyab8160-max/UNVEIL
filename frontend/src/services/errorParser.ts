import { ethers } from "ethers";

export interface ParsedContractError {
  title: string;
  explanation: string;
  errorName?: string;
  isUserRejection: boolean;
  isRpcError: boolean;
}

// ABI definitions for custom errors across the three contracts
const CUSTOM_ERRORS_ABI = [
  // CertificateRegistry errors
  "error IssuerNotActive(address issuer)",
  "error InvalidCertificateID()",
  "error CertificateAlreadyExists(string certificateID)",
  "error CertificateNotFound(string certificateID)",
  "error InvalidHolder()",
  "error InvalidQuantity()",
  "error InvalidValidityWindow()",
  "error CertificateNotYetActive(string certificateID, uint256 validFrom)",
  "error CertificateExpired(string certificateID, uint256 validUntil)",
  "error CertificateHasBeenRevoked(string certificateID)",
  "error CertificateAlreadyRevoked(string certificateID)",
  "error CallerNotCertificateHolder(address caller, address holder)",
  "error InsufficientCertifiedQuantity(string certificateID, uint256 requestedQuantityGrams, uint256 remainingQuantityGrams)",
  "error UnauthorizedRevocation(address caller)",

  // ConsignmentRegistry errors
  "error InvalidLotID()",
  "error LotAlreadyExists(string lotID)",
  "error LotNotFound(string lotID)",
  "error CallerNotLotOwner(address caller, address currentOwner)",
  "error LotAlreadyConsumed(string lotID)",
  "error InvalidChildCount()",
  "error SplitConservationViolation(uint256 parentQuantity, uint256 childSum)",
  "error InvalidParentCount()",
  "error YieldExpansionNotAllowed(uint256 inputQuantity, uint256 outputQuantity)",
  "error InvalidRecipient()",
  "error CertificateMismatch(string expectedCertificateID, string actualCertificateID)",

  // IssuerRegistry errors
  "error InvalidSourceID()",
  "error InvalidAccreditationExpiry()",
  "error IssuerAlreadyExists(string sourceID)",
  "error IssuerAddressAlreadyRegistered(address issuerAddress)",
  "error IssuerNotFound(string sourceID)",
  "error IssuerAlreadyRevoked(string sourceID)",
  "error IssuerInactive(string sourceID)",
  "error EmptyProof()"
];

const errorInterface = new ethers.Interface(CUSTOM_ERRORS_ABI);

/**
 * Extracts raw error data hex string from nested ethers error objects.
 */
function extractErrorData(error: any): string | null {
  if (!error) return null;
  if (typeof error.data === "string" && error.data.startsWith("0x")) return error.data;
  if (error.info?.error?.data && typeof error.info.error.data === "string") return error.info.error.data;
  if (error.error?.data && typeof error.error.data === "string") return error.error.data;
  if (error.data?.data && typeof error.data.data === "string") return error.data.data;
  return null;
}

/**
 * Formats integer grams to human-readable string with units (e.g. 25,000,000 g -> 25,000 kg).
 */
function formatGrams(grams: bigint | number | string): string {
  const g = BigInt(grams);
  const kg = Number(g) / 1000;
  return `${kg.toLocaleString(undefined, { maximumFractionDigits: 3 })} kg (${g.toLocaleString()} g)`;
}

/**
 * Normalizes all smart contract, wallet, and network errors into clear user-facing messages.
 */
export function parseContractError(error: any): ParsedContractError {
  if (!error) {
    return {
      title: "Unknown Error",
      explanation: "An unexpected error occurred without details.",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  // 1. Check for User Wallet Cancellation
  if (
    error.code === "ACTION_REJECTED" ||
    error.code === 4001 ||
    error.message?.includes("user rejected") ||
    error.message?.includes("User rejected the request")
  ) {
    return {
      title: "Transaction Cancelled",
      explanation: "You cancelled the transaction in your wallet. No changes were made on-chain.",
      isUserRejection: true,
      isRpcError: false,
    };
  }

  // 2. Check for Insufficient Gas Funds
  if (
    error.code === "INSUFFICIENT_FUNDS" ||
    error.message?.includes("insufficient funds")
  ) {
    return {
      title: "Insufficient Gas Funds",
      explanation: "Your wallet does not have enough Sepolia ETH to cover network gas fees.",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  // 3. Attempt Custom Error Decoding from hex data
  const dataHex = extractErrorData(error);
  if (dataHex && dataHex.length >= 10) {
    try {
      const parsed = errorInterface.parseError(dataHex);
      if (parsed) {
        return formatDecodedCustomError(parsed.name, parsed.args);
      }
    } catch {
      // Interface parsing failed, fall through to string checks
    }
  }

  // 4. Check if error object already has decoded error name (ethers v6 sometimes populates error.revert)
  if (error.revert?.name) {
    return formatDecodedCustomError(error.revert.name, error.revert.args || []);
  }

  // 5. Fallback pattern matching on error string message
  const msg = String(error.message || error.reason || "");

  if (msg.includes("SplitConservationViolation")) {
    return {
      title: "Split Rejected",
      explanation: "Child quantities must strictly equal the parent quantity. Physical mass cannot be created or lost during split.",
      errorName: "SplitConservationViolation",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("YieldExpansionNotAllowed")) {
    return {
      title: "Yield Expansion Not Allowed",
      explanation: "Processing cannot create more physical output than input. Mass expansion is prohibited on-chain.",
      errorName: "YieldExpansionNotAllowed",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("LotAlreadyConsumed")) {
    return {
      title: "Lot Already Consumed",
      explanation: "This physical lot has already been consumed by a prior split, merge, or process operation and cannot be used again.",
      errorName: "LotAlreadyConsumed",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("InsufficientCertifiedQuantity")) {
    return {
      title: "Insufficient Certified Capacity",
      explanation: "The requested consignment quantity exceeds the remaining unallocated balance of the certificate.",
      errorName: "InsufficientCertifiedQuantity",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("CertificateMismatch")) {
    return {
      title: "Certificate Mismatch",
      explanation: "The selected lots cannot be merged because they originate from different certificates. Ethical sourcing claims cannot be mixed across certificates.",
      errorName: "CertificateMismatch",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("CallerNotLotOwner")) {
    return {
      title: "Unauthorized Lot Owner",
      explanation: "Connected wallet is not the current custodian/owner of this lot according to on-chain records.",
      errorName: "CallerNotLotOwner",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("CallerNotCertificateHolder")) {
    return {
      title: "Unauthorized Certificate Holder",
      explanation: "Only the registered certificate holder address is permitted to create root consignments against this certificate.",
      errorName: "CallerNotCertificateHolder",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("IssuerNotActive")) {
    return {
      title: "Issuer Not Active",
      explanation: "Connected wallet is not registered as an active accredited certifying body in the IssuerRegistry.",
      errorName: "IssuerNotActive",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("UnauthorizedRevocation")) {
    return {
      title: "Unauthorized Revocation",
      explanation: "This wallet is not authorized to revoke this certificate. Only the original issuing body or an address with the ARBITRATION_ROLE can revoke certificates.",
      errorName: "UnauthorizedRevocation",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  if (msg.includes("CertificateAlreadyRevoked")) {
    return {
      title: "Certificate Already Revoked",
      explanation: "This certificate has already been revoked on-chain.",
      errorName: "CertificateAlreadyRevoked",
      isUserRejection: false,
      isRpcError: false,
    };
  }

  // 6. Network or RPC Errors
  if (
    error.code === "NETWORK_ERROR" ||
    msg.includes("could not detect network") ||
    msg.includes("failed to fetch") ||
    msg.includes("timeout") ||
    msg.includes("ECONNREFUSED")
  ) {
    return {
      title: "Network / RPC Communication Error",
      explanation: "Unable to communicate with the Ethereum Sepolia RPC node. Please verify your internet connection.",
      isUserRejection: false,
      isRpcError: true,
    };
  }

  // Default clean fallback
  return {
    title: "Transaction Failed",
    explanation: msg.length > 250 ? `${msg.slice(0, 250)}...` : msg || "The smart contract rejected the transaction.",
    isUserRejection: false,
    isRpcError: false,
  };
}

/**
 * Formats custom Solidity errors with parameter details into domain-specific explanations.
 */
function formatDecodedCustomError(errorName: string, args: any): ParsedContractError {
  switch (errorName) {
    case "SplitConservationViolation": {
      const parent = args[0] !== undefined ? formatGrams(args[0]) : "unknown";
      const children = args[1] !== undefined ? formatGrams(args[1]) : "unknown";
      return {
        title: "Split Rejected: Conservation Violation",
        explanation: `Child quantities (${children}) must strictly equal parent quantity (${parent}). Physical mass cannot be created or destroyed.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "YieldExpansionNotAllowed": {
      const input = args[0] !== undefined ? formatGrams(args[0]) : "unknown";
      const output = args[1] !== undefined ? formatGrams(args[1]) : "unknown";
      return {
        title: "Yield Expansion Not Allowed",
        explanation: `Processing output (${output}) cannot exceed input (${input}). Mass creation is strictly prohibited on-chain.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "InsufficientCertifiedQuantity": {
      const certId = args[0] || "certificate";
      const req = args[1] !== undefined ? formatGrams(args[1]) : "unknown";
      const rem = args[2] !== undefined ? formatGrams(args[2]) : "unknown";
      return {
        title: "Insufficient Certified Capacity",
        explanation: `Requested root quantity (${req}) exceeds remaining certificate balance (${rem}) for ${certId}.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "LotAlreadyConsumed": {
      const lotId = args[0] || "lot";
      return {
        title: "Lot Already Consumed",
        explanation: `Lot ${lotId} has already been consumed by a prior split, merge, or process operation and cannot be used again (anti-double-spending lock).`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CertificateMismatch": {
      const exp = args[0] || "initial certificate";
      const act = args[1] || "conflicting certificate";
      return {
        title: "Certificate Mismatch",
        explanation: `Cannot merge lots originating from different certificates (${exp} vs ${act}). Ethical sourcing claims cannot be mixed across certificates.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CallerNotLotOwner": {
      return {
        title: "Unauthorized Lot Owner",
        explanation: "Connected wallet is not the current custodian/owner of this lot on-chain.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CallerNotCertificateHolder": {
      return {
        title: "Unauthorized Certificate Holder",
        explanation: "Connected wallet is not the registered holder of this certificate and cannot create root consignments against it.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "IssuerNotActive": {
      return {
        title: "Issuer Not Active",
        explanation: "Connected wallet is not registered as an active accredited certifying body in the IssuerRegistry.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "LotAlreadyExists": {
      return {
        title: "Duplicate Lot ID",
        explanation: `A consignment lot with ID '${args[0]}' already exists on-chain. Please specify a unique lot ID.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CertificateAlreadyExists": {
      return {
        title: "Duplicate Certificate ID",
        explanation: `A certificate with ID '${args[0]}' already exists on-chain. Please specify a unique certificate ID.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "LotNotFound": {
      return {
        title: "Lot Not Found",
        explanation: `The lot '${args[0]}' was not found on the blockchain.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CertificateNotFound": {
      return {
        title: "Certificate Not Found",
        explanation: `The certificate '${args[0]}' was not found on the blockchain.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "InvalidChildCount": {
      return {
        title: "Invalid Split Configuration",
        explanation: "Split requires at least 2 child lots, and each child ID must have a corresponding quantity.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "InvalidParentCount": {
      return {
        title: "Invalid Merge Configuration",
        explanation: "Merge requires at least 2 parent lots.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "InvalidQuantity": {
      return {
        title: "Invalid Quantity",
        explanation: "Quantity must be a strictly positive non-zero integer.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "InvalidValidityWindow": {
      return {
        title: "Invalid Validity Window",
        explanation: "Certificate valid-from date must be strictly earlier than valid-until date.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "InvalidRecipient": {
      return {
        title: "Invalid Recipient Address",
        explanation: "Recipient cannot be the zero address or the current lot owner.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CertificateExpired": {
      return {
        title: "Certificate Expired",
        explanation: `Certificate ${args[0]} has expired and can no longer be used to issue root consignments.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CertificateHasBeenRevoked": {
      return {
        title: "Certificate Revoked",
        explanation: `Certificate ${args[0]} has been revoked and cannot be allocated.`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "UnauthorizedRevocation": {
      return {
        title: "Unauthorized Revocation",
        explanation: "This wallet is not authorized to revoke this certificate. Only the original issuing body or an address with the ARBITRATION_ROLE can revoke certificates.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    case "CertificateAlreadyRevoked": {
      return {
        title: "Certificate Already Revoked",
        explanation: "This certificate has already been revoked on-chain.",
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
    }

    default:
      return {
        title: `Contract Reverted (${errorName})`,
        explanation: `Smart contract rejected the transaction with custom error: ${errorName}`,
        errorName,
        isUserRejection: false,
        isRpcError: false,
      };
  }
}
