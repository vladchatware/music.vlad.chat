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
}

const Knob = ({ label, value, onChange, min = 0, max = 1 }: KnobProps) => {
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

    return (
        <Container
            flexDirection="column"
            alignItems="center"
            gap={8}
            padding={4}
        >
            <Container
                width={48}
                height={48}
                borderRadius={24}
                backgroundColor={isDragging ? "white" : "white"}
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
                    width={3}
                    height={14}
                    backgroundColor="white"
                    backgroundOpacity={isDragging ? 1 : 0.8}
                    borderRadius={1.5}
                    transformRotateZ={rotation}
                    positionType="absolute"
                    positionTop={6}
                />

                <Container
                    width={4}
                    height={4}
                    borderRadius={2}
                    backgroundColor="rgb(76, 201, 254)"
                    backgroundOpacity={value > 0.5 ? 1 : 0.3}
                    positionType="absolute"
                    positionBottom={6}
                />
            </Container>

            <Text fontSize={10} fontWeight="bold" color="white" opacity={0.6} letterSpacing={1}>
                {label.toUpperCase()}
            </Text>
        </Container>
    );
};

export function KnobsPanel() {
    const { knobs, setKnobs } = useMusicPlayerStore(
        useShallow((s) => ({
            knobs: s.knobs,
            setKnobs: s.actions.setKnobs,
        }))
    );

    return (
        <Container
            flexDirection="row"
            padding={16}
            gap={10}
            backgroundColor="black"
            backgroundOpacity={0.6}
            borderRadius={24}
            borderWidth={1}
            borderColor="white"
            borderOpacity={0.1}
        >
            <Knob
                label="Low"
                value={knobs.low}
                onChange={(low) => setKnobs({ low })}
            />
            <Knob
                label="Mid"
                value={knobs.mid}
                onChange={(mid) => setKnobs({ mid })}
            />
            <Knob
                label="High"
                value={knobs.high}
                onChange={(high) => setKnobs({ high })}
            />
            <Knob
                label="Vibe"
                value={knobs.resonance}
                onChange={(resonance) => setKnobs({ resonance })}
            />
            <Container width={2} height={32} backgroundColor="white" backgroundOpacity={0.1} alignSelf="center" marginX={4} />
            <Knob
                label="Vol"
                value={knobs.volume}
                onChange={(volume) => setKnobs({ volume })}
            />
        </Container>
    );
}
