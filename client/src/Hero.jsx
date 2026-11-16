import { useEffect, useState } from 'react';

const STORES = ['Amazon.in', 'Flipkart', 'Croma'];
const Y = [52, 170, 288];
const path = (i) => `M204 170 C 282 170, 282 ${Y[i]}, 360 ${Y[i]}`;
const STEPS = [
  { out: [], active: 0, caption: 'Amazon.in is converting best, so shoppers go there.' },
  { out: [0], active: 1, caption: 'Amazon.in sells out. The link switches to Flipkart instantly.' },
  { out: [0, 1], active: 2, caption: 'Flipkart sells out too. Croma takes over.' },
  { out: [], active: 0, caption: 'Everything restocks. Back to the best store.' },
];

export default function HeroRoute() {
  const [step, setStep] = useState(0);
  const [reduce] = useState(() => matchMedia('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (reduce) return undefined;
    const t = setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3400);
    return () => clearInterval(t);
  }, [reduce]);

  const s = STEPS[step];
  return (
    <div className="hero-route">
      <svg className="hero-svg" viewBox="0 0 520 340" aria-hidden="true">
        <defs>
          <linearGradient id="flow" gradientUnits="userSpaceOnUse" x1="204" y1="0" x2="360" y2="0">
            <stop offset="0" style={{ stopColor: 'var(--accent-2)' }} />
            <stop offset="1" style={{ stopColor: 'var(--accent-3)' }} />
          </linearGradient>
        </defs>

        {STORES.map((_, i) => (
          <path key={i} d={path(i)} className={`route ${i === s.active ? 'on' : ''} ${s.out.includes(i) ? 'out' : ''}`} />
        ))}

        {!reduce && (
          <>
            <circle r="6" className="pulse"><animateMotion key={`a${step}`} dur="1.5s" repeatCount="indefinite" path={path(s.active)} /></circle>
            <circle r="4" className="pulse soft"><animateMotion key={`b${step}`} dur="1.5s" begin="-0.75s" repeatCount="indefinite" path={path(s.active)} /></circle>
          </>
        )}

        <rect x="4" y="126" width="200" height="88" rx="24" className="node src" />
        <text x="24" y="162" className="sub">One link</text>
        <text x="24" y="190" className="src-text">go.creator/earbuds</text>

        {STORES.map((name, i) => {
          const out = s.out.includes(i), on = i === s.active;
          return (
            <g key={name}>
              <rect x="360" y={Y[i] - 32} width="156" height="64" rx="20" className={`node ${on ? 'active' : ''} ${out ? 'out' : ''}`} />
              <circle cx="384" cy={Y[i]} r="5.5" className={`dot ${out ? 'red' : on ? 'green' : ''}`} />
              <text x="402" y={Y[i] + 6} className={`store-text ${out ? 'struck' : ''}`}>{name}</text>
            </g>
          );
        })}
      </svg>
      <p className="hero-caption" key={step}>{s.caption}</p>
    </div>
  );
}
