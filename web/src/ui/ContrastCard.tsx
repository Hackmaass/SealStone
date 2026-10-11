import type { Duel, DuelFigures } from "../lib/attacks";
import { Amount } from "./components";

/** One labelled figure: the same four rows on both sides, so the eye compares like with like. */
function Row({ label, children, tone }: { label: string; children: React.ReactNode; tone?: "bad" | "ok" }) {
  return (
    <div className={`duel-row${tone ? ` ${tone}` : ""}`}>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function Naive({ f }: { f: DuelFigures }) {
  return (
    <article className="duel-side bad" aria-label="Naive escrow: drained">
      <header>
        <span className="duel-badge bad stampin"><span aria-hidden="true">✕</span> DRAINED</span>
        <h3>A naive escrow</h3>
        <p className="muted small">Pays out first and updates its books afterwards, with no guard.</p>
      </header>
      <div className="duel-big" data-testid="duel-naive-lost">
        <span className="n"><Amount wei={f.lost} /></span>
        <span className="cap">of other people's money stolen</span>
      </div>
      <dl>
        <Row label="Owed to the attacker"><Amount wei={f.owed} /></Row>
        <Row label="Attacker walked away with" tone="bad"><Amount wei={f.took} /></Row>
        <Row label="Left in the escrow"><Amount wei={f.left ?? 0n} /></Row>
        <Row label="Books balance?" tone="bad"><b>✕ No</b>, short <Amount wei={f.lost} /></Row>
      </dl>
    </article>
  );
}

function Sealstone({ f, ledgerOk }: { f: DuelFigures; ledgerOk: boolean }) {
  const tried = f.reentries ?? 0;
  const stopped = f.stopped ?? 0;
  return (
    <article className="duel-side ok" aria-label="Sealstone vault: blocked">
      <header>
        <span className="duel-badge ok stampin"><span aria-hidden="true">✓</span> BLOCKED</span>
        <h3>A Sealstone vault</h3>
        <p className="muted small">Updates its books first, pays second, and refuses any call that re-enters.</p>
      </header>
      <div className="duel-big" data-testid="duel-sealstone-lost">
        <span className="n"><Amount wei={f.lost} /></span>
        <span className="cap">of other people's money lost</span>
      </div>
      <dl>
        <Row label="Owed to the attacker"><Amount wei={f.owed} /></Row>
        <Row label="Attacker walked away with" tone="ok"><Amount wei={f.took} /></Row>
        <Row label="Re-entries stopped"><b>{stopped} of {tried}</b>{f.guard && <span className="duel-guard mono small muted">{f.guard}</span>}</Row>
        <Row label="Books balance?" tone={ledgerOk ? "ok" : "bad"}>{ledgerOk ? <b>✓ Yes, to the wei</b> : <b>✕ No</b>}</Row>
      </dl>
    </article>
  );
}

/** "Same attack, two escrows": the one picture a judge needs. Every number is read from the two runs. */
export function ContrastCard({ duel, stale = false, busy, offline = false, onRun }: { duel: Duel | null; /** the previous result, kept on screen while a new run is in progress */ stale?: boolean; busy: boolean; /** there is no chain to run against */ offline?: boolean; onRun: () => void }) {
  if (!duel) {
    return (
      <section className="duel idle" data-testid="contrast-card" aria-label="Same attack, two escrows">
        <div>
          <span className="eyebrow">Same attack, two escrows</span>
          <h2>See what the guard is worth</h2>
          <p className="muted">Run the same re-entrancy attack against a naive escrow and against a Sealstone vault, and compare what each one loses.</p>
        </div>
        <button className="btn go" type="button" disabled={busy || offline} title={offline ? "Needs the local chain: run npm run dev on your machine" : undefined} onClick={onRun} data-testid="run-duel">
          {busy ? "Running…" : "Run the comparison"}
        </button>
      </section>
    );
  }
  return (
    <section className={`duel${stale ? " stale" : ""}`} data-testid="contrast-card" aria-label="Same attack, two escrows" aria-busy={stale}>
      <header className="duel-head">
        <div>
          <span className="eyebrow">{stale ? "Same attack, two escrows · running again…" : "Same attack, two escrows"}</span>
          <h2>One attacker contract. One re-entrancy trick. Two very different endings.</h2>
        </div>
        <button className="btn secondary" type="button" disabled={busy || offline} onClick={onRun}>{busy ? "Running…" : "Run it again"}</button>
      </header>
      <div className="duel-grid">
        <Naive f={duel.naive} />
        <span className="duel-vs" aria-hidden="true">vs</span>
        <Sealstone f={duel.sealstone} ledgerOk={duel.ledgerOk} />
      </div>
      <p className="duel-foot muted small">Both sides were just run with real transactions on the local chain. What the attacker received, what the escrow still holds and whether the books balance are read back from the chain after the attack.</p>
    </section>
  );
}
