"use client"

import React, { useEffect, useState } from "react";
import { Image } from "@react-three/uikit";
import { Badge } from "@react-three/uikit-default";
import { Smartphone } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";

const iconToDataUrl = (
  Icon: React.ElementType<{ size: number; color: string; strokeWidth: number }>,
) => {
  const svgString = renderToStaticMarkup(
    <Icon size={24} color="black" strokeWidth={2} />,
  );
  return `data:image/svg+xml,${encodeURIComponent(svgString)}`;
};

const MOTION_ICON = iconToDataUrl(Smartphone);

export function MotionControl() {
  const [showButton, setShowButton] = useState(false);
  const orientationEvent = DeviceOrientationEvent as typeof DeviceOrientationEvent & {
    requestPermission?: () => Promise<"granted" | "denied">;
  };

  useEffect(() => {
    if (
      typeof DeviceOrientationEvent !== "undefined" &&
      typeof orientationEvent.requestPermission === "function"
    ) {
      setShowButton(true);

      const handler = (e: DeviceOrientationEvent) => {
        if (e.alpha !== null) {
          setShowButton(false);
          window.removeEventListener("deviceorientation", handler);
        }
      };
      window.addEventListener("deviceorientation", handler);
      return () => window.removeEventListener("deviceorientation", handler);
    }
  }, []);

  const requestPermission = async () => {
    try {
    const response = await orientationEvent.requestPermission?.();
      if (response === "granted") setShowButton(false);
    } catch (e) {
      console.error(e);
    }
  };

  if (!showButton) return null;

  return (
    <Badge
      onClick={requestPermission}
      backgroundColor="white"
      padding={12}
      borderRadius={999}
      cursor="pointer"
    >
      <Image src={MOTION_ICON} width={24} height={24} />
    </Badge>
  );
}
