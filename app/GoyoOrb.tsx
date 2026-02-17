"use client";

import { useRef, useMemo } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";

interface OrbProps {
  state: "idle" | "listening" | "speaking" | "processing";
}

function AnimatedOrb({ state }: OrbProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const lightRef = useRef<THREE.PointLight>(null);
  
  // Colores según estado
  const colors = useMemo(() => ({
    idle: "#4a5568",
    listening: "#ef4444",
    speaking: "#22c55e", 
    processing: "#eab308"
  }), []);

  const targetColor = useMemo(() => new THREE.Color(colors[state]), [state, colors]);

  useFrame((_, delta) => {
    if (!meshRef.current) return;

    // Rotación suave
    meshRef.current.rotation.y += delta * 0.3;
    meshRef.current.rotation.x += delta * 0.1;

    // Escala pulsante según estado
    const baseScale = state === "idle" ? 1 : 1.1;
    const pulseSpeed = state === "listening" ? 4 : state === "speaking" ? 6 : 2;
    const pulseAmount = state === "idle" ? 0.02 : 0.08;
    const scale = baseScale + Math.sin(Date.now() * 0.001 * pulseSpeed) * pulseAmount;
    meshRef.current.scale.setScalar(scale);

    // Interpolar color
    const material = meshRef.current.material as THREE.MeshStandardMaterial;
    if (material.color) {
      material.color.lerp(targetColor, delta * 3);
    }

    // Luz
    if (lightRef.current) {
      lightRef.current.intensity = 1 + Math.sin(Date.now() * 0.003) * 0.3;
    }
  });

  return (
    <group>
      {/* Luz principal */}
      <pointLight ref={lightRef} position={[0, 0, 3]} intensity={1} color="#ffffff" />
      <ambientLight intensity={0.3} />
      
      {/* Orbe principal */}
      <Sphere ref={meshRef} args={[1, 64, 64]}>
        <MeshDistortMaterial
          color={colors[state]}
          attach="material"
          distort={state === "idle" ? 0.2 : 0.4}
          speed={state === "listening" ? 4 : 2}
          roughness={0.2}
          metalness={0.8}
        />
      </Sphere>

      {/* Anillo exterior */}
      <mesh rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[1.5, 0.02, 16, 100]} />
        <meshStandardMaterial 
          color={colors[state]} 
          emissive={colors[state]}
          emissiveIntensity={0.5}
          transparent
          opacity={0.6}
        />
      </mesh>
    </group>
  );
}

function Particles() {
  const count = 50;
  const particlesRef = useRef<THREE.Points>(null);

  const positions = useMemo(() => {
    const pos = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(Math.random() * 2 - 1);
      const r = 2 + Math.random() * 1;
      pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      pos[i * 3 + 2] = r * Math.cos(phi);
    }
    return pos;
  }, []);

  useFrame((_, delta) => {
    if (particlesRef.current) {
      particlesRef.current.rotation.y += delta * 0.1;
    }
  });

  return (
    <points ref={particlesRef}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          count={count}
          array={positions}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.03}
        color="#6366f1"
        transparent
        opacity={0.6}
        sizeAttenuation
      />
    </points>
  );
}

export default function GoyoOrb({ state }: OrbProps) {
  return (
    <div className="w-full h-64 relative">
      <Canvas
        camera={{ position: [0, 0, 4], fov: 50 }}
        dpr={[1, 1.5]} // Limitar pixel ratio para menos GPU
        performance={{ min: 0.5 }}
      >
        <AnimatedOrb state={state} />
        <Particles />
      </Canvas>
      
      {/* Label debajo */}
      <div className="absolute bottom-2 left-0 right-0 text-center">
        <span className={`text-xs px-3 py-1 rounded-full ${
          state === "listening" ? "bg-red-600" :
          state === "speaking" ? "bg-green-600" :
          state === "processing" ? "bg-yellow-600" :
          "bg-zinc-700"
        }`}>
          {state === "listening" ? "🎤 Escuchando" :
           state === "speaking" ? "🔊 Hablando" :
           state === "processing" ? "⏳ Procesando" :
           "💤 Esperando"}
        </span>
      </div>
    </div>
  );
}
