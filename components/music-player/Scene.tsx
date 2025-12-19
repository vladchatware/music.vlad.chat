"use client"

import React, { type ReactNode } from "react";
import { Canvas } from "@react-three/fiber";
import { Fullscreen } from "@react-three/uikit";
import { Defaults } from "@react-three/uikit-default";
import { CubeCamera, Environment, SoftShadows } from "@react-three/drei";

import { PhysicalGrid } from "@/components/PhysicalGrid";
import { Rig } from "@/components/Rig";
import BaseDiffusedRing from "@/components/Ring/base";
import BackgroundImageCover from "@/components/BackgroundImage";
import { Floating } from "@/components/Simulation";
import { type CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";
import { useShallow } from "zustand/react/shallow";

export function MusicPlayerScene(props: {
  initialTrackId: string | number;
  coordinateMapper: CoordinateMapper_Data;
  audioEnergyRef: React.MutableRefObject<number>;
  transitionHighlight?: { start01: number; end01: number; intensity?: number } | null;
  children: ReactNode;
}) {
  const { initialTrackId, coordinateMapper, audioEnergyRef, transitionHighlight, children } = props;
  const { palette } = useMusicPlayerStore(useShallow((s) => ({ palette: s.palette })));


  return (
    <Canvas
      shadows
      camera={{ position: [0, 0, 18], fov: 32.5 }}
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        width: "100vw",
        height: "100dvh",
        touchAction: "none",
        zIndex: 0,
      }}
      gl={{ localClippingEnabled: true }}
    >
      <ambientLight intensity={Math.PI} />
      <spotLight
        decay={0}
        position={[0, 0, 18]}
        angle={0.6}
        penumbra={1}
        intensity={2}
        castShadow
        shadow-bias={-0.0001}
      />
      <SoftShadows size={40} samples={16} />
      <Defaults>
        <Fullscreen padding={32} flexDirection="column" justifyContent="space-between" alignItems="center">
          {children}
        </Fullscreen>

        <Rig audioLevelRef={audioEnergyRef} />
        <BaseDiffusedRing
          coordinateMapper={coordinateMapper}
          radius={2.8}
          nPoints={10000}
          pointSize={0.1}
          mirrorEffects={true}
          highlightStart01={transitionHighlight?.start01}
          highlightEnd01={transitionHighlight?.end01}
          highlightIntensity={transitionHighlight?.intensity ?? 0.9}
          highlightColor={[palette[1].r, palette[1].g, palette[1].b]}
        />
        <CubeCamera position={[0, 0, 7]} resolution={256} frames={Infinity}>
          {(texture) => (
            <Floating
              envMap={texture}
              audioEnergyRef={audioEnergyRef}
              transitionProgress={transitionHighlight?.end01}
              palette={palette}
            />
          )}
        </CubeCamera>
        <PhysicalGrid
          position={[0, 0, 0]}
          size={100}
          audioEnergyRef={audioEnergyRef}
          transitionProgress={transitionHighlight?.end01}
          palette={palette}
        />
        <BackgroundImageCover
          audioEnergyRef={audioEnergyRef}
          transitionHighlight={transitionHighlight}
          palette={palette}
        />
        <Environment preset="city" environmentIntensity={1} />
      </Defaults>
    </Canvas>
  );
}

