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
    navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: 'environment',
        width: { ideal: 1920 },
        height: { ideal: 1080 }
      }
    })
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

  return <videoTexture attach="map" args={[video]} />;
}

export default function BackgroundImageCover() {
  const viewport = useThree((state) => state.viewport);
  const meshRef = useRef<THREE.Mesh>(null);
  // Scale up to account for the background being further back than z=0
  // Camera is at z=18, Background at z=-1.6. Ratio approx 1.1 + extra for safety
  const scaleFactor = 2.5;

  useFrame((state) => {
    if (!meshRef.current) return;

    meshRef.current.position.set(0, 0, -1.6);
    meshRef.current.rotation.set(0, 0, -Math.PI / 2);
    meshRef.current.scale.set(viewport.height * scaleFactor, viewport.width * scaleFactor, 1);
  
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

            <GradientTexture
              stops={[0, 0.4, 0.7, 1]}
              colors={["#8B1A1A", "#FF4500", "#FF8C00", "#FFD700"]}
            />
          
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
