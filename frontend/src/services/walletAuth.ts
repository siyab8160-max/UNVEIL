import { BrowserProvider, type Signer } from "ethers";
import { SEPOLIA_CHAIN_ID, INDEXER_API_BASE_URL } from "./config";

export interface SiweSession {
  token: string;
  address: string;
  chainId: number;
  expiresAt: number;
}

export interface SiweMessageParams {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
}

const SESSION_STORAGE_KEY = "certledger_siwe_session";

/**
 * Builds standard EIP-4361 SIWE text message.
 */
export function generateSiweMessage(params: SiweMessageParams): string {
  return (
    `${params.domain} wants you to sign in with your Ethereum account:\n` +
    `${params.address}\n\n` +
    `${params.statement}\n\n` +
    `URI: ${params.uri}\n` +
    `Version: ${params.version}\n` +
    `Chain ID: ${params.chainId}\n` +
    `Nonce: ${params.nonce}\n` +
    `Issued At: ${params.issuedAt}`
  );
}

/**
 * Fetch fresh single-use nonce from server-side verification boundary.
 */
export async function fetchServerNonce(): Promise<string> {
  const res = await fetch(`${INDEXER_API_BASE_URL}/api/auth/nonce`);
  if (!res.ok) {
    throw new Error(`Failed to obtain authentication nonce from server: ${res.statusText}`);
  }
  const data = await res.json();
  return data.nonce;
}

/**
 * Inspect connected network chain ID.
 */
export async function getNetworkInfo(provider: BrowserProvider): Promise<{
  chainId: number;
  isSepolia: boolean;
  name: string;
}> {
  const network = await provider.getNetwork();
  const chainId = Number(network.chainId);
  return {
    chainId,
    isSepolia: chainId === SEPOLIA_CHAIN_ID,
    name: chainId === SEPOLIA_CHAIN_ID ? "Ethereum Sepolia" : `Unsupported (${chainId})`,
  };
}

/**
 * Executes full SIWE flow with server-side signature verification.
 * 
 * Flow:
 * 1. Checks Sepolia network (Chain ID 11155111)
 * 2. Fetches server nonce
 * 3. Builds EIP-4361 message
 * 4. Signs with wallet personal sign
 * 5. Sends message + signature to backend verification endpoint (/api/auth/verify)
 * 6. Server verifies signature, validates chainId & consumes nonce (anti-replay)
 * 7. Stores authenticated session token
 */
export async function signInWithEthereum(
  signer: Signer,
  provider: BrowserProvider
): Promise<SiweSession> {
  const network = await getNetworkInfo(provider);
  if (!network.isSepolia) {
    throw new Error(
      `Network mismatch: Wallet is connected to Chain ID ${network.chainId}. Ethereum Sepolia (11155111) is required.`
    );
  }

  const address = await signer.getAddress();
  const nonce = await fetchServerNonce();

  const domain = typeof window !== "undefined" ? window.location.host : "localhost:5173";
  const uri = typeof window !== "undefined" ? window.location.origin : "http://localhost:5173";
  const issuedAt = new Date().toISOString();

  const message = generateSiweMessage({
    domain,
    address,
    statement: "Sign in to CertLedger to access the Issuer & Producer Dashboard.",
    uri,
    version: "1",
    chainId: SEPOLIA_CHAIN_ID,
    nonce,
    issuedAt,
  });

  // Prompt wallet signature
  const signature = await signer.signMessage(message);

  // Submit to server-side authentication boundary
  const verifyRes = await fetch(`${INDEXER_API_BASE_URL}/api/auth/verify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, signature }),
  });

  const verifyData = await verifyRes.json();
  if (!verifyRes.ok || !verifyData.success) {
    throw new Error(verifyData.error || "Server-side SIWE signature verification failed.");
  }

  const session: SiweSession = verifyData.session;
  if (typeof window !== "undefined" && window.sessionStorage) {
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  }

  return session;
}

/**
 * Retrieves cached active session from sessionStorage.
 */
export function getCachedSession(): SiweSession | null {
  if (typeof window === "undefined" || !window.sessionStorage) return null;
  const raw = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
  if (!raw) return null;
  try {
    const session: SiweSession = JSON.parse(raw);
    if (Date.now() > session.expiresAt) {
      window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

/**
 * Validates session against server.
 */
export async function validateSessionWithServer(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${INDEXER_API_BASE_URL}/api/auth/session`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await res.json();
    return Boolean(data.authenticated);
  } catch {
    return false;
  }
}

/**
 * Signs out and revokes server-side session.
 */
export async function signOut(token?: string): Promise<void> {
  const activeToken = token || getCachedSession()?.token;
  if (activeToken) {
    try {
      await fetch(`${INDEXER_API_BASE_URL}/api/auth/logout`, {
        method: "POST",
        headers: { Authorization: `Bearer ${activeToken}` },
      });
    } catch {
      // Ignore network errors during logout
    }
  }
  if (typeof window !== "undefined" && window.sessionStorage) {
    window.sessionStorage.removeItem(SESSION_STORAGE_KEY);
  }
}
