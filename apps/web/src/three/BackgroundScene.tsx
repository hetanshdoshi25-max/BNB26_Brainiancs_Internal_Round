import { useEffect, useMemo } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";

const fragmentShader = /* glsl */ `
precision highp float;
uniform float uTime; uniform vec2 uRes; uniform vec2 uMouse; uniform float uScroll;

float hash(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
float noise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.-2.*f);
  return mix(mix(hash(i),hash(i+vec2(1,0)),u.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float v=0., a=.5; mat2 m=mat2(1.6,1.2,-1.2,1.6); for(int i=0;i<5;i++){ v+=a*noise(p); p=m*p; a*=.5; } return v; }

// Faint spider-web anchored at c: radial spokes plus polygonal rings that sag between spokes.
float web(vec2 p, vec2 c, float spokes, float rot){
  vec2 w = p - c; float rad = length(w); float ang = atan(w.y, w.x) + rot;
  float a = ang / 6.28318 * spokes;
  float off = (fract(a) - .5) * 6.28318 / spokes;
  float spokeDist = rad * abs(sin(off - sign(off) * 3.14159 / spokes));
  float spoke = 1. - smoothstep(0., .0022, spokeDist);
  float poly = rad * cos(off) * (1. + .05 * (1. - abs(off) * spokes / 3.14159));
  float s = log(max(poly, 1e-3) / .05) / log(1.38);
  float ringDist = abs(fract(s + .5) - .5) * poly * log(1.38);
  float ring = (1. - smoothstep(0., .0022, ringDist)) * step(.05, poly);
  return max(spoke, ring) * exp(-rad * 1.25);
}

float stars(vec2 p, float scale, float t){
  vec2 g = p * scale; vec2 id = floor(g); vec2 f = fract(g) - .5;
  float h = hash(id);
  if (h < .965) return 0.;
  vec2 o = vec2(hash(id + 7.1), hash(id + 3.7)) - .5;
  float d = length(f - o * .7);
  float tw = .55 + .45 * sin(t * (1.5 + h * 4.) + h * 40.);
  return smoothstep(.06, 0., d) * tw * (h - .965) * 28.;
}

void main(){
  vec2 p = (gl_FragCoord.xy - .5 * uRes) / uRes.y;
  float aspect = uRes.x / uRes.y;
  vec2 m = uMouse * .035;
  float t = uTime * .045;
  vec2 np = p + m + vec2(0., uScroll * .12);
  vec2 q = vec2(fbm(np * 1.3 + t), fbm(np * 1.3 - t + 3.1));
  vec2 r = vec2(fbm(np * 1.7 + 2. * q + vec2(1.7, 9.2) + t * 1.3), fbm(np * 1.7 + 2. * q + vec2(8.3, 2.8) - t));
  float f = fbm(np * 1.5 + 2.4 * r);

  vec3 col = vec3(.014, .011, .05);
  col = mix(col, vec3(.25, .11, .62), smoothstep(.38, 1., f) * .85);
  col = mix(col, vec3(.62, .10, .42), smoothstep(.55, 1.05, length(q)) * .5 * r.y);
  col = mix(col, vec3(.04, .42, .62), smoothstep(.62, 1., r.x) * .38);
  col *= .62;

  float webs = web(p + m * .5, vec2(.5 * aspect + .04, .56 + uScroll * .1), 16., .2)
             + web(p + m * .5, vec2(-.5 * aspect - .08, -.62 + uScroll * .1), 13., 1.3) * .8;
  col += vec3(.62, .55, 1.) * webs * .16;

  vec2 sp = p + m * 2.;
  col += vec3(.85, .85, 1.) * stars(sp + vec2(0., uScroll * .05), 34., uTime);
  col += vec3(.7, .8, 1.) * stars(sp * 1.1 + 4.2 + vec2(0., uScroll * .1), 60., uTime) * .6;

  float vig = smoothstep(1.35, .2, length(p * vec2(.82, 1.)));
  col *= .55 + .45 * vig;
  col += (hash(gl_FragCoord.xy + fract(uTime)) - .5) * .018;
  gl_FragColor = vec4(col, 1.);
}`;

function NebulaPlane({ still }: { still: boolean }) {
  const { size, gl } = useThree();
  const material = useMemo(() => new THREE.ShaderMaterial({
    depthTest: false, depthWrite: false,
    uniforms: { uTime: { value: 0 }, uRes: { value: new THREE.Vector2() }, uMouse: { value: new THREE.Vector2() }, uScroll: { value: 0 } },
    vertexShader: "void main(){ gl_Position = vec4(position.xy, 0.0, 1.0); }",
    fragmentShader,
  }), []);
  useEffect(() => () => material.dispose(), [material]);
  useEffect(() => {
    const ratio = gl.getPixelRatio();
    material.uniforms.uRes!.value.set(size.width * ratio, size.height * ratio);
  }, [size, gl, material]);

  const pointer = useMemo(() => new THREE.Vector2(), []);
  useEffect(() => {
    const move = (event: PointerEvent) => pointer.set(event.clientX / window.innerWidth * 2 - 1, -(event.clientY / window.innerHeight * 2 - 1));
    window.addEventListener("pointermove", move, { passive: true });
    return () => window.removeEventListener("pointermove", move);
  }, [pointer]);

  useFrame((state, delta) => {
    const u = material.uniforms;
    if (!still) u.uTime!.value = state.clock.elapsedTime;
    (u.uMouse!.value as THREE.Vector2).lerp(pointer, Math.min(1, delta * 2.5));
    const scroll = window.scrollY / Math.max(1, window.innerHeight);
    u.uScroll!.value = THREE.MathUtils.damp(u.uScroll!.value, scroll, 4, delta);
  });
  return <mesh material={material} frustumCulled={false}><planeGeometry args={[2, 2]} /></mesh>;
}

/** Full-viewport animated nebula with spider-web filaments and twinkling stars. */
export default function BackgroundScene({ still = false }: { still?: boolean }) {
  return <div className="bg-canvas" aria-hidden="true">
    <Canvas dpr={[1, 1.25]} gl={{ antialias: false, alpha: false, powerPreference: "low-power" }} frameloop={still ? "demand" : "always"}>
      <NebulaPlane still={still} />
    </Canvas>
  </div>;
}
