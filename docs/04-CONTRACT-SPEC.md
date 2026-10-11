# 04 — Contract specification (source of truth)

One `MilestoneVault` deployment = one agreement. Solidity `0.8.24`, OpenZeppelin v5 `ReentrancyGuard`.

## Storage

| Name | Type | Notes |
|---|---|---|
| `client`, `provider`, `arbiter` | `address immutable` | non-zero and pairwise distinct |
| `agreementHash` | `bytes32 immutable` | keccak256 of the canonical confirmed checklist; non-zero |
| `reviewWindow` | `uint64 immutable` | seconds the client has to respond before the provider may escalate; > 0 |
| `totalAmount` | `uint256 immutable` | Σ milestone amounts |
| `agreementState` | `enum AgreementState { AwaitingSignatures, AwaitingFunding, Active, Closed }` | |
| `clientSigned`, `providerSigned` | `bool` | |
| `milestones` | `Milestone[]` | 1–20 entries |
| `nextMilestone` | `uint256` | index of the only milestone that may be marked complete |
| `totalDeposited`, `totalReleased`, `totalRefunded`, `totalWithdrawn` | `uint256` | accounting |
| `credits` | `mapping(address => uint256)` | pull-payment balances (only client and provider can ever hold credit) |

```solidity
enum MilestoneState { Pending, Completed, Disputed, Released, Refunded }
enum Ruling { Release, Refund }
struct Milestone {
    uint256 amount;
    MilestoneState state;
    bytes32 deliverableHash; // set by markComplete
    bytes32 evidenceHash;    // set by dispute (client) — may be zero for escalate
    bytes32 rationaleHash;   // set by resolve (arbiter)
    uint64  completedAt;
}
```

## Agreement lifecycle
```
AwaitingSignatures --sign(hash) by client AND provider--> AwaitingFunding
AwaitingFunding    --fund() by client, msg.value == totalAmount--> Active
Active             --last milestone becomes terminal--> Closed
```
`withdraw()` works in Active and Closed.

## Milestone transition table (anything not listed reverts)

| From | Function | Caller | Extra checks | To | Money effect |
|---|---|---|---|---|---|
| Pending | `markComplete(i, deliverableHash)` | provider | agreement Active; `i == nextMilestone`; hash ≠ 0 | Completed | — |
| Completed | `approve(i, deliverableHash)` | client | hash == stored deliverableHash | Released | credit provider `amount` |
| Completed | `dispute(i, evidenceHash)` | client | — | Disputed | — |
| Completed | `escalate(i)` | provider | `block.timestamp >= completedAt + reviewWindow` | Disputed | — |
| Disputed | `resolve(i, Release, rationaleHash)` | arbiter | — | Released | credit provider `amount` |
| Disputed | `resolve(i, Refund, rationaleHash)` | arbiter | — | Refunded | credit client `amount` |

Released and Refunded are **terminal**. When milestone `i` becomes terminal, `nextMilestone = i + 1`. When all milestones are terminal, the agreement becomes `Closed`.

## Functions

| Function | Access | Behaviour |
|---|---|---|
| `constructor(address client, address provider, address arbiter, bytes32 agreementHash, uint256[] amounts, uint64 reviewWindow)` | deployer | validates everything above; `totalAmount = Σ amounts` |
| `sign(bytes32 hash)` | client or provider | state AwaitingSignatures; `hash == agreementHash`; not already signed; when both have signed → AwaitingFunding |
| `fund()` payable | client | state AwaitingFunding; `msg.value == totalAmount` → Active |
| `markComplete`, `approve`, `dispute`, `escalate`, `resolve` | see table | see table |
| `withdraw()` | anyone with credit | `nonReentrant`; CEI: read amount → zero credit → `totalWithdrawn += amount` → `call{value: amount}("")` → revert `TransferFailed` if not ok |
| `reconcile()` view | anyone | returns the `Reconciliation` struct below |
| `milestoneCount()`, `getMilestone(i)` view | anyone | — |
| `receive()` / `fallback()` | — | revert `DirectPaymentNotAccepted()` |

```solidity
struct Reconciliation {
    uint256 deposited;
    uint256 released;
    uint256 refunded;
    uint256 withdrawn;
    uint256 heldInEscrow;     // deposited - released - refunded
    uint256 heldByMilestones; // Σ amount of Pending/Completed/Disputed milestones (0 before funding)
    uint256 owedToParties;    // credits[client] + credits[provider]
    uint256 expectedBalance;  // deposited - withdrawn
    uint256 actualBalance;    // address(this).balance
    uint256 surplus;          // actualBalance - expectedBalance (force-sent ETH); never spendable
    bool ok;                  // actual >= expected && heldInEscrow == heldByMilestones
                              // && owedToParties == released + refunded - withdrawn
}
```

## Custom errors
```
ZeroAddress(); DuplicateParty(); InvalidMilestoneCount(uint256 count); ZeroAmount(uint256 index);
ZeroHash(); InvalidReviewWindow();
NotClient(); NotProvider(); NotArbiter(); NotSigner();
WrongAgreementState(AgreementState actual);
AgreementHashMismatch(bytes32 expected, bytes32 provided); AlreadySigned(address signer);
WrongFundingAmount(uint256 expected, uint256 sent);
InvalidMilestone(uint256 index);
InvalidMilestoneState(uint256 index, MilestoneState actual);
MilestoneOutOfOrder(uint256 index, uint256 expectedIndex);
DeliverableHashMismatch(bytes32 expected, bytes32 provided);
ReviewWindowOpen(uint64 escalationAllowedAt);
NothingToWithdraw(); TransferFailed(); DirectPaymentNotAccepted();
```
Check order inside every function: **role → agreement state → index → milestone state → extra checks**. This order is part of the spec: the Attack Lab shows the first failing rule.

## Events (every state change emits one; the UI timeline is built from these)
```
AgreementSigned(address indexed signer, bytes32 agreementHash)
AgreementFunded(uint256 amount)
MilestoneCompleted(uint256 indexed index, bytes32 deliverableHash)
MilestoneApproved(uint256 indexed index, bytes32 deliverableHash)
MilestoneDisputed(uint256 indexed index, bytes32 evidenceHash)
MilestoneEscalated(uint256 indexed index)
DisputeResolved(uint256 indexed index, Ruling ruling, bytes32 rationaleHash)
Credited(address indexed to, uint256 amount)
Withdrawn(address indexed to, uint256 amount)
AgreementClosed()
```

## Invariants (asserted after every step of the randomized test)
- **I1** `actualBalance >= expectedBalance`; equality unless ETH was force-sent (then `surplus > 0`)
- **I2** `deposited ∈ {0, totalAmount}`
- **I3** `heldInEscrow == heldByMilestones`
- **I4** `released == Σ amount of Released milestones` and `refunded == Σ amount of Refunded milestones`
- **I5** `owedToParties == released + refunded - withdrawn`
- **I6** terminal milestones never change state; a failed call changes no storage
- **I7** every milestone with index > `nextMilestone` is Pending
- **I8** `credits[arbiter] == 0` always (the arbiter can never be paid)

## Test contracts (in `contracts/contracts/attack/`, never deployed in the main demo)
- `ReentrantProvider.sol`: acts as the provider. `receive()` re-enters `vault.withdraw()` up to 3 times using `try/catch`, counting `reentryAttempts`, `reentryBlocked` and `reentrySucceeded`. Expected: attempts ≥ 1, blocked == attempts, succeeded == 0, and it receives exactly what it was owed.
- `NaiveEscrow.sol` + `NaiveDrainer.sol`: a deliberately vulnerable escrow (transfer before zeroing credit, no guard) holding other users' credits. The same re-entrancy pattern **drains it**. This is the contrast proving the attacker is real.
- `ForceSender.sol`: uses `selfdestruct(payable(vault))` to force ETH in. Expected: `reconcile().surplus > 0`, `ok == true`, and the surplus can never be withdrawn. (selfdestruct is allowed only in this test contract.)

## Required test names (booklet R13, exact strings in `test/Adversarial.test.ts`)
```
describe("Booklet-required adversarial tests")
  it("rejects a second release attempt")
  it("rejects an unauthorized refund")
  it("rejects an out-of-order transition")
  it("blocks a re-entrancy attack")
```
