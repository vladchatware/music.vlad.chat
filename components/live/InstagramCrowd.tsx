"use client";

import { useFrame } from "@react-three/fiber";
import { useQuery } from "convex/react";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { api } from "@/convex/_generated/api";
import {
  crowdPlacement,
  getBeatPulse,
  getDancerJumpAmplitude,
  nextDancerY,
  type AudioBeatSnapshot,
} from "@/lib/live/dancerMotion";

function hash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function UsernameLabel({ username }: { username: string }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.fillStyle = "rgba(0, 0, 0, 0.72)";
    context.beginPath();
    context.roundRect(4, 10, 504, 108, 28);
    context.fill();
    context.fillStyle = "white";
    context.font = "600 42px system-ui, sans-serif";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.fillText(`@${username}`, 256, 64, 480);
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.needsUpdate = true;
    return result;
  }, [username]);

  useEffect(() => () => texture?.dispose(), [texture]);
  if (!texture) return null;

  return (
    <sprite position={[0, 2.2, 0]} scale={[1.7, 0.43, 1]} renderOrder={10_000}>
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function Dancer({
  username,
  comment,
  commentCount,
  index,
  audioBeatRef,
}: {
  username: string;
  comment: string;
  commentCount: number;
  index: number;
  audioBeatRef: React.MutableRefObject<AudioBeatSnapshot>;
}) {
  const rootRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const seed = useMemo(() => hash(username), [username]);
  const hue = (seed % 360) / 360;
  const color = useMemo(() => new THREE.Color().setHSL(hue, 0.78, 0.58), [hue]);
  const placement = crowdPlacement(index, seed);
  const fire = comment.includes("🔥");
  const jump = /\bjump\b/i.test(comment);

  useFrame(({ clock }, delta) => {
    const root = rootRef.current;
    if (!root) return;
    const snapshot = audioBeatRef.current;
    const pulse = getBeatPulse(snapshot);
    const danceAngle = snapshot.tracked
      ? snapshot.phase * Math.PI * 2 + (index % 2) * Math.PI
      : clock.elapsedTime * 2.4 + (index % 2) * Math.PI;
    const jumpHeight = getDancerJumpAmplitude(snapshot.strength, jump, commentCount);
    const targetY = placement.y + pulse * jumpHeight;
    root.position.y = nextDancerY(root.position.y, targetY, delta);
    root.rotation.y = Math.sin(danceAngle * 0.5) * (fire ? 0.8 : 0.35);
    root.rotation.z = Math.sin(danceAngle) * 0.08;
    if (leftArmRef.current) leftArmRef.current.rotation.z = Math.sin(danceAngle) * 1.1 - 0.45;
    if (rightArmRef.current) rightArmRef.current.rotation.z = -Math.sin(danceAngle) * 1.1 + 0.45;
  });

  return (
    <group ref={rootRef} position={[placement.x, placement.y, placement.z]} scale={0.4}>
      <mesh position={[0, 1.55, 0]} castShadow>
        <sphereGeometry args={[0.42, 18, 18]} />
        <meshStandardMaterial color="#ffd2b3" roughness={0.55} />
      </mesh>
      <mesh position={[0, 0.72, 0]} castShadow>
        <capsuleGeometry args={[0.4, 0.75, 8, 16]} />
        <meshStandardMaterial color={color} emissive={fire ? color : "black"} emissiveIntensity={fire ? 1.8 : 0} />
      </mesh>
      <group ref={leftArmRef} position={[-0.46, 1.05, 0]}>
        <mesh position={[0, -0.46, 0]}>
          <capsuleGeometry args={[0.12, 0.62, 5, 10]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
      <group ref={rightArmRef} position={[0.46, 1.05, 0]}>
        <mesh position={[0, -0.46, 0]}>
          <capsuleGeometry args={[0.12, 0.62, 5, 10]} />
          <meshStandardMaterial color={color} />
        </mesh>
      </group>
      <mesh position={[-0.22, -0.12, 0]} rotation={[0, 0, 0.08]}>
        <capsuleGeometry args={[0.14, 0.72, 5, 10]} />
        <meshStandardMaterial color="#16161b" />
      </mesh>
      <mesh position={[0.22, -0.12, 0]} rotation={[0, 0, -0.08]}>
        <capsuleGeometry args={[0.14, 0.72, 5, 10]} />
        <meshStandardMaterial color="#16161b" />
      </mesh>
      <UsernameLabel username={username} />
    </group>
  );
}

export function InstagramCrowd({
  sessionKey,
  audioBeatRef,
}: {
  sessionKey: string;
  audioBeatRef: React.MutableRefObject<AudioBeatSnapshot>;
}) {
  const participants = useQuery(api.liveStreams.listParticipants, { sessionKey }) ?? [];
  return (
    <group position={[0, 0, 4]}>
      {participants.map((participant, index) => (
        <Dancer
          key={participant._id}
          username={participant.username}
          comment={participant.lastComment}
          commentCount={participant.commentCount}
          index={index}
          audioBeatRef={audioBeatRef}
        />
      ))}
    </group>
  );
}
