// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title ForceSender
/// @notice TEST/DEMO ATTACKER — never deploy outside the local chain.
/// @dev Pushes ETH into a contract that rejects payments by self-destructing into it. `selfdestruct` is
///      allowed only in this test contract (the compiler warns that it is deprecated; that is expected).
contract ForceSender {
    constructor() payable {}

    function boom(address payable target) external {
        selfdestruct(target);
    }
}
