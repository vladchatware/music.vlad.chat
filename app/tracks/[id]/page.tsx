"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent, useFrame } from '@react-three/fiber'
import { Fullscreen, Container, Text, Image, VideoInternals } from '@react-three/uikit'
import { Defaults, Button, Video } from '@react-three/uikit-default'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@react-three/uikit-default"
import { Environment } from '@react-three/drei'
import { useChat } from '@ai-sdk/react';
import { Floating } from '@/components/Simulation'
import { fetchTrack, streamTrack } from '@/lib/soundcloud'
import { z } from 'zod'
import BaseDiffusedRing from '@/components/Ring/base'
import { CoordinateMapper_Waveform } from '@/lib/mappers/coordinateMappers/waveform'
import { CoordinateMapper_Data } from '@/lib/mappers/coordinateMappers/data'
import FFTAnalyzer from '@/lib/analyzers/ftt'
import { useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { useParams } from 'next/navigation'


export default function Page() {
  const { id } = useParams()
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

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const analyzerRef = useRef<FFTAnalyzer | null>(null);
  const rafRef = useRef<number | null>(null);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(true);

  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "anonymous";
    audioRef.current = audio;

    const analyzer = new FFTAnalyzer(audio);
    analyzerRef.current = analyzer;

    return () => {
      analyzer.toggleAnalyzer(false);
      analyzer.disconnectInputs();
      try {
        audio.pause();
      } catch { }
      audioRef.current = null;
      analyzerRef.current = null;
    };
  }, []);


  useEffect(() => {
    if (!analyzerRef.current) return;

    const analyzer = analyzerRef.current;

    const tick = () => {
      const bars = analyzer.getBars();
      // Resize mapper if analyzer config changes
      if (coordinateMapper.data.length !== bars.length) {
        // Update mapper size by recreating instance with same amplitude
        const amplitude = coordinateMapper.amplitude;
        const next = new CoordinateMapper_Data({ amplitude, size: bars.length });
        // Copy reference: mutate the existing instance fields
        (coordinateMapper as any)._params = next.params;
        (coordinateMapper as any).data = next.data;
      }
      for (let i = 0; i < bars.length; i++) {
        coordinateMapper.data[i] = bars[i].value;
      }
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [coordinateMapper]);

  const togglePlay = useCallback(async () => {
    console.log('toggle play', audioRef.current, isLoaded)
    if (!audioRef.current) return;
    if (!isLoaded) return;

    try {
      // Resume audio context if suspended (required for some browsers)
      if (analyzerRef.current?._audioCtx?.state === 'suspended') {
        await analyzerRef.current._audioCtx.resume();
      }

      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        await audioRef.current.play();
        audioRef.current.addEventListener('playing', () => window.obsstudio?.startRecording())
        audioRef.current.addEventListener('ended', () => window.obsstudio?.stopRecording())
        setIsPlaying(true);
        setNeedsUserInteraction(false); // User has interacted, no longer needed
      }
    } catch (err) {
      console.error("Playback error:", err);
      // If autoplay fails, show a message to user
      if (err.name === 'NotAllowedError') {
        alert('Please click the play button to start audio playback');
      }
    }
  }, [isLoaded, isPlaying]);

  useEffect(() => {
    console.log('init')
    const main = async () => {
      onFetchTrack()
      setLoading(false)
    }

    main()
  }, [])

  const onFetchTrack = async () => {
    if (!audioRef.current) {
      setIsLoaded(false);
      return;
    }
    setLoading(true)
    setIsLoaded(false)
    const _track = await fetchTrack(id)
    audioRef.current.pause();
    audioRef.current.src = streamTrack(_track.id);
    setIsLoaded(true);
    // setIsPlaying(true);
    console.log(_track)
    setTrack(_track)
    setLoading(false)
    setIsLoaded(true)
  }

  const onRevibe = async (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    return togglePlay()
    // if (status === 'streaming') return
    // sendMessage({ role: 'user', text: 'Play some angel core genre' })
  }

  const onSignIn = async () => {
    // signIn('soundcloud')
  }

  return <><Canvas
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
        <Card width={460} backgroundColor="rgb(4, 16, 22)">
          <CardContent gap={16} paddingTop={24}>
            <Image src={track?.artwork_url} width={440} />
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
          <Container flexDirection="column">
            {messages.map((message, i) => {
              return message.parts.map(part => {
                if (part.type === 'text') return <Text key={i}>{part.text}</Text>
              })
            })}
          </Container>
        </Container>
      </Fullscreen>
      <BaseDiffusedRing
        coordinateMapper={coordinateMapper}
        radius={2.8}
        nPoints={10000}
        pointSize={0.1}
        mirrorEffects={true}
      />
      <Floating position={[0, 0, 7]} />
      <Environment preset="city" />
    </Defaults>
  </Canvas></>
}
