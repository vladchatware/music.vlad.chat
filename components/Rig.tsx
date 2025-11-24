import { useRef, useEffect, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import * as THREE from 'three';

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

    const pointerScale = 1 + energyRef.current * 1.4;

    // Combine mouse pointer and device orientation
    // On desktop, orientation is 0. On mobile, pointer is 0 (untouched).
    const targetX = (state.pointer.x + orientationRef.current.x) * 2 * pointerScale;
    const targetY = (state.pointer.y + orientationRef.current.y) * 2 * pointerScale;

    const pointerZ = 18 - energyRef.current * 4;

    easing.damp3(state.camera.position, [targetX, targetY, pointerZ], 0.35, delta);
    const lookAtZ = -10 - energyRef.current * 3;
    state.camera.lookAt(0, 0, lookAtZ);
  });

  return null;
};
