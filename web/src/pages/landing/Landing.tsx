import { useEffect, useRef, useState, type ReactNode } from "react";
import { link, navigate } from "../../lib/router";
import { ContrastChart, Icon, SealMark, StoneStack } from "./art";
import { COMMAND, FACTS, FAQS } from "./facts";
import "./landing.css";

const DEMO_VAULT = "/dashboard";
const IMG = "/landing";

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

// ─────────────────────────── navigation ───────────────────────────
const NAV: Array<[string, string]> = [
  ["#how", "How it works"],
  ["#lab", "Attack Lab"],
  ["#proof", "Proof"],
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
    document.querySelector(hash)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  };
  return (
    <>
      <a className="lp-skip" href="#main">Skip to content</a>
      <header className="lp-nav">
        <a className="lp-logo" href="/" aria-label="Sealstone home" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
            <Cta to="/attack-lab" kind="tonal">Try the Attack Lab</Cta>
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
        <p className="lp-lede">Milestone payments where people confirm the terms, every file is matched to its fingerprint, and the books balance after every attack you throw at them.</p>
        <div className="lp-cta-row">
          <Cta to={DEMO_VAULT} kind="solid">Open the dashboard</Cta>
          <Cta to="/attack-lab" kind="tonal">Try to break it</Cta>
        </div>
      </Reveal>
      <Reveal className="lp-phones" delay={120}>
        <Phone className="side l" src={`${IMG}/phone-studio.jpg`} alt="The agreement studio highlighting an unclear term the AI flagged, with the confirm button locked" />
        <Phone className="mid" src={`${IMG}/phone-milestone.jpg`} alt="A milestone waiting for the client's review, with the agreed conditions, the submitted file's seal and the approve and dispute buttons" />
        <Phone className="side r" src={`${IMG}/phone-ledger.jpg`} alt="The ledger as a balance equation, reconciled, with where the money currently sits" />
      </Reveal>
    </section>
  );
}

// ─────────────────────────── facts band ───────────────────────────
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

function FactsBand() {
  return (
    <section className="lp-band lp-card" aria-labelledby="band-h">
      <Reveal>
        <h2 id="band-h" className="lp-h3">Built to be checked, not trusted</h2>
        <dl className="lp-facts">
          <div><dt>Contract tests passing</dt><dd>{FACTS.contractTests}</dd></div>
          <div><dt>Real attacks blocked</dt><dd>{FACTS.attacksBlocked} of {FACTS.attacksTotal}</dd></div>
          <div><dt>Randomised steps fuzzed</dt><dd>{FACTS.fuzzSteps.toLocaleString("en-US")}</dd></div>
        </dl>
        <hr />
        <h3 className="lp-h4">Run it on your machine</h3>
        <p className="lp-sub small">One command starts the local chain, the AI service and the app. It works with Wi-Fi off.</p>
        <CopyCommand />
      </Reveal>
    </section>
  );
}

// ─────────────────────────── dark: the attack lab ───────────────────────────
const LAYERS: Array<{ tag: string; title: string; text: string; chips: string[] }> = [
  { tag: "Layer 1", title: "Agreement integrity", text: "AI proposes a checklist and flags every unclear term. A person resolves each one, and the hash of the confirmed terms goes on-chain. Both sides sign that exact hash before any money moves.", chips: ["Proposed", "Validated", "Confirmed", "Signed"] },
  { tag: "Layer 2", title: "Deliverable integrity", text: "The provider commits the SHA-256 of the file when marking a milestone complete. The client can only approve that exact file, so a swapped deliverable reverts.", chips: ["SHA-256", "Hash-bound approval", "Dispute path"] },
  { tag: "Layer 3", title: "Fund integrity", text: "A role-gated state machine with pull payments, a reentrancy guard and a live ledger that reconciles after every action, including ETH that was forced in.", chips: ["Pull payments", "Reentrancy guard", "Reconciled"] },
];

function LabSection() {
  return (
    <section id="lab" className="lp-dark lp-panel" aria-labelledby="lab-h">
      <Reveal className="lp-center">
        <div className="lp-eyebrow dark"><span className="lp-chip-icon dark"><SealMark size={22} /></span>Attack Lab</div>
        <h2 id="lab-h" className="lp-h1">The full power of <span className="lp-grad">breaking it</span></h2>
        <p className="lp-lede dark">Twelve real attacks, one click. Every one is sent as a real transaction from an attacker's account.</p>
        <div className="lp-cta-row">
          <Cta to="/attack-lab" kind="light">Open the Attack Lab</Cta>
          <Cta to="/vaults" kind="ghost">See the vaults</Cta>
        </div>
      </Reveal>
      <Reveal className="lp-window" delay={100}>
        <div className="lp-window-bar" aria-hidden="true"><i /><i /><i /><span>sealstone.local/attack-lab</span></div>
        <img src={`${IMG}/desktop-lab.jpg`} alt="The Attack Lab after a full run: twelve attacks, each showing the contract's plain-English answer, the raw error, a reconciled ledger and a Blocked verdict, with the naive escrow contrast drained in red" width="1366" height="768" loading="lazy" decoding="async" />
      </Reveal>
      <Reveal className="lp-dark-foot">
        <p className="lp-lede dark left">From a second release to a re-entrancy attack: each one is blocked, and the ledger still balances afterwards.</p>
        <Cta to="/attack-lab" kind="ghost">Learn more</Cta>
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
  { n: "2", title: "Confirm", text: "A person resolves each flag. The confirmed terms are hashed on-chain and both sides sign the hash.", icon: "check" },
  { n: "3", title: "Deliver", text: "The provider submits a file's SHA-256. The client approves that exact file, or disputes it.", icon: "lock" },
  { n: "4", title: "Settle", text: "Funds are released, refunded or escalated by the rules. Payments are pulled, and the ledger reconciles.", icon: "coin" },
];

function HowSection() {
  const track = useRef<HTMLDivElement>(null);
  const by = (dir: 1 | -1) => track.current?.scrollBy({ left: dir * (track.current.clientWidth * 0.8), behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
  return (
    <section id="how" className="lp-how lp-panel" aria-labelledby="how-h">
      <Reveal className="lp-center">
        <div className="lp-eyebrow"><span className="lp-chip-icon"><Icon name="layers" /></span>How it works</div>
        <h2 id="how-h" className="lp-h1">From a paragraph to a protected payment</h2>
        <p className="lp-lede">Four steps, each one checked by the contract and not by trust.</p>
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

// ─────────────────────────── proof ───────────────────────────
const PROOF: Array<{ icon: "check" | "shield" | "bolt" | "layers" | "eye" | "lock"; big: string; text: string }> = [
  { icon: "check", big: `${FACTS.contractTests}`, text: "contract tests passing, with no test weakened to make it pass." },
  { icon: "shield", big: `${FACTS.coverageLines}%`, text: "line coverage of the escrow contract." },
  { icon: "bolt", big: `${FACTS.attacksBlocked}/${FACTS.attacksTotal}`, text: "real attacks blocked, with the ledger reconciled after each." },
  { icon: "layers", big: FACTS.fuzzSteps.toLocaleString("en-US"), text: `randomised steps, with ${FACTS.invariants} invariants asserted after every one.` },
  { icon: "eye", big: `${FACTS.bookletTests}`, text: "required adversarial tests, present by name." },
  { icon: "lock", big: "0", text: "real networks, real people or real money involved." },
];

function ProofSection() {
  return (
    <section id="proof" className="lp-proof lp-panel" aria-labelledby="proof-h">
      <Reveal className="lp-center">
        <div className="lp-eyebrow"><span className="lp-chip-icon"><SealMark size={22} /></span>Proof</div>
        <h2 id="proof-h" className="lp-h1">Provable by default</h2>
        <p className="lp-lede">Every claim here has a test, a screen or a command behind it. Open the app and check.</p>
        <div className="lp-cta-row"><Cta to="/attack-lab" kind="tonal">Run the proof</Cta></div>
      </Reveal>
      <div className="lp-grid6">
        {PROOF.map((p, i) => (
          <Reveal key={p.text} delay={(i % 3) * 70}>
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
        <p className="lp-sub">Pay out an attacker who re-enters the withdraw function. Without the protections, other people's money leaves. With them, it stays.</p>
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

// ─────────────────────────── footer ───────────────────────────
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
          <a className="lp-logo" href="/" onClick={(e) => { e.preventDefault(); window.scrollTo({ top: 0, behavior: "smooth" }); }}>
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
                <a href={h} onClick={(e) => { e.preventDefault(); document.querySelector(h)?.scrollIntoView({ behavior: "smooth" }); }}>{t}</a>
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
        <FactsBand />
        <LabSection />
        <HowSection />
        <ProofSection />
        <Faq />
        <section className="lp-final lp-panel" aria-labelledby="final-h">
          <Reveal className="lp-center">
            <h2 id="final-h" className="lp-h1">See it hold.</h2>
            <p className="lp-lede">Open the demo vault, pick a role, and try to take money you shouldn't.</p>
            <div className="lp-cta-row">
              <Cta to="/dashboard" kind="solid">Launch app</Cta>
              <button className="lp-btn tonal" type="button" onClick={() => navigate("/attack-lab")}>Try to break it</button>
            </div>
          </Reveal>
        </section>
      </main>
      <Footer />
    </div>
  );
}
