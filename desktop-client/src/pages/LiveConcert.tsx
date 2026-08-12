import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Prompter } from '../components/Prompter';
import { Play, Pause, Square, SkipBack, SkipForward, MonitorSpeaker, Music, LayoutList, Wifi, Users } from 'lucide-react';
import { useSyncMaster } from '../hooks/useSyncMaster';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function LiveConcert() {
  const [setlists, setSetlists] = useState<any[]>([]);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(null);
  
  const [songs, setSongs] = useState<any[]>([]);
  const [currentSongIndex, setCurrentSongIndex] = useState<number>(0);
  const currentSong = songs[currentSongIndex] || null;

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [totalDuration, setTotalDuration] = useState(0);
  const [routingMode, setRoutingMode] = useState<'StereoSplit' | 'MultiChannel'>('StereoSplit');

  // Network Sync
  const { broadcast, connections } = useSyncMaster(FAKE_BAND_ID);
  const [broadcastEnabled, setBroadcastEnabled] = useState(false);

  // Audio Context & Nodes
  const audioCtxRef = useRef<AudioContext | null>(null);
  const fohSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const cueSourceRef = useRef<AudioBufferSourceNode | null>(null);
  
  // Buffers loaded in RAM
  const fohBufferRef = useRef<AudioBuffer | null>(null);
  const cueBufferRef = useRef<AudioBuffer | null>(null);
  
  // Nodes for routing
  const fohGainRef = useRef<GainNode | null>(null);
  const cueGainRef = useRef<GainNode | null>(null);
  const fohPannerRef = useRef<StereoPannerNode | null>(null);
  const cuePannerRef = useRef<StereoPannerNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const mergerRef = useRef<ChannelMergerNode | null>(null);

  // Time tracking
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const animationFrameRef = useRef(0);
  const isPlayingRef = useRef(false);

  // UI States
  const [isLoading, setIsLoading] = useState(false);
  const [loadStatus, setLoadStatus] = useState('');

  useEffect(() => {
    fetchSetlists();
    
    // Initialize AudioContext on user interaction/mount
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    audioCtxRef.current = new AudioContextClass();
    
    return () => {
      pause();
      if (audioCtxRef.current) audioCtxRef.current.close();
    };
  }, []);

  useEffect(() => {
    if (selectedSetlistId) {
      fetchSetlistSongs(selectedSetlistId);
    } else {
      setSongs([]);
      setCurrentSongIndex(0);
    }
  }, [selectedSetlistId]);

  // When song index changes, load the audio automatically
  useEffect(() => {
    if (currentSong) {
      loadSongAudio(currentSong);
    }
  }, [currentSongIndex, currentSong, broadcastEnabled]);

  const fetchSetlists = async () => {
    const { data } = await supabase.from('setlists').select('*').eq('band_id', FAKE_BAND_ID).order('created_at', { ascending: false });
    if (data) setSetlists(data);
  };

  const fetchSetlistSongs = async (setId: string) => {
    const { data, error } = await supabase
      .from('setlist_songs')
      .select(`
        position,
        song:songs (id, title, foh_mix_url, cue_mix_url, prompter_data)
      `)
      .eq('setlist_id', setId)
      .order('position', { ascending: true });
      
    if (error) {
      console.error(error);
    } else {
      const mapped = (data || []).map(item => ({
        position: item.position,
        ...(item.song as any)
      }));
      setSongs(mapped);
      setCurrentSongIndex(0); // reset to first song
    }
  };

  const loadSongAudio = async (song: any) => {
    if (!audioCtxRef.current) return;
    
    // Stop current playback
    pause();
    setCurrentTime(-getPreRoll(song)); // Reset clock
    pauseTimeRef.current = 0;
    
    fohBufferRef.current = null;
    cueBufferRef.current = null;
    
    if (!song.foh_mix_url || !song.cue_mix_url) {
       setLoadStatus('Error: Faltan archivos exportados (FOH/CUE) para esta canción.');
       return;
    }

    setIsLoading(true);
    setLoadStatus('Descargando FOH Mix...');
    
    try {
      // Load FOH
      const fohRes = await fetch(song.foh_mix_url);
      const fohArray = await fohRes.arrayBuffer();
      setLoadStatus('Decodificando FOH Mix...');
      fohBufferRef.current = await audioCtxRef.current.decodeAudioData(fohArray);
      
      // Load CUE
      setLoadStatus('Descargando CUE Mix...');
      const cueRes = await fetch(song.cue_mix_url);
      const cueArray = await cueRes.arrayBuffer();
      setLoadStatus('Decodificando CUE Mix...');
      cueBufferRef.current = await audioCtxRef.current.decodeAudioData(cueArray);
      
      setTotalDuration(fohBufferRef.current.duration);
      setLoadStatus('');
      
      if (broadcastEnabled) {
        broadcast({ type: 'LOAD_SONG', songId: song.id, songData: song });
      }
      
    } catch (e: any) {
      console.error(e);
      setLoadStatus('Error al cargar audio: ' + e.message);
    } finally {
      setIsLoading(false);
    }
  };

  const getPreRoll = (song: any) => {
    if (!song?.prompter_data?.bpm) return 0;
    const beatsPerMeasure = parseInt(song.prompter_data.timeSignature?.split('/')[0]) || 4;
    return (60 / song.prompter_data.bpm) * beatsPerMeasure;
  };

  const buildRoutingGraph = () => {
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    
    if (fohSourceRef.current) fohSourceRef.current.disconnect();
    if (cueSourceRef.current) cueSourceRef.current.disconnect();

    const maxChannels = ctx.destination.maxChannelCount;
    let actualRoutingMode = routingMode;
    if (routingMode === 'MultiChannel' && maxChannels < 4) {
      actualRoutingMode = 'StereoSplit';
    }

    if (actualRoutingMode === 'MultiChannel') {
      ctx.destination.channelCount = maxChannels;
      splitterRef.current = ctx.createChannelSplitter(maxChannels);
      mergerRef.current = ctx.createChannelMerger(maxChannels);
      mergerRef.current.connect(ctx.destination);
    }

    fohGainRef.current = ctx.createGain();
    cueGainRef.current = ctx.createGain();

    if (actualRoutingMode === 'StereoSplit') {
      // Stereo Split: CUE to Left (-1), FOH to Right (1)
      // Actually standard: Click/Cue on Left (Pan -1), FOH (Mono mix) on Right (Pan 1)
      // But FOH mix is stereo. If we pan it 1, both L and R of FOH mix will be squashed to Right output.
      fohPannerRef.current = ctx.createStereoPanner();
      fohPannerRef.current.pan.value = 1; // FOH to Right
      fohGainRef.current.connect(fohPannerRef.current);
      fohPannerRef.current.connect(ctx.destination);

      cuePannerRef.current = ctx.createStereoPanner();
      cuePannerRef.current.pan.value = -1; // CUE to Left
      cueGainRef.current.connect(cuePannerRef.current);
      cuePannerRef.current.connect(ctx.destination);
    } else if (actualRoutingMode === 'MultiChannel' && mergerRef.current) {
      // FOH to Ch 0 & 1 (Stereo)
      fohGainRef.current.connect(mergerRef.current, 0, 0); // L -> 0
      fohGainRef.current.connect(mergerRef.current, 0, 1); // R -> 1
      
      // CUE to Ch 2
      cueGainRef.current.connect(mergerRef.current, 0, 2); 
    }
  };

  const play = async () => {
    if (!audioCtxRef.current || !fohBufferRef.current || !cueBufferRef.current) return;
    
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }

    buildRoutingGraph();

    fohSourceRef.current = audioCtxRef.current.createBufferSource();
    fohSourceRef.current.buffer = fohBufferRef.current;
    fohSourceRef.current.connect(fohGainRef.current!);

    cueSourceRef.current = audioCtxRef.current.createBufferSource();
    cueSourceRef.current.buffer = cueBufferRef.current;
    cueSourceRef.current.connect(cueGainRef.current!);

    const offset = pauseTimeRef.current;
    
    const delayMs = 300; // Network propagation buffer
    const T_start = Date.now() + delayMs;
    
    if (broadcastEnabled) {
       broadcast({ type: 'PLAY', startAt: T_start, offset: offset });
    }

    const startAudioContextTime = audioCtxRef.current.currentTime + (delayMs / 1000);
    
    fohSourceRef.current.start(startAudioContextTime, offset);
    cueSourceRef.current.start(startAudioContextTime, offset);

    startTimeRef.current = startAudioContextTime - offset;
    setIsPlaying(true);
    isPlayingRef.current = true;
    updateTime();
  };

  const pause = () => {
    if (!audioCtxRef.current || !isPlayingRef.current) return;
    
    if (fohSourceRef.current) {
      try { fohSourceRef.current.stop(); } catch (e) {}
    }
    if (cueSourceRef.current) {
      try { cueSourceRef.current.stop(); } catch (e) {}
    }
    
    pauseTimeRef.current = audioCtxRef.current.currentTime - startTimeRef.current;
    setIsPlaying(false);
    isPlayingRef.current = false;
    cancelAnimationFrame(animationFrameRef.current);
    
    if (broadcastEnabled) {
       broadcast({ type: 'PAUSE' });
    }
  };

  const updateTime = () => {
    if (!audioCtxRef.current || !isPlayingRef.current) return;
    
    const globalTime = audioCtxRef.current.currentTime - startTimeRef.current;
    const preRoll = getPreRoll(currentSong);
    const visualTime = globalTime - preRoll;
    
    // Auto-stop at end
    if (totalDuration > 0 && globalTime >= totalDuration) {
      pause();
      // Auto-advance to next song? The user prefers manual start "Alguien tiene que darle play"
      nextSong();
      return;
    }

    setCurrentTime(visualTime);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  };

  const seekTo = (newVisualTime: number) => {
    if (!audioCtxRef.current) return;
    const wasPlaying = isPlayingRef.current;
    
    if (wasPlaying) pause();
    
    const preRoll = getPreRoll(currentSong);
    const globalTime = Math.max(0, Math.min(newVisualTime + preRoll, totalDuration));
    
    pauseTimeRef.current = globalTime;
    setCurrentTime(newVisualTime);
    
    if (broadcastEnabled) {
       broadcast({ type: 'SEEK', offset: globalTime });
    }
    
    if (wasPlaying) {
      setTimeout(() => play(), 50);
    }
  };

  const stop = () => {
    pause();
    pauseTimeRef.current = 0;
    setCurrentTime(-getPreRoll(currentSong));
  };

  const nextSong = () => {
    if (currentSongIndex < songs.length - 1) {
      setCurrentSongIndex(prev => prev + 1);
    }
  };

  const prevSong = () => {
    if (currentSongIndex > 0) {
      setCurrentSongIndex(prev => prev - 1);
    }
  };

  const formatTime = (time: number) => {
    if (isNaN(time)) return '00:00.00';
    const isNeg = time < 0;
    const absTime = Math.abs(time);
    const mins = Math.floor(absTime / 60);
    const secs = Math.floor(absTime % 60);
    const ms = Math.floor((absTime % 1) * 100);
    return `${isNeg ? '-' : ''}${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  return (
    <div className="h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden">
      
      {/* HEADER / TRANSPORT */}
      <header className="h-20 bg-[#111] border-b border-[#222] flex items-center px-6 justify-between shrink-0">
        <div className="flex items-center space-x-4">
          <div className="bg-gradient-to-r from-red-600 to-orange-500 text-white font-black px-3 py-1.5 rounded uppercase tracking-widest shadow-lg shadow-red-500/20 flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-white animate-pulse"></span>
            CONCERT LIVE
          </div>
          <select 
            className="bg-[#222] border border-[#333] text-white px-4 py-2 rounded outline-none font-bold text-sm"
            value={selectedSetlistId || ''}
            onChange={(e) => setSelectedSetlistId(e.target.value)}
          >
            <option value="">Cargar Setlist...</option>
            {setlists.map(sl => (
              <option key={sl.id} value={sl.id}>{sl.title}</option>
            ))}
          </select>
        </div>

        {/* Transport Controls */}
        <div className="flex flex-col items-center flex-1 max-w-2xl px-8">
          <div className="flex items-baseline space-x-2 mb-1">
            <span className="text-4xl font-mono font-bold text-white tracking-wider">
              {formatTime(currentTime)}
            </span>
          </div>
          
          <div className="w-full flex items-center space-x-3 mt-1">
            <input 
              type="range" 
              min={-(getPreRoll(currentSong) || 0)} 
              max={totalDuration - getPreRoll(currentSong) || 100} 
              step="0.1" 
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              disabled={isLoading || !currentSong}
              className="flex-1 h-2 bg-[#222] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
              style={{
                background: currentSong && totalDuration > 0
                  ? `linear-gradient(to right, #ef4444 ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%, #222 ${((currentTime + getPreRoll(currentSong)) / totalDuration) * 100}%)`
                  : '#222'
              }}
            />
          </div>
        </div>

        <div className="flex items-center space-x-6">
          {/* Network Broadcast Toggle */}
          <div className={`flex items-center space-x-3 p-2 rounded-lg border transition ${
            broadcastEnabled ? 'bg-blue-600/20 border-blue-500/50' : 'bg-[#1A1A1A] border-[#333]'
          }`}>
            <Wifi size={20} className={broadcastEnabled ? 'text-blue-400' : 'text-gray-400'} />
            <div className="flex flex-col cursor-pointer" onClick={() => setBroadcastEnabled(!broadcastEnabled)}>
              <span className={`text-[10px] font-bold uppercase tracking-wider ${broadcastEnabled ? 'text-blue-400' : 'text-gray-500'}`}>
                In-Ears Móviles
              </span>
              <span className="text-sm font-semibold text-white">
                {broadcastEnabled ? 'Transmitiendo' : 'Desactivado'}
              </span>
            </div>
            {broadcastEnabled && (
              <div className="flex items-center ml-2 text-xs font-bold bg-blue-500/30 text-blue-300 px-2 py-1 rounded-full" title="Músicos conectados">
                <Users size={12} className="mr-1" /> {connections}
              </div>
            )}
          </div>

           {/* Routing Mode */}
          <div className="flex items-center space-x-3 bg-[#1A1A1A] p-2 rounded-lg border border-[#333]">
            <MonitorSpeaker size={20} className="text-gray-400" />
            <div className="flex flex-col">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Modo Salida</span>
              <select 
                className="bg-transparent text-sm font-semibold outline-none text-white appearance-none cursor-pointer"
                value={routingMode}
                onChange={(e) => setRoutingMode(e.target.value as 'StereoSplit' | 'MultiChannel')}
              >
                <option value="StereoSplit">Stereo Split (L:Cues R:FOH)</option>
                <option value="MultiChannel">Interfaz USB (Multi)</option>
              </select>
            </div>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Loading Overlay */}
        {isLoading && (
          <div className="absolute inset-0 bg-black/80 z-40 flex flex-col items-center justify-center backdrop-blur-md">
            <div className="w-12 h-12 border-4 border-red-500 border-t-transparent rounded-full animate-spin mb-4"></div>
            <h2 className="text-xl font-bold text-white mb-2">{currentSong?.title}</h2>
            <p className="text-gray-400 font-mono text-sm">{loadStatus}</p>
          </div>
        )}

        {/* SETLIST SIDEBAR */}
        <div className="w-80 bg-[#0A0A0A] border-r border-[#222] flex flex-col z-10">
          <div className="p-4 border-b border-[#222] bg-[#111]">
            <h2 className="font-bold flex items-center text-gray-300"><LayoutList size={18} className="mr-2 text-red-500" /> Setlist Oficial</h2>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {songs.map((s, idx) => (
              <div 
                key={idx}
                onClick={() => setCurrentSongIndex(idx)}
                className={`p-3 rounded-lg flex items-center cursor-pointer transition ${
                  idx === currentSongIndex 
                    ? 'bg-red-600/20 border border-red-500/50 shadow-[0_0_15px_rgba(239,68,68,0.2)]' 
                    : 'hover:bg-white/5 border border-transparent'
                }`}
              >
                <div className={`w-6 h-6 rounded flex items-center justify-center text-xs font-bold mr-3 ${idx === currentSongIndex ? 'bg-red-500 text-white' : 'bg-[#222] text-gray-500'}`}>
                  {idx + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <p className={`font-bold truncate ${idx === currentSongIndex ? 'text-white' : 'text-gray-400'}`}>{s.title}</p>
                  {(!s.foh_mix_url || !s.cue_mix_url) && <p className="text-[10px] text-red-400 font-bold uppercase mt-1">Audio No Disponible</p>}
                </div>
                {idx === currentSongIndex && isPlaying && <div className="w-2 h-2 rounded-full bg-red-500 animate-pulse"></div>}
              </div>
            ))}
            {songs.length === 0 && (
              <div className="text-center text-gray-600 py-10 px-4 text-sm font-medium">
                Selecciona un setlist arriba para comenzar.
              </div>
            )}
          </div>

          {/* LARGE TRANSPORT BUTTONS */}
          <div className="p-4 bg-[#111] border-t border-[#222] grid grid-cols-3 gap-2">
            <button onClick={prevSong} disabled={currentSongIndex === 0} className="bg-[#222] hover:bg-[#333] disabled:opacity-30 rounded-lg flex items-center justify-center py-4 transition">
              <SkipBack size={24} />
            </button>
            <button onClick={stop} disabled={!currentSong} className="bg-[#222] hover:bg-[#333] disabled:opacity-30 rounded-lg flex items-center justify-center py-4 transition text-gray-400">
              <Square size={24} fill="currentColor" />
            </button>
            <button onClick={nextSong} disabled={currentSongIndex === songs.length - 1} className="bg-[#222] hover:bg-[#333] disabled:opacity-30 rounded-lg flex items-center justify-center py-4 transition">
              <SkipForward size={24} />
            </button>
            
            <button 
              onClick={isPlaying ? pause : play} 
              disabled={isLoading || !currentSong || !currentSong.foh_mix_url}
              className={`col-span-3 py-6 rounded-xl flex items-center justify-center text-2xl font-black transition ${
                isPlaying 
                ? 'bg-white text-black shadow-[0_0_30px_rgba(255,255,255,0.3)] hover:bg-gray-200' 
                : 'bg-red-600 text-white hover:bg-red-500 shadow-[0_0_30px_rgba(239,68,68,0.3)]'
              } disabled:opacity-30 disabled:shadow-none`}
            >
              {isPlaying ? <Pause size={32} fill="currentColor" className="mr-2" /> : <Play size={32} fill="currentColor" className="mr-2" />}
              {isPlaying ? 'PAUSA' : 'REPRODUCIR'}
            </button>
          </div>
        </div>

        {/* PROMPTER AREA */}
        <div className="flex-1 bg-black flex flex-col relative">
          <div className="flex-1 p-8 overflow-hidden flex flex-col relative">
            {/* Background Logo / Glow */}
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
              <Music size={400} />
            </div>

            {currentSong ? (
              <div className="h-full relative z-10">
                <Prompter 
                  currentTime={currentTime}
                  bpm={currentSong.prompter_data?.bpm || 0}
                  timeSignature={currentSong.prompter_data?.timeSignature}
                  baseOffset={currentSong.prompter_data?.firstBeatOffset}
                  beatTimes={currentSong.prompter_data?.beatTimes}
                  chords={currentSong.prompter_data?.chords || []}
                  sections={currentSong.prompter_data?.sections || []}
                  isVamping={false}
                  isEditing={false}
                />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-600 text-xl font-bold">
                MÚSICA DETENIDA
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
