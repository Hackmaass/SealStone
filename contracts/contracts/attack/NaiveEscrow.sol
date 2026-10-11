// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/// @title NaiveEscrow
/// @notice DELIBERATELY VULNERABLE — used only to prove the attacker works. Never "the product".
/// @dev Classic re-entrancy bug: it sends ETH BEFORE zeroing the credit, and has no reentrancy guard.
///      The credit is reset with `= 0` (not `-=`) so the unwinding re-entrant calls do not underflow.
contract NaiveEscrow {
    mapping(address => uint256) public credits;

    /// @notice Credit `payee` with the ETH sent.
    function deposit(address payee) external payable {
        credits[payee] += msg.value;
    }

    /// @notice Pays out the caller's credit. VULNERABLE: interaction before effect.
    function withdraw() external {
        uint256 amount = credits[msg.sender];
        require(amount > 0, "nothing to withdraw");
        (bool ok,) = msg.sender.call{value: amount}("");
        require(ok, "transfer failed");
        credits[msg.sender] = 0;
    }
}
