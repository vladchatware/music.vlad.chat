import * as THREE from 'three'
import { useGLTF, Float, MeshTransmissionMaterial } from '@react-three/drei'
import { useMemo } from 'react'

/**
 * NATURAL LIQUID GLASS MATERIAL
 * Restored to reflect and refract the 3D scene in HDR fashion.
 * - High reflectivity for scene reflections
 * - Iridescence for natural glass color shifts
 * - Low roughness for clear reflections
 * - Proper IOR for natural glass appearance
 * 
 * Original sporadic animation restored - each Float component animates independently
 * for organic, natural floating motion.
 */
export function Floating({
  audioEnergyRef,
  transitionProgress = 0,
  palette,
  ...props
}: {
  audioEnergyRef?: React.MutableRefObject<number>;
  transitionProgress?: number;
  palette?: THREE.Color[];
} & any) {
  const { nodes } = useGLTF('/smileys-transformed.glb')

  const material = useMemo(() => {
    return (
      <MeshTransmissionMaterial
        color="white"
        metalness={0}
        roughness={0.01}
        ior={1.8}
        thickness={0.45}
        reflectivity={0.45}
        chromaticAberration={0.1}
        clearcoat={0.4}
        resolution={1024}
        clearcoatRoughness={0.05}
        iridescence={0.9}
        iridescenceIOR={0.1}
        iridescenceThicknessRange={[0, 140]}
        samples={4}
      />
    );
  }, []);

  return (
    <group {...props} dispose={null}>
      <Float>
        <mesh
          geometry={(nodes.hash as any).geometry}
          position={[-4.095, 1.891, -2.58]}
          scale={0.216}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={(nodes.star001 as any).geometry}
          position={[2.932, -2.747, -2.807]}
          scale={0.278}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={(nodes.play as any).geometry}
          position={[3.722, 0.284, -1.553]}
          scale={0.245}
        >
          <MeshTransmissionMaterial transmission={0.95} side={THREE.DoubleSide} />
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={(nodes.points as any).geometry}
          position={[3, 2.621, -1.858]}
          scale={0.239}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={(nodes.Ellipse as any).geometry}
          position={[-3.275, -1, -3.389]}
          scale={0.317}
        >
          {material}
        </mesh>
      </Float>
    </group>
  )
}
