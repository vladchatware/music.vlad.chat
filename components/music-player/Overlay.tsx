"use client"

import React from "react";
import { Container, Image, Text, Root } from "@react-three/uikit";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@react-three/uikit-default";
import { Authenticated } from "convex/react";
import { type UIMessage } from "@ai-sdk/react";

import { MotionControl } from "./MotionControl";
import { KnobsPanel } from "./Knobs";

function getLastMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((m) => m.role === "assistant");
  const lastMessage = userMessages[userMessages.length - 1];
  if (!lastMessage) return "";
  const text = lastMessage.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
  // Trim a bit if it's too long for a spatial bubble
  return text.length > 120 ? text.substring(0, 117) + "..." : text;
}

export function MusicPlayerOverlay(props: {
  isAuthenticated: boolean | null | undefined;
  activeTrack: any;
  messages: UIMessage[];
  onRevibe: (e: any) => void | Promise<void>;
  status: string;
  buttonLabel: string;
  user: any;
  signIn: (...args: any[]) => Promise<any>;
  checkout: () => Promise<any>;
  isIOS?: boolean;
  isPortrait?: boolean;
}) {
  const {
    isAuthenticated,
    activeTrack,
    messages,
    onRevibe,
    status,
    buttonLabel,
    user,
    signIn,
    checkout,
    isIOS = false,
    isPortrait = false,
  } = props;

  return (
    <>
      {/* HEADER SECTION: Adapts for Portrait/Vertical */}
      <Container
        width="100%"
        flexDirection={isPortrait ? "column" : "row"}
        justifyContent="space-between"
        alignItems={isPortrait ? "center" : "flex-start"}
        gap={isPortrait ? 12 : 0}
      >
        <Container transformRotateY={isPortrait ? 0 : 0.1}>
          <MotionControl />
        </Container>

        <Container
          backgroundColor="rgb(4, 16, 22)"
          borderRadius={16}
          backgroundOpacity={0.8}
          borderWidth={1}
          borderColor="white"
          borderOpacity={0.1}
          padding={isPortrait ? 10 : 16}
          maxWidth={isPortrait ? 300 : 350}
          transformRotateY={isPortrait ? 0 : -0.1}
        >
          <Text color="white" fontSize={isPortrait ? 11 : 14} textAlign={isPortrait ? "center" : "right"} fontWeight="medium">
            {getLastMessage(messages) || `Hi, I'm your AI DJ. Ready to mix?`}
          </Text>
        </Container>
      </Container>

      {/* MIDDLE SECTION: Adapt Card for Vertical Screens */}
      <Container
        display={isAuthenticated && activeTrack ? "flex" : "none" || !activeTrack} // Show even if undefined for layout stability
        flexGrow={1}
        justifyContent="center"
        alignItems="center"
        paddingY={isPortrait ? 16 : 32}
        paddingBottom={isPortrait ? 40 : 16} // Increased padding to push away from button
      >
        <Container
          transformRotateX={isPortrait ? 0.05 : 0}
          transformRotateY={isPortrait ? 0 : 0.05}
          transformTranslateZ={isPortrait ? -80 : -100} // Push further back
        >
          <Card maxWidth={isPortrait ? 320 : 400} width="100%" backgroundColor="rgb(4, 16, 22)" backgroundOpacity={0.9}>
            <CardContent gap={isPortrait ? 8 : 16} paddingTop={isPortrait ? 12 : 24}>
              <Image src={activeTrack?.artwork_url} width="100%" aspectRatio={1} borderRadius={8} />
            </CardContent>
            <CardHeader padding={isPortrait ? 12 : 24}>
              <CardTitle>
                <Text color="white" fontWeight="bold" fontSize={isPortrait ? 16 : 20} lineLimit={1}>
                  {activeTrack?.title || "No track playing"}
                </Text>
              </CardTitle>
              <CardDescription>
                <Text color="rgb(192, 192, 197)" fontSize={isPortrait ? 12 : 16}>
                  {activeTrack?.user?.username || activeTrack?.user?.full_name || "Select a vibe"}
                </Text>
              </CardDescription>
            </CardHeader>
          </Card>
        </Container>
      </Container>

      {/* FOOTER SECTION: Main Controls & Knobs */}
      <Container width="100%" flexDirection="column" alignItems="center" gap={24} transformTranslateZ={100}>
        <Container
          gap={16}
          flexDirection="row"
          alignItems="center"
        >
          <Button
            onClick={onRevibe}
            disabled={status === "streaming"}
            variant="default"
            paddingX={24}
            paddingY={10}
            transformRotateX={isPortrait ? 0 : -0.1}
            transformTranslateZ={20} // Pop button itself off the footer plane
          >
            <Text fontSize={isPortrait ? 14 : 18} fontWeight="bold">{buttonLabel}</Text>
          </Button>

          {user?.isAnonymous && messages.length > 0 && (
            <Authenticated>
              <Text
                onClick={() => signIn("soundcloud")}
                color="white"
                fontSize={10}
                opacity={0.6}
                maxWidth={isPortrait ? 200 : 150}
                textAlign="center"
              >{`Limits: ${user?.trialMessages} left. Tap to Sign In.`}</Text>
            </Authenticated>
          )}
        </Container>

        <Container
          transformRotateX={isPortrait ? -0.15 : -0.3}
          transformTranslateZ={50} // Further pop the knobs forward
          transformScale={isPortrait ? 0.9 : 1}
        >
          <KnobsPanel mobile={isIOS || isPortrait} />
        </Container>
      </Container>
    </>
  );
}
