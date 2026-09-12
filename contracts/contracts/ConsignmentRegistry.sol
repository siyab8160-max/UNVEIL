// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "./interfaces/IConsignmentRegistry.sol";
import "./interfaces/ICertificateRegistry.sol";

/**
 * @title ConsignmentRegistry
 * @notice Registry of traceable product consignments (Lots) for UNVEIL.
 * @dev Conforms strictly to PRD v1.1 §7.3 and §8.1.
 *
 * OWNERSHIP & MASS-BALANCE BOUNDARIES:
 * - Single source of truth for physical lots (`Lot.quantityGrams`, `Lot.currentOwner`, `Lot.status`, lineage).
 * - Root consignment (`parentLotIDs = []`): The ONLY point where `CertificateRegistry.consumeCertifiedQuantity()`
 *   is called to allocate certified capacity into physical material.
 * - Derived consignments (split, merge, process, transfer): NEVER consume or modify certificate capacity.
 * - Consumed-lot lock: When a lot is split, merged, or processed, its status transitions irreversibly
 *   to `Consumed`, preventing double-spending of physical mass.
 */
contract ConsignmentRegistry is IConsignmentRegistry {
    ICertificateRegistry public immutable certificateRegistry;

    mapping(string => Lot) private _lots;
    mapping(string => bool) private _lotExists;

    // Custom errors
    error InvalidCertificateRegistry();
    error InvalidLotID();
    error LotAlreadyExists(string lotID);
    error LotNotFound(string lotID);
    error InvalidQuantity();
    error CallerNotLotOwner(address caller, address currentOwner);
    error LotAlreadyConsumed(string lotID);
    error InvalidChildCount();
    error SplitConservationViolation(uint256 parentQuantity, uint256 childSum);
    error InvalidParentCount();
    error YieldExpansionNotAllowed(uint256 inputQuantity, uint256 outputQuantity);
    error InvalidRecipient();
    error CertificateMismatch(string expectedCertificateID, string actualCertificateID);

    /**
     * @param _certificateRegistry Address of the deployed authoritative CertificateRegistry
     */
    constructor(address _certificateRegistry) {
        if (_certificateRegistry == address(0)) revert InvalidCertificateRegistry();
        certificateRegistry = ICertificateRegistry(_certificateRegistry);
    }

    /**
     * @notice Creates a root consignment ("Produced" event, parentLotIDs = []).
     * @dev This is the ONLY operation that consumes certificate balance.
     * Caller must be the certificate's registered holder.
     */
    function createRootConsignment(
        string calldata lotID,
        string calldata certificateID,
        uint256 quantityGrams
    ) external override {
        if (bytes(lotID).length == 0) revert InvalidLotID();
        if (_lotExists[lotID]) revert LotAlreadyExists(lotID);
        if (quantityGrams == 0) revert InvalidQuantity();

        // Authoritative single-point mass-balance consumption.
        // Reverts if caller != holder, certificate invalid/not active/expired/revoked, or insufficient capacity.
        certificateRegistry.consumeCertifiedQuantity(certificateID, msg.sender, quantityGrams);

        Lot storage rootLot = _lots[lotID];
        rootLot.lotID = lotID;
        rootLot.certificateID = certificateID;
        rootLot.quantityGrams = quantityGrams;
        rootLot.currentOwner = msg.sender;
        rootLot.status = LotStatus.Active;
        rootLot.createdAt = block.timestamp;

        _lotExists[lotID] = true;

        emit RootConsignmentCreated(lotID, certificateID, msg.sender, quantityGrams);
    }

    /**
     * @notice Splits an active parent lot into two or more child lots.
     * @dev Invariant: sum(childQuantities) == parent.quantityGrams.
     * Parent status transitions irreversibly to Consumed.
     * Certificate balance is NEVER touched.
     */
    function splitLot(
        string calldata parentLotID,
        string[] calldata childLotIDs,
        uint256[] calldata childQuantitiesGrams
    ) external override {
        if (!_lotExists[parentLotID]) revert LotNotFound(parentLotID);

        Lot storage parent = _lots[parentLotID];
        if (parent.status == LotStatus.Consumed) revert LotAlreadyConsumed(parentLotID);
        if (parent.currentOwner != msg.sender) revert CallerNotLotOwner(msg.sender, parent.currentOwner);

        uint256 childCount = childLotIDs.length;
        if (childCount < 2 || childCount != childQuantitiesGrams.length) revert InvalidChildCount();

        uint256 sumChildQuantities = 0;
        for (uint256 i = 0; i < childCount; i++) {
            if (bytes(childLotIDs[i]).length == 0) revert InvalidLotID();
            if (_lotExists[childLotIDs[i]]) revert LotAlreadyExists(childLotIDs[i]);
            if (childQuantitiesGrams[i] == 0) revert InvalidQuantity();
            sumChildQuantities += childQuantitiesGrams[i];
        }

        // Strict conservation rule
        if (sumChildQuantities != parent.quantityGrams) {
            revert SplitConservationViolation(parent.quantityGrams, sumChildQuantities);
        }

        // Permanently lock parent lot against re-use
        parent.status = LotStatus.Consumed;
        for (uint256 i = 0; i < childCount; i++) {
            parent.childLotIDs.push(childLotIDs[i]);
        }

        for (uint256 i = 0; i < childCount; i++) {
            Lot storage child = _lots[childLotIDs[i]];
            child.lotID = childLotIDs[i];
            child.certificateID = parent.certificateID;
            child.quantityGrams = childQuantitiesGrams[i];
            child.currentOwner = msg.sender;
            child.status = LotStatus.Active;
            child.createdAt = block.timestamp;
            child.parentLotIDs.push(parentLotID);

            _lotExists[childLotIDs[i]] = true;
        }

        emit LotSplit(parentLotID, childLotIDs, childQuantitiesGrams, msg.sender);
    }

    /**
     * @notice Merges two or more active parent lots into a single consolidated lot.
     * @dev Invariant: newLot.quantityGrams == sum(parentLot.quantityGrams).
     * All parent lots transition irreversibly to Consumed.
     * Certificate balance is NEVER touched.
     *
     * PROVENANCE INTEGRITY REQUIREMENT:
     * All parent lots MUST share the same certificateID.
     * Merging lots from different certificates reverts with CertificateMismatch to prevent
     * cross-attribution of ethical certification claims across distinct certificates.
     */
    function mergeLots(
        string[] calldata parentLotIDs,
        string calldata newLotID
    ) external override {
        uint256 parentCount = parentLotIDs.length;
        if (parentCount < 2) revert InvalidParentCount();
        if (bytes(newLotID).length == 0) revert InvalidLotID();
        if (_lotExists[newLotID]) revert LotAlreadyExists(newLotID);

        uint256 sumParentQuantities = 0;
        string memory primaryCertID = "";

        for (uint256 i = 0; i < parentCount; i++) {
            string calldata pID = parentLotIDs[i];
            if (!_lotExists[pID]) revert LotNotFound(pID);

            Lot storage pLot = _lots[pID];
            if (pLot.status == LotStatus.Consumed) revert LotAlreadyConsumed(pID);
            if (pLot.currentOwner != msg.sender) revert CallerNotLotOwner(msg.sender, pLot.currentOwner);

            if (i == 0) {
                primaryCertID = pLot.certificateID;
            } else {
                if (keccak256(bytes(pLot.certificateID)) != keccak256(bytes(primaryCertID))) {
                    revert CertificateMismatch(primaryCertID, pLot.certificateID);
                }
            }

            sumParentQuantities += pLot.quantityGrams;

            // Lock parent lot permanently
            pLot.status = LotStatus.Consumed;
            pLot.childLotIDs.push(newLotID);
        }

        Lot storage newLot = _lots[newLotID];
        newLot.lotID = newLotID;
        newLot.certificateID = primaryCertID;
        newLot.quantityGrams = sumParentQuantities;
        newLot.currentOwner = msg.sender;
        newLot.status = LotStatus.Active;
        newLot.createdAt = block.timestamp;

        for (uint256 i = 0; i < parentCount; i++) {
            newLot.parentLotIDs.push(parentLotIDs[i]);
        }

        _lotExists[newLotID] = true;

        emit LotsMerged(parentLotIDs, newLotID, sumParentQuantities, msg.sender);
    }

    /**
     * @notice Processes an active parent lot into a derived lot (e.g. milling, roasting, refining).
     * @dev Invariant: outputQuantityGrams <= parentLot.quantityGrams.
     * Yield loss is permitted; mass expansion strictly reverts.
     * Parent lot transitions irreversibly to Consumed.
     * Certificate balance is NEVER touched.
     */
    function processLot(
        string calldata parentLotID,
        string calldata newLotID,
        uint256 outputQuantityGrams,
        string calldata processDetails
    ) external override {
        if (!_lotExists[parentLotID]) revert LotNotFound(parentLotID);

        Lot storage parent = _lots[parentLotID];
        if (parent.status == LotStatus.Consumed) revert LotAlreadyConsumed(parentLotID);
        if (parent.currentOwner != msg.sender) revert CallerNotLotOwner(msg.sender, parent.currentOwner);

        if (bytes(newLotID).length == 0) revert InvalidLotID();
        if (_lotExists[newLotID]) revert LotAlreadyExists(newLotID);
        if (outputQuantityGrams == 0) revert InvalidQuantity();

        // Mass creation is strictly disallowed; yield loss is allowed
        if (outputQuantityGrams > parent.quantityGrams) {
            revert YieldExpansionNotAllowed(parent.quantityGrams, outputQuantityGrams);
        }

        // Lock parent lot permanently
        parent.status = LotStatus.Consumed;
        parent.childLotIDs.push(newLotID);

        Lot storage newLot = _lots[newLotID];
        newLot.lotID = newLotID;
        newLot.certificateID = parent.certificateID;
        newLot.quantityGrams = outputQuantityGrams;
        newLot.currentOwner = msg.sender;
        newLot.status = LotStatus.Active;
        newLot.createdAt = block.timestamp;
        newLot.parentLotIDs.push(parentLotID);

        _lotExists[newLotID] = true;

        emit LotProcessed(
            parentLotID,
            newLotID,
            parent.quantityGrams,
            outputQuantityGrams,
            processDetails,
            msg.sender
        );
    }

    /**
     * @notice Transfers legal custody / ownership of an active lot.
     * @dev Does NOT create volume, does NOT consume the lot, does NOT touch certificate capacity.
     */
    function transferLot(string calldata lotID, address newOwner) external override {
        if (!_lotExists[lotID]) revert LotNotFound(lotID);

        Lot storage lot = _lots[lotID];
        if (lot.status == LotStatus.Consumed) revert LotAlreadyConsumed(lotID);
        if (lot.currentOwner != msg.sender) revert CallerNotLotOwner(msg.sender, lot.currentOwner);
        if (newOwner == address(0) || newOwner == msg.sender) revert InvalidRecipient();

        address prevOwner = lot.currentOwner;
        lot.currentOwner = newOwner;

        emit LotTransferred(lotID, prevOwner, newOwner);
    }

    function getLot(string calldata lotID) external view override returns (Lot memory) {
        if (!_lotExists[lotID]) revert LotNotFound(lotID);
        return _lots[lotID];
    }

    function getLotStatus(string calldata lotID) external view override returns (LotStatus) {
        if (!_lotExists[lotID]) return LotStatus.None;
        return _lots[lotID].status;
    }

    /**
     * @notice Returns lot details alongside direct parent and child references.
     */
    function getConsignmentHistory(string calldata lotID)
        external
        view
        override
        returns (ConsignmentHistory memory)
    {
        if (!_lotExists[lotID]) revert LotNotFound(lotID);
        Lot storage lot = _lots[lotID];
        return ConsignmentHistory({
            lot: lot,
            parentLotIDs: lot.parentLotIDs,
            childLotIDs: lot.childLotIDs
        });
    }

    /**
     * @notice Traverses the ancestry graph backwards up to root consignments.
     */
    function getAncestors(string calldata lotID) external view override returns (string[] memory) {
        if (!_lotExists[lotID]) revert LotNotFound(lotID);

        // Dynamic bounded search for ancestors
        string[] memory queue = new string[](100);
        string[] memory ancestors = new string[](100);
        uint256 queueHead = 0;
        uint256 queueTail = 0;
        uint256 ancestorCount = 0;

        // Seed queue with direct parents
        string[] storage parents = _lots[lotID].parentLotIDs;
        for (uint256 i = 0; i < parents.length; i++) {
            queue[queueTail++] = parents[i];
            ancestors[ancestorCount++] = parents[i];
        }

        while (queueHead < queueTail && ancestorCount < 100) {
            string memory current = queue[queueHead++];
            if (_lotExists[current]) {
                string[] storage nextParents = _lots[current].parentLotIDs;
                for (uint256 j = 0; j < nextParents.length && ancestorCount < 100; j++) {
                    queue[queueTail++] = nextParents[j];
                    ancestors[ancestorCount++] = nextParents[j];
                }
            }
        }

        // Slice to actual size
        string[] memory result = new string[](ancestorCount);
        for (uint256 k = 0; k < ancestorCount; k++) {
            result[k] = ancestors[k];
        }
        return result;
    }

    /**
     * @notice Traverses the descendant graph forwards down to leaf consignments.
     */
    function getDescendants(string calldata lotID) external view override returns (string[] memory) {
        if (!_lotExists[lotID]) revert LotNotFound(lotID);

        string[] memory queue = new string[](100);
        string[] memory descendants = new string[](100);
        uint256 queueHead = 0;
        uint256 queueTail = 0;
        uint256 descendantCount = 0;

        // Seed queue with direct children
        string[] storage children = _lots[lotID].childLotIDs;
        for (uint256 i = 0; i < children.length; i++) {
            queue[queueTail++] = children[i];
            descendants[descendantCount++] = children[i];
        }

        while (queueHead < queueTail && descendantCount < 100) {
            string memory current = queue[queueHead++];
            if (_lotExists[current]) {
                string[] storage nextChildren = _lots[current].childLotIDs;
                for (uint256 j = 0; j < nextChildren.length && descendantCount < 100; j++) {
                    queue[queueTail++] = nextChildren[j];
                    descendants[descendantCount++] = nextChildren[j];
                }
            }
        }

        string[] memory result = new string[](descendantCount);
        for (uint256 k = 0; k < descendantCount; k++) {
            result[k] = descendants[k];
        }
        return result;
    }
}
