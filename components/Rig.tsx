import { useRef, type MutableRefObject } from 'react';
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

  useFrame((state, delta) => {
    const targetEnergy = audioLevelRef?.current ?? 0;
    energyRef.current = smoothTowards(energyRef.current, targetEnergy, delta);

    const pointerScale = 1 + energyRef.current * 1.4;
    const pointerX = state.pointer.x * 2 * pointerScale;
    const pointerY = state.pointer.y * 2 * pointerScale;
    const pointerZ = 18 - energyRef.current * 4;

    easing.damp3(state.camera.position, [pointerX, pointerY, pointerZ], 0.35, delta);
    const lookAtZ = -10 - energyRef.current * 3;
    state.camera.lookAt(0, 0, lookAtZ);
  });

  return null;
};
