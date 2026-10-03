import { useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";
import { Ticket3D } from "./Ticket3D";
import type { TicketFace } from "./ticketTexture";

const vertexShader = /* glsl */ `
uniform float uTime; uniform float uPixelRatio; uniform float uSize;
attribute float aRadius; attribute float aAngle; attribute float aHeight; attribute float aSeed; attribute float aWinner;
varying vec3 vColor; varying float vWinner; varying float vAlpha;
void main(){
  float speed = 0.22 / (0.35 + aRadius * 0.6);
  float ang = aAngle + uTime * speed;
  float r = aRadius + sin(uTime * 0.6 + aSeed * 12.0) * 0.04;
  vec3 pos = vec3(cos(ang) * r, aHeight * (0.4 + aRadius * 0.12), sin(ang) * r);
  // Winners lift and breathe so the 1% stands out of the crowd.
  float pulse = 0.5 + 0.5 * sin(uTime * 2.4 + aSeed * 30.0);
  pos.y += aWinner * (0.18 + pulse * 0.18);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_Position = projectionMatrix * mv;
  float size = uSize * (aWinner > 0.5 ? 3.4 + pulse * 2.2 : 0.75 + fract(aSeed * 91.7) * 0.9);
  gl_PointSize = size * uPixelRatio * (8.0 / -mv.z);
  float k = clamp(aRadius / 6.0, 0.0, 1.0);
  vec3 inner = vec3(1.0, 0.45, 0.85);
  vec3 mid = vec3(0.55, 0.36, 1.0);
  vec3 outer = vec3(0.18, 0.75, 1.0);
  vColor = mix(mix(inner, mid, smoothstep(0.0, 0.45, k)), outer, smoothstep(0.45, 1.0, k));
  vColor = mix(vColor, vec3(1.0, 0.82, 0.35) * 2.2, aWinner);
  vWinner = aWinner;
  vAlpha = mix(0.55, 1.0, aWinner) * (0.35 + 0.65 * (1.0 - k * 0.6));
}`;

const fragmentShader = /* glsl */ `
varying vec3 vColor; varying float vWinner; varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5; float d = length(c);
  float core = smoothstep(0.5, 0.0, d);
  float glow = pow(core, mix(2.2, 1.4, vWinner));
  if (glow < 0.01) discard;
  gl_FragColor = vec4(vColor * glow, glow * vAlpha);
}`;

function Galaxy({ count, winners }: { count: number; winners: number }) {
  const points = useRef<THREE.Points>(null);
  const geometry = useMemo(() => {
    const geo = new THREE.BufferGeometry();
    const radius = new Float32Array(count); const angle = new Float32Array(count);
    const height = new Float32Array(count); const seed = new Float32Array(count); const winner = new Float32Array(count);
    const arms = 4;
    for (let i = 0; i < count; i++) {
      const r = 0.9 + Math.pow(Math.random(), 0.85) * 5.6;
      const arm = (i % arms) / arms * Math.PI * 2;
      const spread = (Math.random() - 0.5) * (0.9 / (0.6 + r * 0.25)) + (Math.random() - 0.5) * 0.35;
      radius[i] = r;
      angle[i] = arm + r * 0.75 + spread;
      height[i] = (Math.random() - 0.5) * Math.pow(Math.random(), 2) * 1.6;
      seed[i] = Math.random();
      winner[i] = 0;
    }
    // Exactly `winners` points are golden: 500 seats out of the crowd.
    const step = count / winners;
    for (let i = 0; i < winners; i++) winner[Math.floor(i * step + Math.random() * step) % count] = 1;
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(count * 3), 3));
    geo.setAttribute("aRadius", new THREE.BufferAttribute(radius, 1));
    geo.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
    geo.setAttribute("aHeight", new THREE.BufferAttribute(height, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
    geo.setAttribute("aWinner", new THREE.BufferAttribute(winner, 1));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 8);
    return geo;
  }, [count, winners]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    vertexShader, fragmentShader, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) }, uSize: { value: 2.4 } },
  }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((state) => {
    material.uniforms.uTime!.value = state.clock.elapsedTime;
    if (points.current) points.current.rotation.z = Math.sin(state.clock.elapsedTime * 0.1) * 0.04;
  });
  return <points ref={points} geometry={geometry} material={material} rotation={[0.42, 0, 0.1]} />;
}

function OrbitRing({ radius, tilt, color, speed }: { radius: number; tilt: [number, number, number]; color: string; speed: number }) {
  const ref = useRef<THREE.Mesh>(null);
  const tint = useMemo(() => new THREE.Color(color).multiplyScalar(2.4), [color]);
  useFrame((_, delta) => { if (ref.current) ref.current.rotation.z += delta * speed; });
  return <group rotation={tilt}>
    <mesh ref={ref}>
      <torusGeometry args={[radius, 0.008, 8, 220, Math.PI * 1.6]} />
      <meshBasicMaterial color={tint} toneMapped={false} transparent opacity={0.9} />
    </mesh>
  </group>;
}

function CameraRig() {
  useFrame((state, delta) => {
    const cam = state.camera;
    const scroll = Math.min(1.5, window.scrollY / Math.max(1, window.innerHeight));
    cam.position.x = THREE.MathUtils.damp(cam.position.x, state.pointer.x * 0.9, 2, delta);
    cam.position.y = THREE.MathUtils.damp(cam.position.y, 1.6 + state.pointer.y * 0.5 + scroll * 1.2, 2, delta);
    cam.position.z = THREE.MathUtils.damp(cam.position.z, 8.2 + scroll * 2.5, 2, delta);
    cam.lookAt(0, 0, 0);
  });
  return null;
}

const defaultFace: TicketFace = {
  kicker: "Admit one · randomized draw",
  title: "FAIR DROP",
  subtitle: "500 SEATS · 50,000 FANS",
  code: "FD-0001-SEALED-DRAW",
  stamp: "SEALED DRAW",
  accent: "#a78bfa",
  accent2: "#f472b6",
};

/** The landing hero: a crowd galaxy with 500 golden winners orbiting a holographic ticket. */
export default function HeroScene({ face = defaultFace, compact = false }: { face?: TicketFace; compact?: boolean }) {
  const mobile = typeof window !== "undefined" && window.innerWidth < 760;
  const count = compact || mobile ? 9000 : 22000;
  return <Canvas className="hero-canvas" dpr={[1, 1.75]} camera={{ position: [0, 1.6, 8.2], fov: 42 }} gl={{ antialias: true, alpha: true, powerPreference: "high-performance" }}>
    <CameraRig />
    <Galaxy count={count} winners={compact ? 200 : 500} />
    <OrbitRing radius={2.5} tilt={[1.2, 0.2, 0]} color="#a78bfa" speed={0.25} />
    <OrbitRing radius={3.1} tilt={[1.5, -0.4, 0.3]} color="#22d3ee" speed={-0.18} />
    <OrbitRing radius={2.1} tilt={[0.9, 0.5, -0.2]} color="#f472b6" speed={0.35} />
    <Ticket3D face={face} scale={compact ? 0.8 : 0.95} />
    <Sparkles count={60} scale={[7, 4, 4]} size={2.2} speed={0.35} color="#c4b5fd" />
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={1.1} luminanceThreshold={0.62} luminanceSmoothing={0.3} radius={0.75} />
    </EffectComposer>
  </Canvas>;
}
