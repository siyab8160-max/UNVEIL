// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IIssuerRegistry
 * @dev Interface for the CertLedger Issuer Registry according to PRD v1.1 §7.1.
 */
interface IIssuerRegistry {
    enum IssuerStatus {
        Inactive,
        Active,
        Expired,
        Revoked
    }

    struct IssuerRecord {
        address issuerAddress;    // Address of the issuer (can be address(0) for mirrored records until claimed)
        string name;              // Name of the accredited certifying body
        string accreditingBody;    // Name of the accrediting entity (e.g. IAF member, USDA, etc.)
        uint256 accreditationExpiry; // Unix timestamp of accreditation expiration
        string attestedBy;        // Platform attestation label (e.g. "CertLedger")
        string source;            // Source registry (e.g. "IAF CertSearch", "USDA Organic Database")
        string sourceID;          // Unique external registry identifier
        address verifiedOwner;    // Set once real issuer claims the mirrored record
        bool isRevoked;           // Explicit revocation flag
        bool exists;              // Existence flag
    }

    event IssuerRegistered(
        string indexed sourceID,
        address indexed issuerAddress,
        string name,
        string accreditingBody,
        uint256 accreditationExpiry
    );

    event IssuerRevoked(
        string indexed sourceID,
        address indexed issuerAddress,
        string reason,
        address indexed revokedBy
    );

    event IssuerRecordClaimed(
        string indexed sourceID,
        address indexed previousAddress,
        address indexed newOwner
    );

    function getIssuerStatus(address issuer) external view returns (IssuerStatus);
    function getIssuerStatusBySourceID(string calldata sourceID) external view returns (IssuerStatus);
    function isIssuerActive(address issuer) external view returns (bool);
    function getIssuerBySourceID(string calldata sourceID) external view returns (IssuerRecord memory);
    function getIssuerByAddress(address issuer) external view returns (IssuerRecord memory);
}
