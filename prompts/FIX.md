# FIX — paste when something breaks

````text
Something is broken. Don't guess and don't rewrite large parts.

What I did: <command or click path>
What I expected: <...>
What happened: <error text / screenshot description>

Steps:
1. Reproduce it with the smallest command or test you can. If it's in the contract, write a failing test first.
2. Find the root cause and tell me in two sentences before changing code.
3. Make the smallest fix that keeps docs/04-CONTRACT-SPEC.md and docs/05-AI-SPEC.md true. If the spec itself is wrong, say so and propose the spec change.
4. Run the affected test suites (and `npx hardhat test` if contracts changed).
5. Add a line to PROGRESS.md under Known issues (fixed) and commit "fix: <short description>".
````
