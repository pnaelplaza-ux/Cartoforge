import React, { useRef, useMemo } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Stars, Sky, Environment, PerformanceMonitor } from '@react-three/drei';
import { EffectComposer, Bloom, SSAO } from '@react-three/postprocessing';
import * as THREE from 'three';
import { MapData, BiomeType, biomeColors } from '../lib/mapGenerator';

interface Map3DProps {
  mapData: MapData;
  width: number;
  height: number;
  quality?: 'low' | 'medium' | 'high' | 'ultra';
  timeOfDay?: 'morning' | 'noon' | 'sunset' | 'night';
  fogDensity?: number;
}

function Terrain({ mapData, width, height, quality = 'medium' }: Map3DProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const treesRef = useRef<THREE.InstancedMesh>(null);

  const { geometry, waterGeometry, lakeGeometry, treePositions, resWood, resStone, resGold, resIron } = useMemo(() => {
    // Quality settings determine max resolution
    let maxRes = 256;
    if (quality === 'low') maxRes = 128;
    if (quality === 'medium') maxRes = 256;
    if (quality === 'high') maxRes = 512;
    if (quality === 'ultra') maxRes = 1024; // 1:1 scale for 1024x1024 maps

    // Ensure we don't go over actual width/height
    maxRes = Math.min(maxRes, Math.max(width, height));

    const stepX = Math.ceil(width / maxRes);
    const stepY = Math.ceil(height / maxRes);
    const renderWidth = Math.ceil(width / stepX);
    const renderHeight = Math.ceil(height / stepY);

    // Create a plane geometry with width and height segments
    const geo = new THREE.PlaneGeometry(width, height, renderWidth - 1, renderHeight - 1);
    
    // Morph the vertices based on elevation
    const pos = geo.attributes.position;
    const colors = new Float32Array(pos.count * 3);
    
    // We will collect active ocean faces to build a custom water geometry
    const oceanPositions: number[] = [];
    const oceanIndices: number[] = [];
    let oceanVertCount = 0;
    
    // We will also collect lake faces
    const lakePositions: number[] = [];
    const lakeIndices: number[] = [];
    let lakeVertCount = 0;
    
    // Collect features
    const tp: THREE.Matrix4[] = [];
    const resWood: THREE.Matrix4[] = [];
    const resStone: THREE.Matrix4[] = [];
    const resGold: THREE.Matrix4[] = [];
    const resIron: THREE.Matrix4[] = [];
    
    // Use a seeded basic RNG for deterministic tree placement
    let fakeSeed = 1;
    const rng = () => {
      fakeSeed = (fakeSeed * 16807) % 2147483647;
      return (fakeSeed - 1) / 2147483646;
    };
    
    const vertexZ = new Float32Array(renderHeight * renderWidth);
    
    for (let ry = 0; ry < renderHeight; ry++) {
      for (let rx = 0; rx < renderWidth; rx++) {
        const vIdx = ry * renderWidth + rx;
        const x = Math.min(rx * stepX, width - 1);
        const y = Math.min(ry * stepY, height - 1);
        
        const cell = mapData.grid[y][x];
        const elevation = cell.elevation;
        
        // Exaggerate height for 3D effect.
        const isOcean = cell.biome === BiomeType.DEEP_WATER || cell.biome === BiomeType.SHALLOW_WATER;
        const isLake = cell.biome === BiomeType.LAKE;
        const zScale = 60; 
        
        // Ocean is flattened at 0.35 to let the water plane cover it cleanly, but maybe we let it dip to show depth under water?
        // Let's actually give it actual depth, the Water plane will cover it!
        let zPos = elevation * zScale;
        if (cell.isRiver && !isLake && !isOcean && elevation > 0.35) {
           zPos -= 2.0; // Carve into the terrain
        }
        
        pos.setZ(vIdx, zPos);
        vertexZ[vIdx] = zPos;
        
        // Apply color
        let [r, g, b] = biomeColors[cell.biome];
        if (cell.isRiver && elevation > 0.35) {
           r = 60; g = 156; b = 230; // River color
           zPos -= 1.0; 
        }
        
        colors[vIdx * 3] = r / 255;
        colors[vIdx * 3 + 1] = g / 255;
        colors[vIdx * 3 + 2] = b / 255;

        // Place trees in forest/jungle randomly
        // Don't render too many trees directly on ultra, limit placement frequency based on resolution mapping to save perf
        if ((cell.biome === BiomeType.FOREST || cell.biome === BiomeType.JUNGLE) && cell.elevation > 0.35 && !cell.isRiver && rng() > 0.96) {
          const mat = new THREE.Matrix4();
          // Adjust coordinates to plane rotation
          const px = (x / width) * width - width / 2;
          const py = -(y / height) * height + height / 2;
          const s = 0.5 + rng() * 1.5;
          const rotZ = rng() * Math.PI * 2;
          const jx = (rng() - 0.5) * 2;
          const jy = (rng() - 0.5) * 2;

          mat.compose(
            new THREE.Vector3(px + jx, py + jy, zPos),
            new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ),
            new THREE.Vector3(s, s, s * (1 + rng() * 0.5)) 
          );
          tp.push(mat);
        }
      }
    }
    
    // Build Ocean and Lake Meshes explicitly
    for (let ry = 0; ry < renderHeight - 1; ry++) {
      for (let rx = 0; rx < renderWidth - 1; rx++) {
        const x = Math.min(rx * stepX, width - 1);
        const y = Math.min(ry * stepY, height - 1);
        const cell = mapData.grid[y][x];
        const isOcean = cell.biome === BiomeType.DEEP_WATER || cell.biome === BiomeType.SHALLOW_WATER || cell.biome === BiomeType.BEACH;
        const isLake = cell.biome === BiomeType.LAKE;
        
        if (isOcean || isLake) {
          const px = (x / width) * width - width / 2;
          const py = -(y / height) * height + height / 2;
          const wx = (stepX / width) * width;
          const wy = -(stepY / height) * height; // py goes down
          const waterZ = 0.35 * 60 - 0.2;
          
          if (isOcean) {
              oceanPositions.push(
                  px, py, waterZ,
                  px + wx, py, waterZ,
                  px, py + wy, waterZ,
                  px + wx, py + wy, waterZ
              );
              
              const iBase = oceanVertCount;
              oceanIndices.push(
                  iBase, iBase + 2, iBase + 1,
                  iBase + 1, iBase + 2, iBase + 3
              );
              oceanVertCount += 4;
          } else if (isLake) {
              lakePositions.push(
                  px, py, waterZ,
                  px + wx, py, waterZ,
                  px, py + wy, waterZ,
                  px + wx, py + wy, waterZ
              );
              
              const iBase = lakeVertCount;
              lakeIndices.push(
                  iBase, iBase + 2, iBase + 1,
                  iBase + 1, iBase + 2, iBase + 3
              );
              lakeVertCount += 4;
          }
        }
      }
    }

    const waterGeo = new THREE.BufferGeometry();
    if (oceanVertCount > 0) {
      waterGeo.setAttribute('position', new THREE.Float32BufferAttribute(oceanPositions, 3));
      waterGeo.setIndex(oceanIndices);
      waterGeo.computeVertexNormals();
    }
    
    const lakeGeo = new THREE.BufferGeometry();
    if (lakeVertCount > 0) {
      lakeGeo.setAttribute('position', new THREE.Float32BufferAttribute(lakePositions, 3));
      lakeGeo.setIndex(lakeIndices);
      lakeGeo.computeVertexNormals();
    }

    // Place resources
    for (const featureCell of mapData.features) {
        if (featureCell.feature) {
            const mat = new THREE.Matrix4();
            const px = (featureCell.x / width) * width - width / 2;
            const py = -(featureCell.y / height) * height + height / 2;
            let zPos = featureCell.elevation * 60;
            if (featureCell.elevation <= 0.35) zPos = 0.35 * 60; 

            if (featureCell.feature.type === 'resource') {
                const s = featureCell.feature.resourceType === 'wood' ? 1.5 : 2;
                
                // Add a random rotation to resource nodes
                const rotZ = featureCell.feature.seed * Math.PI * 2;
                mat.compose(
                  new THREE.Vector3(px, py, zPos + s/2),
                  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), rotZ),
                  new THREE.Vector3(s, s, s) 
                );
                
                if (featureCell.feature.resourceType === 'wood') resWood.push(mat);
                else if (featureCell.feature.resourceType === 'stone') resStone.push(mat);
                else if (featureCell.feature.resourceType === 'gold') resGold.push(mat);
                else if (featureCell.feature.resourceType === 'iron') resIron.push(mat);
            }
        }
    }
    
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    geo.computeVertexNormals();
    return { geometry: geo, waterGeometry: oceanVertCount > 0 ? waterGeo : null, lakeGeometry: lakeVertCount > 0 ? lakeGeo : null, treePositions: tp, resWood, resStone, resGold, resIron };
  }, [mapData, width, height, quality]);

  return (
    <group position={[0, -20, 0]}>
      <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow castShadow={quality !== 'low'}>
        {quality === 'ultra' || quality === 'high' ? (
          <meshPhysicalMaterial 
            vertexColors={true} 
            wireframe={false} 
            flatShading={false} 
            roughness={0.85} 
            metalness={0.05} 
            clearcoat={0.0}
          />
        ) : (
          <meshStandardMaterial 
            vertexColors={true} 
            wireframe={false} 
            flatShading={false} 
            roughness={0.9} 
            metalness={0.0} 
          />
        )}
      </mesh>

      {(quality === 'high' || quality === 'ultra') && treePositions.length > 0 && (
        <instancedMesh ref={(mesh) => {
          if (mesh) {
            treePositions.forEach((mat, i) => mesh.setMatrixAt(i, mat));
            mesh.instanceMatrix.needsUpdate = true;
          }
        }} args={[null as any, null as any, treePositions.length]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <coneGeometry args={[1.5, 4, 5]} />
          <meshStandardMaterial color="#225522" roughness={0.9} />
        </instancedMesh>
      )}

      {resWood.length > 0 && (
        <instancedMesh ref={(mesh) => {
          if (mesh) {
            resWood.forEach((mat, i) => mesh.setMatrixAt(i, mat));
            mesh.instanceMatrix.needsUpdate = true;
          }
        }} args={[null as any, null as any, resWood.length]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <cylinderGeometry args={[0.5, 0.5, 3]} />
          <meshStandardMaterial color="#553311" roughness={0.9} />
        </instancedMesh>
      )}
      {resStone.length > 0 && (
        <instancedMesh ref={(mesh) => {
          if (mesh) {
            resStone.forEach((mat, i) => mesh.setMatrixAt(i, mat));
            mesh.instanceMatrix.needsUpdate = true;
          }
        }} args={[null as any, null as any, resStone.length]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1.5]} />
          <meshStandardMaterial color="#888888" roughness={0.8} />
        </instancedMesh>
      )}
      {resIron.length > 0 && (
        <instancedMesh ref={(mesh) => {
          if (mesh) {
            resIron.forEach((mat, i) => mesh.setMatrixAt(i, mat));
            mesh.instanceMatrix.needsUpdate = true;
          }
        }} args={[null as any, null as any, resIron.length]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1.2]} />
          <meshStandardMaterial color="#b0a090" roughness={0.4} metalness={0.6} />
        </instancedMesh>
      )}
      {resGold.length > 0 && (
        <instancedMesh ref={(mesh) => {
          if (mesh) {
            resGold.forEach((mat, i) => mesh.setMatrixAt(i, mat));
            mesh.instanceMatrix.needsUpdate = true;
          }
        }} args={[null as any, null as any, resGold.length]} rotation={[-Math.PI / 2, 0, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[1]} />
          <meshStandardMaterial color="#ffd700" roughness={0.1} metalness={1.0} />
        </instancedMesh>
      )}

      {waterGeometry && (
        <Water geometry={waterGeometry} quality={quality} />
      )}
      {lakeGeometry && (
        <Lake geometry={lakeGeometry} quality={quality} />
      )}
    </group>
  );
}

function Lake({ geometry, quality = 'medium' }: { geometry: THREE.BufferGeometry, quality?: 'low' | 'medium' | 'high' | 'ultra' }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshPhysicalMaterial 
         color="#1D8CA3" // Different color for lakes
         transparent 
         opacity={quality === 'ultra' ? 0.8 : 0.6} 
         roughness={0.1} // Less rough, still water
         metalness={quality === 'low' ? 0.1 : 0.8} 
         clearcoat={quality !== 'low' ? 1.0 : 0.0}
         clearcoatRoughness={0.0}
      />
    </mesh>
  );
}

function Water({ geometry, quality = 'medium' }: { geometry: THREE.BufferGeometry, quality?: 'low' | 'medium' | 'high' | 'ultra' }) {
  const meshRef = useRef<THREE.Mesh>(null);
  
  useFrame(({ clock }) => {
    if (meshRef.current && quality !== 'low') {
      const t = clock.getElapsedTime();
      // Animate the whole chunk slightly for gentle wave effect
      meshRef.current.position.z = Math.sin(t * 1.5) * 0.5;
    }
  });

  return (
    <mesh ref={meshRef} geometry={geometry} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <meshPhysicalMaterial 
         color="#2B6CC4" 
         transparent 
         opacity={quality === 'ultra' ? 0.8 : 0.6} 
         roughness={0.05} 
         metalness={quality === 'low' ? 0.2 : 0.9} 
         clearcoat={quality !== 'low' ? 1.0 : 0.0}
         clearcoatRoughness={0.1}
      />
    </mesh>
  );
}

export default function Map3D({ mapData, width, height, quality = 'medium', timeOfDay = 'sunset', fogDensity = 0.5 }: Map3DProps) {
  const [dpr, setDpr] = React.useState(1.5);
  const shadowSize = quality === 'ultra' ? 4096 : quality === 'high' ? 2048 : quality === 'medium' ? 1024 : 512;
  const enableShadows = quality !== 'low';

  // Determine lighting & sky based on timeOfDay
  let sunPosition: [number, number, number] = [100, 40, 100];
  let ambientLightProps = { intensity: 0.4, color: '#ffffff' };
  let dirLightProps = { intensity: 1.5, color: '#ffffff' };
  let skyProps = { turbidity: 0.3, rayleigh: 0.5, mieCoefficient: 0.005, mieDirectionalG: 0.8 };
  let fogColor = '#0f111a';
  let fogNear = 100;
  let fogFar = 800 - (fogDensity * 600); // 200 (dense) to 800 (sparse)

  switch (timeOfDay) {
    case 'morning':
      sunPosition = [-150, 60, -50];
      ambientLightProps = { intensity: 0.4, color: '#e0f0ff' };
      dirLightProps = { intensity: 1.2, color: '#ffecce' };
      skyProps = { turbidity: 1.0, rayleigh: 1.5, mieCoefficient: 0.01, mieDirectionalG: 0.7 };
      fogColor = '#c8dfee';
      break;
    case 'noon':
      sunPosition = [0, 400, 50];
      ambientLightProps = { intensity: 0.6, color: '#ffffff' };
      dirLightProps = { intensity: 1.8, color: '#ffffff' };
      skyProps = { turbidity: 0.1, rayleigh: 0.2, mieCoefficient: 0.001, mieDirectionalG: 0.9 };
      fogColor = '#a8cbf0';
      break;
    case 'sunset':
      sunPosition = [150, 10, 100];
      ambientLightProps = { intensity: 0.2, color: '#ffd2a6' };
      dirLightProps = { intensity: 2.5, color: '#ff9d42' };
      skyProps = { turbidity: 3.0, rayleigh: 2.0, mieCoefficient: 0.02, mieDirectionalG: 0.8 };
      fogColor = '#ffb37b';
      break;
    case 'night':
      sunPosition = [0, -100, 0]; // Sun below horizon
      ambientLightProps = { intensity: 0.1, color: '#5566aa' };
      dirLightProps = { intensity: 0.2, color: '#7788dd' }; // Moonlight
      skyProps = { turbidity: 0.1, rayleigh: 0.1, mieCoefficient: 0.001, mieDirectionalG: 0.9 }; // Won't show much, rely on Stars
      fogColor = '#05070f';
      break;
  }

  // If density is 0, push fog far away
  if (fogDensity === 0) {
    fogFar = 5000;
  }

  return (
    <div className="w-full h-full bg-slate-900 pointer-events-auto cursor-grab active:cursor-grabbing">
      <Canvas dpr={dpr} shadows={enableShadows} camera={{ position: [0, 150, 200], fov: 60 }} gl={{ antialias: quality !== 'low', powerPreference: "high-performance" }}>
        <PerformanceMonitor onIncline={() => setDpr(1.5)} onDecline={() => setDpr(max => Math.max(0.75, max - 0.25))} />
        <fog attach="fog" args={[fogColor, fogNear, fogFar]} />
        <Sky sunPosition={sunPosition} {...skyProps} />
        {timeOfDay === 'night' && <Stars radius={100} depth={50} count={5000} factor={4} saturation={0} fade speed={1} />}
        
        <ambientLight {...ambientLightProps} />
        <directionalLight 
           position={timeOfDay === 'night' ? [100, 100, 100] : sunPosition} // Moonlight from above if night
           {...dirLightProps}
           castShadow={enableShadows} 
           shadow-mapSize-width={shadowSize} 
           shadow-mapSize-height={shadowSize} 
           shadow-camera-left={-width/2}
           shadow-camera-right={width/2}
           shadow-camera-top={height/2}
           shadow-camera-bottom={-height/2}
           shadow-camera-near={0.5}
           shadow-camera-far={timeOfDay === 'night' ? 600 : Math.max(800, Math.max(width, height))}
           shadow-bias={-0.0005}
        />
        <Terrain mapData={mapData} width={width} height={height} quality={quality} />
        {quality !== 'low' && timeOfDay !== 'night' && <Environment preset={timeOfDay === 'sunset' ? 'sunset' : timeOfDay === 'morning' ? 'dawn' : 'city'} />}
        {quality !== 'low' && timeOfDay === 'night' && <Environment preset="night" />}
        <OrbitControls makeDefault maxPolarAngle={Math.PI / 2 - 0.05} maxDistance={600} />

        {quality === 'ultra' && (
          <EffectComposer disableNormalPass>
            <SSAO radius={1.0} intensity={100} luminanceInfluence={0.5} color="black" />
            <Bloom luminanceThreshold={0.8} luminanceSmoothing={0.9} height={300} intensity={0.5} />
          </EffectComposer>
        )}
      </Canvas>
    </div>
  );
}
