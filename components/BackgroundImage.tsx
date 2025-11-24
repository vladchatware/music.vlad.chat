import { GradientTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";
import { useEffect, useState } from "react";

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

  // The mesh is rotated -90 degrees (Math.PI / 2). 
  // We need to rotate the texture 90 degrees to compensate.
  return <videoTexture attach="map" args={[video]} rotation={Math.PI / 2} center={[0.5, 0.5]} />;
}

export default function BackgroundImageCover({ enableCamera }: { enableCamera?: boolean }) {
  const viewport = useThree((state) => state.viewport);
  // Scale up to account for the background being further back than z=0
  // Camera is at z=18, Background at z=-1.6. Ratio approx 1.1 + extra for safety
  const scaleFactor = 2.5;

  return (
    <>
      <mesh
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
