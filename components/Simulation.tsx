import * as THREE from 'three'
import { Float, MeshTransmissionMaterial, useFBO, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef } from 'react'

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
  const transmissionBuffer = useFBO(512, 512)

  useFrame(({ gl, scene, camera }) => {
    const group = glassGroup.current
    if (!group) return

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
