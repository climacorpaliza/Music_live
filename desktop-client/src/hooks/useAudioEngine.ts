import { useRef, useState, useEffect, useCallback } from 'react';

export type StemType = 'Click' | 'Cues' | 'Instrument';
export type RoutingMode = 'StereoSplit' | 'MultiChannel';

export interface StemTrack {
  id: string;
  name: string;
  type: StemType;
  url: string;
  volume: number; // 0.0 to 1.0
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
               cueBuffersRef.current[name] = await audioContext.current!.decodeAudioData(arrayBuffer);
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
           panner.pan.value = 0;
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
        // Centro (0) para garantizar que suene en ambos canales (evita silencio si falta un altavoz)
        panner.pan.value = (stem.type === 'Click' || stem.type === 'Cues') ? 0 : 1;
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
         for (let i = beatsPerMeasure; i > 0; i--) shiftedBeatTimes.push(preRollDuration - (i * beatInterval));
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
         for (let i = beatsPerMeasure; i > 0; i--) bTimes.push(preRollDuration - (i * beatInterval));
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
                  
                  source.start(now + (absoluteTime - globalOffset));
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
    });
  }, [stems, isPlaying]);

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
    preRollDuration: preRollDurationRef.current
  };
};
