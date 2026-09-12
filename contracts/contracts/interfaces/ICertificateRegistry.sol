// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ICertificateRegistry
 * @dev Interface for the UNVEIL Certificate Registry according to PRD v1.1 §7.2.
 */
interface ICertificateRegistry {
    enum CertificateStatus {
        None,          // Certificate does not exist
        NotYetActive,  // block.timestamp < validFrom
        Valid,         // Active, not expired, not revoked
        Expired,       // block.timestamp > validUntil
        Revoked        // Explicitly revoked
    }

    struct Certificate {
        string certificateID;           // Unique certificate identifier
        address issuer;                 // Address of the certifying body that issued it
        string standardID;             // References Standard (e.g. "ISO-14001", "ORGANIC-NOP")
        address holder;                // Authorized producer/supplier for root consignment creation
        uint256 certifiedQuantityGrams;// Total accredited capacity in integer grams
        uint256 remainingQuantityGrams;// Remaining unallocated capacity in integer grams
        uint256 validFrom;             // Unix timestamp of validity start
        uint256 validUntil;            // Unix timestamp of validity expiration
        bool isRevoked;                // Revocation status flag
        string revocationReason;       // Reason recorded upon revocation
        address revokedBy;             // Entity that triggered revocation
        string attestedBy;             // Platform attestation provenance (e.g. "CertLedger")
        string source;                 // Mirror source
        string sourceID;               // External source identifier
    }

    event CertificateIssued(
        string indexed certificateID,
        address indexed issuer,
        address indexed holder,
        string standardID,
        uint256 certifiedQuantityGrams,
        uint256 validFrom,
        uint256 validUntil
    );

    event CertificateRevoked(
        string indexed certificateID,
        address indexed revokedBy,
        string reason
    );

    event CertifiedQuantityConsumed(
        string indexed certificateID,
        address indexed holder,
        uint256 quantityConsumedGrams,
        uint256 remainingQuantityGrams
    );

    event MassBalanceAlert(
        string indexed certificateID,
        address indexed caller,
        uint256 requestedQuantityGrams,
        uint256 remainingQuantityGrams,
        string reason
    );

    function getCertificate(string calldata certificateID) external view returns (Certificate memory);
    function getCertificateStatus(string calldata certificateID) external view returns (CertificateStatus);
    function getRemainingQuantity(string calldata certificateID) external view returns (uint256);
    function consumeCertifiedQuantity(
        string calldata certificateID,
        address caller,
        uint256 quantityGrams
    ) external;
}
