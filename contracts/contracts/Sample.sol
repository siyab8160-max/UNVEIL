// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/utils/Context.sol";

/**
 * @title Sample
 * @dev Minimal placeholder contract to validate the Hardhat compilation and test environment.
 * Note: Business logic for CertLedger contracts is deliberately excluded in Phase 0.
 */
contract Sample is Context {
    string private _status;

    event StatusUpdated(string newStatus, address indexed updater);

    constructor(string memory initialStatus) {
        _status = initialStatus;
    }

    function getStatus() external view returns (string memory) {
        return _status;
    }

    function updateStatus(string calldata newStatus) external {
        _status = newStatus;
        emit StatusUpdated(newStatus, _msgSender());
    }
}
