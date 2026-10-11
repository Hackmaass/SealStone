// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MilestoneVault} from "../MilestoneVault.sol";

/// @title RejectingProvider
/// @notice TEST/DEMO HELPER — never deploy outside the local chain.
/// @dev A provider whose `receive()` always reverts. Proves that a failed payout reverts `withdraw()` with
///      `TransferFailed` and leaves the credit and the books untouched (nothing is lost or double-counted).
contract RejectingProvider {
    MilestoneVault public vault;

    error Rejecting();

    function setVault(address vault_) external {
        vault = MilestoneVault(payable(vault_));
    }

    function sign(bytes32 hash) external {
        vault.sign(hash);
    }

    function markComplete(uint256 index, bytes32 deliverableHash) external {
        vault.markComplete(index, deliverableHash);
    }

    function pull() external {
        vault.withdraw();
    }

    receive() external payable {
        revert Rejecting();
    }
}
