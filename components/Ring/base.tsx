"use client"

import { useMemo, useRef } from "react";
import {
  COORDINATE_TYPE,
  gaussianRandom,
  TWO_PI,
  type ICoordinateMapper,
} from "@/lib/mappers/coordinateMappers/common";
import { useFrame } from "@react-three/fiber";
import { DynamicDrawUsage, type BufferAttribute, type Points } from "three";

const DEFAULT_PARTICLE_COUNT = 3_500_000;
const MIN_PARTICLE_UPDATES_PER_FRAME = 40_000;
const MAX_PARTICLE_UPDATES_PER_FRAME = 300_000;
const TARGET_FRAME_TIME_SEC = 1 / 60;
const MIN_DISTANCE_FOR_POINT_SIZE = 0.01;
const POINT_SIZE_VISUAL_SCALE = 1.28;

const BaseDiffusedRing = ({
  coordinateMapper,
  radius = 2.0,
  pointSize = 0.2,
  nPoints = DEFAULT_PARTICLE_COUNT,
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
  const safePointCount = Math.max(2, Math.floor(nPoints));
  const denom = safePointCount - 1;

  const baseNoise = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) arr[i] = gaussianRandom();
    return arr;
  }, [safePointCount]);

  const grainPhase = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) arr[i] = Math.random() * TWO_PI;
    return arr;
  }, [safePointCount]);

  const depthPhase = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) arr[i] = Math.random() * TWO_PI;
    return arr;
  }, [safePointCount]);

  const positionsArray = useMemo(() => {
    const arr = new Float32Array(safePointCount * 3);
    for (let i = 0; i < safePointCount; i += 1) {
      const normIdx = i / denom;
      const angle = normIdx * TWO_PI;
      const idx3 = i * 3;
      arr[idx3] = radius * Math.cos(angle);
      arr[idx3 + 1] = radius * Math.sin(angle);
      arr[idx3 + 2] = 0;
    }
    return arr;
  }, [denom, radius, safePointCount]);

  const smoothedOffsets = useRef<Float32Array>(new Float32Array(safePointCount));
  const updateCursor = useRef(0);
  const refPoints = useRef<Points>(null!);

  useFrame(({ clock }, delta) => {
    //in ms
    const elapsedTimeSec = clock.getElapsedTime();
    let effectiveRadius, normIdx, angRad;
    const positionsBuffer = refPoints.current.geometry.attributes.position as BufferAttribute;
    const frameTime = Math.max(TARGET_FRAME_TIME_SEC * 0.5, delta || TARGET_FRAME_TIME_SEC);
    const scaledBudget = Math.floor(
      MAX_PARTICLE_UPDATES_PER_FRAME * (TARGET_FRAME_TIME_SEC / frameTime),
    );
    const budget = Math.max(
      MIN_PARTICLE_UPDATES_PER_FRAME,
      Math.min(MAX_PARTICLE_UPDATES_PER_FRAME, scaledBudget),
    );

    const start = updateCursor.current;
    const end = Math.min(safePointCount, start + Math.min(safePointCount, budget));
    updateCursor.current = end >= safePointCount ? 0 : end;

    for (let i = start; i < end; i++) {
      normIdx = i / denom;

      // targetOffset comes from the audio energy mapper
      const targetOffset = coordinateMapper.map(
        COORDINATE_TYPE.CARTESIAN_1D,
        mirrorEffects ? 2 * Math.abs(normIdx - 0.5) : normIdx,
        0,
        0,
        elapsedTimeSec,
      );

      // Keep enough smoothing for stability, but retain more high-frequency detail.
      smoothedOffsets.current[i] += (targetOffset - smoothedOffsets.current[i]) * 0.68;

      const amp = smoothedOffsets.current[i];

      // 1. INDIVIDUAL GRAIN JITTER (Simulated Noise)
      // This makes the 'little grains' shimmer and move independently.
      // We use a high-frequency per-point offset to create a 'sparkle'.
      const grainJitter = (
        Math.sin(elapsedTimeSec * 15 + grainPhase[i]) +
        Math.sin(elapsedTimeSec * 5 + grainPhase[i] * 0.7) * 0.5
      ) * 0.012;

      // 2. SIMULATED AUDIO NOISE FLOOR
      const ambientHum = (
        Math.sin(elapsedTimeSec * 10 + normIdx * 50) * 0.005 +
        Math.sin(elapsedTimeSec * 2 + normIdx * 10) * 0.01
      );
      const microOsc =
        Math.sin(elapsedTimeSec * 32 + normIdx * 220 + grainPhase[i] * 0.8) * 0.010 +
        Math.sin(elapsedTimeSec * 54 + normIdx * 390 + depthPhase[i] * 0.5) * 0.007;

      // Keep a baseline occupancy so the ring reads as "millions" even in quieter sections.
      const effectiveAmp = amp * 0.62 + ambientHum + microOsc + 0.2;

      // 3. NOISE DISTORTION (The 'Dust' Cloud)
      // The individual grain position now shifts every frame.
      const shellSpread = 0.2 * thickness;
      const noiseDistortion =
        (baseNoise[i] - 0.5 + grainJitter) * (shellSpread + effectiveAmp * 0.95 * thickness);

      effectiveRadius =
        radius * (1.0 + effectiveAmp * thickness * 0.36 + grainJitter) +
        radius * noiseDistortion;

      angRad = normIdx * TWO_PI;

      // Add individual Z-jitter for shimmering depth
      const zJitter =
        Math.sin(elapsedTimeSec * 20 + depthPhase[i]) * 0.02 +
        Math.sin(elapsedTimeSec * 48 + normIdx * 180 + grainPhase[i]) * 0.012;
      const idx3 = i * 3;
      positionsArray[idx3] = effectiveRadius * Math.cos(angRad); // x
      positionsArray[idx3 + 1] = effectiveRadius * Math.sin(angRad); // y
      positionsArray[idx3 + 2] =
        (baseNoise[i] - 0.5) * (effectiveAmp + 0.24) * thickness * 1.7 + zJitter;
    }

    positionsBuffer.clearUpdateRanges();
    positionsBuffer.addUpdateRange(start * 3, Math.max(0, (end - start) * 3));
    positionsBuffer.needsUpdate = true;
  });

  const wrap01 = (x: number) => ((x % 1) + 1) % 1;
  const hasHighlight =
    Number.isFinite(highlightStart01) &&
    Number.isFinite(highlightEnd01) &&
    (highlightIntensity ?? 0) > 0;
  const markerWidth = 0.008;
  const highlightStart = hasHighlight ? wrap01(highlightStart01 as number) : 0;
  const highlightEnd = hasHighlight ? wrap01(highlightEnd01 as number) : 0;
  const highlightSpan = Math.abs(highlightEnd - highlightStart);
  const highlightStartFinal =
    highlightSpan < markerWidth ? wrap01(highlightStart - markerWidth / 2) : highlightStart;
  const highlightEndFinal =
    highlightSpan < markerWidth ? wrap01(highlightStart + markerWidth / 2) : highlightEnd;

  return (
    <points ref={refPoints}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          usage={DynamicDrawUsage}
          array={positionsArray}
          count={safePointCount}
          itemSize={3}
        />
      </bufferGeometry>
      <shaderMaterial
        attach="material"
        transparent
        depthWrite={false}
        blending={2} // AdditiveBlending
        uniforms={{
          uPointSize: {
            value:
              pointSize *
              POINT_SIZE_VISUAL_SCALE *
              (typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.5) : 1),
          },
          uRadius: { value: radius },
          uHighlightStart: { value: highlightStartFinal },
          uHighlightEnd: { value: highlightEndFinal },
          uHighlightIntensity: { value: Math.max(0, Math.min(1, highlightIntensity ?? 0)) },
          uHighlightColor: { value: highlightColor },
          uHasHighlight: { value: hasHighlight ? 1 : 0 },
        }}
        vertexShader={`
          varying float vNormIdx;
          varying float vDistance;
          varying vec3 vLocalPos;
          uniform float uPointSize;
          void main() {
            vLocalPos = position;
            vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
            vDistance = -mvPosition.z;
            gl_PointSize = uPointSize * (300.0 / max(vDistance, ${MIN_DISTANCE_FOR_POINT_SIZE.toFixed(2)}));
            float angle = atan(position.y, position.x);
            if (angle < 0.0) angle += 6.28318530718;
            vNormIdx = angle / 6.28318530718;
            gl_Position = projectionMatrix * mvPosition;
          }
        `}
        fragmentShader={`
          varying float vNormIdx;
          varying float vDistance;
          varying vec3 vLocalPos;
          uniform float uRadius;
          uniform float uHighlightStart;
          uniform float uHighlightEnd;
          uniform float uHighlightIntensity;
          uniform vec3 uHighlightColor;
          uniform float uHasHighlight;

          bool inArc(float t, float start, float end) {
            if (start <= end) return t >= start && t <= end;
            return t >= start || t <= end;
          }

          void main() {
            float d = distance(gl_PointCoord, vec2(0.5));
            
            // Textured grain with bloom
            float glow = 0.018 / max(0.02, d);
            float core = smoothstep(0.5, 0.36, d);
            float strength = core * 0.9 + pow(glow, 1.55) * 1.0;
            
            // Subtle falloff
            float alpha = smoothstep(0.5, 0.18, d) * min(1.0, strength * 1.6);
            float ringRadius = length(vLocalPos.xy);
            float outerBand = exp(-pow((ringRadius - uRadius) / max(0.0001, uRadius * 0.18), 2.0));
            float innerBand = exp(-pow((ringRadius - uRadius * 0.62) / max(0.0001, uRadius * 0.14), 2.0));
            float axial = pow(max(0.0, 1.0 - abs(vLocalPos.x) / max(0.0001, uRadius * 0.75)), 3.0);
            float spokes = pow(abs(sin(vNormIdx * 64.0)), 10.0);
            float radialEnergy = outerBand * 1.12 + innerBand * 1.36 + axial * 0.92 + spokes * 0.34;

            vec3 coolBase = vec3(0.08, 0.10, 0.18);
            vec3 warmCore = vec3(1.0, 0.52, 0.18);
            vec3 halo = vec3(0.96, 0.78, 0.55);
            vec3 baseColor = mix(coolBase, halo, clamp(outerBand * 0.9 + innerBand * 0.4, 0.0, 1.0));
            baseColor = mix(baseColor, warmCore, clamp(innerBand * 0.9 + axial * 0.5 + spokes * 0.3, 0.0, 1.0));
            vec3 color = baseColor;
            if (uHasHighlight > 0.5 && inArc(vNormIdx, uHighlightStart, uHighlightEnd)) {
              color = mix(baseColor, uHighlightColor, uHighlightIntensity);
            }

            float luminance = (0.46 + radialEnergy) * strength;
            gl_FragColor = vec4(color * luminance * 1.12, alpha * (0.78 + radialEnergy * 0.3));
          }
        `}
      />
    </points>
  );
};

export default BaseDiffusedRing;
