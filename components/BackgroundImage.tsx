import { shaderMaterial } from "@react-three/drei";
import { useThree, useFrame, extend, type ThreeElement } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";


/**
 * FluidMaterial
 * A custom shader material that implements domain warping for a fluid effect,
 * responds to audio energy, and adds grain noise.
 */
const FluidMaterial = shaderMaterial(
  {
    uTime: 0,
    uAudioEnergy: 0,
    uTransitionProgress: 0,
    uResolution: new THREE.Vector2(),
    uColor1: new THREE.Color("#8B1A1A"),
    uColor2: new THREE.Color("#FF4500"),
    uColor3: new THREE.Color("#FF8C00"),
    uColor4: new THREE.Color("#FFD700"),
  },
  // Vertex Shader
  `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
  `,
  // Fragment Shader
  `
  uniform float uTime;
  uniform float uAudioEnergy;
  uniform float uTransitionProgress;
  uniform vec2 uResolution;
  uniform vec3 uColor1;
  uniform vec3 uColor2;
  uniform vec3 uColor3;
  uniform vec3 uColor4;
  varying vec2 vUv;

  // Simple noise function
  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  // Value noise
  float vnoise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
  }

  // Fractional Brownian Motion
  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 5; i++) {
        v += a * vnoise(p);
        p *= 2.0;
        a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    
    // Domain warping for fluid effect
    // Vortex intensity increases with transition progress
    float vortex = uTransitionProgress * 2.5;
    vec2 centeredUv = uv - 0.5;
    float dist = length(centeredUv);
    float angle = atan(centeredUv.y, centeredUv.x);
    vec2 vortexUv = uv + vec2(cos(angle + dist * vortex), sin(angle + dist * vortex)) * dist * vortex * 0.2;

    // uTime * 0.1 is base speed
    // uAudioEnergy adds responsiveness to the beat
    // uTransitionProgress adds chaos during transitions
    float time = uTime * 0.15 + uAudioEnergy * 0.12 + uTransitionProgress * 0.8;
    
    // Warping step 1 (using vortex distorted Uvs)
    vec2 q = vec2(
        fbm(vortexUv + vec2(0.0, 0.0) + time * 0.5),
        fbm(vortexUv + vec2(5.2, 1.3) + time * 0.3)
    );
    
    // Warping step 2
    vec2 r = vec2(
        fbm(vortexUv + 4.0 * q + vec2(1.7, 9.2) + time * 0.4),
        fbm(vortexUv + 4.0 * q + vec2(8.3, 2.8) + time * 0.2)
    );
    
    // Final noise value
    float f = fbm(vortexUv + 4.0 * r);
    
    // Base color mixing based on warping
    vec3 color = mix(uColor1, uColor2, clamp((f*f)*4.0, 0.0, 1.0));
    color = mix(color, uColor3, clamp(length(q), 0.0, 1.0));
    color = mix(color, uColor4, clamp(length(r.x), 0.0, 1.0));
    
    // Expressive transition: shift to bright gold/white and add 'heat'
    vec3 transitionPeakColor = vec3(1.0, 0.9, 0.5); // Bright gold/white
    color = mix(color, color * 1.8 + transitionPeakColor * 0.4, uTransitionProgress);
    
    // Flare pulse at the peak of transition
    float flare = pow(uTransitionProgress, 3.0) * 0.5;
    color += flare * transitionPeakColor;

    // Audio energy pulse - subtle glow
    color += uAudioEnergy * 0.1 * uColor4;

    // Enhanced movement indication: streaks become more chaotic and faster during transition
    float flowSpeed = 2.0 + uAudioEnergy * 6.0 + uTransitionProgress * 10.0;
    float streakChaos = 60.0 + uTransitionProgress * 100.0;
    float streaks = sin(uv.y * streakChaos + uTime * 0.2) * sin(uv.x * 15.0 - uTime * flowSpeed);
    color += max(0.0, streaks) * 0.05 * (1.0 + uAudioEnergy + uTransitionProgress);

    // Grain noise for texture
    float grain = (hash(gl_FragCoord.xy * 0.01 + uTime * 0.1) - 0.5) * 0.1;
    color += grain;

    gl_FragColor = vec4(color, 1.0);
  }
  `
);

// Declare the custom material for JSX
declare global {
  namespace JSX {
    interface IntrinsicElements {
      fluidMaterial: any;
    }
  }
}

extend({ FluidMaterial });

export default function BackgroundImageCover({
  audioEnergyRef,
  transitionHighlight,
  palette
}: {
  audioEnergyRef?: MutableRefObject<number>,
  transitionHighlight?: { start01: number; end01: number; intensity?: number } | null,
  palette?: THREE.Color[]
}) {
  const viewport = useThree((state) => state.viewport);
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<any>(null);

  // Scale up to account for the background being further back than z=0
  const scaleFactor = 5.0;

  useFrame((state, delta) => {
    if (!meshRef.current || !materialRef.current) return;

    materialRef.current.uTime = state.clock.getElapsedTime();
    materialRef.current.uAudioEnergy = audioEnergyRef?.current ?? 0;
    materialRef.current.uTransitionProgress = transitionHighlight?.end01 ?? 0;
    materialRef.current.uResolution.set(state.size.width, state.size.height);

    if (palette && palette.length >= 4) {
      materialRef.current.uColor1.copy(palette[0]);
      materialRef.current.uColor2.copy(palette[1]);
      materialRef.current.uColor3.copy(palette[2]);
      materialRef.current.uColor4.copy(palette[3]);
    }

    meshRef.current.position.set(0, 0, -10);
    meshRef.current.rotation.set(0, 0, -Math.PI / 2);
    meshRef.current.scale.set(viewport.height * scaleFactor, viewport.width * scaleFactor, 1);
  });

  return (
    <>
      <mesh ref={meshRef}>
        <planeGeometry />
        <fluidMaterial
          ref={materialRef}
          depthWrite={false}
          toneMapped={false}
          transparent
          uColor1={palette?.[0] || new THREE.Color("#8B1A1A")}
          uColor2={palette?.[1] || new THREE.Color("#FF4500")}
          uColor3={palette?.[2] || new THREE.Color("#FF8C00")}
          uColor4={palette?.[3] || new THREE.Color("#FFD700")}
        />
      </mesh>
      <mesh
        position={[0, 0, -9.9]}
        scale={[viewport.height * scaleFactor, viewport.width * scaleFactor, 1]}
        rotation={[0, 0, -Math.PI / 2]}
        receiveShadow
      >
        <planeGeometry />
        <shadowMaterial transparent opacity={0.3} />
      </mesh>
    </>
  );
}

