"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

interface BlobProps {
  state: "idle" | "listening" | "speaking" | "processing";
}

function Blob({ state }: BlobProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  // Más distorsión cuando habla/escucha
  const distortion = useMemo(() => {
    switch (state) {
      case "speaking": return 0.6;
      case "listening": return 0.5;
      case "processing": return 0.4;
      default: return 0.25;
    }
  }, [state]);

  const speed = useMemo(() => {
    switch (state) {
      case "speaking": return 5;
      case "listening": return 3;
      case "processing": return 2;
      default: return 1;
    }
  }, [state]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;
    meshRef.current.rotation.y += delta * 0.2;
    meshRef.current.rotation.x += delta * 0.1;
    
    // Escala pulsante
    const pulse = state === "idle" ? 0.02 : 0.06;
    const scale = 1 + Math.sin(Date.now() * 0.003 * speed) * pulse;
    meshRef.current.scale.setScalar(scale);
  });

  return (
    <mesh ref={meshRef}>
      <sphereGeometry args={[1.2, 64, 64]} />
      <MeshDistortMaterial
        color="#22c55e"
        attach="material"
        distort={distortion}
        speed={speed}
        roughness={0.1}
        metalness={0.1}
        transparent
        opacity={0.9}
      />
    </mesh>
  );
}

// Burbujas pequeñas flotando
function Bubbles() {
  const count = 20;
  const meshRefs = useRef<THREE.Mesh[]>([]);
  
  const bubbles = useMemo(() => {
    return Array.from({ length: count }, (_, i) => ({
      position: [
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 4,
        (Math.random() - 0.5) * 2 - 1
      ] as [number, number, number],
      scale: 0.05 + Math.random() * 0.1,
      speed: 0.5 + Math.random() * 1,
      offset: Math.random() * Math.PI * 2
    }));
  }, []);

  useFrame(({ clock }) => {
    meshRefs.current.forEach((mesh, i) => {
      if (mesh) {
        const t = clock.elapsedTime * bubbles[i].speed + bubbles[i].offset;
        mesh.position.y = bubbles[i].position[1] + Math.sin(t) * 0.3;
        mesh.position.x = bubbles[i].position[0] + Math.cos(t * 0.7) * 0.1;
      }
    });
  });

  return (
    <>
      {bubbles.map((bubble, i) => (
        <mesh
          key={i}
          ref={(el) => { if (el) meshRefs.current[i] = el; }}
          position={bubble.position}
          scale={bubble.scale}
        >
          <sphereGeometry args={[1, 16, 16]} />
          <meshStandardMaterial
            color="#22c55e"
            transparent
            opacity={0.4}
          />
        </mesh>
      ))}
    </>
  );
}

export default function GoyoBlob({ state }: BlobProps) {
  return (
    <div className="w-full h-80">
      <Canvas
        camera={{ position: [0, 0, 4], fov: 45 }}
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.6} />
        <pointLight position={[5, 5, 5]} intensity={0.8} color="#ffffff" />
        <pointLight position={[-5, -5, 5]} intensity={0.4} color="#22c55e" />
        <Blob state={state} />
        <Bubbles />
      </Canvas>
    </div>
  );
}
