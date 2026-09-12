// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IIssuerRegistry.sol";

/**
 * @title IssuerRegistry
 * @notice Authoritative on-chain registry of accredited certifying bodies for CertLedger.
 * @dev Conforms strictly to PRD v1.1 §7.1 and §8.1.
 *
 * ARCHITECTURAL NOTE ON MULTISIG / GOVERNANCE:
 * - v1: Writes (registering and revoking mirrored issuer records) are gated by `MULTISIG_ROLE`,
 *   which is assigned to a 3-of-5 Gnosis Safe multisig contract. Multisig threshold execution
 *   occurs externally in the Safe contract; this registry simply authorizes the Safe address.
 * - Production: The `MULTISIG_ROLE` can be seamlessly reassigned to consortium / DAO governance.
 */
contract IssuerRegistry is AccessControl, IIssuerRegistry {
    bytes32 public constant MULTISIG_ROLE = keccak256("MULTISIG_ROLE");

    string public constant ATTESTED_BY = "CertLedger";

    // Storage mappings
    mapping(string => IssuerRecord) private _issuersBySourceID;
    mapping(address => string) private _sourceIDByAddress;
    mapping(string => bool) private _sourceIDExists;

    // Custom errors
    error InvalidSourceID();
    error InvalidAccreditationExpiry();
    error IssuerAlreadyExists(string sourceID);
    error IssuerAddressAlreadyRegistered(address issuerAddress);
    error IssuerNotFound(string sourceID);
    error IssuerAlreadyRevoked(string sourceID);
    error IssuerInactive(string sourceID);
    error EmptyProof();

    /**
     * @param admin Initial contract administrator capable of role management
     * @param multisigAddress The 3-of-5 Gnosis Safe address acting as the initial trust root
     */
    constructor(address admin, address multisigAddress) {
        if (admin == address(0)) revert("Invalid admin address");
        if (multisigAddress == address(0)) revert("Invalid multisig address");

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(MULTISIG_ROLE, multisigAddress);
    }

    /**
     * @notice Registers a new mirrored issuer accreditation record.
     * @dev Gated strictly by MULTISIG_ROLE (3-of-5 multisig trust root).
     */
    function registerIssuer(
        string calldata sourceID,
        address issuerAddress,
        string calldata name,
        string calldata accreditingBody,
        uint256 accreditationExpiry,
        string calldata source
    ) external onlyRole(MULTISIG_ROLE) {
        if (bytes(sourceID).length == 0) revert InvalidSourceID();
        if (_sourceIDExists[sourceID]) revert IssuerAlreadyExists(sourceID);
        if (accreditationExpiry <= block.timestamp) revert InvalidAccreditationExpiry();

        if (issuerAddress != address(0)) {
            if (bytes(_sourceIDByAddress[issuerAddress]).length != 0) {
                revert IssuerAddressAlreadyRegistered(issuerAddress);
            }
            _sourceIDByAddress[issuerAddress] = sourceID;
        }

        _issuersBySourceID[sourceID] = IssuerRecord({
            issuerAddress: issuerAddress,
            name: name,
            accreditingBody: accreditingBody,
            accreditationExpiry: accreditationExpiry,
            attestedBy: ATTESTED_BY,
            source: source,
            sourceID: sourceID,
            verifiedOwner: address(0),
            isRevoked: false,
            exists: true
        });

        _sourceIDExists[sourceID] = true;

        emit IssuerRegistered(sourceID, issuerAddress, name, accreditingBody, accreditationExpiry);
    }

    /**
     * @notice Revokes an issuer's accreditation record.
     * @dev Gated strictly by MULTISIG_ROLE (or future arbitration/governance).
     */
    function revokeIssuer(string calldata sourceID, string calldata reason)
        external
        onlyRole(MULTISIG_ROLE)
    {
        if (!_sourceIDExists[sourceID]) revert IssuerNotFound(sourceID);

        IssuerRecord storage record = _issuersBySourceID[sourceID];
        if (record.isRevoked) revert IssuerAlreadyRevoked(sourceID);

        record.isRevoked = true;

        emit IssuerRevoked(sourceID, record.issuerAddress, reason, msg.sender);
    }

    /**
     * @notice Allows a real certifying body to claim ownership of their mirrored record.
     * @dev v1 stub per PRD §7.1. Validates proof presence and assigns verifiedOwner.
     */
    function claimIssuerRecord(string calldata sourceID, bytes calldata proof) external {
        if (!_sourceIDExists[sourceID]) revert IssuerNotFound(sourceID);
        if (proof.length == 0) revert EmptyProof();

        IssuerRecord storage record = _issuersBySourceID[sourceID];
        if (record.isRevoked) revert IssuerAlreadyRevoked(sourceID);

        address prevAddress = record.issuerAddress;
        record.verifiedOwner = msg.sender;

        if (record.issuerAddress == address(0)) {
            if (bytes(_sourceIDByAddress[msg.sender]).length != 0) {
                revert IssuerAddressAlreadyRegistered(msg.sender);
            }
            record.issuerAddress = msg.sender;
            _sourceIDByAddress[msg.sender] = sourceID;
        }

        emit IssuerRecordClaimed(sourceID, prevAddress, msg.sender);
    }

    /**
     * @notice Computes live issuer status dynamically without state mutation.
     */
    function getIssuerStatus(address issuer) public view override returns (IssuerStatus) {
        if (issuer == address(0)) return IssuerStatus.Inactive;

        string memory sourceID = _sourceIDByAddress[issuer];
        if (bytes(sourceID).length == 0) return IssuerStatus.Inactive;

        IssuerRecord storage record = _issuersBySourceID[sourceID];
        if (!record.exists) return IssuerStatus.Inactive;
        if (record.isRevoked) return IssuerStatus.Revoked;
        if (block.timestamp > record.accreditationExpiry) return IssuerStatus.Expired;

        return IssuerStatus.Active;
    }

    /**
     * @notice Computes live issuer status dynamically using sourceID (supports unclaimed records).
     */
    function getIssuerStatusBySourceID(string calldata sourceID)
        public
        view
        override
        returns (IssuerStatus)
    {
        if (!_sourceIDExists[sourceID]) return IssuerStatus.Inactive;

        IssuerRecord storage record = _issuersBySourceID[sourceID];
        if (!record.exists) return IssuerStatus.Inactive;
        if (record.isRevoked) return IssuerStatus.Revoked;
        if (block.timestamp > record.accreditationExpiry) return IssuerStatus.Expired;

        return IssuerStatus.Active;
    }

    /**
     * @notice Convenience check for active status.
     */
    function isIssuerActive(address issuer) external view override returns (bool) {
        return getIssuerStatus(issuer) == IssuerStatus.Active;
    }

    function getIssuerBySourceID(string calldata sourceID)
        external
        view
        override
        returns (IssuerRecord memory)
    {
        if (!_sourceIDExists[sourceID]) revert IssuerNotFound(sourceID);
        return _issuersBySourceID[sourceID];
    }

    function getIssuerByAddress(address issuer)
        external
        view
        override
        returns (IssuerRecord memory)
    {
        string memory sourceID = _sourceIDByAddress[issuer];
        if (bytes(sourceID).length == 0) revert IssuerNotFound("");
        return _issuersBySourceID[sourceID];
    }
}
