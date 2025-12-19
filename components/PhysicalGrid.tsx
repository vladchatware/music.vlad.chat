import * as THREE from 'three'
import { Instance, Instances } from '@react-three/drei'
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'

interface GridProps {
  size?: number
  cellSize?: number
  sectionSize?: number
  cellColor?: string
  sectionColor?: string
  cellThickness?: number
  sectionThickness?: number
  audioEnergyRef?: React.MutableRefObject<number>
  transitionProgress?: number
  palette?: THREE.Color[]
  [key: string]: any
}

export function PhysicalGrid({
  size = 100,
  cellSize = 0.6,
  sectionSize = 3.3,
  cellColor = "#5c6875",
  sectionColor = "#85909b",
  cellThickness = 0.015,
  sectionThickness = 0.03,
  audioEnergyRef,
  transitionProgress = 0,
  palette,
  ...props
}: GridProps) {
  const groupRef = useRef<THREE.Group>(null)

  const { minor, major } = useMemo(() => {
    const minorLines = []
    const majorLines = []
    const half = size / 2

    // Generate Minor Lines (Cells)
    const numCells = Math.floor(half / cellSize)
    for (let i = -numCells; i <= numCells; i++) {
      const pos = i * cellSize
      minorLines.push({
        position: [pos, 0, 0],
        rotation: [0, 0, 0],
        scale: [cellThickness, size, cellThickness]
      })
      minorLines.push({
        position: [0, pos, 0],
        rotation: [0, 0, Math.PI / 2],
        scale: [cellThickness, size, cellThickness]
      })
    }

    // Generate Major Lines (Sections)
    const numSections = Math.floor(half / sectionSize)
    for (let i = -numSections; i <= numSections; i++) {
      const pos = i * sectionSize
      majorLines.push({
        position: [pos, 0, 0],
        rotation: [0, 0, 0],
        scale: [sectionThickness, size, sectionThickness]
      })
      majorLines.push({
        position: [0, pos, 0],
        rotation: [0, 0, Math.PI / 2],
        scale: [sectionThickness, size, sectionThickness]
      })
    }

    return { minor: minorLines, major: majorLines }
  }, [size, cellSize, sectionSize, cellThickness, sectionThickness])

  const minorMaterialRef = useRef<THREE.MeshStandardMaterial>(null)
  const majorMaterialRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame((state) => {
    if (!minorMaterialRef.current || !majorMaterialRef.current || !groupRef.current) return

    const energy = audioEnergyRef?.current ?? 0
    const time = state.clock.getElapsedTime()

    // Subtle movement to indicate flow/movement
    // Moves slightly opposite to the background flow to create depth
    const flowX = Math.sin(time * 0.2) * 0.1 * (1 + energy)
    const flowY = Math.cos(time * 0.15) * 0.1 * (1 + energy)
    groupRef.current.position.x = flowX
    groupRef.current.position.y = flowY

    // Color reaction: grid picks up background colors during high energy or transitions
    const baseCellColor = new THREE.Color(cellColor)
    const baseSectionColor = new THREE.Color(sectionColor)

    // Use palette colors if available, otherwise fallback to orange
    const transitionCol = palette?.[1] || new THREE.Color("#FF4500")
    const accentCol = palette?.[2] || new THREE.Color("#FF8C00")

    const targetCellColor = baseCellColor.clone().lerp(transitionCol, transitionProgress * 0.5 + energy * 0.2)
    const targetSectionColor = baseSectionColor.clone().lerp(accentCol, transitionProgress * 0.8 + energy * 0.3)

    minorMaterialRef.current.color.lerp(targetCellColor, 0.1)
    majorMaterialRef.current.color.lerp(targetSectionColor, 0.1)

    // Pulse emissive for a direct "vibe" indicator
    minorMaterialRef.current.emissive.copy(transitionCol).multiplyScalar(energy * 0.2 + transitionProgress * 0.3)
    majorMaterialRef.current.emissive.copy(accentCol).multiplyScalar(energy * 0.4 + transitionProgress * 0.5)
  })

  return (
    <group ref={groupRef} {...props}>
      {/* Minor Grid */}
      <Instances receiveShadow limit={10000} range={minor.length}>
        <boxGeometry />
        <meshStandardMaterial
          ref={minorMaterialRef}
          color={cellColor}
          roughness={0.4}
          metalness={0.6}
          emissiveIntensity={1}
        />
        {minor.map((data, i) => (
          <Instance
            key={`minor-${i}`}
            position={data.position as any}
            rotation={data.rotation as any}
            scale={data.scale as any}
          />
        ))}
      </Instances>

      {/* Major Grid */}
      <Instances receiveShadow limit={2000} range={major.length}>
        <boxGeometry />
        <meshStandardMaterial
          ref={majorMaterialRef}
          color={sectionColor}
          roughness={0.3}
          metalness={0.8}
          emissiveIntensity={1}
        />
        {major.map((data, i) => (
          <Instance
            key={`major-${i}`}
            position={data.position as any}
            rotation={data.rotation as any}
            scale={data.scale as any}
          />
        ))}
      </Instances>
    </group>
  )
}

