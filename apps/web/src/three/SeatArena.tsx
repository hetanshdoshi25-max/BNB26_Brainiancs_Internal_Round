import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import * as THREE from "three";

export type ArenaState = {
  capacity: number; confirmed: number; reserved: number; waitlisted: number; entered: number; expired: number;
  status: "DRAFT" | "OPEN" | "CLOSED";
};

const MAX_SEATS = 2400;
const COLORS = {
  confirmed: new THREE.Color("#a3e635").multiplyScalar(2.1),
  reserved: new THREE.Color("#c084fc").multiplyScalar(2.3),
  pending: new THREE.Color("#22d3ee").multiplyScalar(0.55),
  empty: new THREE.Color("#3b3570").multiplyScalar(0.9),
  draft: new THREE.Color("#2a2560").multiplyScalar(0.8),
};

/** Lays seats out on curved, rising tiers facing a stage, front-centre first. */
function layoutSeats(count: number) {
  const seats: Array<{ x: number; y: number; z: number; ry: number; order: number }> = [];
  const arc = Math.PI * 0.82;
  let row = 0;
  const spacing = Math.max(0.13, Math.min(0.26, 3.6 / Math.sqrt(count)));
  while (seats.length < count) {
    const radius = 1.4 + row * spacing * 1.15;
    const perRow = Math.max(4, Math.floor((arc * radius) / spacing));
    const remaining = count - seats.length;
    const inRow = Math.min(perRow, remaining);
    for (let i = 0; i < inRow; i++) {
      // Fill each row from its centre outwards so allocations grow symmetrically.
      const k = i % 2 === 0 ? i / 2 : -(i + 1) / 2;
      const a = (k / perRow) * arc;
      seats.push({ x: Math.sin(a) * radius, y: row * spacing * 0.55, z: Math.cos(a) * radius - 1.2, ry: a, order: row * 1000 + Math.abs(k) });
    }
    row++;
  }
  return { seats, rows: row, spacing };
}

function Seats({ state }: { state: ArenaState }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const count = Math.max(1, Math.min(MAX_SEATS, state.capacity));
  const perInstance = state.capacity / count;
  const { seats, spacing } = useMemo(() => layoutSeats(count), [count]);
  const geometry = useMemo(() => {
    const size = spacing * 0.72;
    return new THREE.BoxGeometry(size, size * 0.7, size);
  }, [spacing]);
  const material = useMemo(() => new THREE.MeshBasicMaterial({ toneMapped: false }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  const born = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);

  useLayoutEffect(() => { born.current = performance.now(); }, [count]);

  // Colour seats by allocation state.
  useLayoutEffect(() => {
    const node = mesh.current;
    if (!node) return;
    const confirmed = Math.round(state.confirmed / perInstance);
    const reserved = Math.round(state.reserved / perInstance);
    for (let i = 0; i < count; i++) {
      let color = state.status === "DRAFT" ? COLORS.draft : state.status === "OPEN" ? COLORS.pending : COLORS.empty;
      if (i < confirmed) color = COLORS.confirmed;
      else if (i < confirmed + reserved) color = COLORS.reserved;
      node.setColorAt(i, color);
    }
    if (node.instanceColor) node.instanceColor.needsUpdate = true;
  }, [state.confirmed, state.reserved, state.status, count, perInstance]);

  useFrame((frame) => {
    const node = mesh.current;
    if (!node) return;
    const age = (performance.now() - born.current) / 1000;
    const t = frame.clock.elapsedTime;
    const open = state.status === "OPEN";
    if (age > 3 && !open) return; // static after the intro
    for (let i = 0; i < count; i++) {
      const seat = seats[i]!;
      const delay = (seat.order / 1000) * 0.07 + (seat.order % 1000) * 0.0025;
      const grow = THREE.MathUtils.clamp((age - delay) * 2.4, 0, 1);
      const pop = grow < 1 ? 1 - Math.pow(1 - grow, 3) * Math.cos(grow * 6) : 1;
      const wave = open ? Math.sin(t * 3 - seat.order * 0.004 - (seat.order % 1000) * 0.2) * 0.04 : 0;
      dummy.position.set(seat.x, seat.y + (1 - grow) * 1.2 + wave, seat.z);
      dummy.rotation.set(0, seat.ry, 0);
      dummy.scale.setScalar(Math.max(0.0001, pop));
      dummy.updateMatrix();
      node.setMatrixAt(i, dummy.matrix);
    }
    node.instanceMatrix.needsUpdate = true;
  });
  return <instancedMesh ref={mesh} args={[geometry, material, count]} frustumCulled={false} />;
}

/** The crowd: entrants swirl above the arena; the denser it is, the higher the demand. */
function Crowd({ people }: { people: number }) {
  const count = Math.max(300, Math.min(4500, people));
  const geometry = useMemo(() => {
    const positions = new Float32Array(count * 3);
    const seeds = new Float32Array(count);
    for (let i = 0; i < count; i++) {
      const r = 2.2 + Math.random() * 3.6;
      const a = Math.random() * Math.PI * 2;
      positions.set([Math.cos(a) * r, 1.4 + Math.random() * 2.2, Math.sin(a) * r - 1.2], i * 3);
      seeds[i] = Math.random();
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(seeds, 1));
    return geo;
  }, [count]);
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uDensity: { value: 0 } },
    vertexShader: `
      uniform float uTime; attribute float aSeed; varying float vA;
      void main(){
        vec3 p = position;
        float a = uTime * (0.08 + aSeed * 0.12);
        p.xz = mat2(cos(a), -sin(a), sin(a), cos(a)) * (p.xz + vec2(0.0, 1.2)) - vec2(0.0, 1.2);
        p.y += sin(uTime + aSeed * 20.0) * 0.12;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_Position = projectionMatrix * mv;
        gl_PointSize = (1.5 + aSeed * 2.5) * (7.0 / -mv.z);
        vA = 0.35 + aSeed * 0.65;
      }`,
    fragmentShader: `
      uniform float uDensity; varying float vA;
      void main(){ float d = length(gl_PointCoord - 0.5); float g = smoothstep(0.5, 0.0, d);
        gl_FragColor = vec4(vec3(1.0, 0.45, 0.8) * 1.3 * g, g * vA * uDensity * 0.75); }`,
  }), []);
  useEffect(() => () => { geometry.dispose(); material.dispose(); }, [geometry, material]);
  useFrame((state, delta) => {
    material.uniforms.uTime!.value = state.clock.elapsedTime;
    const target = people > 0 ? 1 : 0.25;
    material.uniforms.uDensity!.value = THREE.MathUtils.damp(material.uniforms.uDensity!.value, target, 2, delta);
  });
  return <points geometry={geometry} material={material} frustumCulled={false} />;
}

function Stage() {
  const glow = useMemo(() => new THREE.Color("#22d3ee").multiplyScalar(2.6), []);
  const glow2 = useMemo(() => new THREE.Color("#f472b6").multiplyScalar(2.2), []);
  return <group position={[0, 0, -1.2]}>
    <mesh position={[0, -0.02, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[1.05, 64, 0, Math.PI]} />
      <meshBasicMaterial color="#0e0b2a" />
    </mesh>
    <mesh position={[0, 0.01, 0]} rotation={[-Math.PI / 2, 0, Math.PI]}>
      <ringGeometry args={[1.02, 1.07, 64, 1, 0, Math.PI]} />
      <meshBasicMaterial color={glow} toneMapped={false} side={THREE.DoubleSide} />
    </mesh>
    <mesh position={[0, 0.5, -0.05]}>
      <boxGeometry args={[2.1, 0.02, 0.02]} />
      <meshBasicMaterial color={glow2} toneMapped={false} />
    </mesh>
    <gridHelper args={[16, 40, "#3b2f7a", "#1b1640"]} position={[0, -0.05, 1.2]} />
  </group>;
}

/** 3D seat arena for the organizer dashboard. Colours: lime confirmed, violet reserved. */
export default function SeatArena({ state }: { state: ArenaState }) {
  const people = state.entered + state.reserved + state.waitlisted + state.confirmed + state.expired;
  return <Canvas className="arena-canvas" dpr={[1, 1.75]} camera={{ position: [0, 4.2, 7.4], fov: 45 }} gl={{ antialias: true, alpha: true }}>
    <Stage />
    <Seats state={state} />
    <Crowd people={people} />
    <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={0.45} minPolarAngle={0.5} maxPolarAngle={1.35} target={[0, 0.4, 0]} />
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.9} luminanceThreshold={0.25} luminanceSmoothing={0.3} radius={0.7} />
    </EffectComposer>
  </Canvas>;
}
