import React, { useState, useEffect, useRef, useCallback, Suspense } from 'react';
import { generateMap, renderTerrainToCanvas, renderVectorFeatures, DefaultConfig, MapGenConfig, BiomeType, MapFeature, MapData, generateRobloxScript, ViewMode } from './lib/mapGenerator';
import { Settings2, RefreshCw, Download, Map as MapIcon, Layers, Maximize2, Info, X, Box, Code } from 'lucide-react';
import Map3D from './components/Map3D';

export default function App() {
  const [config, setConfig] = useState<MapGenConfig>(new DefaultConfig());
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('biomes');
  const [isSmoothRender, setIsSmoothRender] = useState(true);
  const [is3DView, setIs3DView] = useState(false);
  const [graphicsQuality, setGraphicsQuality] = useState<'auto'|'low'|'medium'|'high'|'ultra'>('auto');
  const [timeOfDay, setTimeOfDay] = useState<'morning'|'noon'|'sunset'|'night'>('sunset');
  const [fogDensity, setFogDensity] = useState(0.5);
  const [renderTime, setRenderTime] = useState(0);
  const [selectedFeature, setSelectedFeature] = useState<MapFeature | null>(null);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showScriptModal, setShowScriptModal] = useState(false);
  const [generatedScript, setGeneratedScript] = useState("");
  
  const [zoomParams, setZoomParams] = useState({ scale: 1, x: 0, y: 0 });
  const dragState = useRef({ isDragging: false, startX: 0, startY: 0, moved: false, pinchDistance: 0 });
  const lastMousePos = useRef({ x: 0, y: 0 });
  const lastGeneratedSize = useRef({ width: 0, height: 0 });
  
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mapDataRef = useRef<MapData | null>(null);
  const terrainCanvasCacheRef = useRef<HTMLCanvasElement | null>(null);

  const triggerGeneration = useCallback(() => {
    setIsGenerating(true);
    setSelectedFeature(null);
    // Yield to let UI update
    setTimeout(() => {
      const start = performance.now();
      const mapData = generateMap(config);
      mapDataRef.current = mapData;
      const end = performance.now();
      setRenderTime(Math.round(end - start));
      
      // Update the terrain background cache
      if (!terrainCanvasCacheRef.current) {
        terrainCanvasCacheRef.current = document.createElement('canvas');
      }
      terrainCanvasCacheRef.current.width = config.width;
      terrainCanvasCacheRef.current.height = config.height;
      
      const ctx = terrainCanvasCacheRef.current.getContext('2d');
      if (ctx) {
         renderTerrainToCanvas(ctx, mapData, config.width, config.height, viewMode);
      }
      
      // Auto fit on dimension change
      if (containerRef.current && (lastGeneratedSize.current.width !== config.width || lastGeneratedSize.current.height !== config.height)) {
          const rect = containerRef.current.getBoundingClientRect();
          const autoScale = Math.min((rect.width - 64) / config.width, (rect.height - 64) / config.height);
          const safeScale = Math.max(0.1, autoScale);
          setZoomParams({
              scale: safeScale,
              x: (rect.width - config.width * safeScale) / 2,
              y: (rect.height - config.height * safeScale) / 2
          });
          lastGeneratedSize.current = { width: config.width, height: config.height };
      }

      drawCanvas();
      setIsGenerating(false);
    }, 10);
  }, [config, viewMode]);

  const drawCanvas = useCallback(() => {
    if(!canvasRef.current || !mapDataRef.current || !containerRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if(!ctx) return;
    
    const rect = containerRef.current.getBoundingClientRect();
    
    // Ensure our display canvas matches the physical screen size perfectly
    if (canvasRef.current.width !== rect.width || canvasRef.current.height !== rect.height) {
        canvasRef.current.width = rect.width;
        canvasRef.current.height = rect.height;
    }

    // Clear whole screen
    ctx.clearRect(0, 0, rect.width, rect.height);
    
    // Disable smoothing if not requested for base terrain rendering
    ctx.imageSmoothingEnabled = isSmoothRender;

    ctx.save();
    // Apply camera transform matrix
    ctx.translate(zoomParams.x, zoomParams.y);
    ctx.scale(zoomParams.scale, zoomParams.scale);

    // Draw cached raster terrain layer
    if (terrainCanvasCacheRef.current) {
       ctx.drawImage(terrainCanvasCacheRef.current, 0, 0);
    }
    
    // Draw vector features layer crisply
    // We pass the current scale to adjust line sizes
    renderVectorFeatures(ctx, mapDataRef.current, zoomParams.scale);

    ctx.restore();

  }, [config.width, config.height, viewMode, zoomParams, isSmoothRender]);

  useEffect(() => {
    // Determine auto-quality
    if (graphicsQuality === 'auto') {
        const cores = navigator.hardwareConcurrency || 4;
        const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);
        
        let detected = 'medium';
        if (isMobile) {
           detected = cores >= 8 ? 'medium' : 'low';
        } else {
           if (cores >= 12) detected = 'ultra';
           else if (cores >= 8) detected = 'high';
           else detected = 'medium';
        }
        setGraphicsQuality(detected as any);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    // Initial generation
    triggerGeneration();
    
    // Zoom with wheel
    const handleNativeWheel = (e: WheelEvent) => {
      if (containerRef.current && containerRef.current.contains(e.target as Node)) {
        e.preventDefault();
        setZoomParams(prev => {
          const zoomSensitivity = -0.001;
          let delta = e.deltaY;
          if (e.deltaMode === 1) delta *= 15;
          const newScale = Math.max(0.2, Math.min(20, prev.scale * Math.exp(delta * zoomSensitivity)));
          
          const rect = containerRef.current!.getBoundingClientRect();
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top;

          const unscaledX = (mouseX - prev.x) / prev.scale;
          const unscaledY = (mouseY - prev.y) / prev.scale;

          const newX = mouseX - unscaledX * newScale;
          const newY = mouseY - unscaledY * newScale;

          return { scale: newScale, x: newX, y: newY };
        });
      }
    };

    window.addEventListener('wheel', handleNativeWheel, { passive: false });
    return () => window.removeEventListener('wheel', handleNativeWheel);
  }, []);

  useEffect(() => {
    // Check if viewMode changed and we need to rebuild terrain cache
    if(!isGenerating && mapDataRef.current && terrainCanvasCacheRef.current) {
        const ctx = terrainCanvasCacheRef.current.getContext('2d');
        if (ctx) {
           renderTerrainToCanvas(ctx, mapDataRef.current, config.width, config.height, viewMode);
        }
        drawCanvas();
    }
  }, [viewMode]);

  // A separate effect to draw on frame changes (zoom, drag)
  useEffect(() => {
       if (!isGenerating) {
           drawCanvas();
       }
  }, [zoomParams, drawCanvas, isSmoothRender, isGenerating]);

  const handleConfigChange = (key: keyof MapGenConfig, value: number | string) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  const handleRandomizeSeed = () => {
    handleConfigChange('seed', Math.random().toString(36).substring(2, 10));
  };

  const downloadImage = () => {
    if(!canvasRef.current) return;
    // ensure features are hidden if needed or match what's on screen
    const link = document.createElement('a');
    link.download = `cartoforge-${config.seed}.png`;
    link.href = canvasRef.current.toDataURL();
    link.click();
  };

  const openRobloxScriptModal = () => {
    if(!mapDataRef.current) return;
    const scriptText = generateRobloxScript(mapDataRef.current, config);
    setGeneratedScript(scriptText);
    setShowScriptModal(true);
  };

  const copyScriptFromModal = () => {
    navigator.clipboard.writeText(generatedScript).then(() => {
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }).catch(err => {
      console.error('Failed to copy code: ', err);
    });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
      dragState.current.pinchDistance = dist;
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      e.preventDefault(); // prevent scroll
      const touch1 = e.touches[0];
      const touch2 = e.touches[1];
      const dist = Math.hypot(touch1.clientX - touch2.clientX, touch1.clientY - touch2.clientY);
      
      if (dragState.current.pinchDistance) {
        const delta = dist - dragState.current.pinchDistance;
        setZoomParams(prev => {
          const zoomSensitivity = 0.01;
          const newScale = Math.max(0.2, Math.min(20, prev.scale * Math.exp(delta * zoomSensitivity)));
          
          if (!containerRef.current) return { ...prev, scale: newScale };
          
          const rect = containerRef.current.getBoundingClientRect();
          // midpoint
          const midX = (touch1.clientX + touch2.clientX) / 2 - rect.left;
          const midY = (touch1.clientY + touch2.clientY) / 2 - rect.top;

          const unscaledX = (midX - prev.x) / prev.scale;
          const unscaledY = (midY - prev.y) / prev.scale;

          const newX = midX - unscaledX * newScale;
          const newY = midY - unscaledY * newScale;

          return { scale: newScale, x: newX, y: newY };
        });
      }
      dragState.current.pinchDistance = dist;
    }
  };

  const handlePointerDown = (e: React.PointerEvent) => {
     if (e.pointerType === 'touch' && e.isPrimary === false) return; // ignore multi touch for pan
     dragState.current = { ...dragState.current, isDragging: true, startX: e.clientX, startY: e.clientY, moved: false };
     lastMousePos.current = { x: e.clientX, y: e.clientY };
     e.currentTarget.setPointerCapture(e.pointerId);
  }

  const handlePointerMove = (e: React.PointerEvent) => {
     if (!dragState.current.isDragging) return;
     if (e.pointerType === 'touch' && !e.isPrimary) return;
     const dx = e.clientX - lastMousePos.current.x;
     const dy = e.clientY - lastMousePos.current.y;
     
     if (Math.abs(e.clientX - dragState.current.startX) > 3 || Math.abs(e.clientY - dragState.current.startY) > 3) {
         dragState.current.moved = true;
     }

     lastMousePos.current = { x: e.clientX, y: e.clientY };
     setZoomParams(prev => ({ ...prev, x: prev.x + dx, y: prev.y + dy }));
  }

  const handlePointerUp = (e: React.PointerEvent) => {
     if (e.pointerType === 'touch' && !e.isPrimary) return;
     dragState.current.isDragging = false;
     e.currentTarget.releasePointerCapture(e.pointerId);

     if (!dragState.current.moved) {
        handleMapClick(e);
     }
  }

  // Auto-detect graphics quality on mount
  useEffect(() => {
    let quality: 'low' | 'medium' | 'high' | 'ultra' = 'medium';
    if (typeof navigator !== 'undefined') {
      const cores = navigator.hardwareConcurrency || 4;
      const deviceMemory = (navigator as any).deviceMemory || 4;
      if (cores >= 8 && deviceMemory >= 8) quality = 'ultra';
      else if (cores >= 6 && deviceMemory >= 6) quality = 'high';
      else if (cores <= 4 && deviceMemory < 4) quality = 'low';
      
      // We could also check window.innerWidth for mobile if we want
      if (window.innerWidth < 768) {
         // Cap on mobile
         if (quality === 'ultra') quality = 'high';
      }
    }
    setGraphicsQuality(quality);
  }, []);

  const handleMapClick = (e: React.PointerEvent) => {
     if (!mapDataRef.current || !canvasRef.current) return;
     const rect = canvasRef.current.getBoundingClientRect();
     
     // coordinates relative to canvas bounding box
     let localX = e.clientX - rect.left;
     let localY = e.clientY - rect.top;
     
     // Inverse transform
     const unscaledX = (localX - zoomParams.x) / zoomParams.scale;
     const unscaledY = (localY - zoomParams.y) / zoomParams.scale;

     let gridX = Math.floor(unscaledX);
     let gridY = Math.floor(unscaledY);
     
      if (gridX >= 0 && gridX < config.width && gridY >= 0 && gridY < config.height) {
        let found = null;
        // search a little area if the user clicked near a feature
        for (let ry = Math.max(0, gridY - 8); ry <= Math.min(config.height - 1, gridY + 8); ry++) {
           for (let rx = Math.max(0, gridX - 8); rx <= Math.min(config.width - 1, gridX + 8); rx++) {
             const c = mapDataRef.current.grid[ry][rx];
             if (c.feature) {
                const distSq = (c.x - gridX) ** 2 + (c.y - gridY) ** 2;
                if (distSq < 64) { // within 8 units
                   found = c.feature;
                   break; // Wait, actually we might hit a resource, but prefer cities? Let's just pick the first one we find.
                }
             }
           }
           if (found) break;
        }
        setSelectedFeature(found);
     }
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-slate-900 text-slate-200 overflow-hidden font-sans">
      
      {/* Mobile Header */}
      <div className="md:hidden flex items-center justify-between p-4 bg-slate-800 border-b border-slate-700 z-30 shrink-0">
        <div className="flex items-center gap-2">
          <div className="p-2 bg-indigo-500 rounded text-white flex items-center justify-center">
            <MapIcon size={18} />
          </div>
          <h1 className="text-lg font-semibold text-white tracking-tight">CartoForge</h1>
        </div>
        <button onClick={() => setIsSidebarOpen(!isSidebarOpen)} className="p-2 bg-slate-700 hover:bg-slate-600 rounded-lg text-white transition-colors">
          <Settings2 size={20} />
        </button>
      </div>

      {/* Mobile Sidebar Overlay */}
      {isSidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40 md:hidden"
          onClick={() => setIsSidebarOpen(false)}
        />
      )}

      {/* Sidebar Controls */}
      <aside className={`fixed md:relative top-0 right-0 h-full w-80 max-w-[85vw] border-l md:border-l-0 md:border-r border-slate-700 bg-slate-800 flex flex-col shadow-2xl z-50 shrink-0 transform transition-transform duration-300 ease-out ${isSidebarOpen ? 'translate-x-0' : 'translate-x-full md:translate-x-0'}`}>
        <div className="p-5 border-b border-slate-700 bg-slate-800/80 sticky top-0 backdrop-blur-sm shadow-sm flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-500 rounded-lg text-white hidden md:block">
              <MapIcon size={20} />
            </div>
            <div>
              <h1 className="text-xl tracking-tight font-semibold text-white">CartoForge</h1>
              <p className="text-xs text-slate-400 font-mono">v2.0 • Realism Update</p>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden p-5 space-y-7 custom-scrollbar pb-24">
          
          {/* Section: Core */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Settings2 size={14} /> Core Parameters
            </h2>
            
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <label className="text-sm font-medium">Seed</label>
                <div className="flex">
                  <input 
                    type="text" 
                    value={config.seed}
                    onChange={e => handleConfigChange('seed', e.target.value)}
                    className="w-24 px-2 py-1 bg-slate-900 border border-slate-700 rounded-l text-sm focus:outline-none focus:border-indigo-500 font-mono"
                  />
                  <button onClick={handleRandomizeSeed} className="bg-slate-700 hover:bg-slate-600 px-2 rounded-r border-y border-r border-slate-700 transition">
                    <RefreshCw size={14} className="text-slate-300" />
                  </button>
                </div>
              </div>

              <div className="space-y-1 mt-2">
                <label className="text-sm font-medium flex justify-between mb-1 text-slate-300">
                  <span>Dimensions</span>
                  <span className="font-mono text-xs text-slate-400">{config.width}x{config.height}</span>
                </label>
                <div className="flex bg-slate-900 rounded-lg p-1 border border-slate-700/50">
                  <button 
                    onClick={() => { handleConfigChange('width', 256); handleConfigChange('height', 256); }}
                    className={`flex-1 text-xs py-1.5 rounded-md transition ${config.width === 256 ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Small
                  </button>
                  <button 
                    onClick={() => { handleConfigChange('width', 512); handleConfigChange('height', 512); }}
                    className={`flex-1 text-xs py-1.5 rounded-md transition ${config.width === 512 ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Medium
                  </button>
                  <button 
                    onClick={() => { handleConfigChange('width', 1024); handleConfigChange('height', 1024); }}
                    className={`flex-1 text-xs py-1.5 rounded-md transition ${config.width === 1024 ? 'bg-indigo-500 text-white' : 'text-slate-400 hover:text-slate-200'}`}
                  >
                    Large
                  </button>
                </div>
              </div>

              <div className="space-y-1 mt-3">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Terrain Scale</label>
                  <span className="text-xs text-slate-400 font-mono">{config.scale}</span>
                </div>
                <input 
                  type="range" min="20" max="300" step="5" 
                  value={config.scale} onChange={e => handleConfigChange('scale', parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

              <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Water Level</label>
                  <span className="text-xs text-slate-400 font-mono">{config.waterLevel.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0.1" max="0.8" step="0.05" 
                  value={config.waterLevel} onChange={e => handleConfigChange('waterLevel', parseFloat(e.target.value))}
                  className="w-full accent-blue-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

              <div className="space-y-1">
                 <div className="flex justify-between">
                  <label className="text-sm font-medium">Island Falloff</label>
                  <span className="text-xs text-slate-400 font-mono">{config.islandFalloff.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="0" max="2" step="0.1" 
                  value={config.islandFalloff} onChange={e => handleConfigChange('islandFalloff', parseFloat(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>
            </div>
          </section>

          {/* Section: Climate */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <span className="text-orange-400">🌡️</span> Climate & Biomes
            </h2>
            
            <div className="space-y-3">
              <div className="space-y-1">
                 <div className="flex justify-between">
                  <label className="text-sm font-medium">Temperature Global Bias</label>
                  <span className="text-xs text-slate-400 font-mono">{config.temperatureOffset > 0 ? '+' : ''}{config.temperatureOffset.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="-0.8" max="0.8" step="0.1" 
                  value={config.temperatureOffset} onChange={e => handleConfigChange('temperatureOffset', parseFloat(e.target.value))}
                  className="w-full accent-orange-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

              <div className="space-y-1">
                 <div className="flex justify-between">
                  <label className="text-sm font-medium">Moisture Noise Scale</label>
                  <span className="text-xs text-slate-400 font-mono">{config.moistureScale}</span>
                </div>
                <input 
                  type="range" min="50" max="600" step="10" 
                  value={config.moistureScale} onChange={e => handleConfigChange('moistureScale', parseFloat(e.target.value))}
                  className="w-full accent-emerald-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>
            </div>
          </section>

          {/* Section: Features & Details */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <span className="text-indigo-400">🌊</span> Rivers & Features
            </h2>
            
            <div className="space-y-3">
              <div className="space-y-1">
                 <div className="flex justify-between">
                  <label className="text-sm font-medium">River Count</label>
                  <span className="text-xs text-slate-400 font-mono">{config.riverCount}</span>
                </div>
                <input 
                  type="range" min="0" max="60" step="5" 
                  value={config.riverCount} onChange={e => handleConfigChange('riverCount', parseInt(e.target.value))}
                  className="w-full accent-blue-400 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

              <div className="space-y-1">
                 <div className="flex justify-between">
                  <label className="text-sm font-medium">Resource Density</label>
                  <span className="text-xs text-slate-400 font-mono">{config.resourceDensity.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="0.5" step="0.05" 
                  value={config.resourceDensity} onChange={e => handleConfigChange('resourceDensity', parseFloat(e.target.value))}
                  className="w-full accent-amber-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>
            </div>
          </section>

          {/* Section: Performance */}
          <section className="space-y-4">
             <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
               <Box size={14} /> 3D & Graphics
             </h2>
             
             <div className="space-y-3">
               <div className="space-y-1">
                 <label className="text-sm font-medium flex justify-between mb-1 text-slate-300">
                   <span>3D Quality</span>
                 </label>
                 <select 
                   value={graphicsQuality} 
                   onChange={e => setGraphicsQuality(e.target.value as any)}
                   className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                 >
                   <option value="auto">Auto-detect</option>
                   <option value="low">Low (Fastest)</option>
                   <option value="medium">Medium</option>
                   <option value="high">High</option>
                   <option value="ultra">Ultra (1:1 Scale + Shadows)</option>
                 </select>
               </div>

               <div className="space-y-1">
                 <label className="text-sm font-medium flex justify-between mb-1 text-slate-300">
                   <span>Time of Day</span>
                 </label>
                 <select 
                   value={timeOfDay} 
                   onChange={e => setTimeOfDay(e.target.value as any)}
                   className="w-full bg-slate-900 border border-slate-700 rounded-lg px-2 py-1.5 text-sm text-slate-300 focus:outline-none focus:border-indigo-500"
                 >
                   <option value="morning">Morning</option>
                   <option value="noon">Noon</option>
                   <option value="sunset">Sunset/Golden Hour</option>
                   <option value="night">Night</option>
                 </select>
               </div>

               <div className="space-y-1">
                 <div className="flex justify-between">
                   <label className="text-sm font-medium">Fog/Atmosphere Density</label>
                   <span className="text-xs text-slate-400 font-mono">{(fogDensity * 100).toFixed(0)}%</span>
                 </div>
                 <input 
                   type="range" min="0" max="1" step="0.05" 
                   value={fogDensity} onChange={e => setFogDensity(parseFloat(e.target.value))}
                   className="w-full accent-emerald-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                 />
               </div>
             </div>
          </section>

          {/* Section: Detail */}
          <section className="space-y-4">
             <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <Layers size={14} /> Detail & Biomes
            </h2>
            
            <div className="space-y-3">
              <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Noise Octaves</label>
                  <span className="text-xs text-slate-400 font-mono">{config.octaves}</span>
                </div>
                <input 
                  type="range" min="1" max="8" step="1" 
                  value={config.octaves} onChange={e => handleConfigChange('octaves', parseInt(e.target.value))}
                  className="w-full accent-indigo-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

               <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Moisture Variance</label>
                  <span className="text-xs text-slate-400 font-mono">{config.moistureScale}</span>
                </div>
                <input 
                  type="range" min="50" max="300" step="10" 
                  value={config.moistureScale} onChange={e => handleConfigChange('moistureScale', parseFloat(e.target.value))}
                  className="w-full accent-green-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

               <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Temperature Shift</label>
                  <span className="text-xs text-slate-400 font-mono">{config.temperatureOffset > 0 ? '+' : ''}{config.temperatureOffset.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="-0.5" max="0.5" step="0.05" 
                  value={config.temperatureOffset} onChange={e => handleConfigChange('temperatureOffset', parseFloat(e.target.value))}
                  className="w-full accent-orange-500 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>
            </div>
          </section>

          {/* Section: Features */}
          <section className="space-y-4">
            <h2 className="text-xs font-bold uppercase tracking-wider text-slate-500 flex items-center gap-2">
              <MapIcon size={14} /> Geography
            </h2>

            <div className="space-y-3">
               <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">Rivers</label>
                  <span className="text-xs text-slate-400 font-mono">{config.riverCount}</span>
                </div>
                <input 
                  type="range" min="0" max="100" step="5" 
                  value={config.riverCount} onChange={e => handleConfigChange('riverCount', parseInt(e.target.value))}
                  className="w-full accent-blue-400 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

               <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">River Meandering</label>
                  <span className="text-xs text-slate-400 font-mono">{config.riverMeander.toFixed(2)}</span>
                </div>
                <input 
                  type="range" min="0" max="1" step="0.05" 
                  value={config.riverMeander} onChange={e => handleConfigChange('riverMeander', parseFloat(e.target.value))}
                  className="w-full accent-blue-400 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

               <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">River Width</label>
                  <span className="text-xs text-slate-400 font-mono">{config.riverWidth.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="1" max="5" step="0.5" 
                  value={config.riverWidth} onChange={e => handleConfigChange('riverWidth', parseFloat(e.target.value))}
                  className="w-full accent-blue-400 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>

               <div className="space-y-1">
                <div className="flex justify-between">
                  <label className="text-sm font-medium">River Flow Speed</label>
                  <span className="text-xs text-slate-400 font-mono">{config.riverFlowSpeed.toFixed(1)}</span>
                </div>
                <input 
                  type="range" min="0.1" max="5" step="0.1" 
                  value={config.riverFlowSpeed} onChange={e => handleConfigChange('riverFlowSpeed', parseFloat(e.target.value))}
                  className="w-full accent-blue-400 h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer" 
                />
              </div>
            </div>
          </section>

        </div>

        {/* Generate Button Wrapper */}
        <div className="p-4 bg-slate-800 border-t border-slate-700 z-20 absolute bottom-0 w-80">
          <button 
             onClick={triggerGeneration}
             disabled={isGenerating}
             className={`w-full py-2.5 rounded-lg font-medium shadow-md flex items-center justify-center gap-2 transition-all ${
               isGenerating ? 'bg-indigo-600/50 text-indigo-200 cursor-not-allowed' : 'bg-indigo-600 hover:bg-indigo-500 hover:shadow-indigo-500/25 text-white active:scale-95'
             }`}
          >
            {isGenerating ? < RefreshCw size={18} className="animate-spin" /> : <RefreshCw size={18} />}
            {isGenerating ? 'Generating...' : 'Regenerate Map'}
          </button>
        </div>
      </aside>

      {/* Main Content Area */}
      <main className="flex-1 relative flex bg-[#0f111a]" ref={containerRef}>
         
         {/* Top bar controls */}
         <div className="absolute top-4 right-4 z-20 flex bg-slate-800/80 backdrop-blur-md rounded-lg p-1.5 shadow-lg border border-slate-700/50 gap-1 flex-wrap justify-end max-w-[calc(100%-2rem)]">
           <button 
             onClick={() => setIs3DView(!is3DView)}
             className={`px-3 py-1.5 text-xs font-semibold rounded-md transition flex items-center gap-2 ${is3DView ? 'bg-emerald-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}`}
           >
             <Box size={14} /> 3D View
           </button>
           <div className="w-px bg-slate-700/50 mx-1"></div>
           <button 
             onClick={() => setViewMode('biomes')}
             className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${viewMode === 'biomes' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
           >
             Biomes
           </button>
           <button 
             onClick={() => setViewMode('elevation')}
             className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${viewMode === 'elevation' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
             title="Heightmap"
           >
             Heightmap
           </button>
           <button 
             onClick={() => setViewMode('temperature')}
             className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${viewMode === 'temperature' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
             title="Temperature Overlay"
           >
             Temperature
           </button>
           <button 
             onClick={() => setViewMode('moisture')}
             className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${viewMode === 'moisture' ? 'bg-indigo-500 text-white' : 'hover:bg-slate-700 text-slate-300'}`}
             title="Moisture Overlay"
           >
             Moisture
           </button>
           <div className="w-px bg-slate-700/50 mx-1"></div>
           <button 
             onClick={() => setIsSmoothRender(!isSmoothRender)}
             className={`px-3 py-1.5 text-xs font-semibold rounded-md transition ${isSmoothRender ? 'bg-indigo-500 text-white' : 'hover:bg-slate-700 text-slate-300'} hidden sm:block`}
           >
             Smooth Filter
           </button>
           <div className="w-px bg-slate-700/50 mx-1 hidden sm:block"></div>
           <button 
             onClick={openRobloxScriptModal}
             className="px-3 py-1.5 text-xs font-semibold rounded-md text-white transition flex items-center gap-1 shadow-md bg-[#00A2FF] hover:bg-[#0088CC]"
             title="View ServerScript for Roblox"
           >
             <Code size={14} /> <span className="hidden sm:inline">Roblox Script</span>
           </button>
           <button 
             onClick={downloadImage}
             className="px-3 py-1.5 text-xs font-semibold rounded-md bg-indigo-600 hover:bg-indigo-500 text-white transition flex items-center gap-1 shadow-md"
             title="Download Map Image (PNG)"
           >
             <Download size={14} /> <span className="hidden sm:inline">PNG</span>
           </button>
         </div>

         {/* Canvas / 3D Wrapper */}
         <div 
            className="flex-1 w-full h-full relative overflow-hidden bg-[#0f111a] touch-none cursor-move"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
         >
             {is3DView && mapDataRef.current ? (
                <div className="absolute inset-0 z-10">
                   <Suspense fallback={<div className="w-full h-full flex items-center justify-center text-white">Loading 3D...</div>}>
                      <Map3D 
                        mapData={mapDataRef.current} 
                        width={config.width} 
                        height={config.height} 
                        quality={graphicsQuality !== 'auto' ? graphicsQuality : 'medium'} 
                        timeOfDay={timeOfDay}
                        fogDensity={fogDensity}
                      />
                   </Suspense>
                </div>
             ) : (
                <canvas 
                  ref={canvasRef}
                  className="block pointer-events-none w-full h-full"
                />
             )}
             
             {isGenerating && (
               <div className="absolute inset-0 bg-slate-900/50 backdrop-blur-sm flex items-center justify-center pointer-events-none z-20">
                 <RefreshCw size={32} className="text-white animate-spin opacity-80" />
               </div>
             )}

             {/* Selection Indicator on Canvas overlay */}
             {!is3DView && selectedFeature && (
                <div 
                   className="absolute border-4 border-indigo-400 rounded-full w-10 h-10 -ml-5 -mt-5 animate-pulse pointer-events-none"
                   style={{ 
                      left: zoomParams.x + selectedFeature.x * zoomParams.scale, 
                      top: zoomParams.y + selectedFeature.y * zoomParams.scale 
                   }}
                />
             )}
         </div>

         {/* Information Popup Layer */}
         {selectedFeature && (
           <div className="absolute top-20 right-4 z-40 bg-slate-800/90 backdrop-blur shadow-2xl rounded-xl border border-slate-700 w-64 p-4 animate-in fade-in slide-in-from-right-8 pointer-events-auto">
             <button onClick={() => setSelectedFeature(null)} className="absolute top-3 right-3 text-slate-400 hover:text-white">
               <X size={16} />
             </button>
             <h3 className="text-lg font-bold text-white mb-1 pr-6 flex items-center gap-2">
               {selectedFeature.type === 'resource' && <span className="text-amber-400 text-xl font-serif">Resource</span>}
               {selectedFeature.name || selectedFeature.resourceType || "Unknown"}
             </h3>
             <div className="space-y-3 mt-4 text-sm text-slate-300">
               <div className="flex justify-between border-b border-slate-700/50 pb-2">
                 <span className="text-slate-400">Type</span>
                 <span className="capitalize text-white font-medium">{selectedFeature.type}</span>
               </div>
               
               {selectedFeature.type === 'resource' && (
                 <div className="flex justify-between border-b border-slate-700/50 pb-2">
                   <span className="text-slate-400">Resource</span>
                   <span className="capitalize text-white font-bold">{selectedFeature.resourceType}</span>
                 </div>
               )}

               <div className="flex justify-between">
                 <span className="text-slate-400">Coordinates</span>
                 <span className="text-white font-mono">{selectedFeature.x}, {selectedFeature.y}</span>
               </div>
             </div>
           </div>
         )}

         {/* Info Bar */}
         <div className="absolute bottom-4 right-4 z-20 px-3 py-1.5 bg-slate-800/80 backdrop-blur border border-slate-700/50 rounded-lg text-xs font-mono text-slate-400 shadow-md flex flex-col md:flex-row items-end md:items-center gap-2 md:gap-4">
            <span className="hidden md:inline text-slate-500">Scroll to zoom, Drag to pan</span>
            <span>Rendered in {renderTime}ms | {config.width}x{config.height}</span>
         </div>
      </main>

       {/* Roblox Script Modal */}
       {showScriptModal && (
         <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4" onClick={() => setShowScriptModal(false)}>
           <div 
             className="bg-slate-800 border border-slate-700 rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col"
             onClick={e => e.stopPropagation()}
           >
             <div className="flex items-center justify-between p-4 border-b border-slate-700">
               <div className="flex items-center gap-2 text-white">
                 <Code size={20} className="text-[#00A2FF]" />
                 <h2 className="text-xl font-bold">Roblox Terrain Generator Script</h2>
               </div>
               <button onClick={() => setShowScriptModal(false)} className="text-slate-400 hover:text-white transition">
                 <X size={24} />
               </button>
             </div>
             
             <div className="p-4 bg-amber-500/10 border-b border-amber-500/20 text-amber-200 text-sm">
               <strong>Instructions:</strong> Open Roblox Studio. Create a new Script in <code>ServerScriptService</code>. Copy and paste the code below into that script, then run the game to generate the terrain.
             </div>

             <div className="flex-1 overflow-auto p-4 bg-[#0d1117] relative">
               <pre className="text-xs font-mono text-slate-300 w-full">
                 <code>{generatedScript}</code>
               </pre>
             </div>

             <div className="p-4 border-t border-slate-700 flex justify-end gap-3 bg-slate-800/50">
               <button 
                 onClick={() => setShowScriptModal(false)}
                 className="px-4 py-2 rounded-lg text-sm font-medium text-slate-300 hover:text-white hover:bg-slate-700 transition"
               >
                 Close
               </button>
               <button 
                 onClick={copyScriptFromModal}
                 className={`px-4 py-2 rounded-lg text-sm font-medium text-white transition shadow-md flex items-center gap-2 ${copySuccess ? 'bg-green-500 hover:bg-green-400' : 'bg-[#00A2FF] hover:bg-[#0088CC]'}`}
               >
                 <Code size={16} />
                 {copySuccess ? 'Copied to Clipboard!' : 'Copy to Clipboard'}
               </button>
             </div>
           </div>
         </div>
       )}

    </div>
  );
}

