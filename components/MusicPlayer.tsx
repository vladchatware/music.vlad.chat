"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Canvas, ThreeEvent } from '@react-three/fiber'
import { Fullscreen, Container, Text, Image } from '@react-three/uikit'
import { Defaults, Button, Badge } from '@react-three/uikit-default'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@react-three/uikit-default"
import { Environment, SoftShadows, CubeCamera } from '@react-three/drei'
import { PhysicalGrid } from '@/components/PhysicalGrid'
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
import { Camera, CameraOff, Smartphone } from 'lucide-react'
import { renderToStaticMarkup } from 'react-dom/server'

const iconToDataUrl = (Icon: React.ElementType<{ size: number; color: string; strokeWidth: number }>) => {
  const svgString = renderToStaticMarkup(<Icon size={24} color="black" strokeWidth={2} />)
  return `data:image/svg+xml,${encodeURIComponent(svgString)}`
}

const MOTION_ICON = iconToDataUrl(Smartphone)
const CAMERA_ICON = iconToDataUrl(Camera)
const CAMERA_OFF_ICON = iconToDataUrl(CameraOff)

function MotionControl() {
  const [showButton, setShowButton] = useState(false)

  useEffect(() => {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      setShowButton(true)

      const handler = (e: DeviceOrientationEvent) => {
        if (e.alpha !== null) {
          setShowButton(false)
          window.removeEventListener('deviceorientation', handler)
        }
      }
      window.addEventListener('deviceorientation', handler)
      return () => window.removeEventListener('deviceorientation', handler)
    }
  }, [])

  const requestPermission = async () => {
    try {
      const response = await (DeviceOrientationEvent as any).requestPermission()
      if (response === 'granted') {
        setShowButton(false)
      }
    } catch (e) {
      console.error(e)
    }
  }

  if (!showButton) return null

  return (
    // @ts-ignore
    <Badge
      onClick={requestPermission}
      backgroundColor="white"
      padding={12}
      borderRadius={999}
      cursor="pointer"
    >
      <Image src={MOTION_ICON} width={24} height={24} />
    </Badge>
  )
}

export default function MusicPlayer({ initialTrackId }: { initialTrackId: string | number }) {
  const user = useQuery(api.users.viewer)
  const isAuthenticated = useQuery(api.auth.isAuthenticated)
  const { signIn, signOut } = useAuthActions()

  // Decks
  const deckARef = useRef<HTMLAudioElement | null>(null);
  const deckBRef = useRef<HTMLAudioElement | null>(null);
  const deckASourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const deckBSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
  const activeDeckRef = useRef<'A' | 'B'>('A');

  // State
  const [trackA, setTrackA] = useState<any>(null);
  const [trackB, setTrackB] = useState<any>(null);
  const [activeTrack, setActiveTrack] = useState<any>(null);
  const [loading, setLoading] = useState(true)

  const { messages, sendMessage, status, error, regenerate, addToolResult } = useChat({
    onError: error => {
      console.log('error caught', error)
    },
    onToolCall: async (ctx) => {
      console.log(`${ctx.toolCall.toolName} ${JSON.stringify(ctx.toolCall.input)}`)
      if (ctx.toolCall.toolName === 'player') {
        setLoading(true)
        const newTrack = await fetchTrack((ctx.toolCall.input as { id: number }).id)

        if (isPlaying) {
          // Load into inactive deck
          const isAActive = activeDeckRef.current === 'A';
          const targetSetter = isAActive ? setTrackB : setTrackA;
          const targetDeck = isAActive ? deckBRef.current : deckARef.current;
          const targetSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;

          targetSetter(newTrack);
          waitingForBeatRef.current = true;
          nextTrackReadyRef.current = false;

          const onLoaded = () => {
            if (!targetDeck) return;
            targetDeck.muted = true;
            targetDeck.playbackRate = 4.0; // Scan speed
            targetDeck.play().catch(e => console.error("Cue play failed", e));

            if (cueAnalyzerRef.current && targetSource) {
              cueAnalyzerRef.current.disconnectInputs();
              cueAnalyzerRef.current.connectInput(targetSource);
            }

            const checkBeat = () => {
              if (!waitingForBeatRef.current) return; // Cancelled
              if (cueAnalyzerRef.current?.getEnergy('bass') > 0.6) {
                targetDeck.pause();
                targetDeck.playbackRate = 1.0;
                targetDeck.currentTime = Math.max(0, targetDeck.currentTime - 0.05);
                targetDeck.muted = false;
                nextTrackReadyRef.current = true;
                console.log('Next track cued and ready');
              } else {
                requestAnimationFrame(checkBeat);
              }
            }
            requestAnimationFrame(checkBeat);
            targetDeck.removeEventListener('loadeddata', onLoaded);
          }
          targetDeck?.addEventListener('loadeddata', onLoaded);

        } else {
          // Immediate play
          setTrackA(newTrack);
          setActiveTrack(newTrack);
          activeDeckRef.current = 'A';
          const onLoaded = () => {
            console.log('loaded immediately')
            setIsLoaded(true)
            setLoading(false)
            togglePlay()
            deckARef.current?.removeEventListener('loadeddata', onLoaded)
          }
          deckARef.current?.addEventListener('loadeddata', onLoaded)
        }

        addToolResult({
          tool: ctx.toolCall.toolName,
          toolCallId: ctx.toolCall.toolCallId,
          output: `Playing ${(ctx.toolCall.input as { id: number }).id}`
        })
      }
    }
  });

  const analyzerRef = useRef<FFTAnalyzer | null>(null);
  const cueAnalyzerRef = useRef<FFTAnalyzer | null>(null);
  const audioEnergyRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const playingHandlerRef = useRef<((e: Event) => void) | null>(null);
  const endedHandlerRef = useRef<((e: Event) => Promise<void>) | null>(null);
  const latestOnRevibeRef = useRef<(e: Event | ThreeEvent<MouseEvent>) => Promise<void> | void>(null);
  const revibeTriggeredRef = useRef(false);
  const nextTrackReadyRef = useRef(false);
  const waitingForBeatRef = useRef(false);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(true);

  const buttonLabel = needsUserInteraction ? 'Play' : 'Revibe'

  const togglePlay = useCallback(async () => {
    const audio = activeDeckRef.current === 'A' ? deckARef.current : deckBRef.current;
    if (!audio || !audio.src) return;

    try {
      if (analyzerRef.current?._audioCtx?.state === 'suspended') {
        await analyzerRef.current._audioCtx.resume();
      }

      if (isPlaying) {
        audio.pause();
        setIsPlaying(false);
      } else {
        await audio.play();
        setIsPlaying(true);
      }
    } catch (err) {
      console.error("Playback error:", err);
      if (err.name === 'NotAllowedError') {
        alert('Please click the play button to start audio playback');
      }
    }
  }, [isPlaying]);

  useEffect(() => {
    // Initialize Audio Context and Sources
    const AudioContext = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContext();

    // Create analyzers sharing the context
    // We pass a dummy element initially, but we will connect sources manually
    // Actually FFTAnalyzer constructor requires an element to create source.
    // But we modified it to accept AudioNode.
    // So we can create sources first.

    const deckA = deckARef.current;
    const deckB = deckBRef.current;

    if (!deckA || !deckB) return;

    deckA.crossOrigin = "anonymous";
    deckB.crossOrigin = "anonymous";

    const sourceA = ctx.createMediaElementSource(deckA);
    const sourceB = ctx.createMediaElementSource(deckB);

    deckASourceRef.current = sourceA;
    deckBSourceRef.current = sourceB;

    const analyzer = new FFTAnalyzer(sourceA, ctx);
    analyzerRef.current = analyzer;

    const cueAnalyzer = new FFTAnalyzer(sourceB, ctx); // Initially B
    cueAnalyzerRef.current = cueAnalyzer;

    // Event Handlers
    const handlePlaying = (e: Event) => {
      const playingDeck = e.target as HTMLAudioElement;
      const isActiveDeck = playingDeck === (activeDeckRef.current === 'A' ? deckA : deckB);

      // Only reset revibe trigger for the active deck, not the cued deck
      if (isActiveDeck) {
        setNeedsUserInteraction(false);
        revibeTriggeredRef.current = false;
        // @ts-ignore OBS
        window.obsstudio?.startRecording();
      }
    }
    const handleEnded = async (e: Event) => {
      // This handler is for when a track naturally ends.
      // If a track ends, and there's a next track cued, we should transition.
      // Otherwise, it's a natural end, and we might want to trigger a revibe.
      const audio = e.target as HTMLAudioElement;
      const isAActive = activeDeckRef.current === 'A';
      const currentDeck = isAActive ? deckARef.current : deckBRef.current;

      if (audio === currentDeck && nextTrackReadyRef.current) {
        console.log('Active track ended, switching to cued track.');
        waitingForBeatRef.current = false; // Cancel beat wait if it was active
        nextTrackReadyRef.current = false;

        const nextDeck = isAActive ? deckBRef.current : deckARef.current;
        const nextSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
        const nextTrack = isAActive ? trackB : trackA;

        if (nextDeck && nextSource) {
          nextDeck.play().catch(err => console.error("Switch play failed on end:", err));
          analyzer.disconnectInputs();
          analyzer.connectInput(nextSource);
          activeDeckRef.current = isAActive ? 'B' : 'A';
          setActiveTrack(nextTrack);
          setIsPlaying(true);
        }
      } else if (audio === currentDeck) {
        // No next track cued, or it was the cued track that ended (shouldn't happen if active)
        console.log('Active track ended naturally, triggering revibe.');
        if (latestOnRevibeRef.current) {
          await latestOnRevibeRef.current(e);
        }
      }
      // @ts-ignore OBS
      window.obsstudio?.stopRecording()
    }

    const handleTimeUpdate = async (e: Event) => {
      const audio = e.target as HTMLAudioElement;
      // Only trigger for active deck
      if (audio !== (activeDeckRef.current === 'A' ? deckARef.current : deckBRef.current)) return;

      const virtualDuration = Math.min(audio.duration, 90);

      // Don't trigger if:
      // 1. Already triggered for this track
      // 2. Already waiting for a beat (track is being cued)
      // 3. Next track is already ready
      // 4. AI is currently streaming a response
      if (audio.duration > 20 &&
        audio.currentTime > virtualDuration - 15 &&
        !revibeTriggeredRef.current &&
        !waitingForBeatRef.current &&
        !nextTrackReadyRef.current) {
        revibeTriggeredRef.current = true
        console.log('Triggering revibe at', audio.currentTime, 'seconds');
        if (latestOnRevibeRef.current) {
          await latestOnRevibeRef.current(e);
        }
      }
    }

    playingHandlerRef.current = handlePlaying;
    endedHandlerRef.current = handleEnded;

    // Attach listeners to both decks? 
    // Or just attach/detach dynamically?
    // Better to attach to both and check active in handler.
    [deckA, deckB].forEach(deck => {
      deck.addEventListener('playing', handlePlaying)
      deck.addEventListener('ended', handleEnded)
      deck.addEventListener('timeupdate', handleTimeUpdate)
    });

    return () => {
      [deckA, deckB].forEach(deck => {
        deck.removeEventListener('playing', handlePlaying)
        deck.removeEventListener('ended', handleEnded)
        deck.removeEventListener('timeupdate', handleTimeUpdate)
      });
      analyzer.toggleAnalyzer(false);
      analyzer.disconnectInputs();
      cueAnalyzer.toggleAnalyzer(false);
      cueAnalyzer.disconnectInputs();
      try {
        deckA.pause();
        deckB.pause();
      } catch { }
      analyzerRef.current = null;
      cueAnalyzerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!analyzerRef.current) return;

    const analyzer = analyzerRef.current;

    const tick = () => {
      const bars = analyzer.getBars();
      if (coordinateMapper.data.length !== bars.length) {
        const amplitude = coordinateMapper.amplitude;
        const next = new CoordinateMapper_Data({ amplitude, size: bars.length });
        (coordinateMapper as any)._params = next.params;
        (coordinateMapper as any).data = next.data;
      }
      for (let i = 0; i < bars.length; i++) {
        coordinateMapper.data[i] = bars[i].value;
      }

      audioEnergyRef.current = analyzer.getEnergy();

      // Transition Logic
      if (waitingForBeatRef.current && nextTrackReadyRef.current && analyzer.getEnergy('bass') > 0.6) {
        console.log('Switching on beat!');
        waitingForBeatRef.current = false;
        nextTrackReadyRef.current = false;

        const isAActive = activeDeckRef.current === 'A';
        const currentDeck = isAActive ? deckARef.current : deckBRef.current;
        const nextDeck = isAActive ? deckBRef.current : deckARef.current;
        const nextSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
        const nextTrack = isAActive ? trackB : trackA;

        if (currentDeck && nextDeck && nextSource) {
          // Crossfade or hard switch? Hard switch for now as per request "on the beat"
          currentDeck.pause();
          nextDeck.play().catch(e => console.error("Switch play failed", e));

          // Switch analyzer input
          analyzer.disconnectInputs();
          analyzer.connectInput(nextSource);

          activeDeckRef.current = isAActive ? 'B' : 'A';
          setActiveTrack(nextTrack);
          setIsPlaying(true);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [coordinateMapper, togglePlay, trackA, trackB]);

  const onFetchTrack = useCallback(async () => {
    if (!deckARef.current) {
      setIsLoaded(false);
      return;
    }
    setLoading(true)
    setIsLoaded(false)

    const _track = await fetchTrack(initialTrackId)
    // Initial load always to Deck A
    deckARef.current.pause();
    deckBRef.current?.pause();

    setTrackA(_track);
    setActiveTrack(_track);
    activeDeckRef.current = 'A';

    setIsLoaded(true);
    setLoading(false)
  }, [initialTrackId])

  useEffect(() => {
    if (isAuthenticated !== true) return
    const main = async () => {
      await onFetchTrack()
      setLoading(false)
    }
    main()
  }, [initialTrackId, onFetchTrack, isAuthenticated])

  const onRevibe = useCallback(async (e: Event | ThreeEvent<MouseEvent>) => {
    e.stopPropagation()

    if (isAuthenticated === false) {
      await signIn('anonymous')
      return
    }

    if (status === 'streaming') return

    if (needsUserInteraction) {
      return togglePlay()
    }

    const bpm = activeTrack?.bpm
    const prompt = bpm
      ? `Play a track with similar BPM to ${bpm} (approx ${Math.floor(bpm - 10)} to ${Math.floor(bpm + 10)})`
      : 'Deep dive into less known genres'

    console.log(prompt)

    sendMessage({ role: 'user', text: prompt })
  }, [isAuthenticated, needsUserInteraction, status, togglePlay, sendMessage, signIn, activeTrack])

  useEffect(() => {
    latestOnRevibeRef.current = onRevibe
  }, [onRevibe])

  const getLastMessage = (messages: UIMessage[]) => {
    const userMessages = messages.filter(m => m.role === 'user')
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
    shadows
    camera={{ position: [0, 0, 18], fov: 32.5 }}
    style={{ position: "fixed", top: 0, left: 0, width: "100vw", height: "100dvh", touchAction: "none", zIndex: 0 }}
    gl={{ localClippingEnabled: true }}>
    <ambientLight intensity={Math.PI} />
    <spotLight
      decay={0}
      position={[0, 0, 18]}
      angle={0.6}
      penumbra={1}
      intensity={2}
      castShadow
      shadow-bias={-0.0001}
    />
    <SoftShadows size={40} samples={16} />
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
        <Container
          display="flex"
          flexDirection="column"
          positionType="absolute"
          positionTop={60}
          positionLeft={32}
          gap={8}
        >
          <MotionControl />
        </Container>
        <Container display={isAuthenticated && activeTrack ? 'flex' : 'none'}>
          <Card maxWidth={460} width="100%" backgroundColor="rgb(4, 16, 22)">
            <CardContent gap={16} paddingTop={24}>
              <Image src={activeTrack?.artwork_url} width="100%" aspectRatio={1} />
            </CardContent>
            <CardHeader>
              <CardTitle>
                <Text color="white" fontWeight="bold">{activeTrack?.title}</Text>
              </CardTitle>
              <CardDescription>
                <Text color="rgb(192, 192, 197)">{activeTrack?.user?.username || activeTrack?.user?.full_name}</Text>
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
      <CubeCamera position={[0, 0, 7]} resolution={256} frames={Infinity}>
        {(texture) => <Floating envMap={texture} />}
      </CubeCamera>
      <PhysicalGrid position={[0, 0, 0]} size={100} />
      <BackgroundImageCover />
      <Environment preset="city" environmentIntensity={1} />
    </Defaults>
  </Canvas >
    <audio ref={deckARef} src={streamTrack(trackA?.id)} />
    <audio ref={deckBRef} src={streamTrack(trackB?.id)} />
  </>
}
