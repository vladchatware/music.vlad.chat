"use client"

import React, { useEffect, useRef, useState } from 'react'
import { Canvas, ThreeEvent, useFrame } from '@react-three/fiber'
import { Fullscreen, Container, Text, Image, VideoInternals } from '@react-three/uikit'
import { Defaults, Button, Video } from '@react-three/uikit-default'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@react-three/uikit-default"
import { Environment } from '@react-three/drei'
import { useChat } from '@ai-sdk/react';
import { useAuthActions } from "@convex-dev/auth/react"
import { Floating } from '../components/Simulation'
import { fetchTrack, streamTrack } from '../lib/soundcloud'
import { z } from 'zod'
import { id } from 'zod/v4/locales'


export default function Page() {
  const { signIn, signOut } = useAuthActions()
  const videoRef = useRef<VideoInternals>(null)
  const [track, setTrack] = useState(null)
  const [loading, setLoading] = useState(true)

  const { messages, sendMessage, status, error, regenerate, addToolResult } = useChat({
    onError: error => {
      console.log('error caught', error)
    },
    onToolCall: async (ctx) => {
      console.log('tool call', ctx)
      if (ctx.toolCall.toolName === 'player') {
        setLoading(true)
        const track = await fetchTrack((ctx.toolCall.input as { id: number }).id)
        setTrack(track)
        setLoading(false)
        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: `Playing ${(ctx.toolCall.input as { id: number }).id}`
        })
      }
    }
  });

  useEffect(() => {
    const main = async () => {
      onFetchTrack()

      // videoRef.current?.element.onended = (e) => console.log('ended', e)
      setLoading(false)
    }

    main()
  }, [])

  const onFetchTrack = async () => {
    setLoading(true)
    const track = await fetchTrack(2079734469)
    setTrack(track)
    setLoading(false)
  }


  const onRevibe = async (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (status === 'streaming') return
    sendMessage({ role: 'user', text: 'Play some angel core genre' })
  }

  const onSignIn = async () => {
    signIn('soundcloud')
  }

  return <Canvas
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
        <Card width={360} backgroundColor="rgb(4, 16, 22)">
          <CardContent gap={16} paddingTop={24}>
            <Video src={streamTrack(track?.id)} autoplay={true} ref={videoRef}>
              <Image src={track?.artwork_url} width={340} />
            </Video>
          </CardContent>
          <CardHeader>
            <CardTitle>
              <Text color="white" fontWeight="bold">{track?.title}</Text>
            </CardTitle>
            <CardDescription>
              <Text color="rgb(192, 192, 197)">{track?.user?.username || track?.user?.full_name}</Text>
            </CardDescription>
          </CardHeader>
        </Card>
        <Container flexDirection="column" alignItems="center" gap={16}>
          <Container>
            <Text color="white">Hello, I am a virtual DJ, let me play some music.</Text>
          </Container>
          <Container gap={16}>
            <Button onClick={onRevibe}>
              <Text>Revibe</Text>
            </Button>
            {/* <Button onClick={onSignIn}> */}
            {/*   <Text>Sign In</Text> */}
            {/* </Button> */}
          </Container>
          {/* <Container flexDirection="column"> */}
          {/*   {messages.map(message => <Text>{message.parts[0].text}</Text>)} */}
          {/* </Container> */}
        </Container>
      </Fullscreen>
      <Floating position={[0, 0, 7]} />
      <Environment preset="city" />
    </Defaults>
  </Canvas >
}
