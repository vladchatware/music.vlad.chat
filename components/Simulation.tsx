import * as THREE from 'three'
import { Float, MeshTransmissionMaterial, useCursor, useFBO, useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useRef, useState } from 'react'

function LiquidGlassMaterial({
  buffer,
  highlighted = false,
}: {
  buffer: THREE.Texture;
  highlighted?: boolean;
}) {
  const materialRef = useRef<THREE.MeshPhysicalMaterial & {
    _transmission: number;
    chromaticAberration: number;
  }>(null)

  useFrame((_, delta) => {
    const material = materialRef.current
    if (!material) return

    const speed = highlighted ? 9 : 7
    material._transmission = THREE.MathUtils.damp(
      material._transmission, highlighted ? 0.94 : 1, speed, delta,
    )
    material.thickness = THREE.MathUtils.damp(
      material.thickness, highlighted ? 0.95 : 1.2, speed, delta,
    )
    material.ior = THREE.MathUtils.damp(
      material.ior, highlighted ? 1.28 : 1.33, speed, delta,
    )
    material.roughness = THREE.MathUtils.damp(
      material.roughness, highlighted ? 0.09 : 0.05, speed, delta,
    )
    material.chromaticAberration = THREE.MathUtils.damp(
      material.chromaticAberration, highlighted ? 0.022 : 0.04, speed, delta,
    )
    material.clearcoat = THREE.MathUtils.damp(
      material.clearcoat, highlighted ? 0.4 : 0.25, speed, delta,
    )
    material.clearcoatRoughness = THREE.MathUtils.damp(
      material.clearcoatRoughness, highlighted ? 0.08 : 0.05, speed, delta,
    )
  })

  return (
    <MeshTransmissionMaterial
      ref={(material) => {
        materialRef.current = material as unknown as typeof materialRef.current
      }}
      buffer={buffer}
      color="#ffffff"
      transmission={1}
      thickness={1.2}
      ior={1.33}
      roughness={0.05}
      chromaticAberration={0.04}
      clearcoat={0.25}
      clearcoatRoughness={0.05}
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
  onHashtagClick,
  onPlayClick,
  isPlaying = false,
  onLikeClick,
  isLiked = false,
  ...props
}: {
  audioEnergyRef?: React.MutableRefObject<number>;
  transitionProgress?: number;
  palette?: THREE.Color[];
  onHashtagClick?: () => void;
  onPlayClick?: () => void;
  isPlaying?: boolean;
  onLikeClick?: () => void;
  isLiked?: boolean;
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
  const [hashtagHovered, setHashtagHovered] = useState(false)
  const [playHovered, setPlayHovered] = useState(false)
  const [likeHovered, setLikeHovered] = useState(false)

  useCursor(hashtagHovered || playHovered || likeHovered, 'pointer', 'auto')

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
          onClick={onHashtagClick ? (event) => {
            event.stopPropagation()
            onHashtagClick()
          } : undefined}
          onPointerOver={onHashtagClick ? (event) => {
            event.stopPropagation()
            setHashtagHovered(true)
          } : undefined}
          onPointerOut={onHashtagClick ? () => setHashtagHovered(false) : undefined}
        >
          <LiquidGlassMaterial
            buffer={transmissionBuffer.texture}
            highlighted={hashtagHovered}
          />
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
          onClick={onPlayClick ? (event) => {
            event.stopPropagation()
            onPlayClick()
          } : undefined}
          onPointerOver={onPlayClick ? (event) => {
            event.stopPropagation()
            setPlayHovered(true)
          } : undefined}
          onPointerOut={onPlayClick ? () => setPlayHovered(false) : undefined}
        >
          <LiquidGlassMaterial
            buffer={transmissionBuffer.texture}
            highlighted={playHovered || isPlaying}
          />
        </mesh>
      </Float>
      <Float>
        <mesh
          geometry={thumbsup.geometry}
          position={[3, 2.621, -1.858]}
          scale={1.195}
          onClick={onLikeClick ? (event) => {
            event.stopPropagation()
            onLikeClick()
          } : undefined}
          onPointerOver={onLikeClick ? (event) => {
            event.stopPropagation()
            setLikeHovered(true)
          } : undefined}
          onPointerOut={onLikeClick ? () => setLikeHovered(false) : undefined}
        >
          <LiquidGlassMaterial
            buffer={transmissionBuffer.texture}
            highlighted={likeHovered || isLiked}
          />
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
