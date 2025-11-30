import { useEffect, useState, type MutableRefObject } from 'react';
import { useFrame } from '@react-three/fiber';
import { PointerLockControls } from '@react-three/drei';

type RigProps = {
  audioLevelRef?: MutableRefObject<number>;
};

export const Rig = ({ audioLevelRef }: RigProps = {}) => {
  const [moveForward, setMoveForward] = useState(false);
  const [moveBackward, setMoveBackward] = useState(false);
  const [moveLeft, setMoveLeft] = useState(false);
  const [moveRight, setMoveRight] = useState(false);
  const [moveUp, setMoveUp] = useState(false);
  const [moveDown, setMoveDown] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          setMoveForward(true);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          setMoveLeft(true);
          break;
        case 'ArrowDown':
        case 'KeyS':
          setMoveBackward(true);
          break;
        case 'ArrowRight':
        case 'KeyD':
          setMoveRight(true);
          break;
        case 'Space':
          setMoveUp(true);
          break;
        case 'KeyC':
          setMoveDown(true);
          break;
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      switch (event.code) {
        case 'ArrowUp':
        case 'KeyW':
          setMoveForward(false);
          break;
        case 'ArrowLeft':
        case 'KeyA':
          setMoveLeft(false);
          break;
        case 'ArrowDown':
        case 'KeyS':
          setMoveBackward(false);
          break;
        case 'ArrowRight':
        case 'KeyD':
          setMoveRight(false);
          break;
        case 'Space':
          setMoveUp(false);
          break;
        case 'KeyC':
          setMoveDown(false);
          break;
      }
    };

    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);

    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  useFrame((state, delta) => {
    const speed = 10 * delta;
    if (moveForward) state.camera.translateZ(-speed);
    if (moveBackward) state.camera.translateZ(speed);
    if (moveLeft) state.camera.translateX(-speed);
    if (moveRight) state.camera.translateX(speed);
    if (moveUp) state.camera.translateY(speed);
    if (moveDown) state.camera.translateY(-speed);
  });

  return <PointerLockControls />;
};
