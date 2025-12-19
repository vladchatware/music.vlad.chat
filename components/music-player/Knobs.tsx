"use client"

import React, { useRef, useState } from "react";
import { Container, Text } from "@react-three/uikit";
import { useMusicPlayerStore } from "./store/useMusicPlayerStore";
import { useShallow } from "zustand/react/shallow";

interface KnobProps {
    label: string;
    value: number;
    onChange: (val: number) => void;
    min?: number;
    max?: number;
    step?: number;
    scale?: number;
}

const Knob = ({ label, value, onChange, min = 0, max = 1, scale = 1 }: KnobProps) => {
    const [isDragging, setIsDragging] = useState(false);
    const startY = useRef(0);
    const startValue = useRef(0);

    const handlePointerDown = (e: any) => {
        if (e.button !== 0) return;
        e.stopPropagation();
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        setIsDragging(true);
        startY.current = e.clientY;
        startValue.current = value;
    };

    const handlePointerMove = (e: any) => {
        if (!isDragging) return;
        const deltaY = startY.current - e.clientY;
        const sensitivity = 200;
        const deltaValue = deltaY / sensitivity;
        const newValue = Math.max(min, Math.min(max, startValue.current + deltaValue));
        onChange(newValue);
    };

    const handlePointerUp = (e: any) => {
        if (isDragging) {
            setIsDragging(false);
            (e.target as HTMLElement).releasePointerCapture(e.pointerId);
        }
    };

    const rotation = (value - 0.5) * 270;
    const size = 48 * scale;
    const indicatorHeight = 14 * scale;
    const indicatorWidth = 3 * scale;
    const indicatorTop = 6 * scale;
    const bulbSize = 4 * scale;
    const bulbBottom = 6 * scale;

    return (
        <Container
            flexDirection="column"
            alignItems="center"
            gap={4 * scale}
            padding={2 * scale}
        >
            <Container
                width={size}
                height={size}
                borderRadius={size / 2}
                backgroundColor="white"
                backgroundOpacity={isDragging ? 0.15 : 0.08}
                borderWidth={2}
                borderColor="white"
                borderOpacity={isDragging ? 0.4 : 0.2}
                alignItems="center"
                justifyContent="center"
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
            >
                <Container
                    width={indicatorWidth}
                    height={indicatorHeight}
                    backgroundColor="white"
                    backgroundOpacity={isDragging ? 1 : 0.8}
                    borderRadius={indicatorWidth / 2}
                    transformRotateZ={rotation}
                    positionType="absolute"
                    positionTop={indicatorTop}
                />

                <Container
                    width={bulbSize}
                    height={bulbSize}
                    borderRadius={bulbSize / 2}
                    backgroundColor="rgb(76, 201, 254)"
                    backgroundOpacity={value > 0.5 ? 1 : 0.3}
                    positionType="absolute"
                    positionBottom={bulbBottom}
                />
            </Container>

            <Text fontSize={10 * scale} fontWeight="bold" color="white" opacity={0.6} letterSpacing={1 * scale}>
                {label.toUpperCase()}
            </Text>
        </Container>
    );
};

export function KnobsPanel({ mobile }: { mobile?: boolean }) {
    const { knobs, setKnobs } = useMusicPlayerStore(
        useShallow((s) => ({
            knobs: s.knobs,
            setKnobs: s.actions.setKnobs,
        }))
    );

    const scale = mobile ? 0.8 : 1;

    return (
        <Container
            flexDirection="row"
            padding={12 * scale}
            gap={8 * scale}
            backgroundColor="black"
            backgroundOpacity={0.6}
            borderRadius={20 * scale}
            borderWidth={1}
            borderColor="white"
            borderOpacity={0.1}
        >
            <Knob
                label="Low"
                value={knobs.low}
                onChange={(low) => setKnobs({ low })}
                scale={scale}
            />
            <Knob
                label="Mid"
                value={knobs.mid}
                onChange={(mid) => setKnobs({ mid })}
                scale={scale}
            />
            <Knob
                label="High"
                value={knobs.high}
                onChange={(high) => setKnobs({ high })}
                scale={scale}
            />
            <Knob
                label="Vibe"
                value={knobs.resonance}
                onChange={(resonance) => setKnobs({ resonance })}
                scale={scale}
            />
            <Container width={2 * scale} height={24 * scale} backgroundColor="white" backgroundOpacity={0.1} alignSelf="center" marginX={2 * scale} />
            <Knob
                label="Vol"
                value={knobs.volume}
                onChange={(volume) => setKnobs({ volume })}
                scale={scale}
            />
        </Container>
    );
}
