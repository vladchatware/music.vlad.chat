"use client"

import { useRef } from "react";
import {
  COORDINATE_TYPE,
  gaussianRandom,
  TWO_PI,
  type ICoordinateMapper,
} from "@/lib/mappers/coordinateMappers/common";
import { useFrame } from "@react-three/fiber";
import { type Points } from "three";

const BaseDiffusedRing = ({
  coordinateMapper,
  radius = 2.0,
  pointSize = 0.2,
  nPoints = 1000,
  mirrorEffects = false,
  highlightStart01,
  highlightEnd01,
  highlightIntensity = 1,
  highlightColor = [1, 0.82, 0.2],
  thickness = 1,
}: {
  coordinateMapper: ICoordinateMapper;
  radius?: number;
  nPoints?: number;
  pointSize?: number;
  mirrorEffects?: boolean;
  highlightStart01?: number;
  highlightEnd01?: number;
  highlightIntensity?: number; // 0..1 (blend)
  highlightColor?: [number, number, number]; // linear RGB 0..1
  thickness?: number;
}) => {
  const noise = Array.from({ length: nPoints }).map(gaussianRandom);
  const smoothedOffsets = useRef<Float32Array>(new Float32Array(nPoints).fill(0));
  const refPoints = useRef<Points>(null!);

  useFrame(({ clock }) => {
    //in ms
    const elapsedTimeSec = clock.getElapsedTime();
    let effectiveRadius, normIdx, angRad;
    const positionsBuffer = refPoints.current.geometry.attributes.position;
    const colorsBuffer = refPoints.current.geometry.attributes.color;

    const hasHighlight =
      Number.isFinite(highlightStart01) &&
      Number.isFinite(highlightEnd01) &&
      (highlightIntensity ?? 0) > 0;

    const hStartRaw = hasHighlight ? (highlightStart01 as number) : 0;
    const hEndRaw = hasHighlight ? (highlightEnd01 as number) : 0;
    const wrap01 = (x: number) => ((x % 1) + 1) % 1;
    const hStart = wrap01(hStartRaw);
    const hEnd = wrap01(hEndRaw);
    const span = Math.abs(hEnd - hStart);
    const markerWidth = 0.008;
    const startA = span < markerWidth ? wrap01(hStart - markerWidth / 2) : hStart;
    const endA = span < markerWidth ? wrap01(hStart + markerWidth / 2) : hEnd;

    const inArc = (t: number) => {
      if (!hasHighlight) return false;
      if (startA <= endA) return t >= startA && t <= endA;
      return t >= startA || t <= endA;
    };

    for (let i = 0; i < nPoints; i++) {
      normIdx = i / (nPoints - 1);

      // targetOffset comes from the audio energy mapper
      const targetOffset = coordinateMapper.map(
        COORDINATE_TYPE.CARTESIAN_1D,
        mirrorEffects ? 2 * Math.abs(normIdx - 0.5) : normIdx,
        0,
        0,
        elapsedTimeSec,
      );

      // Balanced reactivity (0.5)
      smoothedOffsets.current[i] += (targetOffset - smoothedOffsets.current[i]) * 0.5;

      const amp = smoothedOffsets.current[i];

      // 1. INDIVIDUAL GRAIN JITTER (Simulated Noise)
      // This makes the 'little grains' shimmer and move independently.
      // We use a high-frequency per-point offset to create a 'sparkle'.
      const grainJitter = (Math.sin(elapsedTimeSec * 15 + i * 0.5) + (Math.random() - 0.5)) * 0.015;

      // 2. SIMULATED AUDIO NOISE FLOOR
      const ambientHum = (
        Math.sin(elapsedTimeSec * 10 + normIdx * 50) * 0.005 +
        Math.sin(elapsedTimeSec * 2 + normIdx * 10) * 0.01
      );

      const effectiveAmp = amp + ambientHum;

      // 3. NOISE DISTORTION (The 'Dust' Cloud)
      // The individual grain position now shifts every frame.
      const noiseDistortion = (noise[i] - 0.5 + grainJitter) * (0.15 + effectiveAmp * 0.8) * thickness;

      effectiveRadius =
        radius * (1.0 + effectiveAmp * thickness * 0.4 + grainJitter) +
        radius * noiseDistortion;

      angRad = normIdx * TWO_PI;

      // Add individual Z-jitter for shimmering depth
      const zJitter = (Math.sin(elapsedTimeSec * 20 + i) - 0.5) * 0.02;

      positionsBuffer.setXYZ(
        i,
        effectiveRadius * Math.cos(angRad), // x
        effectiveRadius * Math.sin(angRad), // y
        ((noise[i] - 0.5) * (effectiveAmp + 0.1) * thickness * 1.0) + zJitter,
      );

      // Default ring color is white; blend in a highlight arc for transition planning/progress.
      const baseR = 1,
        baseG = 1,
        baseB = 1;
      if (colorsBuffer) {
        if (inArc(normIdx)) {
          const a = Math.max(0, Math.min(1, highlightIntensity ?? 1));
          colorsBuffer.setXYZ(
            i,
            baseR * (1 - a) + highlightColor[0] * a,
            baseG * (1 - a) + highlightColor[1] * a,
            baseB * (1 - a) + highlightColor[2] * a,
          );
        } else {
          colorsBuffer.setXYZ(i, baseR, baseG, baseB);
        }
      }
    }
    positionsBuffer.needsUpdate = true;
    if (colorsBuffer) colorsBuffer.needsUpdate = true;
  });

  return (
    <points ref={refPoints}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          array={new Float32Array(nPoints * 3)}
          count={nPoints}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          array={new Float32Array(nPoints * 3)}
          count={nPoints}
          itemSize={3}
        />
      </bufferGeometry>
      <shaderMaterial
        attach="material"
        transparent
        depthWrite={false}
        blending={2} // AdditiveBlending
        vertexColors
        uniforms={{
          uPointSize: { value: pointSize * (typeof window !== 'undefined' ? window.devicePixelRatio : 1) },
        }}
        vertexShader={`
          varying vec3 vColor;
          varying float vDistance;
          uniform float uPointSize;
          void main() {
            vColor = color;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDistance = -mvPosition.z;
            gl_PointSize = uPointSize * (300.0 / vDistance);
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vDistance;
          void main() {
            float d = distance(gl_PointCoord, vec2(0.5));
            
            // Textured grain with bloom
            float glow = 0.02 / d;
            float core = smoothstep(0.5, 0.42, d); // Slightly sharper core for grain definition
            
            float strength = core + pow(glow, 1.9); // Slightly tighter bloom
            
            // Subtle falloff
            float alpha = smoothstep(0.5, 0.15, d) * min(1.0, strength);
            
            gl_FragColor = vec4(vColor * strength * 1.1, alpha);
          }
        `}
      />
    </points>
  );
};

export default BaseDiffusedRing;
