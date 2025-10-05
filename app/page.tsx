"use client"

import React, { useMemo, useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { Fullscreen, Container, Root, Text, Content, Image } from '@react-three/uikit'
import { Defaults, Button, Avatar, colors, DialogAnchor, Switch } from '@react-three/uikit-default'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@react-three/uikit-default"
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

export function CardPage() {
  const openRef = useRef(false)
  return (
    <Root flexDirection="column" pixelSize={0.01} sizeX={4.4}>
      <Defaults>
        <Container
          backgroundColor={0xffffff}
          dark={{ backgroundColor: 0x0 }}
          borderRadius={20}
          cursor="pointer"
          flexDirection="column"
          zIndex={10}
        >
          <Content transformTranslateZ={1} padding={14} keepAspectRatio={false} width="100%" height={400}>
            <Text>Test</Text>
          </Content>
          <Container
            backgroundColor={0xffffff}
            dark={{ backgroundColor: 0x0 }}
            flexDirection="row"
            padding={28}
            paddingTop={28 + 4}
            alignItems="center"
            justifyContent="space-between"
            borderBottomRadius={20}
            castShadow
          >
            <Container flexDirection="column" gap={8}>
              <Text fontWeight="normal" fontSize={24} lineHeight="100%">
                VanArsdel Marketing
              </Text>
              <Text fontSize={20} fontWeight="medium" letterSpacing={-0.4} color={colors.primary}>
                1 activities for you
              </Text>
            </Container>
          </Container>
        </Container>
      </Defaults>
    </Root >
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

  return <div style={{ position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, width: '100%', height: '100%' }}><Canvas
    camera={{ position: [0, 0, 18], fov: 32.5 }}
    style={{ position: "absolute", inset: "0", touchAction: "none", backgroundColor: 'black' }}
    gl={{ localClippingEnabled: true }}>
    <ambientLight intensity={Math.PI} />
    <spotLight decay={0} position={[0, 5, 10]} angle={0.25} penumbra={1} intensity={2} castShadow />
    <Defaults>
      <Fullscreen
        overflow="scroll"
        scrollbarColor="black"
        flexDirection="column"
        gap={32}
        paddingX={32}
        alignItems="center"
        justifyContent="center"
        padding={32}
      >

        <Card width={300} backgroundColor="rgb(4, 16, 22)">
          <CardContent gap={16} paddingTop={16}>
            <Image src="cover.jpeg" height={600} />
          </CardContent>
          <CardHeader>
            <CardTitle>
              <Text color="white" fontWeight="bold">HAHA (PROD. WENDIGO)</Text>
            </CardTitle>
            <CardDescription>
              <Text color="rgb(192, 192, 197)">Lil Darkie</Text>
            </CardDescription>
          </CardHeader>
        </Card>
        <Container flexDirection="column" alignItems="center" gap={16}>
          <Container>
            <Text color="white">Hello, I am a virtual DJ, let me play some music.</Text>
          </Container>
          <Container gap={16}>
            <Button
              onClick={() => {
                console.log(window!.start_sequence())
              }}>
              <Text>Revibe</Text>
            </Button>
          </Container>
        </Container>
      </Fullscreen>
      <Floating position={[0, 0, 7]} />
      <Environment preset="city" />
    </Defaults>
  </Canvas>
    <div style={{
      position: 'absolute',
      top: 0,
      bottom: 0,
      left: 0,
      right: 0,
      visibility: "hidden"
    }}>
      <audio
        id="control"
        autoPlay={false}
        muted={false}
        controls
        playsInline={false}
        style={{
          position: 'relative',
          top: '80vh',
          bottom: 0,
          left: '25%',
          width: '50%',
          visibility: "hidden"
        }} />
    </div>
    <div style={{ position: 'absolute', top: '-27%', bottom: 0, left: 0, right: 0, width: 250, height: 250, margin: 'auto' }}>
      <iframe
        frameBorder="none"
        height={250}
        width={250}
        id="sc-widget"
        src={`https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/1431680770&color=%23ff5500&auto_play=true&hide_related=true&show_comments=false&show_user=false&show_reposts=false&visual=true`}></iframe>
    </div>
    <script src="https://w.soundcloud.com/player/api.js" type="text/javascript"></script>
    <script src="/script.js" type="module"></script>
  </div>
}
