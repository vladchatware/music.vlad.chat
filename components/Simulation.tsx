import * as THREE from 'three'
import { Float, MeshTransmissionMaterial, useFBO, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

const clownPalette = {
  nose: '#ff1744',
  cheek: '#ff6f91',
  hat: '#f9d423',
  hatBand: '#ff4e50',
  bowTie: '#00c2ff',
  pomPom: '#ffffff',
  shoe: '#ff1744',
}

function LiquidGlassMaterial({ buffer }: { buffer: THREE.Texture }) {
  return (
    <MeshTransmissionMaterial
      buffer={buffer}
      transmission={1}
      thickness={1.2}
      ior={1.33}
      roughness={0.05}
      chromaticAberration={0.04}
      samples={6}
    />
  )
}

/**
 * Each Float animates independently for organic, natural floating motion.
 * Geometry comes from the individually exported GLB assets.
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
  const { nodes: hashtagNodes } = useGLTF('/hashtag.glb')
  const { nodes: starNodes } = useGLTF('/star.glb')
  const { nodes: playNodes } = useGLTF('/play.glb')
  const { nodes: thumbsupNodes } = useGLTF('/thumbsup.glb')
  const { nodes: commentNodes } = useGLTF('/comment.glb')

  const hashtag = hashtagNodes.Hashtag as THREE.Mesh
  const star = starNodes.Star as THREE.Mesh
  const play = playNodes.Play as THREE.Mesh
  const thumbsup = thumbsupNodes.Thumbsup as THREE.Mesh
  const comment = commentNodes.Comment as THREE.Mesh
  const glassGroup = useRef<THREE.Group>(null)
  const clownGroup = useRef<THREE.Group>(null)
  const transmissionBuffer = useFBO(512, 512)

  useFrame(({ gl, scene, camera, clock }) => {
    const group = glassGroup.current
    if (!group) return

    const clown = clownGroup.current
    if (clown) {
      const energy = audioEnergyRef?.current ?? 0
      const bounce = Math.sin(clock.elapsedTime * 8) * (0.08 + energy * 0.18)
      clown.position.y = bounce
      clown.rotation.z = Math.sin(clock.elapsedTime * 5) * (0.12 + energy * 0.18)
      clown.scale.setScalar(1 + energy * 0.08)
    }

    const previousTarget = gl.getRenderTarget()
    const previousToneMapping = gl.toneMapping
    const wasVisible = group.visible

    group.visible = false
    gl.toneMapping = THREE.NoToneMapping
    gl.setRenderTarget(transmissionBuffer)
    gl.render(scene, camera)
    gl.setRenderTarget(previousTarget)
    gl.toneMapping = previousToneMapping
    group.visible = wasVisible
  })

  return (
    <group ref={glassGroup} {...props} dispose={null}>
      <Float speed={2.8} rotationIntensity={0.55} floatIntensity={0.75}>
        <group ref={clownGroup} position={[0, 0.25, -1.15]} scale={0.9}>
          <mesh position={[0, 0.2, 0]} scale={[0.95, 0.95, 0.32]}>
            <sphereGeometry args={[1, 32, 32]} />
            <LiquidGlassMaterial buffer={transmissionBuffer.texture} />
          </mesh>
          <mesh position={[0, 0.22, 0.34]}>
            <sphereGeometry args={[0.23, 24, 24]} />
            <meshStandardMaterial color={clownPalette.nose} emissive={clownPalette.nose} emissiveIntensity={0.45} roughness={0.35} />
          </mesh>
          <mesh position={[-0.43, 0.2, 0.35]} scale={[1, 0.72, 0.4]}>
            <sphereGeometry args={[0.18, 18, 18]} />
            <meshStandardMaterial color={clownPalette.cheek} emissive={clownPalette.cheek} emissiveIntensity={0.25} transparent opacity={0.8} />
          </mesh>
          <mesh position={[0.43, 0.2, 0.35]} scale={[1, 0.72, 0.4]}>
            <sphereGeometry args={[0.18, 18, 18]} />
            <meshStandardMaterial color={clownPalette.cheek} emissive={clownPalette.cheek} emissiveIntensity={0.25} transparent opacity={0.8} />
          </mesh>
          <mesh position={[-0.28, 0.53, 0.36]}>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshStandardMaterial color="black" roughness={0.2} />
          </mesh>
          <mesh position={[0.28, 0.53, 0.36]}>
            <sphereGeometry args={[0.07, 16, 16]} />
            <meshStandardMaterial color="black" roughness={0.2} />
          </mesh>
          <mesh position={[0, 1.05, 0]} rotation={[0, 0, -0.12]}>
            <coneGeometry args={[0.42, 0.95, 32]} />
            <meshStandardMaterial color={clownPalette.hat} emissive={clownPalette.hat} emissiveIntensity={0.2} roughness={0.45} />
          </mesh>
          <mesh position={[0, 0.68, 0]} rotation={[Math.PI / 2, 0, -0.12]}>
            <torusGeometry args={[0.42, 0.055, 12, 32]} />
            <meshStandardMaterial color={clownPalette.hatBand} emissive={clownPalette.hatBand} emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0.08, 1.54, 0]}>
            <sphereGeometry args={[0.13, 16, 16]} />
            <meshStandardMaterial color={clownPalette.pomPom} emissive={clownPalette.pomPom} emissiveIntensity={0.5} />
          </mesh>
          <mesh position={[-0.22, -0.85, 0.15]} rotation={[0, 0, 0.75]} scale={[1.25, 0.8, 0.35]}>
            <sphereGeometry args={[0.25, 16, 16]} />
            <meshStandardMaterial color={clownPalette.bowTie} emissive={clownPalette.bowTie} emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0.22, -0.85, 0.15]} rotation={[0, 0, -0.75]} scale={[1.25, 0.8, 0.35]}>
            <sphereGeometry args={[0.25, 16, 16]} />
            <meshStandardMaterial color={clownPalette.bowTie} emissive={clownPalette.bowTie} emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[-0.52, -1.05, 0.05]} rotation={[0, 0, -0.2]} scale={[1.55, 0.65, 0.45]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial color={clownPalette.shoe} emissive={clownPalette.shoe} emissiveIntensity={0.35} />
          </mesh>
          <mesh position={[0.52, -1.05, 0.05]} rotation={[0, 0, 0.2]} scale={[1.55, 0.65, 0.45]}>
            <sphereGeometry args={[0.22, 16, 16]} />
            <meshStandardMaterial color={clownPalette.shoe} emissive={clownPalette.shoe} emissiveIntensity={0.35} />
          </mesh>
        </group>
      </Float>
      <Float>
        <mesh
          geometry={hashtag.geometry}
          position={[-4.095, 1.891, -2.58]}
          scale={1.08}
        >
          <LiquidGlassMaterial buffer={transmissionBuffer.texture} />
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={star.geometry}
          position={[2.932, -2.747, -2.807]}
          scale={1.39}
        >
          <LiquidGlassMaterial buffer={transmissionBuffer.texture} />
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={play.geometry}
          position={[3.722, 0.284, -1.553]}
          rotation={[0, -Math.PI / 2, 0]}
          scale={1.225}
        >
          <LiquidGlassMaterial buffer={transmissionBuffer.texture} />
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={thumbsup.geometry}
          position={[3, 2.621, -1.858]}
          scale={1.195}
        >
          <LiquidGlassMaterial buffer={transmissionBuffer.texture} />
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={comment.geometry}
          position={[-3.275, -1, -3.389]}
          scale={1.585}
        >
          <LiquidGlassMaterial buffer={transmissionBuffer.texture} />
        </mesh>
      </Float>
    </group>
  )
}
