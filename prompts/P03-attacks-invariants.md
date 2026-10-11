# P03 — Attack contracts, re-entrancy test and randomized invariant test
**Depends on:** P02 · **Time box:** 75 min

## Paste this
````text
Read docs/04-CONTRACT-SPEC.md, sections "Invariants" and "Test contracts". Implement the attackers and the strongest tests.

1. contracts/contracts/attack/ReentrantProvider.sol
   - Acts as the provider of a MilestoneVault (deploy it first; pass its address as provider when deploying the vault).
   - setVault(address), forwarding functions sign(bytes32), markComplete(uint256, bytes32), escalate(uint256), attackWithdraw() (calls vault.withdraw()).
   - receive(): if reentryAttempts < 3 { reentryAttempts++; try vault.withdraw() { reentrySucceeded++; } catch { reentryBlocked++; } }
   - Public counters: reentryAttempts, reentryBlocked, reentrySucceeded.
   - NatSpec header: "TEST/DEMO ATTACKER — never deploy outside the local chain."

2. contracts/contracts/attack/NaiveEscrow.sol + NaiveDrainer.sol (the contrast)
   - NaiveEscrow: deposit(address payee) payable credits payee; withdraw() sends credit with call BEFORE zeroing it, with no guard. Header comment: "DELIBERATELY VULNERABLE — used only to prove the attacker works."
   - NaiveDrainer: is credited a small amount, then re-enters withdraw() in receive() until the escrow balance < its credit. Funds deposited for other payees get drained.

3. contracts/contracts/attack/ForceSender.sol: constructor payable; boom(address payable target) uses selfdestruct(target). (selfdestruct is allowed only here.)

4. In test/Adversarial.test.ts replace the skipped test with "blocks a re-entrancy attack":
   - deploy ReentrantProvider, then a vault with provider = attacker; sign (client directly, provider via attacker.sign), fund, markComplete via the attacker, client approves, attacker.attackWithdraw()
   - assert reentryAttempts >= 1, reentryBlocked == reentryAttempts, reentrySucceeded == 0, the attacker's ETH balance == exactly the milestone amount, credits[attacker] == 0, expectReconciled(vault)
   - add "naive escrow is drained by the same attack pattern (contrast)": the drainer takes more than its credit, and the other payees' funds are gone.
   - add "force-sent ETH is reported as surplus and cannot be withdrawn": ForceSender.boom(vault) with 0.3 ETH → reconcile().surplus == 0.3 ETH, ok == true, and nobody can withdraw it (both parties' withdraw → NothingToWithdraw once their credits are 0).

5. test/Invariant.test.ts — randomized sequence test with a seeded PRNG (mulberry32), so failures can be reproduced:
   - seeds [1, 2, 3, 42, 1337]; 200 steps each; actors {client, provider, arbiter, stranger}
   - actions: sign(random correct/wrong hash), fund(random correct/wrong value), markComplete(random index, random hash), approve(random index, the stored or a random hash), dispute, escalate (sometimes call time.increase(reviewWindow) first), resolve(random ruling), withdraw
   - before each call, snapshot the milestone states, credits and the reconcile() struct; perform the call and catch reverts
   - after each step, assert invariants I1–I8 from the spec. If the call reverted, assert the snapshot is unchanged (I6)
   - count succeeded/reverted per action type and print a compact summary table per seed (console.table)
   - on failure, print the seed, step number and action so it can be replayed

6. Run `npx hardhat test` and `npx hardhat coverage`. Record the invariant summary (total steps, successes, reverts) in PROGRESS.md; we quote it in the README and the pitch.

Commit "P03: attackers, re-entrancy proof, naive contrast, invariant fuzz".
````

## Acceptance checks
- [ ] `blocks a re-entrancy attack` passes, and the naive contrast shows a real drain
- [ ] The invariant test runs 1,000 steps across 5 seeds, with a mix of successes and reverts (if almost everything reverts, the action generator is too random; ask Claude to bias it toward valid sequences about 50% of the time)
- [ ] Coverage is still ≥ the P02 numbers
