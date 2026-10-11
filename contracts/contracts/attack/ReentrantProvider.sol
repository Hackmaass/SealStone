// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {MilestoneVault} from "../MilestoneVault.sol";

/// @title ReentrantProvider
/// @notice TEST/DEMO ATTACKER — never deploy outside the local chain.
/// @dev Acts as the provider of a MilestoneVault. When it receives ETH from `withdraw()` it tries to call
///      `withdraw()` again (up to 3 times). A correct vault blocks every re-entry; the counters prove it.
contract ReentrantProvider {
    MilestoneVault public vault;

    uint256 public reentryAttempts;
    uint256 public reentryBlocked;
    uint256 public reentrySucceeded;
    /// @notice First four bytes of the most recent revert data seen on a blocked re-entry.
    bytes4 public lastRevertSelector;

    /// @notice Points the attacker at the vault it is the provider of.
    function setVault(address vault_) external {
        vault = MilestoneVault(payable(vault_));
    }

    function sign(bytes32 hash) external {
        vault.sign(hash);
    }

    function markComplete(uint256 index, bytes32 deliverableHash) external {
        vault.markComplete(index, deliverableHash);
    }

    function escalate(uint256 index) external {
        vault.escalate(index);
    }

    /// @notice Starts the attack: withdraw legitimately, then re-enter from `receive()`.
    function attackWithdraw() external {
        vault.withdraw();
    }

    receive() external payable {
        if (reentryAttempts < 3) {
            reentryAttempts++;
            try vault.withdraw() {
                reentrySucceeded++;
            } catch (bytes memory reason) {
                reentryBlocked++;
                if (reason.length >= 4) {
                    lastRevertSelector = bytes4(reason);
                }
            }
        }
    }
}
