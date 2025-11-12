import { useEffect, useRef, useLayoutEffect, useMemo } from "react";
import { extend, useThree } from "@react-three/fiber";
import { shaderMaterial, useTexture, useVideoTexture } from "@react-three/drei";
import * as THREE from "three";

// Type for the custom shader material
type CustomVideoMaterialType = THREE.ShaderMaterial & {
  map: THREE.Texture | null;
  viewportResolution: THREE.Vector2;
  videoResolution: THREE.Vector2;
};

// Extend JSX types for custom material
declare global {
  namespace JSX {
    interface IntrinsicElements {
      customVideoMaterial: {
        ref?: React.Ref<CustomVideoMaterialType>;
        depthWrite?: boolean;
        [key: string]: any;
      };
    }
  }
}

function VideoBackground() {
  const { viewport, camera } = useThree();

  const materialRef = useRef<CustomVideoMaterialType>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const CustomVideoMaterial = useMemo(
    () =>
      shaderMaterial(
        {
          time: 0,
          map: null,
          viewportResolution: new THREE.Vector2(
            window.innerWidth,
            window.innerHeight
          ),
          videoResolution: new THREE.Vector2(20, 10),
        },
        // vertex shader
        /*glsl*/ `
          varying vec2 vUv;
          varying vec2 vScreenPos;
          void main() {
            vUv = uv;
            vScreenPos = position.xy;
            // gl_Position = vec4(position, 1.0); // for 2d
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
        // fragment shader
        /*glsl*/ `
          uniform float time;
          uniform sampler2D map;
          uniform vec2 viewportResolution;
          uniform vec2 videoResolution;
          varying vec2 vUv;
          varying vec2 vScreenPos;
      
          void main() {
            // Calculate aspect ratios
            float viewportAspect = viewportResolution.x / viewportResolution.y;
            float videoAspect = videoResolution.x / videoResolution.y;
            
            // Convert screen position to normalized UV coordinates [0, 1]
            vec2 screenUV = (vScreenPos + 1.0) * 0.5;
            
            // Calculate scale factor to cover the screen
            float scale;
            vec2 offset = vec2(0.0);
            
            if (videoAspect > viewportAspect) {
              // Video is wider than viewport
              scale = viewportAspect / videoAspect;
              offset.x = (1.0 - scale) * 0.5;
              screenUV.x = screenUV.x * scale + offset.x;
            } else {
              // Video is taller than viewport
              scale = videoAspect / viewportAspect;
              offset.y = (1.0 - scale) * 0.25;
              screenUV.y = screenUV.y * scale + offset.y;
            }
            
            // Clamp to ensure we don't go outside texture bounds
            screenUV = clamp(screenUV, 0.0, 1.0);
            
            vec4 texColor = texture2D(map, screenUV);
            vec3 finalColor = mix(texColor.rgb, vec3(0.0, 0.0, 0.0), 0.3);
            gl_FragColor = vec4(finalColor, 1.0);
          }
        `
      ),
    []
  );

  // Extend the material for use in React Three Fiber
  extend({ CustomVideoMaterial });

  const videoTexture = useVideoTexture(`/video.mp4`, {
    start: true,
    muted: true,
    loop: true,
  });

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.map = videoTexture;
    }
  }, [videoTexture]);

  // Function to update dimensions
  const updateDimensions = () => {
    if (materialRef.current) {
      materialRef.current.viewportResolution.set(
        viewport.width,
        viewport.height
      );
    }
    if (meshRef.current) {
      meshRef.current.scale.set(viewport.width / 1.5, viewport.height / 1.5, 1);
    }
  };

  // Initialize dimensions synchronously before first render
  useLayoutEffect(() => {
    updateDimensions();
    if (materialRef.current && videoTexture) {
      materialRef.current.map = videoTexture;
    }
  }, []);

  // Update viewport dimensions when they change
  useEffect(() => {
    updateDimensions();
  }, [viewport]);

  // Listen for camera changes (FOV animations, etc.)
  useEffect(() => {
    updateDimensions();
  }, [camera, viewport]);

  // Ensure texture is always applied when it changes
  useEffect(() => {
    if (materialRef.current && videoTexture) {
      materialRef.current.map = videoTexture;
    }
  }, []);

  return (
    <mesh
      position={[0, 0, -1.5]}
      ref={meshRef}
      scale={[viewport.width, viewport.height, 1]}
    >
      <planeGeometry args={[2.5, 2.5]} />
      {/* @ts-expect-error - customVideoMaterial is extended via extend() */}
      <customVideoMaterial ref={materialRef} depthWrite={false} />
    </mesh>
  );
}

function ImageBackground({ imageName }: { imageName: string }) {
  const { viewport, camera } = useThree();

  const materialRef = useRef<CustomVideoMaterialType>(null);
  const meshRef = useRef<THREE.Mesh>(null);

  const CustomVideoMaterial = shaderMaterial(
    {
      time: 0,
      map: null,
      viewportResolution: new THREE.Vector2(
        window.innerWidth,
        window.innerHeight
      ),
      videoResolution: new THREE.Vector2(20, 10),
    },
    // vertex shader
    /*glsl*/ `
          varying vec2 vUv;
          varying vec2 vScreenPos;
          void main() {
            vUv = uv;
            vScreenPos = position.xy;
            // gl_Position = vec4(position, 1.0);
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          }
        `,
    // fragment shader
    /*glsl*/ `
          uniform float time;
          uniform sampler2D map;
          uniform vec2 viewportResolution;
          uniform vec2 videoResolution;
          varying vec2 vUv;
          varying vec2 vScreenPos;
      
          void main() {
            // Calculate aspect ratios
            float viewportAspect = viewportResolution.x / viewportResolution.y;
            float videoAspect = videoResolution.x / videoResolution.y;
            
            // Convert screen position to normalized UV coordinates [0, 1]
            vec2 screenUV = (vScreenPos + 1.0) * 0.5;
            
            // Calculate scale factor to cover the screen
            float scale;
            vec2 offset = vec2(0.0);
            
            if (videoAspect > viewportAspect) {
              // Video is wider than viewport
              scale = viewportAspect / videoAspect;
              offset.x = (1.0 - scale) * 0.5;
              screenUV.x = screenUV.x * scale + offset.x;
            } else {
              // Video is taller than viewport
              scale = videoAspect / viewportAspect;
              offset.y = (1.0 - scale) * 0.25;
              screenUV.y = screenUV.y * scale + offset.y;
            }
            
            // Clamp to ensure we don't go outside texture bounds
            screenUV = clamp(screenUV, 0.0, 1.0);
            
            vec4 texColor = texture2D(map, screenUV);
            vec3 finalColor = mix(texColor.rgb, vec3(0.0, 0.0, 0.0), 0.2);
            gl_FragColor = vec4(finalColor, 1.0);
          }
        `
  );

  extend({ CustomVideoMaterial });

  const imageTexture = useTexture(`/${imageName}.jpg`);

  useEffect(() => {
    if (materialRef.current) {
      materialRef.current.map = imageTexture;
    }
  }, [imageTexture]);

  // Function to update dimensions
  const updateDimensions = () => {
    if (materialRef.current) {
      materialRef.current.viewportResolution.set(
        viewport.width,
        viewport.height
      );
    }
    if (meshRef.current) {
      meshRef.current.scale.set(viewport.width / 1.5, viewport.height / 1.5, 1);
    }
  };

  // Initialize dimensions synchronously before first render
  useLayoutEffect(() => {
    updateDimensions();
    if (materialRef.current && imageTexture) {
      materialRef.current.map = imageTexture;
    }
  }, []);

  // Update viewport dimensions when they change
  useEffect(() => {
    updateDimensions();
  }, [viewport]);

  // Listen for camera changes (FOV animations, etc.)
  useEffect(() => {
    updateDimensions();
  }, [camera, viewport]);

  // Ensure texture is always applied when it changes
  useEffect(() => {
    if (materialRef.current && imageTexture) {
      materialRef.current.map = imageTexture;
    }
  }, []);

  return (
    <mesh
      position={[0, 0, -1.5]}
      ref={meshRef}
      scale={[viewport.width, viewport.height, 1]}
    >
      <planeGeometry args={[2.5, 2.5]} />
      {/* @ts-expect-error - customVideoMaterial is extended via extend() */}
      <customVideoMaterial ref={materialRef} depthWrite={false} />
    </mesh>
  );
}

export default function BackgroundImageCover() {
  return <VideoBackground />
}