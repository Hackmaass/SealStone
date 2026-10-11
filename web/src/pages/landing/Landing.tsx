import { useEffect, useRef, useState, type ReactNode } from "react";
import { link } from "../../lib/router";
import deployment from "../../generated/deployment.json";
import { ContrastChart, Icon, SealMark, StoneStack } from "./art";
import { COMMAND, FACTS, FAQS } from "./facts";
import { SealDemo } from "./SealDemo";
import "./landing.css";
import "./sections.css";

const IMG = "/landing";
const DEMO_VAULT = `/vault/${deployment.preseededVault.address}`;

/** Fades a block in once, when it scrolls into view. Without JavaScript, or with reduced motion, everything is simply visible. */
function Reveal({ children, className = "", delay = 0 }: { children: ReactNode; className?: string; delay?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined" || matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setSeen(true);
      return;
    }
    const io = new IntersectionObserver((es) => es.some((e) => e.isIntersecting) && (setSeen(true), io.disconnect()), { rootMargin: "0px 0px -8% 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`rv${seen ? " in" : ""} ${className}`} style={{ transitionDelay: `${delay}ms` }}>
      {children}
    </div>
  );
}

function Cta({ to, children, kind = "solid" }: { to: string; children: ReactNode; kind?: "solid" | "tonal" | "light" | "ghost" }) {
  return (
    <a className={`lp-btn ${kind}`} href={to} onClick={link(to)}>
      {children}
    </a>
  );
}

const smooth = () => (matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth");

// ─────────────────────────── navigation ───────────────────────────
const NAV: Array<[string, string]> = [
  ["#demo", "Try it"],
  ["#for", "Who it's for"],
  ["#lab", "Attack Lab"],
  ["#how", "How it works"],
  ["#faq", "FAQ"],
];

function Nav() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.classList.add("menu-open");
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.classList.remove("menu-open");
    };
  }, [open]);
  const go = (hash: string) => {
    setOpen(false);
    document.querySelector(hash)?.scrollIntoView({ behavior: smooth(), block: "start" });
  };
  return (
    <>
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-nav">
        <a className="lp-logo" href="/" aria-label="Sealstone home" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: smooth() }); }}>
          <SealMark size={30} />
          <span>Sealstone</span>
        </a>
        <nav className="lp-links" aria-label="Sections">
          {NAV.map(([h, t]) => (
            <a key={h} href={h} onClick={(e) => { e.preventDefault(); go(h); }}>{t}</a>
          ))}
        </nav>
        <div className="lp-nav-cta">
          <Cta to="/dashboard" kind="solid">Launch app</Cta>
        </div>
        <button className="lp-burger" type="button" aria-label="Open the menu" aria-expanded={open} onClick={() => setOpen(true)}>
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
        </button>
      </header>
      {open && (
        <div className="lp-menu" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="lp-menu-head">
            <a className="lp-logo" href="/" onClick={(e) => { e.preventDefault(); setOpen(false); window.scrollTo({ top: 0 }); }}>
              <SealMark size={30} />
              <span>Sealstone</span>
            </a>
            <button className="lp-burger" type="button" aria-label="Close the menu" onClick={() => setOpen(false)}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
          <div className="lp-menu-body">
            {NAV.map(([h, t]) => (
              <a key={h} href={h} onClick={(e) => { e.preventDefault(); go(h); }}>{t}</a>
            ))}
          </div>
          <div className="lp-menu-foot">
            <Cta to="/attack-lab" kind="tonal">Try to break it</Cta>
            <Cta to="/dashboard" kind="solid">Launch app</Cta>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────── hero ───────────────────────────
function Phone({ src, alt, className = "" }: { src: string; alt: string; className?: string }) {
  return (
    <figure className={`lp-phone ${className}`}>
      <div className="lp-phone-screen">
        <img src={src} alt={alt} width="390" height="844" loading="eager" decoding="async" />
      </div>
    </figure>
  );
}

function Hero() {
  return (
    <section className="lp-hero lp-panel" aria-labelledby="hero-h">
      <Reveal className="lp-hero-copy">
        <div className="lp-eyebrow"><span className="lp-chip-icon"><SealMark size={22} /></span>Sealstone</div>
        <h1 id="hero-h">Escrow that can't be tricked</h1>
        <p className="lp-lede">Hold the money until the work is delivered. Everyone agrees to the same terms, nobody can swap the file, and any attempt to cheat is refused.</p>
        <div className="lp-cta-row">
          <Cta to="/dashboard" kind="solid">Open the demo</Cta>
          <Cta to="/attack-lab" kind="tonal">Try to break it</Cta>
        </div>
        <p className="lp-reassure"><Icon name="lock" /> No wallet and no sign-up. Runs on your own computer with test money.</p>
      </Reveal>
      <Reveal className="lp-phones" delay={120}>
        <Phone className="side l" src={`${IMG}/phone-studio.jpg`} alt="The agreement studio: an unclear term the AI flagged, with the confirm button locked until a person resolves it" />
        <Phone className="mid" src={`${IMG}/phone-milestone.jpg`} alt="A milestone waiting for the client's review, with the agreed conditions, the submitted file's seal and the approve and dispute buttons" />
        <Phone className="side r" src={`${IMG}/phone-ledger.jpg`} alt="The ledger as a balance equation, reconciled, with where the money currently sits" />
      </Reveal>
    </section>
  );
}

// ─────────────────────────── three promises ───────────────────────────
const PROMISES: Array<{ icon: "file" | "lock" | "eye"; title: string; text: string }> = [
  { icon: "file", title: "You approve the exact file", text: "The file you approve is the one that was delivered. Swap it for a look-alike and the payment is refused." },
  { icon: "lock", title: "Nobody takes money they aren't owed", text: "Only the right person can take each step, in order. Anything else is refused, with a plain explanation." },
  { icon: "eye", title: "Every disagreement has a referee", text: "A named arbiter settles disputes. Neither side can overrule them, and the arbiter can never be paid from the vault." },
];

function Promises() {
  return (
    <section className="lp-promises" aria-labelledby="promises-h">
      <h2 id="promises-h" className="sr-only">What Sealstone promises</h2>
      <div className="lp-promise-grid">
        {PROMISES.map((p, i) => (
          <Reveal key={p.title} delay={i * 80}>
            <article className="lp-card lp-promise">
              <span className="lp-stat-icon"><Icon name={p.icon} /></span>
              <h3>{p.title}</h3>
              <p>{p.text}</p>
            </article>
          </Reveal>
        ))}
      </div>
      <Reveal>
        <div className="lp-strip">
          <span><b>{FACTS.contractTests}</b> tests passing</span>
          <span><b>{FACTS.attacksBlocked} of {FACTS.attacksTotal}</b> real attacks blocked</span>
          <span><b>{FACTS.fuzzSteps.toLocaleString("en-US")}</b> random steps checked</span>
          <span className="lp-strip-note">Don't take our word for it: every one of these you can run yourself.</span>
        </div>
      </Reveal>
    </section>
  );
}

// ─────────────────────────── the product, shown ───────────────────────────
function Browser({ src, alt, url, className = "" }: { src: string; alt: string; url: string; className?: string }) {
  return (
    <div className={`lp-browser ${className}`}>
      <div className="lp-browser-bar" aria-hidden="true"><i /><i /><i /><span>{url}</span></div>
      <img src={src} alt={alt} width="1366" height="768" loading="lazy" decoding="async" />
    </div>
  );
}

function Showcase() {
  return (
    <section className="lp-show" aria-labelledby="show-h">
      <Reveal className="lp-center">
        <h2 id="show-h" className="lp-h1">See what's waiting on you</h2>
        <p className="lp-lede">One screen shows what's locked, what's owed and which step is yours, across every agreement. It reads straight from the contract, so it's never out of date.</p>
      </Reveal>
      <Reveal delay={80}>
        <Browser className="lp-shadow" src={`${IMG}/desktop-dashboard.jpg`} alt="The dashboard: totals in escrow and owed, a row saying what is waiting for the provider, and the list of agreements with progress and a reconciled ledger" url="sealstone.local/dashboard" />
      </Reveal>
      <Reveal className="lp-center lp-tight">
        <h2 className="lp-h2">Milestones that explain themselves</h2>
        <p className="lp-sub">Each milestone says who it is waiting for, what was agreed, and what happens next. When something is refused, it tells you why and that your money didn't move.</p>
      </Reveal>
      <div className="lp-trio">
        {[
          { src: "phone-milestone", cap: "Waiting for review", alt: "A milestone waiting for the client, with the countdown, the submitted file's seal and the approve and dispute buttons" },
          { src: "phone-milestone-mismatch", cap: "A swapped file is refused", alt: "A refused approval: the submitted file's seal and the client's seal side by side, marked different files, with the message that nothing changed" },
          { src: "phone-milestones-settled", cap: "Settled, and the books balance", alt: "Milestone one released and settled, milestone two now unlocked" },
        ].map((s, i) => (
          <Reveal key={s.src} delay={i * 90}>
            <figure className="lp-shot">
              <div className="lp-shot-frame">
                <img src={`${IMG}/${s.src}.jpg`} alt={s.alt} width="390" height="844" loading="lazy" decoding="async" />
              </div>
              <figcaption>{s.cap}</figcaption>
            </figure>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────── who it's for ───────────────────────────
const AUDIENCES = [
  {
    id: "people",
    tab: "For freelancers and clients",
    title: "Pay for the work you actually got.",
    points: ["Split a project into steps and release each one only when you've approved that exact file.", "Both sides sign the same written terms before any money moves.", "If you disagree, a person you both named decides, and you can see their reasoning."],
    example: "A designer and a café owner agree three milestones for a new menu. The owner approves each file by its seal, and the final payment waits for the final files.",
  },
  {
    id: "teams",
    tab: "For teams and programmes",
    title: "Run many agreements with one clear view.",
    points: ["See what's locked, what's owed and what needs a decision across every agreement, in one dashboard.", "AI helps turn contracts into milestones and flags unclear terms; a person confirms every one before money is locked.", "The ledger reconciles after every action, so finance can check the books without asking anyone."],
    example: "A campus incubator funds a student team with 5 ETH of test money in three milestones, with a faculty mentor as arbiter. This is the demo vault.",
  },
] as const;

function WhoFor() {
  const [tab, setTab] = useState<(typeof AUDIENCES)[number]["id"]>("people");
  const a = AUDIENCES.find((x) => x.id === tab)!;
  return (
    <section id="for" className="lp-for" aria-labelledby="for-h">
      <Reveal className="lp-center">
        <h2 id="for-h" className="lp-h1">Built for people and for teams</h2>
        <p className="lp-lede">The same protection, whether it's one project or a whole programme.</p>
      </Reveal>
      <Reveal delay={60}>
        <div className="lp-tabs" role="tablist" aria-label="Who Sealstone is for">
          {AUDIENCES.map((x) => (
            <button key={x.id} role="tab" id={`tab-${x.id}`} aria-selected={tab === x.id} aria-controls={`panel-${x.id}`} className={tab === x.id ? "on" : ""} onClick={() => setTab(x.id)}>
              {x.tab}
            </button>
          ))}
        </div>
        <div className="lp-card lp-for-panel" role="tabpanel" id={`panel-${a.id}`} aria-labelledby={`tab-${a.id}`}>
          <div>
            <h3 className="lp-h3">{a.title}</h3>
            <ul className="lp-checks">
              {a.points.map((p) => (
                <li key={p}><span aria-hidden="true">✓</span>{p}</li>
              ))}
            </ul>
            <div className="lp-cta-row left">
              <Cta to={a.id === "people" ? "/agreement" : "/dashboard"} kind="solid">{a.id === "people" ? "Draft an agreement" : "Open the dashboard"}</Cta>
              <Cta to={DEMO_VAULT} kind="tonal">Open the demo vault</Cta>
            </div>
          </div>
          <aside className="lp-example"><span className="lp-tag">Example</span><p>{a.example}</p></aside>
        </div>
      </Reveal>
    </section>
  );
}

// ─────────────────────────── dark: the attack lab ───────────────────────────
const LAYERS: Array<{ tag: string; title: string; text: string; chips: string[] }> = [
  { tag: "Layer 1", title: "Agreement integrity", text: "AI proposes a checklist and flags every unclear term. A person resolves each one, and a fingerprint of the confirmed terms goes on-chain. Both sides sign that exact fingerprint before any money moves.", chips: ["Proposed", "Checked", "Confirmed", "Signed"] },
  { tag: "Layer 2", title: "Deliverable integrity", text: "The provider commits a SHA-256 fingerprint of the file. The client can only approve that exact file, so a swapped deliverable reverts.", chips: ["SHA-256", "Hash-bound approval", "Dispute path"] },
  { tag: "Layer 3", title: "Fund integrity", text: "Rules-only state machine, pull payments, a reentrancy guard and a live ledger that reconciles after every action, even if ETH is forced in.", chips: ["Pull payments", "Reentrancy guard", "Reconciled"] },
];

function LabSection() {
  return (
    <section id="lab" className="lp-dark lp-panel" aria-labelledby="lab-h">
      <Reveal className="lp-center">
        <div className="lp-eyebrow dark"><span className="lp-chip-icon dark"><SealMark size={22} /></span>Attack Lab</div>
        <h2 id="lab-h" className="lp-h1">Try to <span className="lp-grad">break it</span></h2>
        <p className="lp-lede dark">Twelve real attacks, one click. Each one is a real transaction, and none of them gets money it isn't owed.</p>
        <div className="lp-cta-row">
          <Cta to="/attack-lab" kind="light">Open the Attack Lab</Cta>
          <Cta to="/vaults" kind="ghost">See the vaults</Cta>
        </div>
      </Reveal>
      <Reveal delay={100}>
        <Browser className="lp-window" src={`${IMG}/desktop-lab.jpg`} alt="The Attack Lab after a full run: each attack with the contract's plain-English answer, the raw error, a reconciled ledger and a Blocked verdict, and the naive escrow contrast drained in red" url="sealstone.local/attack-lab" />
      </Reveal>
      <div className="lp-layers">
        {LAYERS.map((l, i) => (
          <Reveal key={l.title} delay={i * 80}>
            <article className="lp-layer">
              <span className="lp-tag">{l.tag}</span>
              <h3>{l.title}</h3>
              <p>{l.text}</p>
              <div className="lp-chips">{l.chips.map((c) => (<span key={c}>{c}</span>))}</div>
            </article>
          </Reveal>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────── how it works ───────────────────────────
const STEPS: Array<{ n: string; title: string; text: string; icon: "file" | "check" | "lock" | "coin" }> = [
  { n: "1", title: "Draft", text: "Paste the agreement. AI proposes the milestones and flags every vague or conflicting term.", icon: "file" },
  { n: "2", title: "Confirm", text: "A person resolves each flag. Both sides sign the same confirmed terms before any money moves.", icon: "check" },
  { n: "3", title: "Deliver", text: "The provider submits a file's seal. The client approves that exact file, or disputes it.", icon: "lock" },
  { n: "4", title: "Settle", text: "Money is released, refunded or escalated by fixed rules. Payments are pulled, and the ledger reconciles.", icon: "coin" },
];

function HowSection() {
  const track = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * (track.current.clientWidth * 0.8), behavior: smooth() });
  return (
    <section id="how" className="lp-how lp-panel" aria-labelledby="how-h">
      <Reveal className="lp-center">
        <div className="lp-eyebrow"><span className="lp-chip-icon"><Icon name="layers" /></span>How it works</div>
        <h2 id="how-h" className="lp-h1">From a paragraph to a protected payment</h2>
        <p className="lp-lede">Four steps. Each one is checked by the contract and not by trust.</p>
        <div className="lp-cta-row">
          <Cta to="/agreement" kind="solid">Draft an agreement</Cta>
          <Cta to="/dashboard" kind="tonal">Open the dashboard</Cta>
        </div>
      </Reveal>
      <Reveal className="lp-stones" delay={80}>
        <StoneStack />
      </Reveal>
      <div className="lp-how-head">
        <div>
          <h2 className="lp-h2">Every step has a rule.</h2>
          <p className="lp-sub">What can happen next is fixed in advance. Anything else is refused with a specific, plain-English error.</p>
        </div>
        <div className="lp-arrows">
          <button type="button" className="lp-round" aria-label="Previous step" onClick={() => by(-1)}>‹</button>
          <button type="button" className="lp-round" aria-label="Next step" onClick={() => by(1)}>›</button>
        </div>
      </div>
      <div className="lp-track" ref={track} tabIndex={0} aria-label="The four steps">
        {STEPS.map((s) => (
          <article key={s.n} className="lp-step">
            <div className="lp-step-top"><span className="lp-step-icon"><Icon name={s.icon} /></span><span>Step {s.n}</span></div>
            <h3>{s.title}</h3>
            <p>{s.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

// ─────────────────────────── guarantee, limits and proof ───────────────────────────
const GUARANTEES: Array<{ text: string; check: string; to: string }> = [
  { text: "The file you approve is the file that was delivered.", check: "Check it: approve the demo vault's milestone with a different file.", to: DEMO_VAULT },
  { text: "No one can take money they aren't owed, in any order or by any trick we've tried.", check: "Check it: run all twelve attacks.", to: "/attack-lab" },
  { text: "The books always add up, and you can verify the agreement's terms yourself.", check: "Check it: open a vault and press Verify the agreement.", to: DEMO_VAULT },
];
const LIMITS = [
  "A matching seal proves it's the same file, not that the work is good. Judging quality is a person's job, which is what disputes are for.",
  "The arbiter is trusted to decide disputes fairly. They can choose between the two sides, but they can never be paid from the vault.",
  "This build runs on a local test chain with test money. Nothing here is a real payment, and every name and agreement is fictional.",
];
const PROOF: Array<{ icon: "check" | "shield" | "bolt" | "layers"; big: string; text: string }> = [
  { icon: "check", big: `${FACTS.contractTests}`, text: "contract tests passing." },
  { icon: "shield", big: `${FACTS.coverageLines}%`, text: "line coverage of the escrow contract." },
  { icon: "bolt", big: `${FACTS.attacksBlocked}/${FACTS.attacksTotal}`, text: "real attacks blocked, ledger reconciled each time." },
  { icon: "layers", big: FACTS.fuzzSteps.toLocaleString("en-US"), text: `random steps, with ${FACTS.invariants} rules checked after every one.` },
];

function ProofSection() {
  return (
    <section id="proof" className="lp-proof lp-panel" aria-labelledby="proof-h">
      <Reveal className="lp-center">
        <div className="lp-eyebrow"><span className="lp-chip-icon"><SealMark size={22} /></span>The Sealstone guarantee</div>
        <h2 id="proof-h" className="lp-h1">Provable by default</h2>
        <p className="lp-lede">Three promises, each with a way to check it yourself. And an honest list of what Sealstone doesn't do.</p>
      </Reveal>
      <div className="lp-promise-grid lp-guarantees">
        {GUARANTEES.map((g, i) => (
          <Reveal key={g.text} delay={i * 70}>
            <article className="lp-card lp-promise">
              <span className="lp-stat-icon"><Icon name="check" /></span>
              <h3>{g.text}</h3>
              <a className="lp-check-link" href={g.to} onClick={link(g.to)}>{g.check}</a>
            </article>
          </Reveal>
        ))}
      </div>
      <Reveal>
        <div className="lp-card lp-limits">
          <h3 className="lp-h4">What Sealstone doesn't do</h3>
          <ul>
            {LIMITS.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      </Reveal>
      <div className="lp-grid4">
        {PROOF.map((p, i) => (
          <Reveal key={p.text} delay={(i % 4) * 60}>
            <article className="lp-card lp-stat">
              <span className="lp-stat-icon"><Icon name={p.icon} /></span>
              <b>{p.big}</b>
              <p>{p.text}</p>
            </article>
          </Reveal>
        ))}
      </div>
      <hr className="lp-rule" />
      <Reveal className="lp-center">
        <h2 className="lp-h2">The same attack, two contracts.</h2>
        <p className="lp-sub">An attacker tries to be paid over and over. Without the protections, other people's money leaves. With them, it stays.</p>
      </Reveal>
      <Reveal className="lp-card lp-chart" delay={60}>
        <div className="lp-chart-head">
          <div>
            <h3>Other users' money left in the contract</h3>
            <p className="lp-sub small">From the Attack Lab's contrast run: {FACTS.naiveDrainedEth} ETH of other users' balances.</p>
          </div>
          <ul className="lp-legend">
            <li><i style={{ background: "#8E7CFF" }} />Sealstone</li>
            <li><i style={{ background: "#C0342B" }} />Naive escrow</li>
          </ul>
        </div>
        <ContrastChart />
      </Reveal>
    </section>
  );
}

// ─────────────────────────── faq ───────────────────────────
function Faq() {
  return (
    <section id="faq" className="lp-faq" aria-labelledby="faq-h">
      <Reveal>
        <h2 id="faq-h" className="lp-h2">Questions people ask</h2>
        <div className="lp-acc">
          {FAQS.map((f) => (
            <details key={f.q}>
              <summary>
                {f.q}
                <span className="lp-plus" aria-hidden="true" />
              </summary>
              <p>{f.a}</p>
            </details>
          ))}
        </div>
      </Reveal>
    </section>
  );
}

// ─────────────────────────── run it yourself + footer ───────────────────────────
function CopyCommand() {
  const [copied, setCopied] = useState(false);
  return (
    <div className="lp-cmd">
      <code aria-label={`Command: ${COMMAND}`}>
        <span className="lp-prompt" aria-hidden="true">$</span> {COMMAND}
      </code>
      <button
        type="button"
        className="lp-btn tonal small"
        onClick={() => {
          void navigator.clipboard?.writeText(COMMAND);
          setCopied(true);
          setTimeout(() => setCopied(false), 1800);
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

function Footer() {
  const col = (title: string, items: Array<[string, string]>) => (
    <div>
      <h4>{title}</h4>
      <ul>
        {items.map(([to, t]) => (
          <li key={t}>
            <a href={to} onClick={link(to)}>{t}</a>
          </li>
        ))}
      </ul>
    </div>
  );
  return (
    <footer className="lp-footer">
      <div className="lp-foot-grid">
        <div className="lp-foot-brand">
          <a className="lp-logo" href="/" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: smooth() }); }}>
            <SealMark size={30} />
            <span>Sealstone</span>
          </a>
          <p>Escrow that can't be tricked by ambiguous agreements, swapped deliverables or malicious contracts.</p>
        </div>
        {col("The app", [["/dashboard", "Dashboard"], ["/vaults", "Vaults"], ["/agreement", "Agreement studio"], ["/attack-lab", "Attack Lab"]])}
        <div>
          <h4>Learn</h4>
          <ul>
            {NAV.map(([h, t]) => (
              <li key={h}>
                <a href={h} onClick={(e) => { e.preventDefault(); document.querySelector(h)?.scrollIntoView({ behavior: smooth() }); }}>{t}</a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <h4>Project</h4>
          <ul>
            <li>Built for VORTEXA 3.0</li>
            <li>Problem B-03: adversarial smart-contract escrow</li>
            <li>Runs offline on a local test chain</li>
          </ul>
        </div>
      </div>
      <p className="lp-fine">Fictional data only. Test ETH on a local chain: no real money, people, public networks or third-party systems are involved.</p>
    </footer>
  );
}

export default function Landing() {
  useEffect(() => {
    document.title = "Sealstone: escrow that can't be tricked";
  }, []);
  // The visitor may land with a hash (/#faq); scroll there once the page exists.
  useEffect(() => {
    if (location.hash) document.querySelector(location.hash)?.scrollIntoView();
  }, []);
  return (
    <div className="lp">
      <Nav />
      <main id="main">
        <Hero />
        <Promises />
        <SealDemo />
        <Showcase />
        <WhoFor />
        <LabSection />
        <HowSection />
        <ProofSection />
        <Faq />
        <section className="lp-final lp-panel" aria-labelledby="final-h">
          <Reveal className="lp-center">
            <h2 id="final-h" className="lp-h1">See it hold.</h2>
            <p className="lp-lede">Open the demo, pick a role, and try to take money you shouldn't. Or run it on your own machine with one command.</p>
            <div className="lp-cta-row">
              <Cta to="/dashboard" kind="solid">Launch app</Cta>
              <Cta to="/attack-lab" kind="tonal">Try to break it</Cta>
            </div>
            <CopyCommand />
          </Reveal>
        </section>
      </main>
      <Footer />
    </div>
  );
}
