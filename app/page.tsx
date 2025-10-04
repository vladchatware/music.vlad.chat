"use client"

import React, { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Fullscreen, Container, Root, Text } from '@react-three/uikit'
import { Defaults, Button } from '@react-three/uikit-default'
import { OrbitControls, Environment, Html, Float, ContactShadows } from '@react-three/drei'
import { easing, geometry } from 'maath'
import { Floating } from '../components/Simulation'

function Striplight(props) {
  return (
    <mesh {...props}>
      <boxGeometry />
      <meshBasicMaterial color="white" />
    </mesh>
  )
}

const Rig = () => {
  useFrame((state, delta) => {
    easing.damp3(state.camera.position, [state.pointer.x * 2, state.pointer.y * 2, 18], 0.35, delta)
    state.camera.lookAt(0, 0, -10)
  })

  return null
}

export default function Page() {
  const audioRef = useRef(null)
  const onTimeUpdate = () => {

  }
  const onLoadedMetadata = () => {

  }

  return <Canvas
    camera={{ position: [0, 0, 18], fov: 32.5 }}
    style={{ height: '100vh', touchAction: 'none' }}
    gl={{ localClippingEnabled: true }}
  >
    <Defaults>
      <ambientLight intensity={Math.PI} />
      <spotLight decay={0} position={[0, 5, 10]} angle={0.25} penumbra={1} intensity={2} castShadow />
      <Fullscreen flexDirection="row" padding={10} gap={10}>
        <Root backgroundColor="red" sizeX={8} sizeY={8}>
          <OrbitControls />
          <Html>
            <div style={{ background: 'white', padding: '10px', borderRadius: '5px' }}>
              <div id="card">
                <div id="inner-card">
                  <header>
                    <div>
                      <span id="icon">
                        🧬
                      </span>
                      <span id="username">music.vlad.chat</span>
                    </div>
                  </header>
                  <div id="remix-indicator">
                    <p>Hello, I am a virtual DJ, let me play some music.</p>
                  </div>
                  <button id="revibe">Revibe 💿</button>
                  <div>
                    <button id="connect">
                      <img id="connect-image" src="https://connect.soundcloud.com/2/btn-connect-s.png" />
                    </button>
                  </div>
                </div>
              </div>
              <audio id="control" autoPlay={false} muted={false} controls playsInline={false}></audio>
              <button id="speech" className="speech">🎙️</button>
              <audio
                ref={audioRef}
                onTimeUpdate={onTimeUpdate}
                onLoadedMetadata={onLoadedMetadata} />
            </div>
          </Html>
        </Root>
      </Fullscreen>
      <Floating position={[0, 0, 7]} />
      <Environment preset="city">
        <Striplight position={[10, 2, 0]} scale={[1, 3, 10]} />
        <Striplight position={[-10, 2, 0]} scale={[1, 3, 10]} />
      </Environment>
      <Rig />
    </Defaults>
  </Canvas >
}
