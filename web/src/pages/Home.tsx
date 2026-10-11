import { navigate } from "../lib/router";
import deployment from "../generated/deployment.json";

export function Home() {
  return (
    <div>
      <h1>Escrow that can't be tricked</h1>
      <p className="muted" style={{ maxWidth: "62ch", marginTop: 8 }}>
        Ambiguous agreements, swapped deliverables and malicious contracts are the three ways milestone escrow fails. Every one of them can be tried here.
      </p>
      <div className="home">
        <div className="panel">
          <h2>Draft a new agreement</h2>
          <p className="muted">Paste the agreement text. The AI proposes a checklist and flags what is unclear. People resolve every flag before any money locks.</p>
          <button className="btn go" onClick={() => navigate("/agreement")}>Start a new agreement</button>
        </div>
        <div className="panel">
          <h2>Open the demo vault</h2>
          <p className="muted">The KrishiLens incubation grant, already deployed and funded, with the first milestone waiting for review.</p>
          <button className="btn" onClick={() => navigate(`/vault/${deployment.preseededVault.address}`)}>Open the demo vault</button>
        </div>
        <div className="panel">
          <h2>Break it</h2>
          <p className="muted">Fire real attacks at a sandbox vault: a second release, an unauthorized refund, a swapped file, re-entrancy.</p>
          <button className="btn secondary" onClick={() => navigate("/attack-lab")}>Open the Attack Lab</button>
        </div>
      </div>
    </div>
  );
}
