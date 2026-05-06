import { createNoise2D } from 'simplex-noise';

// Simple Mulberry32 PRNG
export function createPRNG(seedStr: string) {
  let h = 1779033703 ^ seedStr.length;
  for (let i = 0; i < seedStr.length; i++) {
    h = Math.imul(h ^ seedStr.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = (function () {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  })();

  return function () {
    let t = (a += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export enum BiomeType {
  DEEP_WATER = 'DEEP_WATER',
  SHALLOW_WATER = 'SHALLOW_WATER',
  LAKE = 'LAKE',
  BEACH = 'BEACH',
  DESERT = 'DESERT',
  SAVANNA = 'SAVANNA',
  GRASSLAND = 'GRASSLAND',
  FOREST = 'FOREST',
  JUNGLE = 'JUNGLE',
  ROCK = 'ROCK',
  SNOW = 'SNOW',
}

export interface MapFeature {
  type: 'resource';
  resourceType: 'wood' | 'stone' | 'iron' | 'gold';
  population?: number;
  x: number;
  y: number;
  seed: number; // for procedural drawing
}

export interface CellData {
  x: number;
  y: number;
  elevation: number;
  moisture: number;
  temperature: number;
  biome: BiomeType;
  isRiver: boolean;
  hasRoad: boolean;
  hasShippingRoute: boolean;
  hasFlightPath: boolean;
  feature?: MapFeature;
}

export interface PathData {
  type: 'road' | 'river' | 'shipping' | 'flight';
  points: {x: number, y: number}[];
  width?: number; // Custom width for rendering
  flowSpeed?: number;
}

export interface MapData {
  grid: CellData[][];
  paths: PathData[];
  features: CellData[];
}

export interface MapGenConfig {
  seed: string;
  width: number;
  height: number;
  scale: number;
  octaves: number;
  persistence: number;
  lacunarity: number;
  waterLevel: number;
  moistureScale: number;
  temperatureOffset: number;
  resourceDensity: number;
  riverCount: number;
  riverMeander: number;
  riverWidth: number;
  riverFlowSpeed: number;
  islandFalloff: number;
}

export class DefaultConfig implements MapGenConfig {
  seed = 'island-seed-123';
  width = 1024;
  height = 1024;
  scale = 200;
  octaves = 8;
  persistence = 0.5;
  lacunarity = 2;
  waterLevel = 0.35;
  moistureScale = 300;
  temperatureOffset = 0;
  resourceDensity = 0.15;
  riverCount = 30;
  riverMeander = 0.3;
  riverWidth = 2.0;
  riverFlowSpeed = 1.0;
  islandFalloff = 1.0;
}

export function generateMap(config: MapGenConfig): MapData {
  const prng = createPRNG(config.seed);
  const elevationNoise = createNoise2D(prng);
  
  // Use a different offset for moisture
  const prng2 = createPRNG(config.seed + '-moisture');
  const moistureNoise = createNoise2D(prng2);

  const grid: CellData[][] = [];
  const paths: PathData[] = [];
  const mapCenter = { x: config.width / 2, y: config.height / 2 };
  const maxDist = Math.min(config.width, config.height) / 2;

  let minElev = Infinity;
  let maxElev = -Infinity;

  // 1. Base Elevation & Moisture
  for (let y = 0; y < config.height; y++) {
    grid[y] = [];
    for (let x = 0; x < config.width; x++) {
      let amplitude = 1;
      let frequency = 1;
      let elevation = 0;
      let moisture = 0;
      let maxAmp = 0;

      // FBM for domain warping to create extremely smooth and organic terrain shapes
      let warpX = 0;
      let warpY = 0;
      let wAmp = 25;
      let wFreq = 1 / 150;
      for (let o = 0; o < 3; o++) {
         warpX += elevationNoise(x * wFreq, y * wFreq) * wAmp;
         warpY += elevationNoise((x + 100) * wFreq, (y + 100) * wFreq) * wAmp;
         wAmp *= 0.5;
         wFreq *= 2.0;
      }

      for (let o = 0; o < config.octaves; o++) {
        const sampleX = ((x + warpX) / config.scale) * frequency;
        const sampleY = ((y + warpY) / config.scale) * frequency;

        // Use ridged noise for higher octaves to create mountain peaks
        let n = elevationNoise(sampleX, sampleY);
        if (o > 0) {
           n = 1.0 - Math.abs(n); // ridged
           n = n * n * 2 - 1; // expand range slightly
        }

        elevation += n * amplitude;
        
        const mSampleX = (x / config.moistureScale) * frequency;
        const mSampleY = (y / config.moistureScale) * frequency;
        moisture += moistureNoise(mSampleX, mSampleY) * amplitude;

        maxAmp += amplitude;
        amplitude *= config.persistence;
        frequency *= config.lacunarity;
      }

      // Normalize strictly to 0-1 range based on maximum possible amplitude
      elevation = (elevation / maxAmp + 1) / 2;
      moisture = (moisture / maxAmp + 1) / 2;

      // Island Falloff
      const dx = x - mapCenter.x;
      const dy = y - mapCenter.y;
      const distance = Math.sqrt(dx * dx + dy * dy);
      let normalizedDist = distance / maxDist;
      
      // Smooth falloff curve
      let gradient = 1 - Math.pow(normalizedDist, config.islandFalloff);
      gradient = Math.max(0, Math.min(1, gradient));
      
      // Apply smooth gradient
      elevation = elevation * gradient;

      if (elevation < minElev) minElev = elevation;
      if (elevation > maxElev) maxElev = elevation;

      grid[y][x] = {
        x,
        y,
        elevation,
        moisture,
        temperature: 0.5, // Will be set in next pass
        biome: BiomeType.DEEP_WATER,
        isRiver: false,
        hasRoad: false,
        hasShippingRoute: false,
        hasFlightPath: false,
      };
    }
  }

  // Normalize grid and Assign Biomes
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const cell = grid[y][x];
      
      const elev = cell.elevation;
      const moist = cell.moisture;
      // Latitude-based temperature (colder at edges, warmer at center)
      // or standard from top to bottom (colder at top and bottom)
      const lat = Math.abs(y - config.height / 2) / (config.height / 2);
      const temperature = 1.0 - lat * 0.8 - (elev * 0.4) + config.temperatureOffset;

      let biome = BiomeType.DEEP_WATER;

      if (elev < config.waterLevel - 0.1) {
        biome = BiomeType.DEEP_WATER;
      } else if (elev < config.waterLevel) {
        biome = BiomeType.SHALLOW_WATER;
      } else if (elev < config.waterLevel + 0.05) {
        biome = BiomeType.BEACH;
      } else if (elev > 0.8 || temperature < 0.2) {
        biome = BiomeType.SNOW;
      } else if (elev > 0.65) {
        biome = BiomeType.ROCK;
      } else {
        // Flat land biomes based on moisture & temperature
        if (temperature < 0.4 && moist < 0.5) biome = BiomeType.GRASSLAND; 
        else if (temperature < 0.4) biome = BiomeType.FOREST;
        else if (moist < 0.3) biome = BiomeType.DESERT;
        else if (moist < 0.45) biome = BiomeType.SAVANNA;
        else if (moist < 0.7) biome = BiomeType.GRASSLAND;
        else if (moist < 0.85) biome = BiomeType.FOREST;
        else biome = BiomeType.JUNGLE;
      }

      cell.temperature = temperature;
      cell.biome = biome;
    }
  }

  // 1.5 Flood fill oceans. Any water not touched by map edges is a lake.
  const visited = new Set<string>();
  const isOcean = new Set<string>();
  const stack: {x: number, y: number}[] = [];
  
  // push edges
  for(let x = 0; x < config.width; x++) {
      if (grid[0][x].elevation < config.waterLevel) { stack.push({x, y: 0}); isOcean.add(`0,${x}`); visited.add(`0,${x}`); }
      if (grid[config.height-1][x].elevation < config.waterLevel) { stack.push({x, y: config.height-1}); isOcean.add(`${config.height-1},${x}`); visited.add(`${config.height-1},${x}`); }
  }
  for(let y = 1; y < config.height-1; y++) {
      if (grid[y][0].elevation < config.waterLevel) { stack.push({x: 0, y}); isOcean.add(`${y},0`); visited.add(`${y},0`); }
      if (grid[y][config.width-1].elevation < config.waterLevel) { stack.push({x: config.width-1, y}); isOcean.add(`${y},${config.width-1}`); visited.add(`${y},${config.width-1}`); }
  }

  const dirs = [[0,1], [1,0], [0,-1], [-1,0]];
  while(stack.length > 0) {
      const curr = stack.pop()!;
      for(const [dy, dx] of dirs) {
          const ny = curr.y + dy, nx = curr.x + dx;
          if (ny >= 0 && ny < config.height && nx >= 0 && nx < config.width) {
              const key = `${ny},${nx}`;
              if (!visited.has(key)) {
                  visited.add(key);
                  if (grid[ny][nx].elevation < config.waterLevel) {
                      isOcean.add(key);
                      stack.push({x: nx, y: ny});
                  }
              }
          }
      }
  }

  // Assign LAKE biome to water that isn't ocean
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      if (grid[y][x].elevation < config.waterLevel && !isOcean.has(`${y},${x}`)) {
          grid[y][x].biome = BiomeType.LAKE;
          // Optionally make lakes flatter
          grid[y][x].elevation = grid[y][x].elevation * 0.5 + config.waterLevel * 0.5;
      }
    }
  }

  // 2. Generate Rivers
  for (let i = 0; i < config.riverCount; i++) {
    let rx = Math.floor(prng() * config.width);
    let ry = Math.floor(prng() * config.height);

    let startCell = grid[ry] && grid[ry][rx];
    // Start rivers in mountains or forests
    if (startCell && startCell.elevation > 0.6 && startCell.elevation < 0.85) {
      let current = startCell;
      let failsafe = 0;
      const maxRiverLength = config.width * 2;
      const riverPath: {x:number, y:number}[] = [ {x: current.x, y: current.y} ];

      while (current && current.elevation >= config.waterLevel && failsafe < maxRiverLength) {
        current.isRiver = true;

        // Apply width to grid (so 3D can use it too)
        if (config.riverWidth > 1) {
            const wR = Math.floor(config.riverWidth / 2);
            for (let dy = -wR; dy <= wR; dy++) {
                for (let dx = -wR; dx <= wR; dx++) {
                    const nx = current.x + dx;
                    const ny = current.y + dy;
                    if (nx > 0 && nx < config.width - 1 && ny > 0 && ny < config.height - 1) {
                        grid[ny][nx].isRiver = true;
                    }
                }
            }
        }

        // Find lower neighbors
        const neighbors = [
          { dx: 0, dy: -1 }, { dx: 1, dy: 0 }, { dx: 0, dy: 1 }, { dx: -1, dy: 0 },
          { dx: 1, dy: 1 }, { dx: -1, dy: -1 }, { dx: 1, dy: -1 }, { dx: -1, dy: 1 }
        ];

        let lowerNeighbors: CellData[] = [];

        for (const n of neighbors) {
          const nx = current.x + n.dx;
          const ny = current.y + n.dy;
          if (nx >= 0 && nx < config.width && ny >= 0 && ny < config.height) {
            const neighbor = grid[ny][nx];
            if (neighbor.elevation <= current.elevation + 0.01) {
              lowerNeighbors.push(neighbor);
            }
          }
        }

        let nextNeighbor: CellData | null = null;
        if (lowerNeighbors.length > 0) {
            lowerNeighbors.sort((a, b) => a.elevation - b.elevation);

            // Meandering logic
            if (prng() < config.riverMeander && lowerNeighbors.length > 1) {
                const maxIdx = Math.max(1, Math.floor(lowerNeighbors.length / 2));
                nextNeighbor = lowerNeighbors[Math.floor(prng() * maxIdx)];
            } else {
                nextNeighbor = lowerNeighbors[0];
            }
        }

        // Check cycle or end condition
        if (!nextNeighbor || nextNeighbor === current || riverPath.some(p => p.x === nextNeighbor!.x && p.y === nextNeighbor!.y)) {
          break; // Hit a pool or cycle
        }
        
        if (nextNeighbor.isRiver && failsafe > 0) {
           riverPath.push({x: nextNeighbor.x, y: nextNeighbor.y});
           break; // merge into existing river
        }

        current = nextNeighbor;
        riverPath.push({x: current.x, y: current.y});
        failsafe++;
      }
      
      if (riverPath.length > 3) {
         paths.push({ 
           type: 'river', 
           points: riverPath,
           width: config.riverWidth,
           flowSpeed: config.riverFlowSpeed
         });
      }
    }
  }

  // 3. Generate Resources
  const features: CellData[] = [];

  if (config.resourceDensity > 0) {
     const totalCells = config.width * config.height;
     const numResources = Math.floor(totalCells * config.resourceDensity * 0.005); // scale down sensibly
     for (let i = 0; i < numResources; i++) {
       let cx = Math.floor(prng() * config.width);
       let cy = Math.floor(prng() * config.height);
       let cell = grid[cy][cx];
       if (cell.elevation > config.waterLevel && !cell.feature) {
          let resType: 'wood' | 'stone' | 'iron' | 'gold' = 'wood';
          if (cell.biome === BiomeType.FOREST || cell.biome === BiomeType.JUNGLE) resType = 'wood';
          else if (cell.biome === BiomeType.ROCK) resType = (prng() > 0.8) ? 'iron' : 'stone';
          else if (cell.biome === BiomeType.SNOW && prng() > 0.9) resType = 'gold';
          else continue; // don't place

          cell.feature = { type: 'resource', resourceType: resType, x: cx, y: cy, seed: prng() };
          features.push(cell);
       }
     }
  }

  return { grid, paths, features };
}

export function generateRobloxScript(mapData: MapData, config: MapGenConfig): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  
  let chunks = [];
  let mapString = "";
  for (let y = 0; y < config.height; y++) {
    for (let x = 0; x < config.width; x++) {
      const cell = mapData.grid[y][x];
      // Height (0 to 63 to keep it one char)
      const hStr = chars[Math.floor(Math.max(0, Math.min(1, cell.elevation)) * 63)];
      
      // Material (1 char)
      let matIdx = 0;
      switch (cell.biome) {
          case BiomeType.DEEP_WATER:
          case BiomeType.SHALLOW_WATER:
          case BiomeType.BEACH: matIdx = 1; break; // Sand
          case BiomeType.DESERT: matIdx = 2; break; // Sand
          case BiomeType.SAVANNA: matIdx = 3; break; // LeafyGrass
          case BiomeType.GRASSLAND: matIdx = 4; break; // Grass
          case BiomeType.FOREST:
          case BiomeType.JUNGLE: matIdx = 5; break; // LeafyGrass
          case BiomeType.ROCK: matIdx = 6; break; // Rock
          case BiomeType.SNOW: matIdx = 7; break; // Snow
      }
      
      if (cell.isRiver) matIdx = 8; // Water
      
      mapString += hStr + chars[matIdx];
      
      if (mapString.length > 80000) { // Keep well under typical Lua limits limit per string literal
          chunks.push(`"${mapString}"`);
          mapString = "";
      }
    }
  }
  if (mapString.length > 0) chunks.push(`"${mapString}"`);

  return `-- CartoForge Roblox Terrain Generator
-- Place this in ServerScriptService and run the game.

local mapChunks = {
${chunks.map(c => `  ${c},`).join('\n')}
}
local mapString = table.concat(mapChunks)

local width = ${config.width}
local height = ${config.height}
local scale = 1 -- 1 pixel = 1 stud (which translates to 1/4 voxel, but we'll use 4 studs per block)

-- Character map decoder
local b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
local charMap = {}
for i = 1, #b64 do
    charMap[b64:sub(i,i)] = i - 1
end

local materials = {
    [0] = Enum.Material.Water,
    [1] = Enum.Material.Sand,
    [2] = Enum.Material.Sand,
    [3] = Enum.Material.LeafyGrass,
    [4] = Enum.Material.Grass,
    [5] = Enum.Material.LeafyGrass,
    [6] = Enum.Material.Rock,
    [7] = Enum.Material.Snow,
    [8] = Enum.Material.Water,
}

local Terrain = workspace.Terrain
Terrain:Clear()

print("Generating Terrain...")

local function generate()
    local idx = 1
    local batchSize = 1000
    local count = 0
    
    for y = 1, height do
        for x = 1, width do
            local hChar = mapString:sub(idx, idx)
            local mChar = mapString:sub(idx+1, idx+1)
            idx = idx + 2
            
            local elev = charMap[hChar] or 0
            local matIdx = charMap[mChar] or 0
            
            local elevationReal = math.floor((elev / 63) * 100) -- max 100 studs high
            if elevationReal < 35 then 
                 if matIdx ~= 8 then matIdx = 0 end -- Fill Water below sea level
            end
            
            local material = materials[matIdx] or Enum.Material.Grass
            
            -- Create a 4x4 coordinate area (Roblox terrain grid is 4 studs)
            local posX = (x - width/2) * 4
            local posZ = (y - height/2) * 4
            
            local size = Vector3.new(4, elevationReal + 10, 4) -- +10 for deep crust
            local cframe = CFrame.new(posX, (elevationReal - 10) / 2, posZ)
            
            Terrain:FillBlock(cframe, size, material)
            
            -- Fill water if below sea level
            if elevationReal < 35 and material ~= Enum.Material.Water then
               local waterDepth = 35 - elevationReal
               local wSize = Vector3.new(4, waterDepth, 4)
               local wCframe = CFrame.new(posX, elevationReal + (waterDepth/2), posZ)
               Terrain:FillBlock(wCframe, wSize, Enum.Material.Water)
            end
            
            count = count + 1
            if count % batchSize == 0 then
               task.wait() -- prevent script timeout
            end
        end
        print("Row " .. y .. " / " .. height)
    end
    print("Generation Complete!")
end

generate()
`;
}
export const biomeColors: Record<BiomeType, [number, number, number]> = {
  [BiomeType.DEEP_WATER]: [18, 45, 87],
  [BiomeType.SHALLOW_WATER]: [46, 118, 168],
  [BiomeType.LAKE]: [41, 105, 127],
  [BiomeType.BEACH]: [224, 209, 154],
  [BiomeType.DESERT]: [212, 185, 137],
  [BiomeType.SAVANNA]: [176, 178, 107],
  [BiomeType.GRASSLAND]: [105, 153, 85],
  [BiomeType.FOREST]: [52, 102, 53],
  [BiomeType.JUNGLE]: [31, 74, 39],
  [BiomeType.ROCK]: [120, 124, 128],
  [BiomeType.SNOW]: [240, 246, 250],
};

export type ViewMode = 'biomes' | 'elevation' | 'temperature' | 'moisture';

export function renderTerrainToCanvas(ctx: CanvasRenderingContext2D, mapData: MapData, width: number, height: number, viewMode: ViewMode = 'biomes') {
  const imgData = ctx.createImageData(width, height);
  const data = imgData.data;
  const grid = mapData.grid;

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const cell = grid[y][x];

      let r=0, g=0, b=0;

      // Calculate highly realistic slope lighting (normal mapping)
      let dx = 0, dy = 0;
      if (x > 0 && x < width - 1) dx = grid[y][x+1].elevation - grid[y][x-1].elevation;
      if (y > 0 && y < height - 1) dy = grid[y+1][x].elevation - grid[y-1][x].elevation;
      
      const isOcean = cell.biome === BiomeType.DEEP_WATER || cell.biome === BiomeType.SHALLOW_WATER;
      const isLake = cell.biome === BiomeType.LAKE;
      const isWater = isOcean || isLake;
      
      let lighting = 1.0;
      // compute lighting for all terrain including water to give it "texture" and ripples
      const lx = -0.577; const ly = -0.577; const lz = 0.577; 
      const ns = isWater ? 5.0 : 15.0; // Softer bump strength for water
      const nx = -dx * ns; const ny = -dy * ns; const nz = 1.0;
      const len = Math.sqrt(nx*nx + ny*ny + nz*nz);
      const dot = Math.max(0, (nx/len)*lx + (ny/len)*ly + (nz/len)*lz);
      const ambient = 0.5;
      lighting = ambient + dot * 0.8;

      if (viewMode === 'elevation') {
        const val = Math.floor(Math.max(0, Math.min(1, cell.elevation)) * 255);
        if(isWater) {
           // deep to shallow water colors
           const depth = isLake ? 0.8 : (cell.elevation / 0.35); // 0 to 1
           r = Math.floor(10 + depth * 20);
           g = Math.floor(30 + depth * 60);
           b = Math.floor(50 + depth * 120);
        } else {
           r = Math.min(255, val * lighting); 
           g = Math.min(255, val * lighting); 
           b = Math.min(255, val * lighting);
           
           // Optional: add contour lines every 0.1 elevation step
           if (val % 25 < 2) {
              r *= 0.5; g *= 0.5; b *= 0.5;
           }
        }
      } else if (viewMode === 'temperature') {
         // Heatmap from cold (blue) to hot (red)
         const tempVal = Math.max(0, Math.min(1, cell.temperature));
         r = Math.floor(tempVal * 255);
         g = Math.floor((1 - Math.abs(tempVal - 0.5) * 2) * 255); // Green in middle
         b = Math.floor((1 - tempVal) * 255);
         if (isWater) {
            r *= 0.4; g *= 0.4; b *= 0.6; // Darker over water
         } else {
            r = Math.min(255, r * lighting); 
            g = Math.min(255, g * lighting); 
            b = Math.min(255, b * lighting);
         }
      } else if (viewMode === 'moisture') {
         // Dry (tan/brown) to Wet (dark blue)
         const moistVal = Math.max(0, Math.min(1, cell.moisture));
         r = Math.floor((1 - moistVal) * 200);
         g = Math.floor((1 - Math.abs(moistVal - 0.5)) * 150 + 50);
         b = Math.floor(moistVal * 255);
         if (isWater) {
            r = 10; g = 30; b = 80;
         } else {
            r = Math.min(255, r * lighting); 
            g = Math.min(255, g * lighting); 
            b = Math.min(255, b * lighting);
         }
      } else {
         [r, g, b] = biomeColors[cell.biome];
         
         // simple hash for micro details
         const microNoise = (Math.sin(x * 12.9898 + y * 78.233) * 43758.5453) % 1;
         const dither = (microNoise - 0.5) * 15;

         if (isWater) {
           // water depth shading
           const depth = (0.35 - cell.elevation) * 120;
           r = Math.max(0, r - depth) * lighting;
           g = Math.max(0, g - depth) * lighting;
           b = Math.max(0, b - depth) * lighting + dither * 0.5;
         } else {
           // Slight altitude tint to differentiate high vs low terrain
           const altiTint = (cell.elevation - 0.35) * 40;
           
           r = Math.min(255, r * lighting + altiTint + dither);
           g = Math.min(255, g * lighting + altiTint + dither);
           b = Math.min(255, b * lighting + altiTint + dither);
         }
      }

      data[idx] = r;
      data[idx + 1] = g;
      data[idx + 2] = b;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(imgData, 0, 0);
}

export function renderVectorFeatures(ctx: CanvasRenderingContext2D, mapData: MapData, currentScale: number) {
  // We use the canvas context assuming it has been scaled by currentScale.
  // We apply stroke widths inversely proportional to scale to keep lines crisp and at a good weight.
  const wScale = Math.max(0.5, 1 / currentScale);

  // 1. Draw Paths (Rivers, Roads, Shipping, Flight)
  for (const path of mapData.paths) {
    if (path.points.length < 2) continue;

    ctx.beginPath();
    ctx.moveTo(path.points[0].x + 0.5, path.points[0].y + 0.5);
    for (let i = 1; i < path.points.length; i++) {
       // Smooth curves for rivers and roads could be implemented here with bezier maps, 
       // but continuous lines are fine.
       ctx.lineTo(path.points[i].x + 0.5, path.points[i].y + 0.5);
    }

    if (path.type === 'river') {
      ctx.strokeStyle = '#3C9CE6'; // Deep river blue
      ctx.lineWidth = wScale * (path.width || 2);
      ctx.setLineDash([]);
      ctx.stroke();
    } else if (path.type === 'road') {
      ctx.strokeStyle = '#5A4E46'; // Dirt/Stone road color
      ctx.lineWidth = wScale * 1.5;
      ctx.setLineDash([]);
      ctx.stroke();
    } else if (path.type === 'shipping') {
      ctx.strokeStyle = '#E6E6FA'; // Light lavender/white for shipping
      ctx.lineWidth = wScale;
      ctx.setLineDash([wScale * 4, wScale * 4]);
      ctx.stroke();
    } else if (path.type === 'flight') {
      ctx.strokeStyle = '#FFD700'; // Gold for flight
      ctx.lineWidth = wScale * 1.2;
      ctx.setLineDash([wScale * 6, wScale * 6]);
      ctx.stroke();
    }
    ctx.setLineDash([]); // reset dash
  }

  // 2. Draw Procedural Cities, Airports, Ports, Resources
  for (const row of mapData.grid) {
     for (const cell of row) {
        if (cell.feature) {
           drawProceduralFeature(ctx, cell.feature, wScale);
        }
     }
  }
}

function drawProceduralFeature(ctx: CanvasRenderingContext2D, feature: MapFeature, wScale: number) {
  const prng = createPRNG(feature.seed.toString());
  const x = feature.x + 0.5;
  const y = feature.y + 0.5;

  ctx.save();
  ctx.translate(x, y);

  if (feature.type === 'resource') {
    // Simple icon for resource
    ctx.fillStyle = 
       feature.resourceType === 'wood' ? '#115511' :
       feature.resourceType === 'stone' ? '#999999' :
       feature.resourceType === 'gold' ? '#FFD700' :
       '#777777'; // iron
    
    if (feature.resourceType === 'wood') {
       // draw a little tree
       ctx.beginPath();
       ctx.moveTo(0, -1.5); ctx.lineTo(1, 1); ctx.lineTo(-1, 1); ctx.closePath();
       ctx.fill();
    } else {
       // draw polygon
       ctx.beginPath();
       ctx.arc(0, 0, 1.2, 0, 5, prng() > 0.5);
       ctx.fill();
       ctx.strokeStyle = '#000';
       ctx.lineWidth = wScale * 0.5;
       ctx.stroke();
    }
  }

  ctx.restore();
}
