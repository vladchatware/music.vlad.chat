import { GradientTexture } from "@react-three/drei";
import { useThree, useFrame } from "@react-three/fiber";
import { useEffect, useState, useRef } from "react";
import * as THREE from "three";

function CameraFeed() {
  const [video] = useState(() => {
    if (typeof document === 'undefined') return null;
    const vid = document.createElement('video');
    vid.playsInline = true;
    vid.muted = true;
    vid.autoplay = true;
    vid.style.display = 'none';
    return vid;
  });

  useEffect(() => {
    if (!video) return;
    let stream: MediaStream | null = null;
    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } })
      .then((s) => {
        stream = s;
        video.srcObject = s;
        video.play();
      })
      .catch((err) => console.error("Error accessing camera:", err));

    return () => {
      if (stream) {
        stream.getTracks().forEach((track) => track.stop());
      }
    };
  }, [video]);

  if (!video) return null;

  return <videoTexture attach="map" args={[video]} toneMapped={false} />;
}

export default function BackgroundImageCover({ enableCamera }: { enableCamera?: boolean }) {
  const viewport = useThree((state) => state.viewport);
  const meshRef = useRef<THREE.Mesh>(null);
  // Scale up to account for the background being further back than z=0
  // Camera is at z=18, Background at z=-1.6. Ratio approx 1.1 + extra for safety
  const scaleFactor = 2.5;

  useFrame((state) => {
    if (!meshRef.current) return;

    if (enableCamera) {
      const camera = state.camera;
      // Lock to camera position and rotation
      meshRef.current.position.copy(camera.position);
      meshRef.current.quaternion.copy(camera.quaternion);
      // Move to background depth relative to camera
      // Camera is at z=18, background target is z=-1.6. Distance is 19.6.
      meshRef.current.translateZ(-19.6);

      // Calculate frustum size at this distance to fit the screen exactly
      const dist = 19.6;
      const vH = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * dist;
      const vW = vH * camera.aspect;

      // Apply scale to fit frustum
      meshRef.current.scale.set(vW, vH, 1);
    } else {
      // Restore static world transform for gradient mode
      meshRef.current.position.set(0, 0, -1.6);
      meshRef.current.rotation.set(0, 0, -Math.PI / 2);
      meshRef.current.scale.set(viewport.height * scaleFactor, viewport.width * scaleFactor, 1);
    }
  });

  return (
    <>
      <mesh
        ref={meshRef}
        position={[0, 0, -1.6]}
        scale={[viewport.height * scaleFactor, viewport.width * scaleFactor, 1]}
        rotation={[0, 0, -Math.PI / 2]}
      >
        <planeGeometry />
        <meshBasicMaterial depthWrite={false} toneMapped={false}>
          {enableCamera ? (
            <CameraFeed />
          ) : (
            <GradientTexture
              stops={[0, 1]}
              colors={["#353b45", "#c0c6ce"]}
            />
          )}
        </meshBasicMaterial>
      </mesh>
      <mesh
        position={[0, 0, -1.5]}
        scale={[viewport.height * scaleFactor, viewport.width * scaleFactor, 1]}
        rotation={[0, 0, -Math.PI / 2]}
        receiveShadow
      >
        <planeGeometry />
        <shadowMaterial transparent opacity={0.3} />
      </mesh>
    </>
  );
}
