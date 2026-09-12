import crypto from "crypto";
import { ethers } from "ethers";
import { CONFIG } from "./config";

export interface SiweParsedMessage {
  domain: string;
  address: string;
  statement: string;
  uri: string;
  version: string;
  chainId: number;
  nonce: string;
  issuedAt: string;
  expirationTime?: string;
  raw: string;
}

export interface AuthSession {
  token: string;
  address: string;
  chainId: number;
  createdAt: number;
  expiresAt: number;
}

/**
 * Server-side SIWE Authentication Service
 * 
 * ARCHITECTURAL BOUNDARY:
 * - SIWE authenticates who controls the Ethereum wallet (Application Authentication).
 * - SIWE does NOT grant smart contract authorization or bypass contract roles.
 * - Nonce store enforces single-use replay protection.
 * - Enforces Ethereum Sepolia (chainId 11155111).
 */
export class AuthService {
  // Nonce storage: nonce -> expiry timestamp (ms)
  private activeNonces: Map<string, number> = new Map();
  // Session storage: token -> AuthSession
  private activeSessions: Map<string, AuthSession> = new Map();

  private readonly NONCE_TTL_MS = 5 * 60 * 1000; // 5 minutes
  private readonly SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor() {
    // Periodic cleanup of expired nonces and sessions
    setInterval(() => this.cleanupExpired(), 60 * 1000).unref();
  }

  /**
   * Generates a single-use cryptographically secure nonce for SIWE.
   */
  public generateNonce(): string {
    const nonce = crypto.randomBytes(16).toString("hex");
    this.activeNonces.set(nonce, Date.now() + this.NONCE_TTL_MS);
    return nonce;
  }

  /**
   * Validates and immediately consumes a nonce (single-use anti-replay).
   */
  public consumeNonce(nonce: string): boolean {
    const expiry = this.activeNonces.get(nonce);
    if (!expiry) return false;
    
    // Immediately delete to prevent replay
    this.activeNonces.delete(nonce);
    
    return Date.now() <= expiry;
  }

  /**
   * Parses an EIP-4361 formatted text message into structured fields.
   */
  public parseSiweMessage(message: string): SiweParsedMessage | null {
    try {
      // EIP-4361 regex parsing
      // Line 1: ${domain} wants you to sign in with your Ethereum account:
      // Line 2: ${address}
      const domainAddressMatch = message.match(/^([^\n]+) wants you to sign in with your Ethereum account:\n(0x[a-fA-F0-9]{40})/m);
      if (!domainAddressMatch) return null;

      const domain = domainAddressMatch[1].trim();
      const address = ethers.getAddress(domainAddressMatch[2].trim());

      // URI
      const uriMatch = message.match(/URI:\s*([^\n]+)/);
      const uri = uriMatch ? uriMatch[1].trim() : "";

      // Version
      const versionMatch = message.match(/Version:\s*([^\n]+)/);
      const version = versionMatch ? versionMatch[1].trim() : "1";

      // Chain ID
      const chainIdMatch = message.match(/Chain ID:\s*([0-9]+)/);
      const chainId = chainIdMatch ? parseInt(chainIdMatch[1].trim(), 10) : 0;

      // Nonce
      const nonceMatch = message.match(/Nonce:\s*([a-zA-Z0-9]+)/);
      const nonce = nonceMatch ? nonceMatch[1].trim() : "";

      // Issued At
      const issuedAtMatch = message.match(/Issued At:\s*([^\n]+)/);
      const issuedAt = issuedAtMatch ? issuedAtMatch[1].trim() : "";

      // Expiration Time (optional)
      const expMatch = message.match(/Expiration Time:\s*([^\n]+)/);
      const expirationTime = expMatch ? expMatch[1].trim() : undefined;

      // Statement
      const statementMatch = message.match(/account:\n0x[a-fA-F0-9]{40}\n\n([^\n]+)\n\n/);
      const statement = statementMatch ? statementMatch[1].trim() : "";

      return {
        domain,
        address,
        statement,
        uri,
        version,
        chainId,
        nonce,
        issuedAt,
        expirationTime,
        raw: message,
      };
    } catch {
      return null;
    }
  }

  /**
   * Verifies the EIP-4361 message and signature against server-side nonce and chain ID.
   */
  public verifySignature(
    messageText: string,
    signature: string
  ): { success: boolean; session?: AuthSession; error?: string } {
    const parsed = this.parseSiweMessage(messageText);
    if (!parsed) {
      return { success: false, error: "Invalid EIP-4361 SIWE message format" };
    }

    // 1. Enforce Ethereum Sepolia chainId (11155111)
    if (parsed.chainId !== CONFIG.CHAIN_ID) {
      return {
        success: false,
        error: `Network mismatch: expected chain ID ${CONFIG.CHAIN_ID} (Sepolia), received ${parsed.chainId}`,
      };
    }

    // 2. Validate and consume nonce (Anti-replay protection)
    const isNonceValid = this.consumeNonce(parsed.nonce);
    if (!isNonceValid) {
      return {
        success: false,
        error: "Invalid, expired, or already-consumed nonce. SIWE authentication cannot be replayed.",
      };
    }

    // 3. Cryptographically recover signer address
    try {
      const recoveredAddress = ethers.verifyMessage(messageText, signature);
      if (ethers.getAddress(recoveredAddress) !== parsed.address) {
        return {
          success: false,
          error: "Signature recovery mismatch: signature does not match claimed address",
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: `Cryptographic signature verification failed: ${err.message}`,
      };
    }

    // 4. Issue server-side session token
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const session: AuthSession = {
      token,
      address: parsed.address,
      chainId: parsed.chainId,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL_MS,
    };

    this.activeSessions.set(token, session);
    return { success: true, session };
  }

  /**
   * Directly creates an authenticated session (for testing or server initialization).
   */
  public createSession(address: string, chainId: number = CONFIG.CHAIN_ID): AuthSession {
    const token = crypto.randomBytes(32).toString("hex");
    const now = Date.now();
    const session: AuthSession = {
      token,
      address: ethers.getAddress(address),
      chainId,
      createdAt: now,
      expiresAt: now + this.SESSION_TTL_MS,
    };
    this.activeSessions.set(token, session);
    return session;
  }

  /**
   * Retrieves an active session by token.
   */
  public getSession(token: string): AuthSession | null {
    const session = this.activeSessions.get(token);
    if (!session) return null;
    if (Date.now() > session.expiresAt) {
      this.activeSessions.delete(token);
      return null;
    }
    return session;
  }

  /**
   * Invalidates a session token (logout).
   */
  public revokeSession(token: string): boolean {
    return this.activeSessions.delete(token);
  }

  private cleanupExpired(): void {
    const now = Date.now();
    for (const [nonce, expiry] of this.activeNonces.entries()) {
      if (now > expiry) this.activeNonces.delete(nonce);
    }
    for (const [token, session] of this.activeSessions.entries()) {
      if (now > session.expiresAt) this.activeSessions.delete(token);
    }
  }
}

export const authService = new AuthService();
export default authService;
