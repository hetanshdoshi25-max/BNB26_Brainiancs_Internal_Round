import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { RoundedBox } from "@react-three/drei";
import * as THREE from "three";
import { createTicketTextures, type TicketFace } from "./ticketTexture";

/** A thick holographic ticket that leans toward the pointer and slowly turns. */
export function Ticket3D({ face, scale = 1, spin = 0.25 }: { face: TicketFace; scale?: number; spin?: number }) {
  const group = useRef<THREE.Group>(null);
  const textures = useMemo(() => createTicketTextures(face), [face]);
  useEffect(() => () => { textures.front.dispose(); textures.back.dispose(); }, [textures]);
  const edge = useMemo(() => new THREE.Color(face.accent).multiplyScalar(2.2), [face.accent]);

  useFrame((state, delta) => {
    const node = group.current;
    if (!node) return;
    const t = state.clock.elapsedTime;
    const targetY = state.pointer.x * 0.55 + Math.sin(t * spin) * 0.35;
    const targetX = -state.pointer.y * 0.35 + Math.sin(t * 0.7) * 0.06;
    node.rotation.y = THREE.MathUtils.damp(node.rotation.y, targetY, 3, delta);
    node.rotation.x = THREE.MathUtils.damp(node.rotation.x, targetX, 3, delta);
    node.position.y = Math.sin(t * 1.1) * 0.08;
  });

  const w = 3.2; const h = 1.6; const d = 0.07;
  return <group ref={group} scale={scale}>
    <RoundedBox args={[w + 0.04, h + 0.04, d]} radius={0.03} smoothness={4}>
      <meshBasicMaterial color={edge} toneMapped={false} />
    </RoundedBox>
    <mesh position={[0, 0, d / 2 + 0.002]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={textures.front} transparent toneMapped={false} />
    </mesh>
    <mesh position={[0, 0, -d / 2 - 0.002]} rotation={[0, Math.PI, 0]}>
      <planeGeometry args={[w, h]} />
      <meshBasicMaterial map={textures.back} transparent toneMapped={false} />
    </mesh>
    <HoloSheen width={w} height={h} z={d / 2 + 0.006} />
  </group>;
}

/** A thin additive layer that sweeps an iridescent band across the ticket face. */
function HoloSheen({ width, height, z }: { width: number; height: number; z: number }) {
  const material = useMemo(() => new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 } },
    vertexShader: "varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: `
      varying vec2 vUv; uniform float uTime;
      vec3 spectrum(float x){ return 0.5 + 0.5*cos(6.2831*(x + vec3(0.0,0.33,0.67))); }
      void main(){
        float band = fract(uTime*0.12);
        float d = vUv.x*0.8 + vUv.y*0.5 - band*2.2 + 0.5;
        float sheen = exp(-pow(d*6.0, 2.0));
        vec3 col = spectrum(vUv.x + vUv.y*0.5 + uTime*0.05) * sheen * 0.55;
        gl_FragColor = vec4(col, sheen*0.6);
      }`,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  useFrame((state) => { material.uniforms.uTime!.value = state.clock.elapsedTime; });
  return <mesh position={[0, 0, z]} material={material}><planeGeometry args={[width, height]} /></mesh>;
}
