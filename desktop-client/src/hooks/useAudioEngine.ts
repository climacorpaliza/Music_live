import { useRef, useState, useEffect, useCallback } from 'react';

export type StemType = 'Click' | 'Cues' | 'Instrument';
export type RoutingMode = 'StereoSplit' | 'MultiChannel';

export interface StemTrack {
  id: string;
  name: string;
  type: StemType;
  url: string;
  volume: number; // 0.0 to 1.0
  pan: number; // -1.0 (L) to 1.0 (R)
  muted: boolean;
  solo: boolean;
  targetOutputChannel?: number; // Used in MultiChannel mode
}

const generateClickBuffer = (ctx: AudioContext, frequency: number) => {
  const sampleRate = ctx.sampleRate;
  const duration = 0.05;
  const buffer = ctx.createBuffer(1, sampleRate * duration, sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) {
    const t = i / sampleRate;
    const env = Math.exp(-t * 80); 
    // Usamos Math.cos para generar un transitorio (transient) instantáneo en t=0 (pico máximo inicial)
    data[i] = Math.cos(2 * Math.PI * frequency * t) * env * 0.8;
  }
  return buffer;
};

export const useAudioEngine = (initialStems: StemTrack[]) => {
  const audioContext = useRef<AudioContext | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const isPlayingRef = useRef(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [routingMode, setRoutingMode] = useState<RoutingMode>('StereoSplit');
  const [stems, setStems] = useState<StemTrack[]>(initialStems);
  const [loadProgress, setLoadProgress] = useState({ loaded: 0, total: 0, currentFile: '' });
  const [totalDuration, setTotalDuration] = useState(0);
  
  const sourceNodes = useRef<Map<string, AudioBufferSourceNode>>(new Map());
  const gainNodes = useRef<Map<string, GainNode>>(new Map());
  const pannerNodes = useRef<Map<string, StereoPannerNode>>(new Map());
  const buffers = useRef<Map<string, AudioBuffer>>(new Map());

  const splitterNode = useRef<ChannelSplitterNode | null>(null);
  const mergerNode = useRef<ChannelMergerNode | null>(null);

  const startTime = useRef<number>(0);
  const pauseTime = useRef<number>(0);
  const loopState = useRef<{ isLooping: boolean; start: number; end: number }>({ isLooping: false, start: 0, end: 0 });
  // Referencia para la duración del Pre-Roll (Cuenta Regresiva)
  const preRollDurationRef = useRef(0);
  
  // Referencias para programación en tiempo real
  const clickSources = useRef<AudioBufferSourceNode[]>([]);
  const clickHighBufferRef = useRef<AudioBuffer | null>(null);
  const clickLowBufferRef = useRef<AudioBuffer | null>(null);
  const cueSources = useRef<AudioBufferSourceNode[]>([]);
  const cueBuffersRef = useRef<Record<string, AudioBuffer>>({});
  const cueOffsetsRef = useRef<Record<string, number>>({});
  
  // Referencias para el auto-play al buscar
  const prompterDataRef = useRef<any>(null);
  const manualGridOffsetRef = useRef<number>(0);
  
  const animationFrame = useRef<number>(0);
  const seekTimeoutRef = useRef<number | null>(null);

  // 1. Inicialización y Prevención de Desconexiones (Fail-Safe)
  useEffect(() => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioContext.current = new AudioContextClass();
    
    clickHighBufferRef.current = generateClickBuffer(audioContext.current, 1200);
    clickLowBufferRef.current = generateClickBuffer(audioContext.current, 800);
    
    const handleDeviceChange = async () => {
      console.warn("Hardware device change detected! Suspending audio to prevent bleeding.");
      if (audioContext.current?.state === 'running') {
        await audioContext.current.suspend();
        setIsPlaying(false);
        isPlayingRef.current = false;
        pauseTime.current = audioContext.current.currentTime - startTime.current;
      }
    };

    navigator.mediaDevices?.addEventListener('devicechange', handleDeviceChange);
    return () => navigator.mediaDevices?.removeEventListener('devicechange', handleDeviceChange);
  }, []);

  // 2. Cargar Buffers en Memoria
  const loadStems = async (bpm?: number, gridOffsetTime: number = 0, timeSignature: string = '4/4', _beatTimes: number[] = [], prompterData?: any) => {
    if (!audioContext.current) return;
    
    // Resume context if suspended (browser auto-play policy)
    if (audioContext.current.state === 'suspended') {
      await audioContext.current.resume();
    }
    
    setLoadProgress({ loaded: 0, total: stems.length, currentFile: 'Iniciando descarga...' });
    let loadedCount = 0;
    let maxDuration = 0;

    for (const stem of stems) {
      if (buffers.current.has(stem.id)) {
        loadedCount++;
        continue;
      }
      
      try {
        setLoadProgress({ loaded: loadedCount, total: stems.length, currentFile: `Descargando: ${stem.name}` });
        
        // Si es el metrónomo sintético o cues, no hacemos fetch
        if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
          loadedCount++;
          continue;
        }

        // Use standard fetch. Supabase public buckets allow GET from * by default.
        const response = await fetch(stem.url);
        if (!response.ok) throw new Error(`HTTP Error: ${response.status}`);
        
        setLoadProgress({ loaded: loadedCount, total: stems.length, currentFile: `Decodificando audio en RAM: ${stem.name}` });
        
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await audioContext.current.decodeAudioData(arrayBuffer);
        buffers.current.set(stem.id, audioBuffer);
        if (audioBuffer.duration > maxDuration) {
          maxDuration = audioBuffer.duration;
        }
        
        loadedCount++;
        setLoadProgress({ loaded: loadedCount, total: stems.length, currentFile: `Completado: ${stem.name}` });
      } catch (err) {
        console.error(`Error loading stem ${stem.name}:`, err);
        throw err;
      }
    }
    
    // --- AUTO-ADAPTACIÓN RÍTMICA (COMPENSACIÓN DE LATENCIA EN NAVEGADOR) ---
    const drumStem = stems.find(s => s.name.toLowerCase().includes('drum') || s.name.toLowerCase().includes('bater') || s.name.toLowerCase().includes('perc'));
    if (drumStem && buffers.current.has(drumStem.id) && prompterData && prompterData.beatTimes && prompterData.beatTimes.length > 0) {
        try {
            setLoadProgress({ loaded: stems.length, total: stems.length, currentFile: `Sincronizando transitorios...` });
            const drumBuffer = buffers.current.get(drumStem.id)!;
            const data = drumBuffer.getChannelData(0);
            const sr = drumBuffer.sampleRate;
            const windowSamples = Math.floor(0.1 * sr); // Ventana de ±100ms
            
            let offsets: number[] = [];
            // Analizamos los primeros 16 golpes para calcular el offset global (padding del MP3 en Chrome)
            const beatsToAnalyze = Math.min(16, prompterData.beatTimes.length);
            
            for (let i = 0; i < beatsToAnalyze; i++) {
                const originalTime = prompterData.beatTimes[i];
                const centerSample = Math.floor(originalTime * sr);
                const startSample = Math.max(0, centerSample - windowSamples);
                const endSample = Math.min(data.length, centerSample + windowSamples);
                
                let maxEnergy = 0;
                let peakSample = centerSample;
                
                // Encontrar el pico exacto de energía (ataque del transitorio)
                for (let j = startSample; j < endSample; j++) {
                    const energy = Math.abs(data[j]);
                    if (energy > maxEnergy) {
                        maxEnergy = energy;
                        peakSample = j;
                    }
                }
                
                // Si el pico es lo suficientemente fuerte como para ser considerado un golpe
                if (maxEnergy > 0.1) {
                    offsets.push((peakSample - centerSample) / sr);
                }
            }
            
            if (offsets.length > 0) {
                // Tomar la mediana de los offsets para ignorar anomalías (fills) y obtener el padding exacto
                offsets.sort((a, b) => a - b);
                const medianOffset = offsets[Math.floor(offsets.length / 2)];
                
                console.log(`[Auto-Sync] Compensación de latencia de decodificación aplicada: ${medianOffset * 1000}ms`);
                
                // Aplicar compensación a toda la grilla de la canción
                prompterData.beatTimes = prompterData.beatTimes.map((t: number) => t + medianOffset);
                if (prompterData.firstBeatOffset !== undefined) {
                    prompterData.firstBeatOffset += medianOffset;
                }
                if (prompterData.sections) {
                    prompterData.sections = prompterData.sections.map((s: any) => ({...s, time: s.time + medianOffset}));
                }
            }
        } catch (e) {
            console.error("[Auto-Sync] Error en compensación rítmica:", e);
        }
    }
    // ------------------------------------------------------------------------

    // Calcular preRollDuration basado en el BPM (1 compás extra)
    let preRollDuration = 0;
    const beatsPerMeasure = parseInt(timeSignature.split('/')[0]) || 4;
    if (bpm && bpm > 0) {
      preRollDuration = (60 / bpm) * beatsPerMeasure;
    }
    preRollDurationRef.current = preRollDuration;
    setTotalDuration(maxDuration);

    // Guardar para uso interno
    prompterDataRef.current = prompterData;
    manualGridOffsetRef.current = gridOffsetTime - (prompterData?.firstBeatOffset || 0);

    // Resetear el reloj visual al inicio del Pre-Roll
    setCurrentTime(-preRollDuration);
    pauseTime.current = 0;
    
    // Pre-cargar todas las voces desde public/cues/
    const cueNames = ['intro', 'verso', 'pre-coro', 'coro', 'puente', 'solo', 'final', '1', '2', '3', '4'];
    await Promise.all(cueNames.map(async (name) => {
       try {
         if (!cueBuffersRef.current[name]) {
             const res = await fetch(`/cues/${name}.mp3`);
             if (res.ok) {
               const arrayBuffer = await res.arrayBuffer();
               const audioBuffer = await audioContext.current!.decodeAudioData(arrayBuffer);
               cueBuffersRef.current[name] = audioBuffer;
               
               // Auto-Trim: Detectar el inicio real de la voz para saltar el silencio (padding del MP3)
               const data = audioBuffer.getChannelData(0);
               let startSample = 0;
               for (let i = 0; i < data.length; i++) {
                  if (Math.abs(data[i]) > 0.05) { startSample = i; break; }
               }
               cueOffsetsRef.current[name] = startSample / audioBuffer.sampleRate;
             }
         }
       } catch (e) {
         console.error("No se pudo cargar cue:", name);
       }
    }));

    setLoadProgress({ loaded: stems.length, total: stems.length, currentFile: '¡Todas las pistas cargadas en RAM!' });
  };



  // 3. Matriz de Ruteo (Routing Engine)
  const buildRoutingGraph = useCallback(() => {
    if (!audioContext.current) return;
    const ctx = audioContext.current;

    sourceNodes.current.forEach(node => node.disconnect());
    gainNodes.current.forEach(node => node.disconnect());
    pannerNodes.current.forEach(node => node.disconnect());

    const maxChannels = ctx.destination.maxChannelCount;
    if (routingMode === 'MultiChannel' && maxChannels < 4) {
      console.warn("Hardware interface only supports", maxChannels, "channels. Falling back to StereoSplit.");
      setRoutingMode('StereoSplit');
    }

    if (routingMode === 'MultiChannel') {
      ctx.destination.channelCount = maxChannels;
      splitterNode.current = ctx.createChannelSplitter(maxChannels);
      mergerNode.current = ctx.createChannelMerger(maxChannels);
      mergerNode.current.connect(ctx.destination);
    }

    const hasSolo = stems.some(s => s.solo);

    stems.forEach(stem => {
      const isMuted = stem.muted || (hasSolo && !stem.solo);

      if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
         const gain = ctx.createGain();
         gain.gain.value = isMuted ? 0 : stem.volume;
         if (routingMode === 'StereoSplit') {
           const panner = ctx.createStereoPanner();
           panner.pan.value = stem.pan || 0;
           gain.connect(panner);
           panner.connect(ctx.destination);
           pannerNodes.current.set(stem.id, panner);
         } else if (routingMode === 'MultiChannel' && mergerNode.current) {
           const targetOutput = stem.targetOutputChannel ?? 0;
           gain.connect(mergerNode.current, 0, targetOutput);
         } else {
           gain.connect(ctx.destination);
         }
         gainNodes.current.set(stem.id, gain);
         return;
      }
      
      const buffer = buffers.current.get(stem.id);
      if (!buffer) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      
      const gain = ctx.createGain();
      gain.gain.value = isMuted ? 0 : stem.volume;

      source.connect(gain);
      
      if (routingMode === 'StereoSplit') {
        const panner = ctx.createStereoPanner();
        panner.pan.value = stem.pan || 0;
        gain.connect(panner);
        panner.connect(ctx.destination);
        pannerNodes.current.set(stem.id, panner);
      } else if (routingMode === 'MultiChannel' && mergerNode.current) {
        const targetOutput = stem.targetOutputChannel ?? 0;
        gain.connect(mergerNode.current, 0, targetOutput);
      }

      sourceNodes.current.set(stem.id, source);
      gainNodes.current.set(stem.id, gain);
    });
  }, [stems, routingMode]);

  // 4. Playback Controls
  const play = async () => {
    if (!audioContext.current) return;
    
    const prompterData = prompterDataRef.current;
    const manualGridOffset = manualGridOffsetRef.current;
    
    if (audioContext.current.state === 'suspended') {
      await audioContext.current.resume();
    }

    buildRoutingGraph();
    
    const preRollDuration = preRollDurationRef.current;
    const globalOffset = pauseTime.current;
    const now = audioContext.current.currentTime;
    
    // A. Reproducir los Stems Musicales
    sourceNodes.current.forEach((source, _id) => {
      if (globalOffset < preRollDuration) {
        source.start(now + (preRollDuration - globalOffset), 0);
      } else {
        source.start(0, globalOffset - preRollDuration);
      }
    });
    
    // B. Reproducir Click (Tiempo Real)
    clickSources.current.forEach(src => { try { src.stop(); } catch(e) {} });
    clickSources.current = [];
    
    // Obtener el nodo de Ganancia/Paneo del click
    const clickStem = stems.find(s => s.id === 'synthetic-click');
    const isClickMuted = clickStem ? clickStem.muted || (stems.some(s => s.solo) && !clickStem.solo) : false;
    
    if (prompterData && prompterData.bpm && !isClickMuted) {
      const beatInterval = 60 / prompterData.bpm;
      const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
      
      let shiftedBeatTimes: number[] = [];
      if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
         const firstSongBeatTime = prompterData.beatTimes[0] + preRollDuration;
         for (let i = beatsPerMeasure; i > 0; i--) shiftedBeatTimes.push(firstSongBeatTime - (i * beatInterval));
         shiftedBeatTimes = [...shiftedBeatTimes, ...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
      } else {
         const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
         const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
         for (let t = preRollDuration - (beatsPerMeasure * beatInterval); t <= maxTime; t += beatInterval) {
             const adjusted = t + startOffset;
             if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
         }
      }

      const gridOffsetTime = (prompterData.firstBeatOffset || 0) + manualGridOffset;
      const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? (gridOffsetTime - prompterData.beatTimes[0]) : 0;
      
      let beatCount = 0;
      for (const time of shiftedBeatTimes) {
        const adjustedTime = time + manualOffset;
        if (adjustedTime >= globalOffset) {
          const isHigh = beatCount % beatsPerMeasure === 0;
          const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;
          
          if (buffer && audioContext.current) {
            const source = audioContext.current.createBufferSource();
            source.buffer = buffer;
            
            const masterGain = gainNodes.current.get('synthetic-click');
            if (masterGain) source.connect(masterGain);
            else source.connect(audioContext.current.destination);
            
            source.start(now + (adjustedTime - globalOffset));
            clickSources.current.push(source);
          }
        }
        beatCount++;
      }
    }
    
    // C. Reproducir Cues (Tiempo Real)
    cueSources.current.forEach(src => { try { src.stop(); } catch(e) {} });
    cueSources.current = [];
    
    const cueStem = stems.find(s => s.id === 'synthetic-cues');
    const isCueMuted = cueStem ? cueStem.muted || (stems.some(s => s.solo) && !cueStem.solo) : false;
    
    if (prompterData && prompterData.sections && !isCueMuted && prompterData.bpm) {
      const beatInterval = 60 / prompterData.bpm;
      const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
      let bTimes: number[] = [];
      
      if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
         const firstSongBeatTime = prompterData.beatTimes[0] + preRollDuration;
         for (let i = beatsPerMeasure; i > 0; i--) bTimes.push(firstSongBeatTime - (i * beatInterval));
         bTimes = [...bTimes, ...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
      } else {
         const maxTime = preRollDuration + (totalDuration > 0 ? totalDuration : 600);
         const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
         for (let t = preRollDuration - (beatsPerMeasure * beatInterval); t <= maxTime; t += beatInterval) {
             const adjusted = t + startOffset;
             if (adjusted >= 0) bTimes.push(adjusted);
         }
      }

      const gridOffsetTime = (prompterData.firstBeatOffset || 0) + manualGridOffset;
      const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? (gridOffsetTime - prompterData.beatTimes[0]) : 0;

      prompterData.sections.forEach((section: any) => {
         const secTime = section.time + preRollDuration;
         let nearestBeatIdx = 0;
         let minDiff = Infinity;
         for (let i = 0; i < bTimes.length; i++) {
            const diff = Math.abs(bTimes[i] - secTime);
            if (diff < minDiff) { minDiff = diff; nearestBeatIdx = i; }
         }
         
         const schedule = (bufName: string, bIdx: number) => {
            const buf = cueBuffersRef.current[bufName];
            const cueOffset = cueOffsetsRef.current[bufName] || 0;
            if (buf && bIdx >= 0 && bIdx < bTimes.length) {
               const absoluteTime = bTimes[bIdx] + manualOffset;
               if (absoluteTime >= globalOffset) {
                  const source = audioContext.current!.createBufferSource();
                  const gain = audioContext.current!.createGain();
                  source.buffer = buf;
                  gain.gain.value = 1.0;
                  source.connect(gain);
                  
                  const masterGain = gainNodes.current.get('synthetic-cues');
                  if (masterGain) gain.connect(masterGain);
                  else gain.connect(audioContext.current!.destination);
                  
                  // Iniciar la reproducción saltando exactamente el silencio detectado en el cueOffset
                  source.start(now + (absoluteTime - globalOffset), cueOffset);
                  cueSources.current.push(source);
               }
            }
         };
         
         let sName = (section.name || section.section || '').toLowerCase();
         if (!cueBuffersRef.current[sName]) sName = '';
         
         if (section.time < 0.5) {
            if (sName) schedule(sName, 0);
            schedule('3', 1); schedule('2', 2); schedule('1', 3);
         } else if (minDiff < 1.0 && nearestBeatIdx >= 4) {
            if (sName) schedule(sName, nearestBeatIdx - 4);
            schedule('3', nearestBeatIdx - 3); schedule('2', nearestBeatIdx - 2); schedule('1', nearestBeatIdx - 1);
         }
      });
    }
    
    startTime.current = now - globalOffset;
    setIsPlaying(true);
    isPlayingRef.current = true;
    updateTime();
  };

  const pause = () => {
    if (!audioContext.current) return;
    sourceNodes.current.forEach(source => {
      try { source.stop(); } catch (e) {}
    });
    clickSources.current.forEach(src => { try { src.stop(); } catch (e) {} });
    cueSources.current.forEach(src => { try { src.stop(); } catch (e) {} });
    
    pauseTime.current = audioContext.current.currentTime - startTime.current;
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationFrame.current);
  };

  const updateTime = () => {
    if (!audioContext.current || !isPlayingRef.current) return;
    
    const globalTime = audioContext.current.currentTime - startTime.current;
    const visualTime = globalTime - preRollDurationRef.current;
    
    // 5. Vamp / Loop Logic (Requiere adaptar globalTime vs visualTime si se usa)
    if (loopState.current.isLooping && visualTime >= loopState.current.end) {
      pause();
      pauseTime.current = loopState.current.start + preRollDurationRef.current;
      play();
      return;
    }

    // Auto-stop al final de la canción
    if (totalDuration > 0 && globalTime >= totalDuration + preRollDurationRef.current) {
      pause();
      pauseTime.current = 0;
      setCurrentTime(-preRollDurationRef.current);
      return;
    }

    setCurrentTime(visualTime);
    if (isPlayingRef.current) {
      animationFrame.current = requestAnimationFrame(updateTime);
    }
  };

  const seekTo = (newVisualTime: number) => {
    if (!audioContext.current) return;
    const wasPlaying = isPlayingRef.current;
    
    if (wasPlaying) {
      pause();
    }
    
    const preRollDuration = preRollDurationRef.current;
    // Permitir buscar desde -preRollDuration hasta totalDuration
    const globalTime = Math.max(0, Math.min(newVisualTime + preRollDuration, totalDuration + preRollDuration));
    pauseTime.current = globalTime;
    setCurrentTime(newVisualTime);
    
    if (wasPlaying) {
      if (seekTimeoutRef.current) clearTimeout(seekTimeoutRef.current);
      seekTimeoutRef.current = window.setTimeout(() => play(), 50);
    }
  };

  const setLoop = (start: number, end: number, enable: boolean) => {
    loopState.current = { isLooping: enable, start, end };
  };

  // 6. Reactividad del Mixer (Volumen, Mute, Solo en Tiempo Real)
  useEffect(() => {
    if (!audioContext.current || !isPlaying) return;
    
    const hasSolo = stems.some(s => s.solo);
    
    stems.forEach(stem => {
      const gainNode = gainNodes.current.get(stem.id);
      if (gainNode) {
        const isMuted = stem.muted || (hasSolo && !stem.solo);
        // setTargetAtTime evita "clicks" o "pops" de audio al mover el fader bruscamente
        if (audioContext.current) {
          gainNode.gain.setTargetAtTime(isMuted ? 0 : stem.volume, audioContext.current.currentTime, 0.01);
        }
      }
      const pannerNode = pannerNodes.current.get(stem.id);
      if (pannerNode && audioContext.current) {
         pannerNode.pan.setTargetAtTime(stem.pan || 0, audioContext.current.currentTime, 0.01);
      }
    });
  }, [stems, isPlaying]);

  const exportLiveMix = async (songId: string, bandId: string, onProgress: (msg: string) => void) => {
    if (!audioContext.current) throw new Error("AudioContext not initialized");
    const sampleRate = audioContext.current.sampleRate;
    const lengthSeconds = totalDuration + preRollDurationRef.current + 5; // 5 seconds tail
    const lengthSamples = Math.ceil(lengthSeconds * sampleRate);

    const renderMix = async (isFoh: boolean): Promise<Blob> => {
      onProgress(`Preparando renderizado ${isFoh ? 'FOH' : 'CUE'}...`);
      const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(2, lengthSamples, sampleRate);
      
      const prompterData = prompterDataRef.current;
      const manualGridOffset = manualGridOffsetRef.current;
      const preRollDuration = preRollDurationRef.current;

      // Render Stems
      stems.forEach(stem => {
        // FOH: Only Music. CUE: Only Click & Cues (and maybe Music if they didn't mute it? No, user wants CUE to be click+cue, FOH to be music).
        // Actually, the user asked for FOH = Stereo Music, CUE = Stereo Click+Cue.
        // Let's filter:
        const isMusic = stem.type === 'Instrument';
        if (isFoh && !isMusic) return; // FOH only gets instruments
        if (!isFoh && isMusic) return; // CUE only gets click and cues

        const isMuted = stem.muted;
        if (isMuted) return;

        if (stem.id === 'synthetic-click' || stem.id === 'synthetic-cues') {
           // handled below
           return;
        }

        const buffer = buffers.current.get(stem.id);
        if (!buffer) return;

        const source = offlineCtx.createBufferSource();
        source.buffer = buffer;
        
        const gain = offlineCtx.createGain();
        gain.gain.value = stem.volume;

        const panner = offlineCtx.createStereoPanner();
        panner.pan.value = stem.pan || 0;

        source.connect(gain);
        gain.connect(panner);
        panner.connect(offlineCtx.destination);
        
        source.start(preRollDuration);
      });

      // Render Clicks (Only for CUE)
      if (!isFoh && prompterData && prompterData.bpm) {
        const clickStem = stems.find(s => s.id === 'synthetic-click');
        if (!clickStem || !clickStem.muted) {
           const beatInterval = 60 / prompterData.bpm;
           const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
           let shiftedBeatTimes: number[] = [];
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              const firstSongBeatTime = prompterData.beatTimes[0] + preRollDuration;
              for (let i = beatsPerMeasure; i > 0; i--) shiftedBeatTimes.push(firstSongBeatTime - (i * beatInterval));
              shiftedBeatTimes = [...shiftedBeatTimes, ...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = preRollDuration - (beatsPerMeasure * beatInterval); t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) shiftedBeatTimes.push(adjusted);
              }
           }

           const gridOffsetTime = (prompterData.firstBeatOffset || 0) + manualGridOffset;
           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? (gridOffsetTime - prompterData.beatTimes[0]) : 0;
           
           let beatCount = 0;
           for (const time of shiftedBeatTimes) {
             const adjustedTime = time + manualOffset;
             if (adjustedTime >= 0 && adjustedTime < lengthSeconds) {
               const isHigh = beatCount % beatsPerMeasure === 0;
               const buffer = isHigh ? clickHighBufferRef.current : clickLowBufferRef.current;
               
               if (buffer) {
                 const source = offlineCtx.createBufferSource();
                 source.buffer = buffer;
                 const gain = offlineCtx.createGain();
                 gain.gain.value = clickStem ? clickStem.volume : 0.8;
                 const panner = offlineCtx.createStereoPanner();
                 panner.pan.value = clickStem ? (clickStem.pan || 0) : 0;
                 
                 source.connect(gain);
                 gain.connect(panner);
                 panner.connect(offlineCtx.destination);
                 source.start(adjustedTime);
               }
             }
             beatCount++;
           }
        }
      }

      // Render Cues (Only for CUE)
      if (!isFoh && prompterData && prompterData.sections && prompterData.bpm) {
        const cueStem = stems.find(s => s.id === 'synthetic-cues');
        if (!cueStem || !cueStem.muted) {
           const beatInterval = 60 / prompterData.bpm;
           const beatsPerMeasure = parseInt(prompterData.timeSignature?.split('/')[0]) || 4;
           let bTimes: number[] = [];
           if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
              const firstSongBeatTime = prompterData.beatTimes[0] + preRollDuration;
              for (let i = beatsPerMeasure; i > 0; i--) bTimes.push(firstSongBeatTime - (i * beatInterval));
              bTimes = [...bTimes, ...prompterData.beatTimes.map((t: number) => t + preRollDuration)];
           } else {
              const startOffset = (prompterData.firstBeatOffset || 0) + manualGridOffset;
              for (let t = preRollDuration - (beatsPerMeasure * beatInterval); t <= lengthSeconds; t += beatInterval) {
                  const adjusted = t + startOffset;
                  if (adjusted >= 0) bTimes.push(adjusted);
              }
           }
           const gridOffsetTime = (prompterData.firstBeatOffset || 0) + manualGridOffset;
           const manualOffset = (prompterData.beatTimes && prompterData.beatTimes.length > 0) ? (gridOffsetTime - prompterData.beatTimes[0]) : 0;

           prompterData.sections.forEach((section: any) => {
              const secTime = section.time + preRollDuration;
              let nearestBeatIdx = 0;
              let minDiff = Infinity;
              for (let i = 0; i < bTimes.length; i++) {
                 const diff = Math.abs(bTimes[i] - secTime);
                 if (diff < minDiff) { minDiff = diff; nearestBeatIdx = i; }
              }
              
              const schedule = (bufName: string, bIdx: number) => {
                 const buf = cueBuffersRef.current[bufName];
                 const cueOffset = cueOffsetsRef.current[bufName] || 0;
                 if (buf && bIdx >= 0 && bIdx < bTimes.length) {
                    const absoluteTime = bTimes[bIdx] + manualOffset;
                    if (absoluteTime >= 0 && absoluteTime < lengthSeconds) {
                       const source = offlineCtx.createBufferSource();
                       source.buffer = buf;
                       const gain = offlineCtx.createGain();
                       gain.gain.value = cueStem ? cueStem.volume : 0.8;
                       const panner = offlineCtx.createStereoPanner();
                       panner.pan.value = cueStem ? (cueStem.pan || 0) : 0;
                       
                       source.connect(gain);
                       gain.connect(panner);
                       panner.connect(offlineCtx.destination);
                       source.start(absoluteTime, cueOffset);
                    }
                 }
              };
              
              let sName = (section.name || section.section || '').toLowerCase();
              if (!cueBuffersRef.current[sName]) sName = '';
              
              if (section.time < 0.5) {
                 if (sName) schedule(sName, 0);
                 schedule('3', 1); schedule('2', 2); schedule('1', 3);
              } else if (minDiff < 1.0 && nearestBeatIdx >= 4) {
                 if (sName) schedule(sName, nearestBeatIdx - 4);
                 schedule('3', nearestBeatIdx - 3); schedule('2', nearestBeatIdx - 2); schedule('1', nearestBeatIdx - 1);
              }
           });
        }
      }

      onProgress(`Renderizando ${isFoh ? 'FOH' : 'CUE'}...`);
      const renderedBuffer = await offlineCtx.startRendering();
      
      onProgress(`Codificando WAV ${isFoh ? 'FOH' : 'CUE'}...`);
      return audioBufferToWavBlob(renderedBuffer);
    };

    try {
      const fohBlob = await renderMix(true);
      const cueBlob = await renderMix(false);

      const fohPath = `mixes/${bandId}/${songId}/foh_${Date.now()}.wav`;
      const { error: fohError } = await import('../lib/supabase').then(m => m.supabase.storage
        .from('audios')
        .upload(fohPath, fohBlob, { contentType: 'audio/wav', upsert: true }));
      if (fohError) throw fohError;
      const fohUrl = await import('../lib/supabase').then(m => m.supabase.storage.from('audios').getPublicUrl(fohPath).data.publicUrl);
      
      onProgress('Subiendo CUE a la nube...');
      const cuePath = `mixes/${bandId}/${songId}/cue_${Date.now()}.wav`;
      const { error: cueError } = await import('../lib/supabase').then(m => m.supabase.storage
        .from('audios')
        .upload(cuePath, cueBlob, { contentType: 'audio/wav', upsert: true }));
      if (cueError) throw cueError;
      const cueUrl = await import('../lib/supabase').then(m => m.supabase.storage.from('audios').getPublicUrl(cuePath).data.publicUrl);

      onProgress('Guardando URLs en la base de datos...');
      await import('../lib/supabase').then(m => m.supabase.from('songs').update({
        foh_mix_url: fohUrl,
        cue_mix_url: cueUrl
      }).eq('id', songId));

      onProgress('¡Exportación completada exitosamente!');
    } catch (err: any) {
      console.error(err);
      throw new Error(`Error en la exportación: ${err.message}`);
    }
  };

  // Helper para convertir AudioBuffer a WAV Blob
  const audioBufferToWavBlob = (buffer: AudioBuffer): Blob => {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2 + 44;
    const arrayBuffer = new ArrayBuffer(length);
    const view = new DataView(arrayBuffer);
    const channels = [];
    let offset = 0;
    let pos = 0;

    // write WAV header
    const setUint16 = (data: number) => { view.setUint16(pos, data, true); pos += 2; };
    const setUint32 = (data: number) => { view.setUint32(pos, data, true); pos += 4; };
    const setString = (data: string) => { for (let i = 0; i < data.length; i++) { view.setUint8(pos, data.charCodeAt(i)); pos++; } };

    setString('RIFF');
    setUint32(length - 8);
    setString('WAVE');
    setString('fmt ');
    setUint32(16);
    setUint16(1);
    setUint16(numOfChan);
    setUint32(buffer.sampleRate);
    setUint32(buffer.sampleRate * 2 * numOfChan);
    setUint16(numOfChan * 2);
    setUint16(16);
    setString('data');
    setUint32(length - pos - 4);

    // write interleaved data
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      channels.push(buffer.getChannelData(i));
    }

    while (pos < length) {
      for (let i = 0; i < numOfChan; i++) {
        let sample = Math.max(-1, Math.min(1, channels[i][offset])); // clamp
        sample = (0.5 + sample < 0 ? sample * 32768 : sample * 32767) | 0; // scale to 16-bit
        view.setInt16(pos, sample, true);
        pos += 2;
      }
      offset++;
    }

    return new Blob([arrayBuffer], { type: 'audio/wav' });
  };

  return {
    loadStems,
    play,
    pause,
    seekTo,
    isPlaying,
    currentTime,
    routingMode,
    setRoutingMode,
    stems,
    setStems,
    setLoop,
    loadProgress,
    totalDuration,
    preRollDuration: preRollDurationRef.current,
    exportLiveMix
  };
};
