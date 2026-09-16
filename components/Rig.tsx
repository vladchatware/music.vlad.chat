import { useRef, useEffect, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { easing } from 'maath';
import * as THREE from 'three';
import {
  deviceOrientationQuaternion,
  orbitPositionFromOrientation,
  relativeDeviceOrientation,
} from '@/lib/deviceOrientation';

type RigProps = {
  audioLevelRef?: MutableRefObject<number>;
};

const MAX_CAMERA_ORIENTATION = THREE.MathUtils.degToRad(15);
const ORBIT_CENTER_Z = -2;

const smoothTowards = (current: number, target: number, delta: number) => {
  const alpha = 1 - Math.exp(-delta * 6);
  return THREE.MathUtils.lerp(current, target, alpha);
};

export const Rig = ({ audioLevelRef }: RigProps = {}) => {
  const energyRef = useRef(0);
  const orientationRef = useRef(new THREE.Quaternion());
  const initialOrientationRef = useRef<THREE.Quaternion | null>(null);
  const hasOrientationRef = useRef(false);
  const relativeOrientationRef = useRef(new THREE.Quaternion());
  const targetQuaternionRef = useRef(new THREE.Quaternion());
  const focusRef = useRef(new THREE.Vector3());
  const targetPositionRef = useRef(new THREE.Vector3());

  useEffect(() => {
    const getScreenOrientation = () => {
      if (typeof window.screen.orientation?.angle === 'number') {
        return window.screen.orientation.angle;
      }

      return (window as Window & { orientation?: number }).orientation ?? 0;
    };

    const handleOrientation = (event: DeviceOrientationEvent) => {
      if (event.alpha === null && event.beta === null && event.gamma === null) {
        return;
      }

      deviceOrientationQuaternion(
        event.alpha ?? 0,
        event.beta ?? 0,
        event.gamma ?? 0,
        getScreenOrientation(),
        orientationRef.current,
      );

      if (!initialOrientationRef.current) {
        initialOrientationRef.current = orientationRef.current.clone();
      }
      hasOrientationRef.current = true;
    };

    const recalibrate = () => {
      initialOrientationRef.current = null;
      hasOrientationRef.current = false;
    };

    if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
      window.addEventListener('deviceorientation', handleOrientation);
      window.addEventListener('orientationchange', recalibrate);
    }

    return () => {
      if (typeof window !== 'undefined' && window.DeviceOrientationEvent) {
        window.removeEventListener('deviceorientation', handleOrientation);
        window.removeEventListener('orientationchange', recalibrate);
      }
    };
  }, []);

  useFrame((state, delta) => {
    const targetEnergy = audioLevelRef?.current ?? 0;
    energyRef.current = smoothTowards(energyRef.current, targetEnergy, delta);

    const pointerScale = 1 + energyRef.current * 1.4;
    const pointerZ = 18 - energyRef.current * 4;
    const lookAtZ = -10 - energyRef.current * 3;

    if (hasOrientationRef.current && initialOrientationRef.current) {
      const relativeOrientation = relativeDeviceOrientation(
        initialOrientationRef.current,
        orientationRef.current,
        relativeOrientationRef.current,
      );
      const orientationInfluence = Math.min(0.6, 0.35 * pointerScale);
      const relativeAngle = relativeOrientation.angleTo(
        targetQuaternionRef.current.identity(),
      );
      const boundedInfluence =
        relativeAngle > 0
          ? Math.min(
              orientationInfluence,
              MAX_CAMERA_ORIENTATION / relativeAngle,
            )
          : 0;
      const targetQuaternion = targetQuaternionRef.current
        .identity()
        .slerp(relativeOrientation, boundedInfluence);
      const focus = focusRef.current.set(0, 0, ORBIT_CENTER_Z);
      const targetPosition = orbitPositionFromOrientation(
        focus,
        pointerZ - ORBIT_CENTER_Z,
        targetQuaternion,
        targetPositionRef.current,
      );

      easing.damp3(state.camera.position, targetPosition, 0.35, delta);
      state.camera.up.set(0, 1, 0);
      state.camera.lookAt(focus);
      return;
    }

    const targetX = state.pointer.x * 2 * pointerScale;
    const targetY = state.pointer.y * 2 * pointerScale;
    easing.damp3(state.camera.position, [targetX, targetY, pointerZ], 0.35, delta);
    state.camera.lookAt(0, 0, lookAtZ);
  });

  return null;
};
