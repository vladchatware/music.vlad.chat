import * as THREE from 'three'
import { useGLTF, Float, MeshTransmissionMaterial } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'

/**
 * FUSED LIQUID GEOMETRY
 * Optimized to match the background orange fluid.
 * - Heavy distortion (0.8) for liquid magnification.
 * - Short attenuation (0.5) to 'trap' the background orange inside the drop.
 * - Water IOR (1.33) for soft, natural refraction.
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
  const groupRef = useRef<THREE.Group>(null)

  const smoothedEnergyRef = useRef(0)

  const config = useMemo(() => ({
    meshPhysicalMaterial: false,
    transmissionSampler: true,
    backside: true,
    samples: 6,
    resolution: 256,
    transmission: 1.0,
    roughness: 0.0,
    thickness: 2.5, // Solid water-drop thickness
    ior: 1.33, // Scientific Water IOR: soft edges, no white glare
    chromaticAberration: 0.05,
    anisotropy: 0.1,
    distortion: 0.8, // AGGRESSIVE distortion to swirl the background color inside
    distortionScale: 0.3,
    temporalDistortion: 0.05,
    clearcoat: 1.0,
    clearcoatRoughness: 0.0,
    attenuationDistance: 0.5, // Traps the orange color inside the drop
    color: new THREE.Color("#ffffff"),
  }), [])

  useFrame((state, delta) => {
    if (!groupRef.current) return

    const energy = audioEnergyRef?.current ?? 0
    smoothedEnergyRef.current = THREE.MathUtils.lerp(smoothedEnergyRef.current, energy, 0.1)
    const sEnergy = smoothedEnergyRef.current

    // Audio-Reactive Scaling Pulse
    const s = 1 + sEnergy * 0.15
    groupRef.current.scale.set(s, s, s)

    // Smooth group floating drift
    groupRef.current.position.y = Math.sin(state.clock.elapsedTime * 0.5) * 0.2
  })

  // Match the inner volume color to the track's dominant (orange) color
  const volumeColor = palette?.[0] || new THREE.Color("orange")

  return (
    <group ref={groupRef} {...props} dispose={null}>
      <Float speed={1.5} rotationIntensity={1} floatIntensity={1}>
        <mesh renderOrder={100} castShadow receiveShadow geometry={(nodes.hash as any).geometry} position={[-4.095, 1.891, -2.58]} scale={0.25}>
          <MeshTransmissionMaterial {...config} attenuationColor={volumeColor} />
        </mesh>
      </Float>
      <Float speed={2.2} rotationIntensity={1} floatIntensity={1.5}>
        <mesh renderOrder={100} castShadow receiveShadow geometry={(nodes.star001 as any).geometry} position={[2.932, -2.747, -2.807]} scale={0.32}>
          <MeshTransmissionMaterial {...config} attenuationColor={palette?.[1] || volumeColor} />
        </mesh>
      </Float>
      <Float speed={1.8} rotationIntensity={2} floatIntensity={1}>
        <mesh renderOrder={100} castShadow receiveShadow geometry={(nodes.play as any).geometry} position={[3.722, 0.284, -1.553]} scale={0.28}>
          <MeshTransmissionMaterial {...config} attenuationColor={palette?.[2] || volumeColor} />
        </mesh>
      </Float>
      <Float speed={2.5} rotationIntensity={1} floatIntensity={2}>
        <mesh renderOrder={100} castShadow receiveShadow geometry={(nodes.points as any).geometry} position={[3, 2.621, -1.858]} scale={0.239}>
          <MeshTransmissionMaterial {...config} attenuationColor={volumeColor} />
        </mesh>
      </Float>
      <Float speed={2} rotationIntensity={1} floatIntensity={1}>
        <mesh renderOrder={100} castShadow receiveShadow geometry={(nodes.Ellipse as any).geometry} position={[-3.275, -1, -3.389]} scale={0.35}>
          <MeshTransmissionMaterial {...config} attenuationColor={volumeColor} />
        </mesh>
      </Float>
    </group>
  )
}
