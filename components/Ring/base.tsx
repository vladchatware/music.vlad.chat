"use client"

import { useMemo, useRef, type MutableRefObject } from "react";
import {
  COORDINATE_TYPE,
  TWO_PI,
  type ICoordinateMapper,
} from "@/lib/mappers/coordinateMappers/common";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, DynamicDrawUsage, type BufferAttribute, type Mesh, type Points } from "three";

const DEFAULT_PARTICLE_COUNT = 3_500_000;
const MIN_PARTICLE_UPDATES_PER_FRAME = 40_000;
const MAX_PARTICLE_UPDATES_PER_FRAME = 300_000;
const TARGET_FRAME_TIME_SEC = 1 / 60;
const MIN_DISTANCE_FOR_POINT_SIZE = 0.01;
const POINT_SIZE_VISUAL_SCALE = 1.28;
const ACTIVE_SAMPLE_COUNT = 512;
const IDLE_SAMPLE_COUNT = 192;
const PARTICLE_SCATTER_WINDOW = 0.012;

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));
const wrap01 = (value: number) => ((value % 1) + 1) % 1;

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
  audioEnergyRef,
  isPlaybackActive = false,
}: {
  coordinateMapper: ICoordinateMapper;
  radius?: number;
  nPoints?: number;
  pointSize?: number;
  mirrorEffects?: boolean;
  highlightStart01?: number;
  highlightEnd01?: number;
  highlightIntensity?: number;
  highlightColor?: [number, number, number];
  thickness?: number;
  audioEnergyRef?: MutableRefObject<number>;
  isPlaybackActive?: boolean;
}) => {
  const safePointCount = Math.max(512, Math.floor(nPoints));
  const particleDenom = safePointCount - 1;
  const ribbonSampleCount = ACTIVE_SAMPLE_COUNT;
  const ribbonVertexCount = (ribbonSampleCount + 1) * 2;
  const signalSampleCount = ACTIVE_SAMPLE_COUNT;
  const idleSignalSampleCount = IDLE_SAMPLE_COUNT;

  const idleNoiseProfile = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) arr[i] = Math.random() * 2 - 1;
    return arr;
  }, [safePointCount]);

  const radialProfile = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) {
      const sign = Math.random() > 0.5 ? 1 : -1;
      arr[i] = sign * Math.pow(Math.random(), 2.3);
    }
    return arr;
  }, [safePointCount]);

  const depthProfile = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) {
      const sign = Math.random() > 0.5 ? 1 : -1;
      arr[i] = sign * Math.pow(Math.random(), 1.85);
    }
    return arr;
  }, [safePointCount]);

  const streamProfile = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) arr[i] = Math.pow(Math.random(), 2.4);
    return arr;
  }, [safePointCount]);

  const angularScatterProfile = useMemo(() => {
    const arr = new Float32Array(safePointCount);
    for (let i = 0; i < safePointCount; i += 1) {
      const sign = Math.random() > 0.5 ? 1 : -1;
      arr[i] = sign * Math.pow(Math.random(), 1.6);
    }
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

  const particlePositions = useMemo(() => {
    const arr = new Float32Array(safePointCount * 3);
    for (let i = 0; i < safePointCount; i += 1) {
      const angle = (i / particleDenom) * TWO_PI;
      const idx3 = i * 3;
      arr[idx3] = radius * Math.cos(angle);
      arr[idx3 + 1] = radius * Math.sin(angle);
      arr[idx3 + 2] = 0;
    }
    return arr;
  }, [particleDenom, radius, safePointCount]);

  const ribbonPositions = useMemo(() => new Float32Array(ribbonVertexCount * 3), [ribbonVertexCount]);
  const ribbonUvs = useMemo(() => {
    const arr = new Float32Array(ribbonVertexCount * 2);
    for (let i = 0; i <= ribbonSampleCount; i += 1) {
      const u = i / ribbonSampleCount;
      const base = i * 4;
      arr[base] = u;
      arr[base + 1] = 0;
      arr[base + 2] = u;
      arr[base + 3] = 1;
    }
    return arr;
  }, [ribbonSampleCount, ribbonVertexCount]);

  const ribbonIndices = useMemo(() => {
    const indices = new Uint32Array(ribbonSampleCount * 6);
    for (let i = 0; i < ribbonSampleCount; i += 1) {
      const v = i * 2;
      const idx = i * 6;
      indices[idx] = v;
      indices[idx + 1] = v + 1;
      indices[idx + 2] = v + 2;
      indices[idx + 3] = v + 1;
      indices[idx + 4] = v + 3;
      indices[idx + 5] = v + 2;
    }
    return indices;
  }, [ribbonSampleCount]);

  const particleSignal = useRef<Float32Array>(new Float32Array(signalSampleCount));
  const particleDerivative = useRef<Float32Array>(new Float32Array(signalSampleCount));
  const particleCrest = useRef<Float32Array>(new Float32Array(signalSampleCount));
  const idleSignal = useRef<Float32Array>(new Float32Array(idleSignalSampleCount));
  const smoothedGlobalEnergy = useRef(0);
  const smoothedIdleEnvelope = useRef(0);
  const updateCursor = useRef(0);

  const refParticles = useRef<Points>(null!);
  const refRibbon = useRef<Mesh>(null!);

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

  useFrame(({ clock }, delta) => {
    const elapsedTimeSec = clock.getElapsedTime();
    const frameTime = Math.max(TARGET_FRAME_TIME_SEC * 0.5, delta || TARGET_FRAME_TIME_SEC);
    const scaledBudget = Math.floor(
      MAX_PARTICLE_UPDATES_PER_FRAME * (TARGET_FRAME_TIME_SEC / frameTime),
    );
    const partialBudget = Math.max(
      MIN_PARTICLE_UPDATES_PER_FRAME,
      Math.min(MAX_PARTICLE_UPDATES_PER_FRAME, scaledBudget),
    );
    const budget = isPlaybackActive ? safePointCount : partialBudget;

    const targetGlobalEnergy = clamp01(audioEnergyRef?.current ?? 0);
    smoothedGlobalEnergy.current +=
      (targetGlobalEnergy - smoothedGlobalEnergy.current) * (isPlaybackActive ? 0.2 : 0.08);
    const idleEnvelopeTarget = isPlaybackActive
      ? 0
      : 0.042 +
        (Math.sin(elapsedTimeSec * 0.42) * 0.5 + 0.5) * 0.02 +
        (Math.sin(elapsedTimeSec * 1.07 + 0.8) * 0.5 + 0.5) * 0.016;
    smoothedIdleEnvelope.current += (idleEnvelopeTarget - smoothedIdleEnvelope.current) * 0.05;

    for (let i = 0; i < signalSampleCount; i += 1) {
      const norm = i / signalSampleCount;
      const sampledNorm = mirrorEffects ? 2 * Math.abs(norm - 0.5) : norm;
      const step = 1 / signalSampleCount;
      const prevNorm = Math.max(0, sampledNorm - step);
      const nextNorm = Math.min(1, sampledNorm + step);
      const current = coordinateMapper.map(COORDINATE_TYPE.CARTESIAN_1D, sampledNorm, 0, 0, elapsedTimeSec);
      const prev = coordinateMapper.map(COORDINATE_TYPE.CARTESIAN_1D, prevNorm, 0, 0, elapsedTimeSec);
      const next = coordinateMapper.map(COORDINATE_TYPE.CARTESIAN_1D, nextNorm, 0, 0, elapsedTimeSec);
      particleSignal.current[i] += (current - particleSignal.current[i]) * 0.76;
      particleDerivative.current[i] +=
        ((next - prev) * 0.5 - particleDerivative.current[i]) * 0.7;
      particleCrest.current[i] +=
        (Math.max(0, current - (prev + next) * 0.5) - particleCrest.current[i]) * 0.72;
    }

    for (let i = 0; i < idleSignalSampleCount; i += 1) {
      const norm = i / idleSignalSampleCount;
      const sampledNorm = mirrorEffects ? 2 * Math.abs(norm - 0.5) : norm;
      const current = coordinateMapper.map(COORDINATE_TYPE.CARTESIAN_1D, sampledNorm, 0, 0, elapsedTimeSec);
      idleSignal.current[i] += (current - idleSignal.current[i]) * 0.38;
    }

    const sampleCircular = (buffer: Float32Array, norm: number) => {
      const wrapped = wrap01(norm) * buffer.length;
      const idxA = Math.floor(wrapped) % buffer.length;
      const idxB = (idxA + 1) % buffer.length;
      const mix = wrapped - Math.floor(wrapped);
      return buffer[idxA] + (buffer[idxB] - buffer[idxA]) * mix;
    };

    const ribbonPositionAttr = refRibbon.current.geometry.attributes.position as BufferAttribute;
    for (let i = 0; i <= ribbonSampleCount; i += 1) {
      const wrapped = i % ribbonSampleCount;
      const norm = wrapped / ribbonSampleCount;
      const angle = norm * TWO_PI;
      const amp = clamp01(Math.abs(particleSignal.current[wrapped]));
      const slope = Math.abs(particleDerivative.current[wrapped]);
      const crest = clamp01(particleCrest.current[wrapped] * 2.8);
      const signalEnvelope = clamp01(
        amp * 0.82 + slope * 0.55 + crest * 0.6 + smoothedGlobalEnergy.current * 0.22,
      );
      const midRadius = radius + radius * thickness * amp * 0.24;
      const halfWidth = isPlaybackActive
        ? radius * (0.045 + amp * 0.05 + slope * 0.06 + crest * 0.085)
        : 0;
      const depth = isPlaybackActive
        ? radius * (particleDerivative.current[wrapped] * 0.11 + crest * 0.08)
        : 0;
      const haloLift = isPlaybackActive ? radius * (0.018 + signalEnvelope * 0.09 + crest * 0.04) : 0;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);

      const innerRadius = midRadius - halfWidth;
      const outerRadius = midRadius + halfWidth;
      const innerIdx = i * 6;
      const outerIdx = innerIdx + 3;

      ribbonPositions[innerIdx] = innerRadius * cos;
      ribbonPositions[innerIdx + 1] = innerRadius * sin;
      ribbonPositions[innerIdx + 2] = depth - haloLift;

      ribbonPositions[outerIdx] = outerRadius * cos;
      ribbonPositions[outerIdx + 1] = outerRadius * sin;
      ribbonPositions[outerIdx + 2] = depth + haloLift;
    }
    ribbonPositionAttr.needsUpdate = true;

    const particlePositionAttr = refParticles.current.geometry.attributes.position as BufferAttribute;
    const start = updateCursor.current;
    const end = Math.min(safePointCount, start + Math.min(safePointCount, budget));
    updateCursor.current = end >= safePointCount ? 0 : end;

    for (let i = start; i < end; i += 1) {
      const baseNorm = i / particleDenom;
      const idx3 = i * 3;

      if (isPlaybackActive) {
        const scatteredNorm = wrap01(
          baseNorm + angularScatterProfile[i] * PARTICLE_SCATTER_WINDOW * (0.45 + streamProfile[i] * 0.9),
        );
        const amp = clamp01(Math.abs(sampleCircular(particleSignal.current, scatteredNorm)));
        const slope = Math.abs(sampleCircular(particleDerivative.current, scatteredNorm));
        const crest = clamp01(sampleCircular(particleCrest.current, scatteredNorm) * 2.8);
        const bassWeight = Math.pow(1 - scatteredNorm, mirrorEffects ? 1.15 : 1.7);
        const signalEnvelope = clamp01(
          amp * 0.82 + slope * 0.55 + crest * 0.6 + smoothedGlobalEnergy.current * 0.22,
        );
        const baseAngle = baseNorm * TWO_PI;
        const axialFocus = Math.pow(Math.max(0, 1 - Math.abs(Math.cos(baseAngle))), 1.8);
        const explosionFactor = Math.max(0, smoothedGlobalEnergy.current - 0.22);
        const edgeBias = 1 - Math.pow(streamProfile[i], 0.42);
        const farBias = Math.pow(streamProfile[i], 2.9);
        const bassPressure = clamp01(bassWeight * (0.45 + amp * 0.9 + smoothedGlobalEnergy.current * 0.65));
        const lineRadius = radius + radius * thickness * amp * 0.24;
        const inwardVeil =
          -radius *
          (0.03 + signalEnvelope * 0.03 + slope * 0.026) *
          (0.55 + edgeBias * 0.55);
        const edgeSpread =
          radius * (0.05 + signalEnvelope * 0.06 + slope * 0.05 + crest * 0.08);
        const diffuseField =
          radius *
          (
            0.04 +
            signalEnvelope * 0.06 +
            slope * 0.045 +
            crest * 0.06 +
            explosionFactor * 0.16
          ) *
          (0.18 + farBias * 1.35);
        const outwardSpray =
          radius *
          Math.max(0, crest - 0.02) *
          Math.pow(streamProfile[i], 1.7) *
          (0.28 +
            0.72 *
              Math.abs(
                Math.sin(elapsedTimeSec * 2.7 + baseNorm * 28 + depthPhase[i] * 0.35),
              ));
        const farFieldSpray =
          radius *
          Math.pow(streamProfile[i], 2.8) *
          Math.max(0, explosionFactor) *
          (0.34 + crest * 0.72 + axialFocus * 0.28) *
          (0.6 + 0.4 * Math.abs(Math.sin(elapsedTimeSec * 4.1 + baseNorm * 12.0 + grainPhase[i] * 0.3)));
        const tangentialSmear =
          angularScatterProfile[i] *
          (0.008 + signalEnvelope * 0.026 + slope * 0.02 + crest * 0.014) *
          (0.72 +
            0.28 *
              Math.sin(elapsedTimeSec * 1.2 + baseNorm * 16 + grainPhase[i] * 0.18));
        const rayBias =
          angularScatterProfile[i] *
          0.01 *
          axialFocus *
          (0.5 + 0.5 * Math.sin(elapsedTimeSec * 0.9 + depthPhase[i] * 0.4));
        const angle = baseAngle + tangentialSmear + rayBias;
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const rayMask = Math.pow(streamProfile[i], 2.8) * (0.35 + axialFocus * 0.95);
        const rayPull =
          radius *
          rayMask *
          (0.18 + signalEnvelope * 0.3 + crest * 0.26) *
          (0.45 + 0.55 * Math.abs(Math.sin(elapsedTimeSec * 2.4 + baseNorm * 10 + grainPhase[i] * 0.25)));
        const ambientBurst =
          idleNoiseProfile[i] *
          radius *
          (explosionFactor + bassPressure * 0.6) *
          0.24 *
          (0.08 + 0.92 * farBias);
        const shellOffset =
          radialProfile[i] * edgeSpread * (0.75 + edgeBias * 0.65) +
          radius *
            0.018 *
            signalEnvelope *
            Math.sin(elapsedTimeSec * 3.4 + grainPhase[i] * 1.1) *
            (0.5 + edgeBias * 0.7);
        const mistOffset =
          idleNoiseProfile[i] * diffuseField +
          radius *
            0.022 *
            (slope + crest) *
            Math.sin(elapsedTimeSec * 5.8 + baseNorm * 24 + depthPhase[i] * 0.4) +
          depthProfile[i] * radius * bassPressure * 0.06 +
          ambientBurst;
        const rimPush =
          radius *
          axialFocus *
          Math.max(0, crest - 0.03) *
          0.1 *
          (0.4 + 0.6 * Math.abs(Math.sin(elapsedTimeSec * 1.7 + baseNorm * 6.0)));
        const depthOffset =
          depthProfile[i] *
            radius *
            (0.05 + signalEnvelope * 0.12 + crest * 0.14) *
            (0.4 + farBias * 1.1) +
          radius *
            slope *
            0.055 *
            Math.sin(elapsedTimeSec * 1.8 + baseNorm * 18 + depthPhase[i] * 0.22) +
          radius *
            signalEnvelope *
            0.08 *
            Math.sin(elapsedTimeSec * 4.6 + grainPhase[i] * 1.4) +
          radius *
            bassPressure *
            0.1 *
            Math.sin(elapsedTimeSec * 1.4 + baseNorm * 6 + depthPhase[i] * 0.35) +
          radius *
            rayMask *
            0.12 *
            Math.sin(elapsedTimeSec * 3.2 + depthPhase[i] * 0.9) +
          depthProfile[i] *
            radius *
            explosionFactor *
            0.32 *
            (0.08 + 0.92 * Math.pow(streamProfile[i], 2.1));
        const effectiveRadius =
          lineRadius +
          inwardVeil +
          shellOffset +
          mistOffset +
          outwardSpray +
          farFieldSpray +
          rimPush -
          rayPull +
          radius *
            0.006 *
            Math.sin(elapsedTimeSec * 6.2 + grainPhase[i] * 1.4) *
            (0.4 + signalEnvelope + bassPressure * 0.45);

        particlePositions[idx3] = effectiveRadius * cos;
        particlePositions[idx3 + 1] = effectiveRadius * sin;
        particlePositions[idx3 + 2] =
          depthOffset +
          radius *
            bassPressure *
            0.12 *
            Math.sin(elapsedTimeSec * 2.1 + baseNorm * 10 + grainPhase[i] * 0.35);
      } else {
        const sampleIndex = Math.min(
          idleSignalSampleCount - 1,
          Math.floor(baseNorm * idleSignalSampleCount),
        );
        const amp = clamp01(Math.abs(idleSignal.current[sampleIndex]));
        const idleEnvelope = smoothedIdleEnvelope.current + amp * 0.035;
        const angle =
          baseNorm * TWO_PI +
          idleEnvelope *
            0.03 *
            (Math.sin(elapsedTimeSec * 1.0 + grainPhase[i] * 0.8) +
              0.65 * Math.sin(elapsedTimeSec * 1.9 + depthPhase[i] * 0.6));
        const cos = Math.cos(angle);
        const sin = Math.sin(angle);
        const shellSpread = radius * (0.02 + idleEnvelope * 0.22);
        const radialJitter =
          radialProfile[i] * shellSpread +
          radius *
            idleEnvelope *
            0.03 *
            Math.sin(elapsedTimeSec * 3.8 + grainPhase[i] * 1.1) +
          radius *
            idleEnvelope *
            0.016 *
            Math.sin(elapsedTimeSec * 7.5 + baseNorm * 14 + depthPhase[i] * 0.18) +
          radius *
            idleEnvelope *
            0.012 *
            Math.sin(elapsedTimeSec * 11.5 + baseNorm * 22 + grainPhase[i] * 0.22);
        const effectiveRadius = radius + radialJitter;

        particlePositions[idx3] = effectiveRadius * cos;
        particlePositions[idx3 + 1] = effectiveRadius * sin;
        particlePositions[idx3 + 2] =
          depthProfile[i] * radius * (0.016 + idleEnvelope * 0.14) +
          radius *
            idleEnvelope *
            0.026 *
            Math.sin(elapsedTimeSec * 5.4 + depthPhase[i] * 1.2) +
          radius *
            idleEnvelope *
            0.018 *
            Math.sin(elapsedTimeSec * 9.2 + grainPhase[i] * 1.5) +
          idleNoiseProfile[i] * radius * idleEnvelope * 0.018;
      }
    }

    particlePositionAttr.clearUpdateRanges();
    particlePositionAttr.addUpdateRange(start * 3, Math.max(0, (end - start) * 3));
    particlePositionAttr.needsUpdate = true;
  });

  return (
    <group>
      <mesh ref={refRibbon}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            usage={DynamicDrawUsage}
            array={ribbonPositions}
            count={ribbonVertexCount}
            itemSize={3}
          />
          <bufferAttribute
            attach="attributes-uv"
            array={ribbonUvs}
            count={ribbonVertexCount}
            itemSize={2}
          />
          <bufferAttribute attach="index" array={ribbonIndices} count={ribbonIndices.length} itemSize={1} />
        </bufferGeometry>
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={{
            uRadius: { value: radius },
            uActiveMix: { value: isPlaybackActive ? 1 : 0 },
            uHighlightStart: { value: highlightStartFinal },
            uHighlightEnd: { value: highlightEndFinal },
            uHighlightIntensity: { value: clamp01(highlightIntensity ?? 0) },
            uHighlightColor: { value: highlightColor },
            uHasHighlight: { value: hasHighlight ? 1 : 0 },
          }}
          vertexShader={`
            varying float vNormIdx;
            varying float vSide;
            varying float vRadius;
            varying vec3 vLocalPos;
            void main() {
              vNormIdx = uv.x;
              vSide = uv.y;
              vLocalPos = position;
              vRadius = length(position.xy);
              gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
          `}
          fragmentShader={`
            varying float vNormIdx;
            varying float vSide;
            varying float vRadius;
            varying vec3 vLocalPos;
            uniform float uRadius;
            uniform float uActiveMix;
            uniform float uHighlightStart;
            uniform float uHighlightEnd;
            uniform float uHighlightIntensity;
            uniform vec3 uHighlightColor;
            uniform float uHasHighlight;

            bool inArc(float t, float start, float end) {
              if (start <= end) return t >= start && t <= end;
              return t >= start || t <= end;
            }

            float hash21(vec2 p) {
              return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            void main() {
              float edge = 1.0 - abs(vSide * 2.0 - 1.0);
              float bandCore = pow(edge, 2.1);
              float bandHalo = pow(edge, 0.8);
              float radialDelta = abs(vRadius - uRadius) / max(uRadius, 0.0001);
              float bassWeight = pow(1.0 - abs(vNormIdx - 0.5) * 2.0, 1.8);
              float verticalAxis = pow(max(0.0, 1.0 - abs(vLocalPos.x) / max(uRadius * 0.92, 0.0001)), 1.9);
              float verticalCore = pow(max(0.0, 1.0 - abs(vLocalPos.x) / max(uRadius * 0.48, 0.0001)), 2.6);
              float filament = pow(abs(sin(vNormIdx * 34.0 + vLocalPos.z * 10.0)), 4.0);
              float dust = mix(0.82, 1.18, hash21(floor(vLocalPos.xy * 34.0)));
              float bodyGlow = exp(-pow(vLocalPos.x / max(uRadius * 0.34, 0.0001), 2.0));

              vec3 cold = vec3(0.34, 0.62, 1.0);
              vec3 warm = vec3(1.0, 0.28, 0.06);
              vec3 ember = vec3(1.0, 0.68, 0.22);
              vec3 core = vec3(0.94, 0.98, 1.0);
              float temperature = clamp(radialDelta * 4.2 + filament * 0.22 + bassWeight * 0.4 - verticalCore * 0.38, 0.0, 1.0);
              vec3 color = mix(cold, warm, temperature);
              color = mix(color, core, verticalAxis * 0.62 + bandCore * 0.22 + bodyGlow * 0.18);
              color = mix(color, ember, clamp(bandHalo * 0.42 + radialDelta * 0.34 + bassWeight * 0.28, 0.0, 1.0));
              if (uHasHighlight > 0.5 && inArc(vNormIdx, uHighlightStart, uHighlightEnd)) {
                color = mix(color, uHighlightColor, uHighlightIntensity);
              }

              float alpha = (bandCore * 1.02 + bandHalo * 0.52 + verticalAxis * 0.18 + bassWeight * 0.14 + bodyGlow * 0.16) * dust * uActiveMix;
              float luminance = (0.42 + bandCore * 1.08 + filament * 0.18 + verticalCore * 0.34 + bassWeight * 0.22 + bodyGlow * 0.24) * dust;
              gl_FragColor = vec4(color * luminance, alpha);
            }
          `}
        />
      </mesh>

      <points ref={refParticles}>
        <bufferGeometry>
          <bufferAttribute
            attach="attributes-position"
            usage={DynamicDrawUsage}
            array={particlePositions}
            count={safePointCount}
            itemSize={3}
          />
        </bufferGeometry>
        <shaderMaterial
          transparent
          depthWrite={false}
          blending={AdditiveBlending}
          uniforms={{
            uPointSize: {
              value:
                pointSize *
                POINT_SIZE_VISUAL_SCALE *
                (typeof window !== "undefined" ? Math.min(window.devicePixelRatio, 1.5) : 1),
            },
            uRadius: { value: radius },
            uActiveMix: { value: isPlaybackActive ? 1 : 0 },
            uHighlightStart: { value: highlightStartFinal },
            uHighlightEnd: { value: highlightEndFinal },
            uHighlightIntensity: { value: clamp01(highlightIntensity ?? 0) },
            uHighlightColor: { value: highlightColor },
            uHasHighlight: { value: hasHighlight ? 1 : 0 },
          }}
          vertexShader={`
            varying float vNormIdx;
            varying vec3 vLocalPos;
            varying float vDistance;
            uniform float uPointSize;
            void main() {
              vLocalPos = position;
              vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
              vDistance = -mvPosition.z;
              float angle = atan(position.y, position.x);
              if (angle < 0.0) angle += 6.28318530718;
              vNormIdx = angle / 6.28318530718;
              gl_PointSize = uPointSize * (300.0 / max(vDistance, ${MIN_DISTANCE_FOR_POINT_SIZE.toFixed(2)}));
              gl_Position = projectionMatrix * mvPosition;
            }
          `}
          fragmentShader={`
            varying float vNormIdx;
            varying vec3 vLocalPos;
            varying float vDistance;
            uniform float uRadius;
            uniform float uActiveMix;
            uniform float uHighlightStart;
            uniform float uHighlightEnd;
            uniform float uHighlightIntensity;
            uniform vec3 uHighlightColor;
            uniform float uHasHighlight;

            bool inArc(float t, float start, float end) {
              if (start <= end) return t >= start && t <= end;
              return t >= start || t <= end;
            }

            float hash21(vec2 p) {
              return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
            }

            void main() {
              float d = distance(gl_PointCoord, vec2(0.5));
              float core = smoothstep(0.5, 0.15, d);
              float glow = 0.012 / max(0.025, d);
              float ringRadius = length(vLocalPos.xy);
              float bassWeight = pow(1.0 - abs(vNormIdx - 0.5) * 2.0, 1.5);
              float edgeDelta = abs(ringRadius - uRadius);
              float band = exp(-pow(edgeDelta / max(uRadius * (uActiveMix > 0.5 ? 0.05 : 0.1), 0.0001), 2.0));
              float nearField = exp(-pow(edgeDelta / max(uRadius * 0.12, 0.0001), 2.0));
              float mist = exp(-pow(edgeDelta / max(uRadius * 0.22, 0.0001), 2.0));
              float farMist = exp(-pow(edgeDelta / max(uRadius * 0.42, 0.0001), 2.0));
              float outwardBias = smoothstep(uRadius * 1.02, uRadius * 1.7, ringRadius);
              float plume = smoothstep(uRadius * 0.97, uRadius * 1.45, ringRadius) * (1.0 - nearField * 0.55);
              float depthGlow = exp(-pow(vLocalPos.z / max(uRadius * 0.38, 0.0001), 2.0));
              float axial = pow(max(0.0, 1.0 - abs(vLocalPos.x) / max(uRadius * 0.78, 0.0001)), 2.8);
              float verticalCore = pow(max(0.0, 1.0 - abs(vLocalPos.x) / max(uRadius * 0.34, 0.0001)), 2.3);
              float subBody = exp(-pow(vLocalPos.x / max(uRadius * 0.46, 0.0001), 2.0)) * exp(-pow(vLocalPos.z / max(uRadius * 0.58, 0.0001), 2.0));
              float rimHeat = smoothstep(uRadius * 0.94, uRadius * 1.12, ringRadius);
              float innerRays = pow(abs(sin(vNormIdx * 28.0 + length(vLocalPos.xy) * 0.8)), 6.0) * axial;
              float dust = mix(0.42, 1.2, hash21(floor(vLocalPos.xy * 48.0) + floor(vLocalPos.z * 20.0)));
              float grain = hash21(floor(vLocalPos.xy * 86.0) + floor(vLocalPos.z * 34.0));
              float distanceFade = smoothstep(34.0, 8.0, vDistance);

              vec3 idleColor = vec3(0.98, 0.98, 0.98);
              vec3 cool = vec3(0.36, 0.64, 1.0);
              vec3 warm = vec3(1.0, 0.34, 0.06);
              vec3 ember = vec3(1.0, 0.76, 0.24);
              float temperature = clamp(plume * 0.82 + mist * 0.3 + band * 0.2 + rimHeat * 0.34 + grain * 0.08 + bassWeight * 0.34 - verticalCore * 0.26, 0.0, 1.0);
              vec3 color = mix(idleColor, mix(cool, warm, temperature), uActiveMix);
              color = mix(color, vec3(0.92, 0.97, 1.0), (verticalCore * 0.62 + subBody * 0.22 + bassWeight * 0.1) * uActiveMix);
              color = mix(color, ember, clamp(innerRays * 0.72 + axial * 0.1 + nearField * 0.14 + rimHeat * 0.22 + bassWeight * 0.24 + plume * 0.08, 0.0, 1.0) * uActiveMix);
              if (uHasHighlight > 0.5 && inArc(vNormIdx, uHighlightStart, uHighlightEnd)) {
                color = mix(color, uHighlightColor, uHighlightIntensity * max(0.35, uActiveMix));
              }

              float energyField = uActiveMix > 0.5
                ? 0.12 + band * 0.42 + nearField * 0.34 + mist * 0.2 + plume * 0.2 + depthGlow * 0.18 + axial * 0.16 + verticalCore * 0.26 + innerRays * 0.24 + farMist * 0.08 + bassWeight * 0.22 + subBody * 0.28
                : 0.34 + band * 0.18;
              float radialFade = mix(
                clamp(0.34 + band * 0.66, 0.0, 1.0),
                clamp(0.18 + band * 0.74 + nearField * 0.46 + mist * 0.2 + farMist * 0.06 + subBody * 0.18 - outwardBias * 0.22, 0.0, 1.0),
                uActiveMix
              );
              float alpha = smoothstep(0.5, 0.04, d) * min(1.0, (core * 0.88 + pow(glow, 1.18)) * dust) * mix(0.24, 1.0, grain) * distanceFade * radialFade;
              float luminance = energyField * mix(0.66, 1.16, grain) * distanceFade * mix(0.96, 1.0 - outwardBias * 0.34, uActiveMix);
              gl_FragColor = vec4(color * luminance, alpha * mix(0.9, 0.72, uActiveMix));
            }
          `}
        />
      </points>
    </group>
  );
};

export default BaseDiffusedRing;
