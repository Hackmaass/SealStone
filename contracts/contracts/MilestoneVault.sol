// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @title MilestoneVault
/// @notice One deployment = one milestone-based escrow agreement between a client, a provider and an arbiter.
/// @dev Spec: docs/04-CONTRACT-SPEC.md (source of truth). Pull payments, checks-effects-interactions,
///      a reentrancy guard on `withdraw`, and a never-reverting `reconcile()` view.
///      Check order inside every function: role -> agreement state -> index -> milestone state -> extra checks.
contract MilestoneVault is ReentrancyGuard {
    // ───────────────────────────── Types ─────────────────────────────

    enum AgreementState {
        AwaitingSignatures,
        AwaitingFunding,
        Active,
        Closed
    }

    enum MilestoneState {
        Pending,
        Completed,
        Disputed,
        Released,
        Refunded
    }

    enum Ruling {
        Release,
        Refund
    }

    struct Milestone {
        uint256 amount;
        MilestoneState state;
        bytes32 deliverableHash; // set by markComplete
        bytes32 evidenceHash; // set by dispute (client); may be zero for escalate
        bytes32 rationaleHash; // set by resolve (arbiter)
        uint64 completedAt;
    }

    struct Reconciliation {
        uint256 deposited;
        uint256 released;
        uint256 refunded;
        uint256 withdrawn;
        uint256 heldInEscrow; // deposited - released - refunded
        uint256 heldByMilestones; // sum of amount of Pending/Completed/Disputed milestones (0 before funding)
        uint256 owedToParties; // credits[client] + credits[provider]
        uint256 expectedBalance; // deposited - withdrawn
        uint256 actualBalance; // address(this).balance
        uint256 surplus; // actualBalance - expectedBalance (force-sent ETH); never spendable
        bool ok; // actual >= expected && heldInEscrow == heldByMilestones && owedToParties == released + refunded - withdrawn
    }

    // ───────────────────────────── Errors ─────────────────────────────

    error ZeroAddress();
    error DuplicateParty();
    error InvalidMilestoneCount(uint256 count);
    error ZeroAmount(uint256 index);
    error ZeroHash();
    error InvalidReviewWindow();
    error NotClient();
    error NotProvider();
    error NotArbiter();
    error NotSigner();
    error WrongAgreementState(AgreementState actual);
    error AgreementHashMismatch(bytes32 expected, bytes32 provided);
    error AlreadySigned(address signer);
    error WrongFundingAmount(uint256 expected, uint256 sent);
    error InvalidMilestone(uint256 index);
    error InvalidMilestoneState(uint256 index, MilestoneState actual);
    error MilestoneOutOfOrder(uint256 index, uint256 expectedIndex);
    error DeliverableHashMismatch(bytes32 expected, bytes32 provided);
    error ReviewWindowOpen(uint64 escalationAllowedAt);
    error NothingToWithdraw();
    error TransferFailed();
    error DirectPaymentNotAccepted();

    // ───────────────────────────── Events ─────────────────────────────

    event AgreementSigned(address indexed signer, bytes32 agreementHash);
    event AgreementFunded(uint256 amount);
    event MilestoneCompleted(uint256 indexed index, bytes32 deliverableHash);
    event MilestoneApproved(uint256 indexed index, bytes32 deliverableHash);
    event MilestoneDisputed(uint256 indexed index, bytes32 evidenceHash);
    event MilestoneEscalated(uint256 indexed index);
    event DisputeResolved(uint256 indexed index, Ruling ruling, bytes32 rationaleHash);
    event Credited(address indexed to, uint256 amount);
    event Withdrawn(address indexed to, uint256 amount);
    event AgreementClosed();

    // ───────────────────────────── Storage ─────────────────────────────

    uint256 private constant MAX_MILESTONES = 20;

    address public immutable client;
    address public immutable provider;
    address public immutable arbiter;
    bytes32 public immutable agreementHash;
    uint64 public immutable reviewWindow;
    uint256 public immutable totalAmount;

    AgreementState public agreementState;
    bool public clientSigned;
    bool public providerSigned;

    Milestone[] private milestones;
    uint256 public nextMilestone;

    uint256 public totalDeposited;
    uint256 public totalReleased;
    uint256 public totalRefunded;
    uint256 public totalWithdrawn;

    /// @notice Pull-payment balances. Only the client and the provider can ever hold credit.
    mapping(address => uint256) public credits;

    // ───────────────────────────── Modifiers ─────────────────────────────

    modifier onlyClient() {
        if (msg.sender != client) revert NotClient();
        _;
    }

    modifier onlyProvider() {
        if (msg.sender != provider) revert NotProvider();
        _;
    }

    modifier onlyArbiter() {
        if (msg.sender != arbiter) revert NotArbiter();
        _;
    }

    modifier inAgreementState(AgreementState required) {
        if (agreementState != required) revert WrongAgreementState(agreementState);
        _;
    }

    // ───────────────────────────── Constructor ─────────────────────────────

    /// @param client_ The paying party. Non-zero and distinct from the other two parties.
    /// @param provider_ The party delivering the milestones. Non-zero and distinct.
    /// @param arbiter_ The dispute resolver, fixed at deployment. Non-zero and distinct; never receives funds.
    /// @param agreementHash_ keccak256 of the canonical confirmed checklist. Non-zero.
    /// @param amounts One entry per milestone (wei), 1 to 20 entries, each non-zero.
    /// @param reviewWindow_ Seconds the client has to respond to a completed milestone before the provider may escalate. > 0.
    /// @dev Reverts: ZeroAddress, DuplicateParty, InvalidMilestoneCount, ZeroAmount, ZeroHash, InvalidReviewWindow.
    constructor(
        address client_,
        address provider_,
        address arbiter_,
        bytes32 agreementHash_,
        uint256[] memory amounts,
        uint64 reviewWindow_
    ) {
        if (client_ == address(0) || provider_ == address(0) || arbiter_ == address(0)) revert ZeroAddress();
        if (client_ == provider_ || client_ == arbiter_ || provider_ == arbiter_) revert DuplicateParty();
        if (amounts.length == 0 || amounts.length > MAX_MILESTONES) revert InvalidMilestoneCount(amounts.length);

        uint256 sum;
        for (uint256 i = 0; i < amounts.length; i++) {
            if (amounts[i] == 0) revert ZeroAmount(i);
            sum += amounts[i];
            milestones.push(
                Milestone({
                    amount: amounts[i],
                    state: MilestoneState.Pending,
                    deliverableHash: bytes32(0),
                    evidenceHash: bytes32(0),
                    rationaleHash: bytes32(0),
                    completedAt: 0
                })
            );
        }

        if (agreementHash_ == bytes32(0)) revert ZeroHash();
        if (reviewWindow_ == 0) revert InvalidReviewWindow();

        client = client_;
        provider = provider_;
        arbiter = arbiter_;
        agreementHash = agreementHash_;
        reviewWindow = reviewWindow_;
        totalAmount = sum;
        // agreementState defaults to AwaitingSignatures
    }

    // ───────────────────────────── Agreement lifecycle ─────────────────────────────

    /// @notice Sign the agreement by presenting the exact agreement hash. Both parties must sign before funding.
    /// @dev Callable by: client or provider. Reverts: NotSigner, WrongAgreementState, AgreementHashMismatch, AlreadySigned.
    function sign(bytes32 hash) external {
        if (msg.sender != client && msg.sender != provider) revert NotSigner();
        if (agreementState != AgreementState.AwaitingSignatures) revert WrongAgreementState(agreementState);
        if (hash != agreementHash) revert AgreementHashMismatch(agreementHash, hash);

        if (msg.sender == client) {
            if (clientSigned) revert AlreadySigned(msg.sender);
            clientSigned = true;
        } else {
            if (providerSigned) revert AlreadySigned(msg.sender);
            providerSigned = true;
        }

        emit AgreementSigned(msg.sender, hash);

        if (clientSigned && providerSigned) {
            agreementState = AgreementState.AwaitingFunding;
        }
    }

    /// @notice Deposit the full agreement amount. The agreement becomes Active.
    /// @dev Callable by: client. Reverts: NotClient, WrongAgreementState, WrongFundingAmount.
    function fund() external payable onlyClient inAgreementState(AgreementState.AwaitingFunding) {
        if (msg.value != totalAmount) revert WrongFundingAmount(totalAmount, msg.value);

        totalDeposited = msg.value;
        agreementState = AgreementState.Active;

        emit AgreementFunded(msg.value);
    }

    // ───────────────────────────── Milestone transitions ─────────────────────────────

    /// @notice Provider declares milestone `index` complete and commits to the SHA-256 of the deliverable.
    /// @dev Callable by: provider. Reverts: NotProvider, WrongAgreementState, InvalidMilestone,
    ///      InvalidMilestoneState (not Pending), MilestoneOutOfOrder (index != nextMilestone), ZeroHash.
    function markComplete(uint256 index, bytes32 deliverableHash)
        external
        onlyProvider
        inAgreementState(AgreementState.Active)
    {
        Milestone storage m = _milestoneInState(index, MilestoneState.Pending);
        if (index != nextMilestone) revert MilestoneOutOfOrder(index, nextMilestone);
        if (deliverableHash == bytes32(0)) revert ZeroHash();

        m.deliverableHash = deliverableHash;
        m.state = MilestoneState.Completed;
        m.completedAt = uint64(block.timestamp);

        emit MilestoneCompleted(index, deliverableHash);
    }

    /// @notice Client approves the exact deliverable the provider committed to. Releases the milestone amount to the provider's credit.
    /// @dev Callable by: client. Reverts: NotClient, WrongAgreementState, InvalidMilestone,
    ///      InvalidMilestoneState (not Completed), DeliverableHashMismatch (swapped deliverable).
    function approve(uint256 index, bytes32 deliverableHash)
        external
        onlyClient
        inAgreementState(AgreementState.Active)
    {
        Milestone storage m = _milestoneInState(index, MilestoneState.Completed);
        if (deliverableHash != m.deliverableHash) revert DeliverableHashMismatch(m.deliverableHash, deliverableHash);

        emit MilestoneApproved(index, deliverableHash);
        _settle(index, m, MilestoneState.Released, provider);
    }

    /// @notice Client disputes a completed milestone and passes the decision to the arbiter.
    /// @dev Callable by: client. Reverts: NotClient, WrongAgreementState, InvalidMilestone,
    ///      InvalidMilestoneState (not Completed).
    function dispute(uint256 index, bytes32 evidenceHash)
        external
        onlyClient
        inAgreementState(AgreementState.Active)
    {
        Milestone storage m = _milestoneInState(index, MilestoneState.Completed);

        m.evidenceHash = evidenceHash;
        m.state = MilestoneState.Disputed;

        emit MilestoneDisputed(index, evidenceHash);
    }

    /// @notice Provider escalates an unanswered completed milestone to the arbiter once the review window has passed.
    /// @dev Callable by: provider. Reverts: NotProvider, WrongAgreementState, InvalidMilestone,
    ///      InvalidMilestoneState (not Completed), ReviewWindowOpen.
    function escalate(uint256 index) external onlyProvider inAgreementState(AgreementState.Active) {
        Milestone storage m = _milestoneInState(index, MilestoneState.Completed);

        uint64 allowedAt = m.completedAt + reviewWindow;
        if (block.timestamp < allowedAt) revert ReviewWindowOpen(allowedAt);

        m.state = MilestoneState.Disputed;

        emit MilestoneEscalated(index);
    }

    /// @notice Arbiter rules on a disputed milestone: Release credits the provider, Refund credits the client.
    /// @dev Callable by: arbiter. Reverts: NotArbiter, WrongAgreementState, InvalidMilestone,
    ///      InvalidMilestoneState (not Disputed).
    function resolve(uint256 index, Ruling ruling, bytes32 rationaleHash)
        external
        onlyArbiter
        inAgreementState(AgreementState.Active)
    {
        Milestone storage m = _milestoneInState(index, MilestoneState.Disputed);

        m.rationaleHash = rationaleHash;
        emit DisputeResolved(index, ruling, rationaleHash);

        if (ruling == Ruling.Release) {
            _settle(index, m, MilestoneState.Released, provider);
        } else {
            _settle(index, m, MilestoneState.Refunded, client);
        }
    }

    // ───────────────────────────── Payouts ─────────────────────────────

    /// @notice Pull the caller's credited balance. Checks-effects-interactions plus a reentrancy guard.
    /// @dev Callable by: anyone with credit. Reverts: WrongAgreementState (not Active/Closed),
    ///      NothingToWithdraw, TransferFailed (which also restores the credit).
    function withdraw() external nonReentrant {
        if (agreementState != AgreementState.Active && agreementState != AgreementState.Closed) {
            revert WrongAgreementState(agreementState);
        }

        uint256 amount = credits[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        credits[msg.sender] = 0;
        totalWithdrawn += amount;

        emit Withdrawn(msg.sender, amount);

        (bool ok,) = msg.sender.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }

    // ───────────────────────────── Views ─────────────────────────────

    /// @notice Number of milestones in this agreement.
    function milestoneCount() external view returns (uint256) {
        return milestones.length;
    }

    /// @notice Full data of milestone `index`.
    /// @dev Reverts: InvalidMilestone.
    function getMilestone(uint256 index) external view returns (Milestone memory) {
        if (index >= milestones.length) revert InvalidMilestone(index);
        return milestones[index];
    }

    /// @notice The books: every money counter, the live balance, and whether they agree. Never reverts.
    /// @dev Subtractions are guarded so that a broken state reports `ok == false` instead of panicking.
    function reconcile() external view returns (Reconciliation memory r) {
        r.deposited = totalDeposited;
        r.released = totalReleased;
        r.refunded = totalRefunded;
        r.withdrawn = totalWithdrawn;

        uint256 paidOut = r.released + r.refunded;
        r.heldInEscrow = r.deposited >= paidOut ? r.deposited - paidOut : 0;
        r.heldByMilestones = _heldByMilestones();
        r.owedToParties = credits[client] + credits[provider];
        r.expectedBalance = r.deposited >= r.withdrawn ? r.deposited - r.withdrawn : 0;
        r.actualBalance = address(this).balance;
        r.surplus = r.actualBalance >= r.expectedBalance ? r.actualBalance - r.expectedBalance : 0;

        r.ok = r.actualBalance >= r.expectedBalance
            && r.deposited >= paidOut
            && r.heldInEscrow == r.heldByMilestones
            && paidOut >= r.withdrawn
            && r.owedToParties == paidOut - r.withdrawn;
    }

    // ───────────────────────────── Internals ─────────────────────────────

    /// @dev Index check then milestone-state check (the spec's check order).
    function _milestoneInState(uint256 index, MilestoneState required) private view returns (Milestone storage m) {
        if (index >= milestones.length) revert InvalidMilestone(index);
        m = milestones[index];
        if (m.state != required) revert InvalidMilestoneState(index, m.state);
    }

    /// @dev Moves a milestone to a terminal state and credits the payee (client or provider only).
    ///      Advances `nextMilestone`; closes the agreement after the last milestone.
    function _settle(uint256 index, Milestone storage m, MilestoneState terminal, address payee) private {
        uint256 amount = m.amount;
        m.state = terminal;

        if (terminal == MilestoneState.Released) {
            totalReleased += amount;
        } else {
            totalRefunded += amount;
        }
        credits[payee] += amount;
        emit Credited(payee, amount);

        nextMilestone = index + 1;
        if (nextMilestone == milestones.length) {
            agreementState = AgreementState.Closed;
            emit AgreementClosed();
        }
    }

    /// @dev Sum of Pending/Completed/Disputed milestone amounts; 0 until the agreement is funded.
    function _heldByMilestones() private view returns (uint256 held) {
        if (totalDeposited == 0) return 0;
        for (uint256 i = 0; i < milestones.length; i++) {
            MilestoneState s = milestones[i].state;
            if (s != MilestoneState.Released && s != MilestoneState.Refunded) {
                held += milestones[i].amount;
            }
        }
    }

    // ───────────────────────────── Direct payments ─────────────────────────────

    /// @notice Plain ETH transfers are rejected. Fund through `fund()`.
    receive() external payable {
        revert DirectPaymentNotAccepted();
    }

    /// @notice Unknown calls (with or without value) are rejected.
    fallback() external payable {
        revert DirectPaymentNotAccepted();
    }
}
