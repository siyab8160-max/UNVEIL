import { Interface, Log } from "ethers";
import { ISSUER_REGISTRY_ABI, CERTIFICATE_REGISTRY_ABI, CONSIGNMENT_REGISTRY_ABI } from "./abi";

const issuerInterface = new Interface(ISSUER_REGISTRY_ABI);
const certificateInterface = new Interface(CERTIFICATE_REGISTRY_ABI);
const consignmentInterface = new Interface(CONSIGNMENT_REGISTRY_ABI);

export interface ParsedEvent {
  contractType: "IssuerRegistry" | "CertificateRegistry" | "ConsignmentRegistry" | "Unknown";
  eventName: string;
  args: Record<string, any>;
}

export function parseContractLog(log: { address: string; topics: readonly string[]; data: string }): ParsedEvent | null {
  // Try CertificateRegistry first
  try {
    const parsed = certificateInterface.parseLog({ topics: log.topics as string[], data: log.data });
    if (parsed) {
      return {
        contractType: "CertificateRegistry",
        eventName: parsed.name,
        args: serializeEventArgs(parsed.args),
      };
    }
  } catch {}

  // Try ConsignmentRegistry
  try {
    const parsed = consignmentInterface.parseLog({ topics: log.topics as string[], data: log.data });
    if (parsed) {
      return {
        contractType: "ConsignmentRegistry",
        eventName: parsed.name,
        args: serializeEventArgs(parsed.args),
      };
    }
  } catch {}

  // Try IssuerRegistry
  try {
    const parsed = issuerInterface.parseLog({ topics: log.topics as string[], data: log.data });
    if (parsed) {
      return {
        contractType: "IssuerRegistry",
        eventName: parsed.name,
        args: serializeEventArgs(parsed.args),
      };
    }
  } catch {}

  return null;
}

function serializeEventArgs(args: any): Record<string, any> {
  const result: Record<string, any> = {};
  for (const key of Object.keys(args)) {
    // Ignore numeric indices
    if (!isNaN(Number(key))) continue;
    result[key] = serializeValue(args[key]);
  }
  return result;
}

function serializeValue(val: any): any {
  if (typeof val === "bigint") {
    return val.toString();
  }
  if (Array.isArray(val)) {
    return val.map(serializeValue);
  }
  if (val && typeof val === "object" && typeof val.toString === "function" && val._isBigNumber) {
    return val.toString();
  }
  return val;
}
