import { Component, Suspense, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";

export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(query.matches);
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);
  return reduced;
}

let webglSupport: boolean | null = null;
export function hasWebGL() {
  if (webglSupport !== null) return webglSupport;
  try {
    const canvas = document.createElement("canvas");
    webglSupport = !!(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch { webglSupport = false; }
  return webglSupport;
}

/** Renders a WebGL scene, falling back to `fallback` when WebGL is missing or the scene crashes. */
export class SceneBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (this.state.failed || !hasWebGL()) return this.props.fallback ?? null;
    return <Suspense fallback={this.props.fallback ?? null}>{this.props.children}</Suspense>;
  }
}

/** Fades and lifts children into view the first time they scroll on screen. */
export function Reveal({ children, delay = 0, className = "", as: Tag = "div" }: { children: ReactNode; delay?: number; className?: string; as?: "div" | "section" | "article" }) {
  const ref = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) { setShown(true); observer.disconnect(); }
    }, { threshold: 0.12 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <Tag ref={ref as never} className={`reveal ${shown ? "reveal-in" : ""} ${className}`} style={{ "--reveal-delay": `${delay}ms` } as CSSProperties}>{children}</Tag>;
}

/** A card that tilts toward the pointer with a moving glare highlight. */
export function TiltCard({ children, className = "", max = 9 }: { children: ReactNode; className?: string; max?: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const reduced = usePrefersReducedMotion();
  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const node = ref.current;
    if (!node || reduced || event.pointerType === "touch") return;
    const rect = node.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width;
    const y = (event.clientY - rect.top) / rect.height;
    node.style.setProperty("--rx", `${(0.5 - y) * max}deg`);
    node.style.setProperty("--ry", `${(x - 0.5) * max}deg`);
    node.style.setProperty("--gx", `${x * 100}%`);
    node.style.setProperty("--gy", `${y * 100}%`);
  };
  const leave = () => {
    const node = ref.current;
    if (!node) return;
    node.style.setProperty("--rx", "0deg");
    node.style.setProperty("--ry", "0deg");
  };
  return <div ref={ref} className={`tilt ${className}`} onPointerMove={move} onPointerLeave={leave}><div className="tilt-glare" />{children}</div>;
}

/** Animates a number from its previous value to `value`. */
export function CountUp({ value, duration = 1100 }: { value: number | null | undefined; duration?: number }) {
  const [shown, setShown] = useState(0);
  const from = useRef(0);
  useEffect(() => {
    if (value == null) return;
    const start = performance.now();
    const origin = from.current;
    let frame = 0;
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 4);
      setShown(Math.round(origin + (value - origin) * eased));
      if (t < 1) frame = requestAnimationFrame(tick);
      else from.current = value;
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [value, duration]);
  if (value == null) return <>—</>;
  return <>{shown.toLocaleString()}</>;
}

/** Text that scrambles through glyphs before settling. */
export function ScrambleText({ text, className = "" }: { text: string; className?: string }) {
  const [out, setOut] = useState(text);
  const reduced = usePrefersReducedMotion();
  useEffect(() => {
    if (reduced) { setOut(text); return; }
    const glyphs = "!<>-_\\/[]{}—=+*^?#01";
    let frame = 0; let raf = 0;
    const run = () => {
      frame++;
      const settled = Math.floor(frame / 2);
      setOut(text.split("").map((char, i) => (i < settled || char === " " ? char : glyphs[Math.floor(Math.random() * glyphs.length)])).join(""));
      if (settled < text.length) raf = requestAnimationFrame(run);
    };
    raf = requestAnimationFrame(run);
    return () => cancelAnimationFrame(raf);
  }, [text, reduced]);
  return <span className={className} aria-label={text}>{out}</span>;
}

/** Circular progress ring drawn in SVG. */
export function Ring({ value, size = 120, stroke = 9, tone = "violet", children }: { value: number; size?: number; stroke?: number; tone?: string; children?: ReactNode }) {
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const clamped = Math.max(0, Math.min(1, value));
  return <div className={`ring ring-${tone}`} style={{ width: size, height: size }}>
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true">
      <circle cx={size / 2} cy={size / 2} r={radius} className="ring-track" strokeWidth={stroke} fill="none" />
      <circle cx={size / 2} cy={size / 2} r={radius} className="ring-value" strokeWidth={stroke} fill="none" strokeLinecap="round"
        strokeDasharray={circumference} strokeDashoffset={circumference * (1 - clamped)} transform={`rotate(-90 ${size / 2} ${size / 2})`} />
    </svg>
    <div className="ring-center">{children}</div>
  </div>;
}
