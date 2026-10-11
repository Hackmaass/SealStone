/** Landing-page artwork, all inline SVG (no images to fetch, nothing external). The landing page must not import ethers. */

/** keccak256("sealstone"): the brand seal is drawn from this hash, exactly like every other seal in the app. */
const BRAND = "18d6890f91dc5dc428f22e2cb402f41c614e0ec0bce44b827238ad9d0f2d44cf";

/** One radial stroke per hex digit (same rule as the app's HashSeal): the Sealstone mark. */
export function SealMark({ size = 28, hex = BRAND, className }: { size?: number; hex?: string; className?: string }) {
  const lines = [];
  for (let i = 0; i < 64; i++) {
    const v = parseInt(hex[i] ?? "0", 16) || 0;
    const a = (i / 64) * Math.PI * 2 - Math.PI / 2;
    const r1 = 22;
    const r2 = 26 + v * 1.25;
    lines.push(<line key={i} x1={(50 + r1 * Math.cos(a)).toFixed(2)} y1={(50 + r1 * Math.sin(a)).toFixed(2)} x2={(50 + r2 * Math.cos(a)).toFixed(2)} y2={(50 + r2 * Math.sin(a)).toFixed(2)} />);
  }
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 100 100" role="img" aria-label="Sealstone" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <circle cx="50" cy="50" r="17" />
      <circle cx="50" cy="50" r="8" strokeDasharray="3 3" />
      <circle cx="50" cy="50" r="2.4" fill="currentColor" stroke="none" />
      {lines}
    </svg>
  );
}

/** A lavender stone block (isometric), optionally carrying the seal on its top face. */
function Stone({ x, y, seal = false, id }: { x: number; y: number; seal?: boolean; id: string }) {
  return (
    <g transform={`translate(${x} ${y})`}>
      <polygon points="100,100 200,50 200,110 100,160" fill={`url(#${id}-r)`} />
      <polygon points="0,50 100,100 100,160 0,110" fill={`url(#${id}-l)`} />
      <polygon points="100,0 200,50 100,100 0,50" fill={`url(#${id}-t)`} />
      {seal && (
        <g transform="translate(100 50) scale(1 .5) rotate(-45)" stroke="#fff" strokeOpacity=".92" strokeWidth="2" strokeLinecap="round" fill="none">
          <circle r="17" />
          <circle r="6" fill="#fff" stroke="none" />
          {Array.from({ length: 28 }, (_, i) => {
            const a = (i / 28) * Math.PI * 2;
            const r2 = 24 + ((i * 7) % 6) * 2.4;
            return <line key={i} x1={Math.cos(a) * 20} y1={Math.sin(a) * 20} x2={Math.cos(a) * r2} y2={Math.sin(a) * r2} />;
          })}
        </g>
      )}
    </g>
  );
}

/** Three stacks of stones: milestones being settled one after another, the last one sealed. */
export function StoneStack({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 740 380" role="img" aria-label="Three stacks of lavender stone blocks, the highest carrying the Sealstone seal" fill="none">
      <defs>
        {["a", "b", "c"].map((k) => (
          <g key={k}>
            <linearGradient id={`${k}-t`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#CFC7FF" /><stop offset="1" stopColor="#9C8DFF" /></linearGradient>
            <linearGradient id={`${k}-l`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#8D7BF5" /><stop offset="1" stopColor="#7A66EC" /></linearGradient>
            <linearGradient id={`${k}-r`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#A99CFF" /><stop offset="1" stopColor="#9484F6" /></linearGradient>
          </g>
        ))}
        <filter id="soft" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#5B45E6" floodOpacity=".22" /></filter>
      </defs>
      <g filter="url(#soft)">
        {/* left: one stone */}
        <Stone id="a" x={10} y={190} />
        {/* middle: two stones */}
        <Stone id="b" x={270} y={150} />
        <Stone id="b" x={270} y={90} seal />
        {/* right: three stones */}
        <Stone id="c" x={530} y={110} />
        <Stone id="c" x={530} y={50} />
        <Stone id="c" x={530} y={-10} seal />
      </g>
    </svg>
  );
}

/** The contrast, as a picture: other users' money left in the contract as the attacker is paid out. Values are from the Attack Lab's contrast run. */
export function ContrastChart({ className }: { className?: string }) {
  const W = 900;
  const H = 340;
  const L = 64;
  const R = 36;
  const T = 24;
  const B = 56;
  const xs = [0, 1, 2, 3, 4];
  const x = (i: number) => L + (i / 4) * (W - L - R);
  const y = (eth: number) => T + (1 - eth / 3) * (H - T - B);
  const naive = [3, 3, 2, 1, 0];
  const safe = [3, 3, 3, 3, 3];
  const path = (s: number[]) => s.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = (s: number[]) => `${path(s)} L${x(4).toFixed(1)} ${y(0).toFixed(1)} L${x(0).toFixed(1)} ${y(0).toFixed(1)} Z`;
  return (
    <svg className={className} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Chart: other users' money in the contract as the attacker is paid. Sealstone stays at 3 ETH. The naive escrow falls to 0 ETH.">
      <defs>
        <linearGradient id="area" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#9C8DFF" stopOpacity=".32" /><stop offset="1" stopColor="#9C8DFF" stopOpacity="0" /></linearGradient>
      </defs>
      {[0, 1, 2, 3].map((v) => (
        <g key={v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke="#E4E0F5" strokeDasharray="3 5" />
          <text x={L - 12} y={y(v) + 4} textAnchor="end" fontSize="13" fill="#7A7587">{v} ETH</text>
        </g>
      ))}
      {xs.map((i) => (
        <text key={i} x={x(i)} y={H - 28} textAnchor="middle" fontSize="13" fill="#7A7587">{i}</text>
      ))}
      <text x={(L + W - R) / 2} y={H - 6} textAnchor="middle" fontSize="13" fill="#7A7587">Payouts made to the attacker</text>
      <path d={area(safe)} fill="url(#area)" />
      <path d={path(safe)} fill="none" stroke="#8E7CFF" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d={path(naive)} fill="none" stroke="#C0342B" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
      {naive.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="5" fill="#fff" stroke="#C0342B" strokeWidth="3" />
      ))}
      {safe.map((v, i) => (
        <circle key={i} cx={x(i)} cy={y(v)} r="5" fill="#fff" stroke="#8E7CFF" strokeWidth="3" />
      ))}
      <g>
        <rect x={x(4) - 118} y={y(3) - 44} width="118" height="30" rx="15" fill="#5B45E6" />
        <text x={x(4) - 59} y={y(3) - 24} textAnchor="middle" fontSize="14" fontWeight="650" fill="#fff">3 ETH safe</text>
      </g>
      <g>
        <rect x={x(4) - 130} y={y(0) - 46} width="130" height="30" rx="15" fill="#C0342B" />
        <text x={x(4) - 65} y={y(0) - 26} textAnchor="middle" fontSize="14" fontWeight="650" fill="#fff">0 ETH left</text>
      </g>
    </svg>
  );
}

/** Small line icons for the proof cards. */
export function Icon({ name }: { name: "check" | "shield" | "bolt" | "layers" | "file" | "eye" | "coin" | "lock" }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" aria-hidden="true" {...p}>
      {name === "check" && (<><circle cx="12" cy="12" r="9" /><path d="M8 12.5l3 3 5-6" /></>)}
      {name === "shield" && <path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" />}
      {name === "bolt" && <path d="M13 2L4 14h7l-1 8 9-12h-7z" />}
      {name === "layers" && (<><path d="M12 3l9 5-9 5-9-5z" /><path d="M3 13l9 5 9-5" /></>)}
      {name === "file" && (<><path d="M6 3h8l4 4v14H6z" /><path d="M14 3v4h4M9 13h6M9 17h6" /></>)}
      {name === "eye" && (<><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" /></>)}
      {name === "coin" && (<><circle cx="12" cy="12" r="9" /><path d="M9 9.5c0-1 1.2-1.7 3-1.7s3 .7 3 1.8c0 2.3-6 1.2-6 3.8 0 1.1 1.3 1.8 3 1.8s3-.7 3-1.7M12 6v2M12 16v2" /></>)}
      {name === "lock" && (<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 018 0v3" /></>)}
    </svg>
  );
}
