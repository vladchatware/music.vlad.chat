import * as THREE from 'three'
import { useGLTF, Float } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { Physics, RigidBody, BallCollider, RapierRigidBody } from '@react-three/rapier'
import { useMemo, useRef } from 'react'
import { useMusicPlayerStore } from './music-player/store/useMusicPlayerStore'
import { useShallow } from 'zustand/react/shallow'

// Shapes by https://app.spline.design/library/a4eeaee4-be03-4df8-ab05-5a073eda2eb4
export function Floating({
  envMap,
  audioEnergyRef,
  transitionProgress = 0,
  palette,
  ...props
}: {
  envMap: any;
  audioEnergyRef?: React.MutableRefObject<number>;
  transitionProgress?: number;
  palette?: THREE.Color[];
} & any) {
  const { nodes, materials } = useGLTF('/smileys-transformed.glb')
  const groupRef = useRef<THREE.Group>(null)

  const materialRef = useRef<THREE.MeshPhysicalMaterial>(null)

  const { section, beatPhase } = useMusicPlayerStore(
    useShallow((s) => ({
      section: s.analysis.section,
      beatPhase: s.analysis.beatPhase,
    }))
  );

  useFrame((state, delta) => {
    if (!materialRef.current || !groupRef.current) return
    const energy = audioEnergyRef?.current ?? 0

    // Section-based intensity
    const intensity = section === 'culmination' ? 2.5 : section === 'comeup' ? 1.5 : 1.0;

    // Rhythmic scale pulse based on beat phase - snappy on the beat
    const beatPulse = Math.exp(-beatPhase * 3) * 0.3 * intensity;
    const scalePulse = 1 + (energy * 0.15 * intensity) + beatPulse;
    groupRef.current.scale.lerp(new THREE.Vector3(scalePulse, scalePulse, scalePulse), 0.15)

    // Vertical bobbing tied to the beat
    const bob = Math.sin(beatPhase * Math.PI) * 0.2 * intensity;
    groupRef.current.position.y = bob;

    // Color shift: objects glow with background colors
    const transitionCol = palette?.[1] || new THREE.Color("#FF4500")
    materialRef.current.emissive.copy(transitionCol).multiplyScalar(energy * 0.5 * intensity + transitionProgress * 0.5)
    materialRef.current.emissiveIntensity = 1

    // Animate the base color to pick up the tint - more permanently tinted now
    const baseColor = palette?.[2] || new THREE.Color("#FF8C00")
    materialRef.current.color.lerp(baseColor.clone().lerp(transitionCol, transitionProgress * 0.4), 0.1)

    // Add a slight rotation based on energy and beat
    if (section === 'culmination') {
      groupRef.current.rotation.y += delta * (energy * 2 + beatPulse * 5);
      groupRef.current.rotation.z += delta * (energy * 1 + beatPulse * 2);
    }
  })

  const material = useMemo(() => {
    return (
      <meshPhysicalMaterial
        ref={materialRef}
        transmission={1.0}
        roughness={0.02} // Very shiny/wet look
        thickness={3} // Deep volume distortion
        ior={1.4} // Jelly-like IOR
        clearcoat={1}
        clearcoatRoughness={0}
        attenuationDistance={2} // Shorter distance for richer internal color
        attenuationColor={palette?.[1] || "#FF4500"} // Volumetric tint
        color={palette?.[2] || "#FF8C00"}
        transparent
        envMap={envMap}
        envMapIntensity={3} // Bright specular highlights
      />
    )
  }, [envMap, palette])

  return (
    <group ref={groupRef} {...props} dispose={null}>
      <Float>
        <mesh
          castShadow
          receiveShadow
          geometry={(nodes.hash as any).geometry}
          position={[-4.095, 1.891, -2.58]}
          scale={0.216}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          castShadow
          receiveShadow
          geometry={(nodes.star001 as any).geometry}
          position={[2.932, -2.747, -2.807]}
          scale={0.278}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          castShadow
          receiveShadow
          geometry={(nodes.play as any).geometry}
          position={[3.722, 0.284, -1.553]}
          scale={0.245}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          castShadow
          receiveShadow
          geometry={(nodes.points as any).geometry}
          position={[3, 2.621, -1.858]}
          scale={0.239}
        >
          {material}
        </mesh>
      </Float>
      <Float>
        <mesh
          castShadow
          receiveShadow
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

export function Physical() {
  const { nodes, materials } = useGLTF('/smileys-transformed.glb')
  const meshes = useMemo(() => Object.values(nodes).filter((node) => 'isMesh' in node), [nodes])
  return (
    <Physics gravity={[0, 0, 0]}>
      {meshes.map((mesh) => (
        <RigidShape key={mesh.uuid} mesh={mesh as THREE.Mesh} />
      ))}
      <Pointer />
    </Physics>
  )
}

function RigidShape({ mesh, vec = new THREE.Vector3() }: { mesh: THREE.Mesh; vec?: THREE.Vector3 }) {
  const api = useRef<RapierRigidBody>(null)
  useFrame((state, delta) => {
    delta = Math.min(0.1, delta)
    api.current?.applyImpulse(
      vec.copy(api.current.translation()).negate().add({ x: 0, y: 2, z: 0 }).multiplyScalar(0.2),
      false,
    )
  })
  return (
    <RigidBody
      ref={api}
      scale={0.2}
      position={[
        THREE.MathUtils.randFloatSpread(10),
        THREE.MathUtils.randFloatSpread(10),
        THREE.MathUtils.randFloatSpread(10),
      ]}
      linearDamping={4}
      angularDamping={1}
      friction={0.1}
      colliders="ball"
    >
      <mesh castShadow receiveShadow geometry={mesh.geometry} material={mesh.material} />
    </RigidBody>
  )
}

function Pointer({ vec = new THREE.Vector3() }) {
  const ref = useRef<RapierRigidBody>(null)
  useFrame(({ mouse, viewport }) => {
    ref.current?.setNextKinematicTranslation(
      vec.set((mouse.x * viewport.width) / 2, (mouse.y * viewport.height) / 2, 0),
    )
  })
  return (
    <RigidBody position={[0, 0, 0]} type="kinematicPosition" colliders={false} ref={ref}>
      <BallCollider args={[2]} />
    </RigidBody>
  )
}
