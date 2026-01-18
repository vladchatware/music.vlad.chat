import { useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { shaderMaterial } from '@react-three/drei'
import * as THREE from 'three'
import { extend, type ThreeElement } from '@react-three/fiber'

const GrainMaterial = shaderMaterial(
    {
        uTime: 0,
        uOpacity: 0.15, // Increased visibility
    },
    // Vertex Shader
    `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    // Standard full-screen quad position
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
  `,
    // Fragment Shader
    `
  uniform float uTime;
  uniform float uOpacity;
  varying vec2 vUv;

  float hash(vec2 p) {
    return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);
  }

  void main() {
    // Faster noise generation
    float n = hash(vUv + fract(uTime));
    
    // We use a flickering grain that feels more like real film
    // It subtly darkens and lightens pixels
    float grain = (n - 0.5) * uOpacity;
    gl_FragColor = vec4(vec3(0.0), grain); // Using alpha blending instead of additive
  }
  `
)

declare module "@react-three/fiber" {
    interface ThreeElements {
        grainMaterial: ThreeElement<typeof GrainMaterial>;
    }
}

extend({ GrainMaterial })

export function ScreenGrain() {
    const materialRef = useRef<any>(null)

    useFrame((state) => {
        if (materialRef.current) {
            materialRef.current.uTime = state.clock.getElapsedTime()
        }
    })

    return (
        <mesh renderOrder={9999} frustumCulled={false}>
            <planeGeometry args={[2, 2]} />
            <grainMaterial
                ref={materialRef}
                transparent
                depthWrite={false}
                depthTest={false}
                blending={THREE.NormalBlending} // More visible over color
            />
        </mesh>
    )
}
