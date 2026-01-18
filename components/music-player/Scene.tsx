"use client"

import React, { type ReactNode, useMemo } from "react";
import { Canvas } from "@react-three/fiber";
import { Fullscreen } from "@react-three/uikit";
import { Defaults } from "@react-three/uikit-default";
import { Environment, SoftShadows, Text } from "@react-three/drei";
import * as THREE from "three";

import { PhysicalGrid } from "@/components/PhysicalGrid";
import { Rig } from "@/components/Rig";
import BaseDiffusedRing from "@/components/Ring/base";
import BackgroundImageCover from "@/components/BackgroundImage";
import { Floating } from "@/components/Simulation";
import { ScreenGrain } from "@/components/ScreenGrain";
import { type CoordinateMapper_Data } from "@/lib/mappers/coordinateMappers/data";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";
import { useShallow } from "zustand/react/shallow";

export function MusicPlayerScene({
  initialTrackId,
  coordinateMapper,
  audioEnergyRef,
  transitionHighlight,
  backgroundPrompt,
  children
}: {
  initialTrackId: string | number;
  coordinateMapper: CoordinateMapper_Data;
  audioEnergyRef: React.MutableRefObject<number>;
  transitionHighlight?: { start01: number; end01: number; intensity?: number } | null;
  backgroundPrompt?: string;
  children: ReactNode;
}) {
  const { palette } = useMusicPlayerStore(useShallow((s) => ({ palette: s.palette })));
  const envKey = useMemo(() => initialTrackId?.toString() || "default", [initialTrackId]);

  return (
    <Canvas
      shadows
      camera={{ position: [0, 0, 18], fov: 32.5 }}
      style={{
        position: "fixed", top: 0, left: 0, width: "100vw", height: "100dvh",
        touchAction: "none", zIndex: 0,
      }}
      gl={{
        localClippingEnabled: true, antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        powerPreference: "high-performance"
      }}
    >
      <ambientLight intensity={0.4} />

      <spotLight
        decay={0} position={[0, 40, 20]} angle={0.5} penumbra={1}
        intensity={Math.PI * 2} castShadow
        color="white"
      />
      <SoftShadows size={40} samples={16} />

      <Defaults>
        <Fullscreen
          overflow={initialTrackId ? "scroll" : "hidden"}
          scrollbarColor="black" flexDirection="column"
          padding={32} alignItems="center" justifyContent="center"
        >
          {children}
        </Fullscreen>

        <Rig audioLevelRef={audioEnergyRef} />

        <Environment
          key={envKey}
          background={false}
          resolution={1024}
          frames={1}
          environmentIntensity={1.8}
        >
          <color attach="background" args={["black"]} />
          <mesh scale={100}>
            <sphereGeometry args={[1, 32, 32]} />
            <meshBasicMaterial side={THREE.BackSide} color={palette[0]} />
          </mesh>
        </Environment>

        {backgroundPrompt && (
          <Text
            position={[-12, -4, -2]} rotation={[-Math.PI / 6, Math.PI / 8, 0]}
            fontSize={0.6} maxWidth={10} lineHeight={1.4} textAlign="left"
            anchorX="left" anchorY="bottom"
          >
            {backgroundPrompt}
            <meshStandardMaterial
              color="white" emissive="white" emissiveIntensity={2.5}
              transparent opacity={0.6}
            />
          </Text>
        )}

        {/* --- DYNAMIC BACKGROUND SPHERE --- */}
        <BackgroundImageCover
          audioEnergyRef={audioEnergyRef}
          transitionHighlight={transitionHighlight}
          palette={palette}
        />

        <group position={[0, 0, -2]}>
          <BaseDiffusedRing
            coordinateMapper={coordinateMapper}
            radius={2.8} nPoints={20000} pointSize={0.12} thickness={1.5}
            mirrorEffects={true} highlightStart01={transitionHighlight?.start01}
            highlightEnd01={transitionHighlight?.end01}
            highlightIntensity={transitionHighlight?.intensity ?? 0.9}
            highlightColor={[palette[1].r, palette[1].g, palette[1].b]}
          />
        </group>

        <PhysicalGrid
          position={[0, 0, 0]} size={100} audioEnergyRef={audioEnergyRef}
          transitionProgress={transitionHighlight?.end01} palette={palette}
        />

        <group position={[0, 0, 8]}>
          <Floating
            audioEnergyRef={audioEnergyRef}
            transitionProgress={transitionHighlight?.end01}
            palette={palette}
          />
        </group>

        {/* 
            PERFORMANCE GRAIN
            Removed HUD to fix slowdown. Rendered directly at the end of the scene 
            with a high renderOrder to cover everything.
        */}
        <ScreenGrain />
      </Defaults>
    </Canvas>
  );
}
