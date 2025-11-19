"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent } from '@react-three/fiber'
import { Fullscreen, Container, Text, Image } from '@react-three/uikit'
import { Defaults, Button } from '@react-three/uikit-default'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@react-three/uikit-default"
import { Environment } from '@react-three/drei'
import { UIMessage, useChat } from '@ai-sdk/react';
import { useAuthActions } from "@convex-dev/auth/react"
import { Floating } from './Simulation'
import { fetchTrack, streamTrack } from '../lib/soundcloud'
import BaseDiffusedRing from '@/components/Ring/base'
import { CoordinateMapper_Data } from '@/lib/mappers/coordinateMappers/data'
import FFTAnalyzer from '@/lib/analyzers/ftt'
import { Authenticated, useQuery } from 'convex/react'
import { api } from '@/convex/_generated/api'
import { Rig } from '@/components/Rig'
import BackgroundImageCover from '@/components/BackgroundImage'

export default function MusicPlayer({ initialTrackId }: { initialTrackId: string | number }) {
  const user = useQuery(api.users.viewer)
  const isAuthenticated = useQuery(api.auth.isAuthenticated)
  const { signIn, signOut } = useAuthActions()
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
        if (isPlaying) {
          await togglePlay()
        }
        setTrack(track)
        audioRef.current.addEventListener('loadeddata', e => {
          console.log('loaded')
          setIsLoaded(true)
          setLoading(false)
          togglePlay()
        })
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
  const audioEnergyRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const playingHandlerRef = useRef<(() => void) | null>(null);
  const endedHandlerRef = useRef<((e: Event) => Promise<void>) | null>(null);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(true);

  const buttonLabel = needsUserInteraction ? 'Play' : 'Revibe'

  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return;

    audio.crossOrigin = "anonymous";

    // Create handlers and store in refs
    const handlePlaying = () => {
      setNeedsUserInteraction(false)
      // @ts-ignore OBS
      window.obsstudio?.startRecording()
    }
    const handleEnded = async (e: Event) => {
      // @ts-ignore OBS
      window.obsstudio?.stopRecording()
    }

    playingHandlerRef.current = handlePlaying;
    endedHandlerRef.current = handleEnded;

    audio.addEventListener('playing', handlePlaying)
    audio.addEventListener('ended', handleEnded)

    const analyzer = new FFTAnalyzer(audio);
    analyzerRef.current = analyzer;

    return () => {
      if (playingHandlerRef.current) {
        audio.removeEventListener('playing', playingHandlerRef.current);
      }
      if (endedHandlerRef.current) {
        audio.removeEventListener('ended', endedHandlerRef.current);
      }
      analyzer.toggleAnalyzer(false);
      analyzer.disconnectInputs();
      try {
        audio.pause();
      } catch { }
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

      audioEnergyRef.current = analyzer.getEnergy();
      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [coordinateMapper]);

  const togglePlay = useCallback(async () => {
    console.log('toggle play', audioRef.current, isLoaded)
    if (!audioRef.current.src) return
    if (!audioRef.current) return;

    try {
      // Resume audio context if suspended (required for some browsers)
      if (analyzerRef.current?._audioCtx?.state === 'suspended') {
        await analyzerRef.current._audioCtx.resume();
      }

      if (isPlaying) {
        audioRef.current.pause();
        setIsPlaying(false);
      } else {
        // Ensure OBS recording listeners are attached before playing
        // Re-attach listeners in case they were removed or audio source changed
        if (playingHandlerRef.current && endedHandlerRef.current) {
          audioRef.current.removeEventListener('playing', playingHandlerRef.current);
          audioRef.current.removeEventListener('ended', endedHandlerRef.current);
        }

        const handlePlaying = () => {
          setNeedsUserInteraction(false)
          // @ts-ignore OBS
          window.obsstudio?.startRecording()
        }
        const handleEnded = async (e: Event) => {
          await onRevibe(e)
          // @ts-ignore OBS
          window.obsstudio?.stopRecording()
        }

        playingHandlerRef.current = handlePlaying;
        endedHandlerRef.current = handleEnded;

        audioRef.current.addEventListener('playing', handlePlaying)
        audioRef.current.addEventListener('ended', handleEnded)

        await audioRef.current.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Playback error:", err);
      // If autoplay fails, show a message to user
      if (err.name === 'NotAllowedError') {
        alert('Please click the play button to start audio playback');
      }
    }
  }, [isPlaying]);

  const onFetchTrack = useCallback(async () => {
    if (!audioRef.current) {
      setIsLoaded(false);
      return;
    }
    setLoading(true)
    setIsLoaded(false)

    const _track = await fetchTrack(initialTrackId)
    audioRef.current.pause();
    setIsLoaded(true);
    setTrack(_track)
    setLoading(false)
    setIsLoaded(true)
  }, [initialTrackId])

  useEffect(() => {
    // Wait for authentication
    if (!isAuthenticated) return

    console.log('init', isAuthenticated, initialTrackId)
    const main = async () => {
      await onFetchTrack()
      setLoading(false)
    }

    main()
  }, [isAuthenticated, initialTrackId, onFetchTrack])

  const onRevibe = async (e: Event | ThreeEvent<MouseEvent>) => {
    e.stopPropagation()

    if (!isAuthenticated) await signIn('anonymous')

    if (status === 'streaming') return

    if (needsUserInteraction) {
      return togglePlay()
    }

    sendMessage({ role: 'user', text: 'Play some angel core genre' })
  }

  const getLastMessage = (messages: UIMessage[]) => {
    const userMessages = messages.filter(m => m.role === 'user') // the next message
    const lastMessage = userMessages[userMessages.length - 1]
    if (!lastMessage) return ''
    return lastMessage.parts.filter(p => p.type === 'text').map(p => p.text).join('')
  }

  const checkout = async () => {
    const res = await fetch(`/api/checkout_session`, {
      method: 'POST',
      body: JSON.stringify({
        price: 5
      })
    })
    const session = await res.json()
    window.open(session.url, '_blank')
  }

  return <><Canvas
    camera={{ position: [0, 0, 18], fov: 32.5 }}
    style={{ position: "absolute", inset: "0", touchAction: "none" }}
    gl={{ localClippingEnabled: true }}>
    <ambientLight intensity={Math.PI} />
    <spotLight decay={0} position={[0, 5, 10]} angle={0.25} penumbra={1} intensity={2} castShadow />
    <Defaults>
      <Fullscreen
        overflow={initialTrackId ? "scroll" : "hidden"}
        scrollbarColor="black"
        flexDirection="column"
        gap={32}
        paddingX={initialTrackId ? 32 : undefined}
        alignItems="center"
        justifyContent="center"
        padding={32}
      >
        <Container display={isAuthenticated && track ? 'flex' : 'none'}>
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
        </Container>
        <Container flexDirection="column" alignItems="center" gap={16}>
          <Container>
            <Text color="white" padding={16} backgroundColor="black">
              {getLastMessage(messages) || `Hello, I am a virtual DJ, let me play some music.`}
            </Text>
          </Container>
          <Container gap={16}>
            <Button onClick={onRevibe} disabled={status === "streaming"}>
              <Text>{buttonLabel}</Text>
            </Button>
          </Container>
          <Container flexDirection="column">
            {user?.isAnonymous && messages.length > 0 && <Authenticated>
              <Text onClick={() => {
                return signIn('soundcloud')
              }} color="white">{`You have only ${user?.trialMessages} messages left. Sign in to reset your limits.`}</Text>
            </Authenticated>}
            {user?.trialTokens <= 0 && user.tokens <= 0 &&
              <Text onClick={() => { checkout() }}>You have run out of credits. Buy more.</Text>
            }
          </Container>
        </Container>
      </Fullscreen>
      <Rig audioLevelRef={audioEnergyRef} />
      <BaseDiffusedRing
        coordinateMapper={coordinateMapper}
        radius={2.8}
        nPoints={10000}
        pointSize={0.1}
        mirrorEffects={true}
      />
      <Floating position={[0, 0, 7]} />
      <BackgroundImageCover />
      <Environment preset="city" environmentIntensity={1} />
    </Defaults>
  </Canvas><audio ref={audioRef} src={streamTrack(track?.id)} /></>
}

