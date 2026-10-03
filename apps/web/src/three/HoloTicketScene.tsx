import { Canvas } from "@react-three/fiber";
import { Sparkles } from "@react-three/drei";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { Ticket3D } from "./Ticket3D";
import type { TicketFace } from "./ticketTexture";

/** A single floating holographic ticket for the participant dashboard. */
export default function HoloTicketScene({ face }: { face: TicketFace }) {
  return <Canvas className="holo-canvas" dpr={[1, 1.75]} camera={{ position: [0, 0, 5.2], fov: 40 }} gl={{ antialias: true, alpha: true }}>
    <Ticket3D face={face} scale={1.05} spin={0.4} />
    <Sparkles count={40} scale={[5, 3, 2]} size={2.4} speed={0.4} color={face.accent} />
    <EffectComposer multisampling={0}>
      <Bloom mipmapBlur intensity={0.8} luminanceThreshold={0.62} luminanceSmoothing={0.3} radius={0.6} />
    </EffectComposer>
  </Canvas>;
}
