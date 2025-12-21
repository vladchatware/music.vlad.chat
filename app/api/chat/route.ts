import { NextResponse, NextRequest } from 'next/server'
import { streamText, UIMessage, convertToModelMessages, stepCountIs, smoothStream, ToolSet } from 'ai';
import { experimental_createMCPClient } from '@ai-sdk/mcp';
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { openai } from '@ai-sdk/openai';
import { systemMessage } from '../../../lib/ai';
import { fetchMutation, fetchQuery } from "convex/nextjs"
import { api, internal } from '../../../convex/_generated/api';
import z from 'zod';
import { convexAuthNextjsToken } from '@convex-dev/auth/nextjs/server';
import { stripe } from '@/lib/stripe';

export async function POST(req: NextRequest) {
  const { messages } = await req.json()

  const user = await fetchQuery(api.users.viewer, {}, { token: await convexAuthNextjsToken() })

  // Bypass limits in development
  const isDev = process.env.NODE_ENV === 'development';
  
  if (!isDev) {
    if (!user.isAnonymous) {
      if (!user.stripeId) {
        const customer = await stripe.customers.create(({
          email: user.email
        }))
        await fetchMutation(api.users.connect, { stripeId: customer.id }, { token: await convexAuthNextjsToken() })
        user.stripeId = customer.id
      }

      if (user.trialTokens <= 0 && user.tokens <= 0) {
        return new NextResponse('out of tokens', { status: 429 })
      }
    } else {
      if (user.trialMessages! <= 0) return new NextResponse('no more messages left', { status: 429 })
    }
  }

  const url = process.env.NEXT_PUBLIC_SITE_URL
  const transport = new StreamableHTTPClientTransport(new URL(`${url}/api/mcp`))
  const notion = await experimental_createMCPClient({
    // @ts-ignore TODO 
    transport
  })

  const tools: ToolSet = {
    player: {
      description: "Play a song. The system automatically analyzes the track and skips the intro. Use startAtSec only to override the automatic detection.",
      inputSchema: z.object({
        id: z.number().describe("The id of a song"),
        startAtSec: z.number().min(0).optional().describe("Override automatic intro detection. Usually not needed - system finds optimal start automatically.")
      })
    },
    
    // DJ Mixer Control Tools - Direct Controls
    setEQ: {
      description: "Adjust 3-band EQ on a deck. Use to emphasize or reduce bass/mid/treble frequencies. Values are 0-1 where 0=cut, 1=unity gain.",
      inputSchema: z.object({
        deck: z.enum(['active', 'cued']).describe("Which deck to adjust: 'active' (currently playing) or 'cued' (next track)"),
        low: z.number().min(0).max(1).optional().describe("Low/bass frequencies (20-250 Hz)"),
        mid: z.number().min(0).max(1).optional().describe("Mid frequencies (250-4000 Hz)"),
        high: z.number().min(0).max(1).optional().describe("High/treble frequencies (4000-20000 Hz)")
      })
    },
    
    setTransitionStyle: {
      description: "Configure how the next transition will sound. Controls EQ curve preset and timing.",
      inputSchema: z.object({
        preset: z.enum(['bassSwap', 'frequencySplit', 'smooth', 'highFirst']).optional()
          .describe("bassSwap=swap bass at midpoint, frequencySplit=complementary EQ, smooth=gradual all bands, highFirst=bring in highs then mids then bass"),
        durationBars: z.number().int().min(4).max(64).optional()
          .describe("Duration of crossfade in bars (4, 8, 16, 32, 64)")
      })
    },
    
    setFilter: {
      description: "Apply a filter sweep effect on a deck. Useful for build-ups and breakdowns.",
      inputSchema: z.object({
        deck: z.enum(['active', 'cued']).describe("Which deck to filter"),
        type: z.enum(['highpass', 'lowpass']).describe("Filter type: highpass removes bass, lowpass removes treble"),
        frequency: z.number().min(20).max(20000).describe("Cutoff frequency in Hz"),
        resonance: z.number().min(0.1).max(20).optional().describe("Resonance/Q factor for filter emphasis")
      })
    },
    
    // DJ Mixer Control Tools - Declarative/High-Level Controls
    setVibe: {
      description: "Set the energy direction for the set. Affects track selection and transition intensity.",
      inputSchema: z.object({
        direction: z.enum(['build', 'maintain', 'wind_down', 'peak'])
          .describe("build=increasing intensity, maintain=steady energy, wind_down=cooling off, peak=maximum energy")
      })
    },
    
    setMixIntensity: {
      description: "Control how dramatic transitions should be.",
      inputSchema: z.object({
        level: z.enum(['smooth', 'normal', 'aggressive'])
          .describe("smooth=long subtle transitions (32 bars), normal=standard DJ (16 bars), aggressive=quick dramatic (4-8 bars)")
      })
    },
    
    setHarmonicMode: {
      description: "Control how strictly to enforce key/harmonic matching between tracks.",
      inputSchema: z.object({
        mode: z.enum(['strict', 'flexible', 'off'])
          .describe("strict=only compatible keys, flexible=prefer compatible but allow others, off=ignore key matching")
      })
    },
    
    setTempo: {
      description: "Manually adjust playback tempo/speed for the current track.",
      inputSchema: z.object({
        adjustment: z.number().min(-8).max(8)
          .describe("Tempo adjustment as percentage (-8 to +8). Positive speeds up, negative slows down.")
      })
    },
    
    // Reject track - AI determined the cued track is not a good match
    rejectTrack: {
      description: "Reject the currently cued track and request a different one. Use when the track analysis shows a poor match (key clash, tempo mismatch, wrong energy). The system will cancel the cued track and ask for a new recommendation.",
      inputSchema: z.object({
        reason: z.string().describe("Why this track doesn't work (e.g., 'Key clash - F major doesn't mix with C minor', 'BPM too far apart - would need 15% tempo change', 'Energy mismatch - need higher energy for build')")
      })
    },
    
    // Scheduled Actions Tool - for precise timestamp-based DJ automation
    scheduleActions: {
      description: "Schedule DJ actions at precise timestamps. Use this to plan transitions, builds, drops, and vibe changes with exact timing. The system will execute each action at the specified timestamp.",
      inputSchema: z.object({
        actions: z.array(z.object({
          atSec: z.number().describe("Execute at this timestamp (seconds into current track)"),
          action: z.enum([
            'player',           // Load/play a track
            'startCrossfade',   // Begin crossfade to cued track
            'setEQ',            // Adjust EQ bands
            'setFilter',        // Apply filter sweep
            'setTempo',         // Adjust tempo
            'setVibe',          // Change energy direction
            'setMixIntensity',  // Change transition style
            'swapBass',         // Quick bass swap between decks
            'cutTrack'          // Hard cut - immediately stop outgoing track
          ]).describe("The action to execute"),
          params: z.object({
            // For player
            trackId: z.number().optional(),
            // For EQ
            deck: z.enum(['active', 'cued']).optional(),
            low: z.number().min(0).max(1).optional(),
            mid: z.number().min(0).max(1).optional(),
            high: z.number().min(0).max(1).optional(),
            // For filter
            filterType: z.enum(['highpass', 'lowpass']).optional(),
            frequency: z.number().optional(),
            // For tempo
            tempoAdjust: z.number().min(-8).max(8).optional(),
            // For vibe
            vibe: z.enum(['build', 'maintain', 'wind_down', 'peak']).optional(),
            // For crossfade
            durationSec: z.number().optional(),
            style: z.enum(['bassSwap', 'frequencySplit', 'smooth', 'highFirst']).optional()
          }).optional().describe("Parameters for the action")
        })).describe("List of actions to schedule with timestamps")
      })
    }
  }

  const notionTools = await notion.tools() as ToolSet
  const result = streamText({
    model: 'openai/gpt-5-mini',
    messages: convertToModelMessages(messages),
    tools: { ...tools, ...notionTools },
    stopWhen: stepCountIs(5),
    system: systemMessage,
    onFinish: async ({ usage, providerMetadata }) => {
      // console.log(usage)
      if (user.isAnonymous) {
        await fetchMutation(api.users.messages, {}, { token: await convexAuthNextjsToken() })
      } else {
        await fetchMutation(api.users.usage, { usage, model: 'gpt-5-mini', provider: 'AI Gateway' }, { token: await convexAuthNextjsToken() })
      }
    },
  })

  return result.toUIMessageStreamResponse({
    sendSources: true,
    sendReasoning: true
  })
}
