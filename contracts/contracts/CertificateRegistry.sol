// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/ICertificateRegistry.sol";
import "./interfaces/IIssuerRegistry.sol";

/**
 * @title CertificateRegistry
 * @notice Authoritative on-chain registry of ethical sourcing certificates and certified capacity.
 * @dev Conforms strictly to PRD v1.1 §7.2 and §8.1.
 *
 * OWNERSHIP & MASS-BALANCE BOUNDARIES:
 * - Single source of truth for certified capacity (`certifiedQuantityGrams`, `remainingQuantityGrams`)
 *   and live certificate status.
 * - Single-point mass-balance consumption (`consumeCertifiedQuantity`) is callable EXCLUSIVELY
 *   by the authorized `ConsignmentRegistry` contract for the root physical production event.
 * - Derived operations (splits, merges, processing, transfers) never interact with this registry.
 */
contract CertificateRegistry is AccessControl, ICertificateRegistry {
    bytes32 public constant ARBITRATION_ROLE = keccak256("ARBITRATION_ROLE");
    bytes32 public constant CONSIGNMENT_REGISTRY_ROLE = keccak256("CONSIGNMENT_REGISTRY_ROLE");

    string public constant ATTESTED_BY = "CertLedger";

    IIssuerRegistry public immutable issuerRegistry;

    mapping(string => Certificate) private _certificates;
    mapping(string => bool) private _certificateExists;

    // Custom errors
    error InvalidIssuerRegistry();
    error IssuerNotActive(address issuer);
    error InvalidCertificateID();
    error CertificateAlreadyExists(string certificateID);
    error CertificateNotFound(string certificateID);
    error InvalidHolder();
    error InvalidQuantity();
    error InvalidValidityWindow();
    error CertificateNotYetActive(string certificateID, uint256 validFrom);
    error CertificateExpired(string certificateID, uint256 validUntil);
    error CertificateHasBeenRevoked(string certificateID);
    error CertificateAlreadyRevoked(string certificateID);
    error InvalidCertificateStatus(string certificateID);
    error CallerNotCertificateHolder(address caller, address holder);
    error InsufficientCertifiedQuantity(
        string certificateID,
        uint256 requestedQuantityGrams,
        uint256 remainingQuantityGrams
    );
    error UnauthorizedRevocation(address caller);

    /**
     * @param admin Initial administrator capable of managing roles
     * @param _issuerRegistry Address of the deployed authoritative IssuerRegistry
     * @param arbitrationAddress Address designated with ARBITRATION_ROLE for dispute resolution
     */
    constructor(
        address admin,
        address _issuerRegistry,
        address arbitrationAddress
    ) {
        if (admin == address(0)) revert("Invalid admin address");
        if (_issuerRegistry == address(0)) revert InvalidIssuerRegistry();

        _grantRole(DEFAULT_ADMIN_ROLE, admin);

        if (arbitrationAddress != address(0)) {
            _grantRole(ARBITRATION_ROLE, arbitrationAddress);
        }

        issuerRegistry = IIssuerRegistry(_issuerRegistry);
    }

    /**
     * @notice Issues a new ethical sourcing certificate bound to a standard and holder.
     * @dev Caller must have active accreditation status in IssuerRegistry.
     */
    function issueCertificate(
        string calldata certificateID,
        string calldata standardID,
        address holder,
        uint256 certifiedQuantityGrams,
        uint256 validFrom,
        uint256 validUntil,
        string calldata source,
        string calldata sourceID
    ) external {
        if (!issuerRegistry.isIssuerActive(msg.sender)) {
            revert IssuerNotActive(msg.sender);
        }
        if (bytes(certificateID).length == 0) revert InvalidCertificateID();
        if (_certificateExists[certificateID]) revert CertificateAlreadyExists(certificateID);
        if (holder == address(0)) revert InvalidHolder();
        if (certifiedQuantityGrams == 0) revert InvalidQuantity();
        if (validFrom >= validUntil) revert InvalidValidityWindow();

        _certificates[certificateID] = Certificate({
            certificateID: certificateID,
            issuer: msg.sender,
            standardID: standardID,
            holder: holder,
            certifiedQuantityGrams: certifiedQuantityGrams,
            remainingQuantityGrams: certifiedQuantityGrams,
            validFrom: validFrom,
            validUntil: validUntil,
            isRevoked: false,
            revocationReason: "",
            revokedBy: address(0),
            attestedBy: ATTESTED_BY,
            source: source,
            sourceID: sourceID
        });

        _certificateExists[certificateID] = true;

        emit CertificateIssued(
            certificateID,
            msg.sender,
            holder,
            standardID,
            certifiedQuantityGrams,
            validFrom,
            validUntil
        );
    }

    /**
     * @notice Deducts certified quota upon root consignment creation.
     * @dev Gated strictly to CONSIGNMENT_REGISTRY_ROLE.
     * Enforces single-point mass-balance consumption at the physical creation root.
     */
    function consumeCertifiedQuantity(
        string calldata certificateID,
        address caller,
        uint256 quantityGrams
    ) external override onlyRole(CONSIGNMENT_REGISTRY_ROLE) {
        if (!_certificateExists[certificateID]) revert CertificateNotFound(certificateID);
        if (quantityGrams == 0) revert InvalidQuantity();

        Certificate storage cert = _certificates[certificateID];

        if (caller != cert.holder) {
            revert CallerNotCertificateHolder(caller, cert.holder);
        }

        CertificateStatus status = getCertificateStatus(certificateID);
        if (status != CertificateStatus.Valid) {
            if (status == CertificateStatus.NotYetActive) {
                revert CertificateNotYetActive(certificateID, cert.validFrom);
            }
            if (status == CertificateStatus.Expired) {
                revert CertificateExpired(certificateID, cert.validUntil);
            }
            if (status == CertificateStatus.Revoked) {
                revert CertificateHasBeenRevoked(certificateID);
            }
            revert InvalidCertificateStatus(certificateID);
        }

        if (quantityGrams > cert.remainingQuantityGrams) {
            emit MassBalanceAlert(
                certificateID,
                caller,
                quantityGrams,
                cert.remainingQuantityGrams,
                "Requested quantity exceeds remaining certified balance"
            );
            revert InsufficientCertifiedQuantity(
                certificateID,
                quantityGrams,
                cert.remainingQuantityGrams
            );
        }

        cert.remainingQuantityGrams -= quantityGrams;

        emit CertifiedQuantityConsumed(
            certificateID,
            caller,
            quantityGrams,
            cert.remainingQuantityGrams
        );
    }

    /**
     * @notice Revokes a certificate.
     * @dev Only callable by the original issuing body OR the authorized arbitration role.
     */
    function revokeCertificate(string calldata certificateID, string calldata reason) external {
        if (!_certificateExists[certificateID]) revert CertificateNotFound(certificateID);

        Certificate storage cert = _certificates[certificateID];
        if (cert.isRevoked) revert CertificateAlreadyRevoked(certificateID);

        bool isIssuer = (msg.sender == cert.issuer);
        bool isArbitrator = hasRole(ARBITRATION_ROLE, msg.sender);

        if (!isIssuer && !isArbitrator) {
            revert UnauthorizedRevocation(msg.sender);
        }

        cert.isRevoked = true;
        cert.revocationReason = reason;
        cert.revokedBy = msg.sender;

        emit CertificateRevoked(certificateID, msg.sender, reason);
    }

    /**
     * @notice Computes live certificate status dynamically from block timestamp and flags.
     */
    function getCertificateStatus(string calldata certificateID)
        public
        view
        override
        returns (CertificateStatus)
    {
        if (!_certificateExists[certificateID]) return CertificateStatus.None;

        Certificate storage cert = _certificates[certificateID];
        if (cert.isRevoked) return CertificateStatus.Revoked;
        if (block.timestamp < cert.validFrom) return CertificateStatus.NotYetActive;
        if (block.timestamp > cert.validUntil) return CertificateStatus.Expired;

        return CertificateStatus.Valid;
    }

    function getCertificate(string calldata certificateID)
        external
        view
        override
        returns (Certificate memory)
    {
        if (!_certificateExists[certificateID]) revert CertificateNotFound(certificateID);
        return _certificates[certificateID];
    }

    function getRemainingQuantity(string calldata certificateID)
        external
        view
        override
        returns (uint256)
    {
        if (!_certificateExists[certificateID]) revert CertificateNotFound(certificateID);
        return _certificates[certificateID].remainingQuantityGrams;
    }
}
