export const SEPOLIA_CHAIN_ID = 11155111;

export const CONTRACT_ADDRESSES = {
  CONSIGNMENT_REGISTRY: "0xC1fF045DCB2731AaFee1d398509b022Ed1F51688",
  CERTIFICATE_REGISTRY: "0x021A1289Aa4589A1a4B83C8b878a91aDD0F0C83b",
  ISSUER_REGISTRY: "0x7c787f9AbDE336c8A377f8fF08527B4e3B918dFA",
};

// Explicitly configured Sepolia providers with chainId 11155111
export const CONFIGURED_SEPOLIA_RPCS = [
  "https://ethereum-sepolia-rpc.publicnode.com",
  "https://1rpc.io/sepolia",
  "https://sepolia.gateway.tenderly.co"
];

export const INDEXER_API_BASE_URL =
  (typeof import.meta !== "undefined" && import.meta.env?.VITE_INDEXER_API_URL) ||
  "http://localhost:4000";

// Standard demo lot IDs for presentation and testing
export const DEMO_LOTS = {
  VALID: "LOT-SEPOLIA-DEMO-001",
  EXPIRED: "LOT-EXPIRED-DEMO-002",
  REVOKED: "LOT-REVOKED-DEMO-003",
  UNDER_REVIEW: "LOT-INVESTIGATION-004",
  SEPOLIA: "LOT-SEPOLIA-DEMO-001",
  SEPOLIA_REVOKED: "LOT-UI-REVOKE-DEMO-003",
  MOCK_LOCAL: "LOT-COOP-HUILA-001"
};

