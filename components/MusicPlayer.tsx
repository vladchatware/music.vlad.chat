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
import { BPMDetector } from '@/lib/analyzers/bpm-detector'
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
  const deckAGainRef = useRef<GainNode | null>(null);
  const deckBGainRef = useRef<GainNode | null>(null);
  const activeDeckRef = useRef<'A' | 'B'>('A');
  const crossfadeInProgressRef = useRef(false);

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

        console.log('isPlaying state:', isPlayingRef.current);

        if (isPlayingRef.current) {
          console.log('Cueing track on inactive deck...');
          // Load into inactive deck
          const isAActive = activeDeckRef.current === 'A';
          const targetSetter = isAActive ? setTrackB : setTrackA;
          const targetDeck = isAActive ? deckBRef.current : deckARef.current;
          const targetSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;

          targetSetter(newTrack);
          waitingForBeatRef.current = true;
          nextTrackReadyRef.current = false;
          trackEndedWhileCueingRef.current = false;

          const onLoaded = () => {
            if (!targetDeck) return;

            console.log('Target deck loaded, starting cue process...');
            console.log('Target track:', newTrack?.title);

            // Ensure target deck gain is 0 (it will fade in during crossfade)
            const targetGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
            if (targetGain) targetGain.gain.value = 0;

            targetDeck.muted = true;

            // Don't use playbackRate for cueing - it breaks the analyzer
            // Instead, just scan forward manually
            targetDeck.currentTime = 0;
            targetDeck.play().catch(e => console.error("Cue play failed", e));

            // Switch cue analyzer to the target deck
            if (cueAnalyzerRef.current && targetSource) {
              console.log('Connecting cue analyzer to target deck');
              cueAnalyzerRef.current.disconnectInputs();
              cueAnalyzerRef.current.connectInput(targetSource);
            }

            const startTime = performance.now();
            const maxCueTime = 30000; // 30 seconds max to find a beat
            let lastLogTime = 0;

            const checkBeat = () => {
              if (!waitingForBeatRef.current) {
                console.log('Beat check cancelled');
                targetDeck.pause();
                return; // Cancelled
              }

              const elapsed = performance.now() - startTime;
              const bassEnergy = cueAnalyzerRef.current?.getEnergy('bass') || 0;

              // Log every 2 seconds
              if (elapsed - lastLogTime > 2000) {
                console.log(`Cueing... time: ${(elapsed / 1000).toFixed(1)}s, bass: ${bassEnergy.toFixed(2)}, position: ${targetDeck.currentTime.toFixed(1)}s`);
                lastLogTime = elapsed;
              }

              if (bassEnergy > 0.6) {
                targetDeck.pause();
                targetDeck.currentTime = Math.max(0, targetDeck.currentTime - 0.05);
                targetDeck.muted = false;
                nextTrackReadyRef.current = true;
                console.log('✓ Beat found! Cued at', targetDeck.currentTime.toFixed(2), 'seconds');
              } else if (elapsed > maxCueTime) {
                // Timeout - just use the beginning
                console.warn('⚠ Cue timeout - starting from beginning');
                targetDeck.pause();
                targetDeck.currentTime = 0;
                targetDeck.muted = false;
                nextTrackReadyRef.current = true;
              } else {
                requestAnimationFrame(checkBeat);
              }
            }
            requestAnimationFrame(checkBeat);
            targetDeck.removeEventListener('loadeddata', onLoaded);
          }
          targetDeck?.addEventListener('loadeddata', onLoaded);

        } else {
          console.log('Loading track immediately (not playing)');
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
  const bpmDetectorRef = useRef<BPMDetector | null>(null);
  const audioEnergyRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  const playingHandlerRef = useRef<((e: Event) => void) | null>(null);
  const endedHandlerRef = useRef<((e: Event) => Promise<void>) | null>(null);
  const latestOnRevibeRef = useRef<(e: Event | ThreeEvent<MouseEvent>) => Promise<void> | void>(null);
  const revibeTriggeredRef = useRef(false);
  const nextTrackReadyRef = useRef(false);
  const waitingForBeatRef = useRef(false);
  const trackEndedWhileCueingRef = useRef(false);

  const coordinateMapper = useMemo(() => new CoordinateMapper_Data(), []);

  const [isLoaded, setIsLoaded] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [needsUserInteraction, setNeedsUserInteraction] = useState(true);

  const buttonLabel = needsUserInteraction ? 'Play' : 'Revibe'

  // Use refs to avoid stale closure in callbacks
  const activeTrackRef = useRef<any>(null);
  const isPlayingRef = useRef(false);
  const trackARef = useRef<any>(null);
  const trackBRef = useRef<any>(null);

  useEffect(() => {
    activeTrackRef.current = activeTrack;
  }, [activeTrack]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    trackARef.current = trackA;
  }, [trackA]);

  useEffect(() => {
    trackBRef.current = trackB;
  }, [trackB]);

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

    // Create gain nodes for crossfading
    const gainA = ctx.createGain();
    const gainB = ctx.createGain();
    gainA.gain.value = 1; // Deck A starts active
    gainB.gain.value = 0; // Deck B starts silent

    // Connect sources through gain nodes to destination
    sourceA.connect(gainA);
    sourceB.connect(gainB);
    gainA.connect(ctx.destination);
    gainB.connect(ctx.destination);

    deckASourceRef.current = sourceA;
    deckBSourceRef.current = sourceB;
    deckAGainRef.current = gainA;
    deckBGainRef.current = gainB;

    const analyzer = new FFTAnalyzer(sourceA, ctx);
    analyzerRef.current = analyzer;

    const cueAnalyzer = new FFTAnalyzer(sourceB, ctx); // Initially B
    cueAnalyzerRef.current = cueAnalyzer;

    const bpmDetector = new BPMDetector();
    bpmDetectorRef.current = bpmDetector;

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

      if (audio === currentDeck && nextTrackReadyRef.current && !crossfadeInProgressRef.current) {
        console.log('Active track ended, switching to cued track with quick crossfade.');
        waitingForBeatRef.current = false;
        nextTrackReadyRef.current = false;

        const nextDeck = isAActive ? deckBRef.current : deckARef.current;
        const nextSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
        const currentGain = isAActive ? deckAGainRef.current : deckBGainRef.current;
        const nextGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
        const nextTrack = isAActive ? trackBRef.current : trackARef.current;

        if (nextDeck && nextSource && nextTrack && currentGain && nextGain) {
          // Reset gains for immediate switch (current track already ended)
          currentGain.gain.value = 0;
          nextGain.gain.value = 1;
          
          nextDeck.play().catch(err => console.error("Switch play failed on end:", err));
          analyzer.disconnectInputs();
          analyzer.connectInput(nextSource);
          activeDeckRef.current = isAActive ? 'B' : 'A';
          setActiveTrack(nextTrack);
          setIsPlaying(true);
        }
      } else if (audio === currentDeck && waitingForBeatRef.current) {
        // Track ended while we're still finding the beat on the cued track
        // Don't trigger revibe - mark that we should play immediately when beat is found
        console.log('Active track ended while cueing next track, will play when beat is found');
        trackEndedWhileCueingRef.current = true;
      } else if (audio === currentDeck && !crossfadeInProgressRef.current) {
        // No next track cued and not in crossfade, trigger revibe
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

      // BPM Detection
      if (bpmDetectorRef.current) {
        bpmDetectorRef.current.detectBeat(analyzer.getEnergy('bass'));
      }

      // Transition Logic
      // Switch when: beat found on cued track AND (bass beat on current track OR current track already ended)
      // AND not already in a crossfade
      const shouldSwitch = waitingForBeatRef.current && nextTrackReadyRef.current && 
        !crossfadeInProgressRef.current &&
        (analyzer.getEnergy('bass') > 0.6 || trackEndedWhileCueingRef.current);
      
      if (shouldSwitch) {
        console.log('=== CROSSFADE STARTING', trackEndedWhileCueingRef.current ? 'IMMEDIATELY (track ended)' : 'ON BEAT', '===');
        waitingForBeatRef.current = false;
        nextTrackReadyRef.current = false;
        const wasTrackEnded = trackEndedWhileCueingRef.current;
        trackEndedWhileCueingRef.current = false;
        crossfadeInProgressRef.current = true;

        const isAActive = activeDeckRef.current === 'A';
        const currentDeck = isAActive ? deckARef.current : deckBRef.current;
        const nextDeck = isAActive ? deckBRef.current : deckARef.current;
        const currentGain = isAActive ? deckAGainRef.current : deckBGainRef.current;
        const nextGain = isAActive ? deckBGainRef.current : deckAGainRef.current;
        const nextSource = isAActive ? deckBSourceRef.current : deckASourceRef.current;
        const nextTrack = isAActive ? trackB : trackA;

        console.log('Active deck:', isAActive ? 'A' : 'B');
        console.log('Switching to deck:', isAActive ? 'B' : 'A');
        console.log('Current track:', activeTrackRef.current?.title);
        console.log('Next track:', nextTrack?.title);

        if (currentDeck && nextDeck && nextSource && nextTrack && currentGain && nextGain) {
          // Start playing the next deck (it will fade in)
          nextDeck.play().catch(e => console.error("Crossfade play failed", e));

          // Switch analyzer input to mix both during crossfade
          analyzer.disconnectInputs();
          analyzer.connectInput(nextSource);

          // Update active deck reference immediately
          activeDeckRef.current = isAActive ? 'B' : 'A';

          // Update active track - force a re-render
          setActiveTrack({ ...nextTrack });
          setIsPlaying(true);

          // Crossfade duration in ms (shorter if track already ended)
          const crossfadeDuration = wasTrackEnded ? 500 : 2000;
          const startTime = performance.now();
          const initialCurrentGain = currentGain.gain.value;
          const initialNextGain = nextGain.gain.value;

          const crossfade = () => {
            const elapsed = performance.now() - startTime;
            const progress = Math.min(elapsed / crossfadeDuration, 1);
            
            // Smooth easing (ease-in-out)
            const eased = progress < 0.5 
              ? 2 * progress * progress 
              : 1 - Math.pow(-2 * progress + 2, 2) / 2;

            // Fade out current, fade in next
            currentGain.gain.value = initialCurrentGain * (1 - eased);
            nextGain.gain.value = initialNextGain + (1 - initialNextGain) * eased;

            if (progress < 1) {
              requestAnimationFrame(crossfade);
            } else {
              // Crossfade complete
              console.log('=== CROSSFADE COMPLETE ===');
              currentDeck.pause();
              currentGain.gain.value = 0;
              nextGain.gain.value = 1;
              crossfadeInProgressRef.current = false;
              
              // Reset BPM detector for new track
              bpmDetectorRef.current?.reset();
            }
          };

          requestAnimationFrame(crossfade);
        } else {
          console.error('Crossfade failed - missing elements:', {
            currentDeck: !!currentDeck,
            nextDeck: !!nextDeck,
            currentGain: !!currentGain,
            nextGain: !!nextGain,
            nextSource: !!nextSource,
            nextTrack: !!nextTrack
          });
          crossfadeInProgressRef.current = false;
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

    // Reset gains for initial load (A active, B silent)
    if (deckAGainRef.current) deckAGainRef.current.gain.value = 1;
    if (deckBGainRef.current) deckBGainRef.current.gain.value = 0;

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

    // Use ref to get the latest track data
    const currentTrack = activeTrackRef.current;

    // Build context with only available metadata
    const hints: string[] = [];
    
    // BPM: prefer metadata, fallback to detected
    let bpm = currentTrack?.bpm;
    if (!bpm && bpmDetectorRef.current?.hasReliableBPM()) {
      bpm = bpmDetectorRef.current.getBPM();
    }
    if (bpm) hints.push(`~${Math.round(bpm)} BPM`);
    if (currentTrack?.genre) hints.push(currentTrack.genre);
    if (currentTrack?.key_signature) hints.push(currentTrack.key_signature);

    // Build concise user-facing prompt
    let prompt: string;
    if (hints.length > 0) {
      prompt = `Something similar to the music I like and ${hints.join(', ')}`;
    } else {
      prompt = 'Explore less known genres';
    }

    // Append current track ID for the model to avoid
    if (currentTrack?.id) {
      prompt += ` [skip:${currentTrack.id}]`;
    }

    console.log('Revibe prompt:', prompt)

    sendMessage({ role: 'user', text: prompt })
  }, [isAuthenticated, needsUserInteraction, status, togglePlay, sendMessage, signIn])

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
