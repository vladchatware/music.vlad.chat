import { GradientTexture } from "@react-three/drei";
import { useThree } from "@react-three/fiber";

export default function BackgroundImageCover() {
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
        <meshBasicMaterial depthWrite={false}>
          <GradientTexture
            stops={[0, 1]}
            colors={["#353b45", "#c0c6ce"]}
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
