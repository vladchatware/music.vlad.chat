import * as THREE from 'three'
import { Instance, Instances } from '@react-three/drei'
import { useMemo } from 'react'

interface GridProps {
  size?: number
  cellSize?: number
  sectionSize?: number
  cellColor?: string
  sectionColor?: string
  cellThickness?: number
  sectionThickness?: number
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
  ...props 
}: GridProps) {
  
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

  return (
    <group {...props}>
      {/* Minor Grid */}
      <Instances receiveShadow limit={10000} range={minor.length}>
        <boxGeometry />
        <meshStandardMaterial color={cellColor} roughness={0.5} metalness={0.5} />
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
        <meshStandardMaterial color={sectionColor} roughness={0.5} metalness={0.5} />
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
