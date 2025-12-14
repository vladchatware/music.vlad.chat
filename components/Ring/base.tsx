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
}) => {
  const noise = Array.from({ length: nPoints }).map(gaussianRandom);
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
      effectiveRadius =
        radius *
        (1 +
          noise[i] *
          coordinateMapper.map(
            COORDINATE_TYPE.CARTESIAN_1D,
            mirrorEffects ? 2 * Math.abs(normIdx - 0.5) : normIdx,
            0,
            0,
            elapsedTimeSec,
          ));

      angRad = normIdx * TWO_PI;
      positionsBuffer.setXYZ(
        i,
        effectiveRadius * Math.cos(angRad), // x
        effectiveRadius * Math.sin(angRad), // y
        0, // z
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
      <pointsMaterial attach="material" size={pointSize} vertexColors />
    </points>
  );
};

export default BaseDiffusedRing;
