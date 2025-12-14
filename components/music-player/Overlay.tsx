"use client"

import React from "react";
import { Container, Image, Text } from "@react-three/uikit";
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from "@react-three/uikit-default";
import { Authenticated } from "convex/react";
import { type UIMessage } from "@ai-sdk/react";

import { MotionControl } from "./MotionControl";

function getLastMessage(messages: UIMessage[]) {
  const userMessages = messages.filter((m) => m.role === "user");
  const lastMessage = userMessages[userMessages.length - 1];
  if (!lastMessage) return "";
  return lastMessage.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
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
  } = props;

  return (
    <>
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

      <Container display={isAuthenticated && activeTrack ? "flex" : "none"}>
        <Card maxWidth={460} width="100%" backgroundColor="rgb(4, 16, 22)">
          <CardContent gap={16} paddingTop={24}>
            <Image src={activeTrack?.artwork_url} width="100%" aspectRatio={1} />
          </CardContent>
          <CardHeader>
            <CardTitle>
              <Text color="white" fontWeight="bold">
                {activeTrack?.title}
              </Text>
            </CardTitle>
            <CardDescription>
              <Text color="rgb(192, 192, 197)">
                {activeTrack?.user?.username || activeTrack?.user?.full_name}
              </Text>
            </CardDescription>
          </CardHeader>
        </Card>
      </Container>

      <Container flexDirection="column" alignItems="center" gap={16}>
        <Container backgroundColor="rgb(4, 16, 22)" borderRadius={8}>
          <Text color="white" padding={16}>
            {getLastMessage(messages) ||
              `Hello, I am a virtual DJ, let me play some music.`}
          </Text>
        </Container>

        <Container gap={16}>
          <Button onClick={onRevibe} disabled={status === "streaming"}>
            <Text>{buttonLabel}</Text>
          </Button>
        </Container>

        <Container flexDirection="column">
          {user?.isAnonymous && messages.length > 0 && (
            <Authenticated>
              <Text
                onClick={() => {
                  return signIn("soundcloud");
                }}
                color="white"
              >{`You have only ${user?.trialMessages} messages left. Sign in to reset your limits.`}</Text>
            </Authenticated>
          )}

          {user?.trialTokens <= 0 && user.tokens <= 0 && (
            <Text
              onClick={() => {
                checkout();
              }}
            >
              You have run out of credits. Buy more.
            </Text>
          )}
        </Container>
      </Container>
    </>
  );
}

