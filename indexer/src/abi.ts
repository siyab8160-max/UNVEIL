export const ISSUER_REGISTRY_ABI = [
  "event IssuerRegistered(string indexed sourceID, address indexed issuerAddress, string name, string accreditingBody, uint256 accreditationExpiry)",
  "event IssuerRevoked(string indexed sourceID, address indexed issuerAddress, string reason, address indexed revokedBy)",
  "event IssuerRecordClaimed(string indexed sourceID, address indexed previousAddress, address indexed newOwner)",
  "function getIssuerStatus(address issuer) external view returns (uint8)",
  "function getIssuerStatusBySourceID(string calldata sourceID) external view returns (uint8)",
  "function isIssuerActive(address issuer) external view returns (bool)",
  "function getIssuerBySourceID(string calldata sourceID) external view returns (tuple(address issuerAddress, string name, string accreditingBody, uint256 accreditationExpiry, string attestedBy, string source, string sourceID, address verifiedOwner, bool isRevoked, bool exists))"
] as const;

export const CERTIFICATE_REGISTRY_ABI = [
  "event CertificateIssued(string indexed certificateID, address indexed issuer, address indexed holder, string standardID, uint256 certifiedQuantityGrams, uint256 validFrom, uint256 validUntil)",
  "event CertificateRevoked(string indexed certificateID, address indexed revokedBy, string reason)",
  "event CertifiedQuantityConsumed(string indexed certificateID, address indexed holder, uint256 quantityConsumedGrams, uint256 remainingQuantityGrams)",
  "event MassBalanceAlert(string indexed certificateID, address indexed caller, uint256 requestedQuantityGrams, uint256 remainingQuantityGrams, string reason)",
  "function getCertificateStatus(string calldata certificateID) external view returns (uint8)",
  "function getRemainingQuantity(string calldata certificateID) external view returns (uint256)",
  "function getCertificate(string calldata certificateID) external view returns (tuple(string certificateID, address issuer, string standardID, address holder, uint256 certifiedQuantityGrams, uint256 remainingQuantityGrams, uint256 validFrom, uint256 validUntil, bool isRevoked, string revocationReason, address revokedBy, string attestedBy, string source, string sourceID))"
] as const;

export const CONSIGNMENT_REGISTRY_ABI = [
  "event RootConsignmentCreated(string indexed lotID, string indexed certificateID, address indexed holder, uint256 quantityGrams)",
  "event LotSplit(string indexed parentLotID, string[] childLotIDs, uint256[] childQuantitiesGrams, address indexed owner)",
  "event LotsMerged(string[] parentLotIDs, string indexed newLotID, uint256 newQuantityGrams, address indexed owner)",
  "event LotProcessed(string indexed parentLotID, string indexed newLotID, uint256 inputQuantityGrams, uint256 outputQuantityGrams, string processDetails, address indexed owner)",
  "event LotTransferred(string indexed lotID, address indexed previousOwner, address indexed newOwner)",
  "function getLot(string calldata lotID) external view returns (tuple(string lotID, string certificateID, uint256 quantityGrams, address currentOwner, uint8 status, uint256 createdAt, string[] parentLotIDs, string[] childLotIDs))",
  "function getConsignmentHistory(string calldata lotID) external view returns (tuple(tuple(string lotID, string certificateID, uint256 quantityGrams, address currentOwner, uint8 status, uint256 createdAt, string[] parentLotIDs, string[] childLotIDs) lot, string[] parentLotIDs, string[] childLotIDs))"
] as const;
