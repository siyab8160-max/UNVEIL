// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title IConsignmentRegistry
 * @dev Interface for the CertLedger Consignment Registry according to PRD v1.1 §7.3.
 */
interface IConsignmentRegistry {
    enum LotStatus {
        None,     // Lot does not exist
        Active,   // Available for transfer, split, merge, or processing
        Consumed  // Permanently locked; cannot be spent, transferred, or operated upon again
    }

    struct Lot {
        string lotID;              // Unique lot/consignment identifier
        string certificateID;      // Associated certificate ID
        uint256 quantityGrams;     // Physical mass in canonical integer grams
        address currentOwner;      // Current legal custodian/owner of this lot
        LotStatus status;          // Active or Consumed
        uint256 createdAt;         // Block timestamp of lot creation
        string[] parentLotIDs;     // Ancestor lots ([] for root lots)
        string[] childLotIDs;      // Descendant lots populated upon split/merge/process
    }

    struct ConsignmentHistory {
        Lot lot;
        string[] parentLotIDs;
        string[] childLotIDs;
    }

    event RootConsignmentCreated(
        string indexed lotID,
        string indexed certificateID,
        address indexed holder,
        uint256 quantityGrams
    );

    event LotSplit(
        string indexed parentLotID,
        string[] childLotIDs,
        uint256[] childQuantitiesGrams,
        address indexed owner
    );

    event LotsMerged(
        string[] parentLotIDs,
        string indexed newLotID,
        uint256 newQuantityGrams,
        address indexed owner
    );

    event LotProcessed(
        string indexed parentLotID,
        string indexed newLotID,
        uint256 inputQuantityGrams,
        uint256 outputQuantityGrams,
        string processDetails,
        address indexed owner
    );

    event LotTransferred(
        string indexed lotID,
        address indexed previousOwner,
        address indexed newOwner
    );

    function createRootConsignment(
        string calldata lotID,
        string calldata certificateID,
        uint256 quantityGrams
    ) external;

    function splitLot(
        string calldata parentLotID,
        string[] calldata childLotIDs,
        uint256[] calldata childQuantitiesGrams
    ) external;

    function mergeLots(
        string[] calldata parentLotIDs,
        string calldata newLotID
    ) external;

    function processLot(
        string calldata parentLotID,
        string calldata newLotID,
        uint256 outputQuantityGrams,
        string calldata processDetails
    ) external;

    function transferLot(string calldata lotID, address newOwner) external;

    function getLot(string calldata lotID) external view returns (Lot memory);
    function getLotStatus(string calldata lotID) external view returns (LotStatus);
    function getConsignmentHistory(string calldata lotID) external view returns (ConsignmentHistory memory);
    function getAncestors(string calldata lotID) external view returns (string[] memory);
    function getDescendants(string calldata lotID) external view returns (string[] memory);
}
