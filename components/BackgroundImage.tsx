import { shaderMaterial } from "@react-three/drei";
import { useThree, useFrame, extend, type ThreeElement } from "@react-three/fiber";
import { useRef, type MutableRefObject } from "react";
import * as THREE from "three";


/**
 * FluidMaterial - HIGH FIDELITY SPHERE
 * Restored for smooth lava lamp motion. Removed grain 'dots'.
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
  varying vec3 vNormal;
  void main() {
    vUv = uv;
    vNormal = normalize(normal);
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
  varying vec3 vNormal;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  float hash1(float n) {
    return fract(sin(n) * 43758.5453);
  }

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
    // For a sphere environment, we use spherical coordinates for seamlessness
    vec2 uv = vec2(atan(vNormal.z, vNormal.x) / (2.0 * 3.14159) + 0.5, acos(vNormal.y) / 3.14159);
    vec2 fluidUv = uv * 2.0; 
    
    float energy = clamp(uAudioEnergy, 0.0, 1.0);
    float transition = clamp(uTransitionProgress, 0.0, 1.0);
    
    // Movement speeds for the 'Elevator' effect
    float lavaSpeed = uTime * 0.1;
    float elevatorSpeed = uTime * (5.0 + energy * 15.0 + transition * 20.0);
    float verticalShift = mix(lavaSpeed, elevatorSpeed, energy * 0.7 + transition * 0.3);

    // Domain warping - High fluidity
    float warpingIntensity = mix(3.0, 1.5, energy);
    float flowTime = uTime * 0.08 + energy * 0.1;

    vec2 q = vec2(
        fbm(fluidUv + vec2(0.0, 0.0) + flowTime * 0.4),
        fbm(fluidUv + vec2(5.2, 1.3) + flowTime * 0.2)
    );
    
    vec2 r = vec2(
        fbm(fluidUv + warpingIntensity * q + vec2(1.7, 9.2) + flowTime * 0.3),
        fbm(fluidUv + warpingIntensity * q + vec2(8.3, 2.8) + flowTime * 0.1)
    );
    
    float f = fbm(fluidUv + warpingIntensity * r);
    
    // Richer palette mixing
    vec3 mixColor1 = mix(uColor1, uColor2, energy * 0.3);
    vec3 mixColor2 = mix(uColor2, uColor3, transition * 0.3);
    vec3 mixColor3 = mix(uColor3, uColor4, (energy + transition) * 0.25);

    vec3 color = mix(mixColor1, mixColor2, clamp((f*f)*3.2, 0.0, 1.0));
    color = mix(color, mixColor3, clamp(length(q), 0.0, 0.8));
    color = mix(color, uColor4 * 0.85, clamp(length(r.x), 0.0, 1.0));

    // --- Horizontal Elevator Light Smears ---
    float streakVisibility = smoothstep(0.1, 0.4, energy + transition * 0.5);
    for(int i = 0; i < 3; i++) {
        float streakSeed = hash1(float(i) * 21.4 + 4.56);
        float sSpeed = 1.0 + streakSeed * 2.0;
        float sPos = fract(uv.y - verticalShift * 0.01 * sSpeed + streakSeed * 15.0);
        
        float smearWidth = 0.02 + streakSeed * 0.05;
        float smear = smoothstep(0.0, smearWidth * 0.5, sPos) * smoothstep(smearWidth, smearWidth * 0.5, sPos);
        
        float xRange = smoothstep(0.1, 0.5, hash1(floor(uv.x * (5.0 + streakSeed * 8.0)) + streakSeed));
        float luminosity = 0.2 + energy * 2.0 + hash1(uTime * 2.0 + streakSeed) * 0.5;
        
        color += smear * xRange * luminosity * uColor4 * 0.4 * streakVisibility;
    }

    // --- Mechanical "Floors" ---
    float floorFreq = 12.0;
    float floorPos = fract(uv.y - verticalShift * 0.01);
    float floorBlock = step(0.99, hash1(floor(uv.x * 20.0) + floor(uv.y * floorFreq - verticalShift * 0.01)));
    color += floorBlock * uColor3 * (0.2 + energy * 0.8) * streakVisibility;

    // --- Transition "Heat" ---
    color = mix(color, color * 1.5 + vec3(0.1), transition);
    
    gl_FragColor = vec4(color, 1.0);
  }
  `
);

declare module "@react-three/fiber" {
  interface ThreeElements {
    fluidMaterial: ThreeElement<typeof FluidMaterial>;
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
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<any>(null);

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
  });

  return (
    <group>
      {/* 
          BACKSIDE SPHERE FLUID
          renders at full screen resolution in the main scene.
      */}
      <mesh ref={meshRef} scale={100}>
        <sphereGeometry args={[1, 64, 64]} />
        <fluidMaterial
          ref={materialRef}
          side={THREE.BackSide}
          uColor1={palette?.[0] || new THREE.Color("#8B1A1A")}
          uColor2={palette?.[1] || new THREE.Color("#FF4500")}
          uColor3={palette?.[2] || new THREE.Color("#FF8C00")}
          uColor4={palette?.[3] || new THREE.Color("#FFD700")}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* Invisible shadow catcher plane */}
      <mesh
        position={[0, 0, -10]}
        scale={[200, 200, 1]}
        receiveShadow
      >
        <planeGeometry />
        <shadowMaterial transparent opacity={0.2} />
      </mesh>
    </group>
  );
}
