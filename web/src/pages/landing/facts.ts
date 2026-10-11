/**
 * Every number the landing page quotes, in ONE place. They are checkable facts from this repository's own runs (see the
 * README's "Test results"), never marketing figures; facts.test.ts fails if the README stops agreeing with them.
 * No user counts, no deposits, no partners: there are none, and the data is fictional.
 */
export const FACTS = {
  contractTests: 138,
  attacksBlocked: 12,
  attacksTotal: 12,
  fuzzSteps: 1000,
  invariants: 8,
  coverageLines: 100,
  bookletTests: 4,
  /** ETH of other users' money the naive escrow loses in the Attack Lab's contrast run */
  naiveDrainedEth: 3,
} as const;

export const COMMAND = "npm run dev";

export interface Faq {
  q: string;
  a: string;
}

/** From docs/06 "Likely judge questions", in plain words. */
export const FAQS: Faq[] = [
  {
    q: "What stops the AI from changing an amount?",
    a: "Three layers. Any amount the AI proposes must literally appear in the agreement text, the validator recomputes every sum in wei, and a person has to confirm the final terms. Only a confirmed, hashed checklist can be deployed; the code won't accept the AI's proposal at all.",
  },
  {
    q: "What if the client never responds?",
    a: "After the review window the provider can escalate the milestone to the arbiter. It is an explicit step, not an automatic payout, because an undefined transition is never allowed to move money.",
  },
  {
    q: "Can the arbiter steal the funds?",
    a: "No. The arbiter can only send a disputed milestone's amount to the client or to the provider, and can never receive credit themselves. That is one of the eight invariants checked after every step of the randomised test.",
  },
  {
    q: "What happens if someone force-sends ETH to the vault?",
    a: "It shows up as surplus in the ledger. It can't be withdrawn and it doesn't break the books. The Attack Lab does this with a self-destructing contract so you can watch it happen.",
  },
  {
    q: "Why pull payments instead of pushing money?",
    a: "A provider that is a malicious contract could block or re-enter a push payment. With pull payments, every withdrawal is isolated, checks come before effects, and a re-entrancy guard stops the rest. The Attack Lab contrast shows the same attack draining a contract without them.",
  },
  {
    q: "Does the file hash prove the work is good?",
    a: "No, and it doesn't claim to. It proves identity: the file that gets approved is exactly the file that was submitted. Judging quality is still a human decision, which is what the dispute path is for.",
  },
  {
    q: "Is any of this real money?",
    a: "No. Everything runs on a local test chain with test ETH and fictional agreements. It works with Wi-Fi off, and nothing leaves your machine.",
  },
];
