import { useRef, useEffect, type MutableRefObject, useMemo } from 'react';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import * as THREE from 'three';
import { useMusicPlayerStore } from './music-player/store/useMusicPlayerStore';
import { useShallow } from 'zustand/react/shallow';

type RigProps = {
  audioLevelRef?: MutableRefObject<number>;
};

const smoothTowards = (current: number, target: number, delta: number) => {
  const alpha = 1 - Math.exp(-delta * 6);
  return THREE.MathUtils.lerp(current, target, alpha);
};

export const Rig = ({ audioLevelRef }: RigProps = {}) => {
  const energyRef = useRef(0);
  const orientationRef = useRef({ x: 0, y: 0 });
  const shakeRef = useRef(new THREE.Vector3(0, 0, 0));

  const { section, dropDetected, bassEnergy, beatPhase } = useMusicPlayerStore(
    useShallow((s) => ({
      section: s.analysis.section,
      dropDetected: s.analysis.dropDetected,
      bassEnergy: s.analysis.bassEnergy,
      beatPhase: s.analysis.beatPhase,
    }))
  );

  useEffect(() => {
    const handleOrientation = (event: DeviceOrientationEvent) => {
      const gamma = event.gamma || 0;
      const beta = event.beta || 0;

      // Normalize gamma (-45 to 45 -> -1 to 1)
      const x = THREE.MathUtils.clamp(gamma / 45, -1, 1);

      // Normalize beta. Assuming holding phone at ~45deg is "center".
      // 0 deg (flat) -> -1
      // 90 deg (upright) -> 1
      const y = THREE.MathUtils.clamp((beta - 45) / 45, -1, 1);

      orientationRef.current = { x, y };
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
    }

    return () => {
      if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation);
      }
    };
  }, []);

  useFrame((state, delta) => {
    const targetEnergy = audioLevelRef?.current ?? 0;
    energyRef.current = smoothTowards(energyRef.current, targetEnergy, delta);

    // Section-based intensity
    let sectionMultiplier = 1.0;
    if (section === 'culmination') sectionMultiplier = 2.2;
    if (section === 'comeup') sectionMultiplier = 1.6;
    if (section === 'breakdown') sectionMultiplier = 0.8;

    const pointerScale = (1 + energyRef.current * 1.8) * sectionMultiplier;

    // Head-bopping oscillation (vertical) based on beat phase
    // Snappy curve: drops on 0, rises till 0.5, drops till 1.0
    const bop = Math.pow(Math.sin(beatPhase * Math.PI), 2) * 0.4 * sectionMultiplier;

    // Side sway tied to the beat (1 bar = 4 beats usually, but we sway every 2 beats)
    const sway = Math.sin(beatPhase * Math.PI * 0.5) * 0.5 * sectionMultiplier;

    // Shake effect on drop or high bass
    if (dropDetected || (bassEnergy > 0.8 && section === 'culmination')) {
      shakeRef.current.set(
        (Math.random() - 0.5) * 0.5 * pointerScale,
        (Math.random() - 0.5) * 0.5 * pointerScale,
        (Math.random() - 0.5) * 0.5 * pointerScale
      );
    } else {
      shakeRef.current.lerp(new THREE.Vector3(0, 0, 0), 0.1);
    }

    // Combine mouse pointer and device orientation
    const targetX = (state.pointer.x + orientationRef.current.x) * 2.5 * pointerScale + sway;
    const targetY = (state.pointer.y + orientationRef.current.y) * 2.5 * pointerScale + bop;
    const pointerZ = 18 - energyRef.current * 5 * sectionMultiplier;

    // Faster damping during high energy for snappier rhythmic feel
    const dampTime = section === 'culmination' ? 0.15 : 0.3;

    easing.damp3(
      state.camera.position,
      [
        targetX + shakeRef.current.x,
        targetY + shakeRef.current.y,
        pointerZ + shakeRef.current.z
      ],
      dampTime,
      delta
    );

    const lookAtZ = -10 - energyRef.current * 4 * sectionMultiplier;
    state.camera.lookAt(shakeRef.current.x * 2, shakeRef.current.y * 2, lookAtZ);
  });

  return null;
};
