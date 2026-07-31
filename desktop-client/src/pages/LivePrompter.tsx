import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAudioEngine, StemTrack } from '../hooks/useAudioEngine';
import { Prompter } from '../components/Prompter';
import { Play, Pause, Square, MonitorSpeaker, Mic, Edit3, Save, AlertCircle, Music, Headphones, Activity } from 'lucide-react';
import './App.css';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function LivePrompter() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const { loadStems, play, pause, seekTo, isPlaying, currentTime, routingMode, setRoutingMode, stems, setStems, loadProgress, totalDuration, preRollDuration } = useAudioEngine([]);
  
  const [prompterData, setPrompterData] = useState<{bpm?: number, timeSignature?: string, firstBeatOffset?: number, beatTimes?: number[], chords: any[], sections: any[]}>({ chords: [], sections: [] });
  
  // Ref del tiempo para el editor en vivo (evitar stale closures y re-binds)
  const currentTimeRef = useRef(0);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  const [isEditingSections, setIsEditingSections] = useState(false);
  const [isEditingPrompter, setIsEditingPrompter] = useState(false);
  const [prompterText, setPrompterText] = useState('');
  
  // Stems as returned from Supabase
  const [dbStems, setDbStems] = useState<any[]>([]);
  
  // Live Sync Engine State
  const [liveTapTimes, setLiveTapTimes] = useState<number[]>([]);
  
  // Error state for audio loading
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  // Grid Nudge State
  const [manualGridOffset, setManualGridOffset] = useState<number>(0);
  const [audioLoaded, setAudioLoaded] = useState(false);

  // Fetch songs
  useEffect(() => {
    const fetchSongs = async () => {
      const { data } = await supabase.from('songs').select('*').eq('band_id', FAKE_BAND_ID);
      if (data) setSongs(data);
    };
    fetchSongs();
  }, []);

  // Fetch stems and prompter data when a song is selected
  useEffect(() => {
    if (!selectedSongId) return;
    const fetchSongData = async () => {
      setAudioLoaded(false);
      setLoadError(null);
      pause(); // Stop any current playback
      
      // 1. Fetch Prompter Data
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
      if (songData && songData.prompter_data) {
        setPrompterData(songData.prompter_data);
        setPrompterText(stringifyPrompterData(songData.prompter_data));
      } else {
        setPrompterData({ chords: [], sections: [] });
        setPrompterText(stringifyPrompterData({ chords: [], sections: [] }));
      }

      // 2. Fetch Stems
      const { data } = await supabase.from('stems').select('*').eq('song_id', selectedSongId);
      if (data && data.length > 0) {
        // Filtrar el audio master para que NO se reproduzca con los stems
        const playableStems = data.filter((stem: any) => !stem.metadata?.is_master);
        setDbStems(playableStems);
        
        // Map database stems to Audio Engine format
        const engineStems: StemTrack[] = playableStems.map(stem => {
          const lowerName = stem.name.toLowerCase();
          let type: 'Click' | 'Cues' | 'Instrument' = 'Instrument';
          if (lowerName.includes('click') || lowerName.includes('metronomo')) type = 'Click';
          if (lowerName.includes('cue') || lowerName.includes('guia') || lowerName.includes('cues')) type = 'Cues';
          
          return {
            id: stem.id,
            name: stem.name,
            type: type,
            url: stem.file_url,
            volume: 0.8,
            muted: false,
            solo: false,
            targetOutputChannel: 0
          };
        });

        // Insertar el Metrónomo IA Sintético
        engineStems.push({
          id: 'synthetic-click',
          name: 'Metrónomo IA',
          type: 'Click',
          url: '', // Se genera matemáticamente en RAM
          volume: 0.8,
          muted: false,
          solo: false,
          targetOutputChannel: 0
        });

        // Insertar las Guías IA Sintéticas
        engineStems.push({
          id: 'synthetic-cues',
          name: 'Guías IA',
          type: 'Cues',
          url: '', // Se genera matemáticamente en RAM
          volume: 0.8,
          muted: false,
          solo: false,
          targetOutputChannel: 0
        });

        setStems(engineStems);
      }
    };
    fetchSongData();
  }, [selectedSongId]);

  // Load Audio Buffers when stems are prepared
  const handleLoadAudio = async () => {
    setLoadError(null);
    setIsDownloading(true);
    try {
      const baseOffset = prompterData.firstBeatOffset !== undefined 
        ? prompterData.firstBeatOffset 
        : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
      await loadStems(prompterData.bpm, baseOffset + manualGridOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData);
      setAudioLoaded(true);
    } catch (error: any) {
      setLoadError("Error descargando las pistas. Asegúrate de tener conexión y permisos CORS habilitados en el Bucket.");
      console.error(error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleNudge = async (amount: number) => {
    const newOffset = manualGridOffset + amount;
    setManualGridOffset(newOffset);
    if (audioLoaded) {
      const baseOffset = prompterData.firstBeatOffset !== undefined 
        ? prompterData.firstBeatOffset 
        : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
      await loadStems(prompterData.bpm, baseOffset + newOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData);
      
      if (isPlaying) {
        const current = currentTime;
        pause();
        setTimeout(() => {
          seekTo(current);
          play();
        }, 50);
      }
    }
  };

  const handleSetDownbeat = async () => {
    if (!audioLoaded || !isPlaying) return;
    const baseOffset = prompterData.firstBeatOffset !== undefined 
      ? prompterData.firstBeatOffset 
      : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
    // The difference between currentTime and baseOffset becomes the new manualGridOffset
    // Actually we want the current time to perfectly align with a beat line.
    // The easiest way: set manualGridOffset so that (baseOffset + manualGridOffset) === currentTime
    const newOffset = currentTime - baseOffset;
    setManualGridOffset(newOffset);
    
    // Regenerate metronome
    await loadStems(prompterData.bpm, currentTime, prompterData.timeSignature, prompterData.beatTimes, prompterData);
    
    const current = currentTime;
    pause();
    setTimeout(() => {
      seekTo(current);
      play();
    }, 50);
  };

  const handleLiveTap = async () => {
    if (!audioLoaded) return;
    const now = Date.now();
    setLiveTapTimes(prev => {
      const recentTaps = prev.filter(time => now - time < 3000);
      const newTaps = [...recentTaps, now];
      
      if (newTaps.length >= 4) { // Requiere 4 taps para estar seguro
        const intervals = [];
        for (let i = 1; i < newTaps.length; i++) {
          intervals.push(newTaps[i] - newTaps[i-1]);
        }
        const avgInterval = intervals.reduce((a, b) => a + b) / intervals.length;
        const newBpm = Math.round(60000 / avgInterval);
        
        // Actualizar el estado temporalmente en RAM
        setPrompterData(prevData => ({ ...prevData, bpm: newBpm }));
        
        // Regenerar audio con nuevo BPM al instante
        const baseOffset = prompterData.firstBeatOffset !== undefined 
          ? prompterData.firstBeatOffset 
          : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
        loadStems(newBpm, baseOffset + manualGridOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData).then(() => {
          if (isPlaying) {
             const current = currentTime;
             pause();
             setTimeout(() => { seekTo(current); play(); }, 50);
          }
        });
        
        return []; // Limpiar taps después de un sync exitoso
      }
      return newTaps;
    });
  };

  const handleVolumeChange = (stemId: string, newVolume: number) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, volume: newVolume } : s));
  };

  const toggleMute = (stemId: string) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, muted: !s.muted } : s));
  };

  const toggleSolo = (stemId: string) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, soloed: !s.soloed } : s));
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

  // --- Prompter Parser Logic ---
  const stringifyPrompterData = (data: any) => {
    let text = '# SECCIONES\n';
    if (data?.sections) {
      data.sections.forEach((s: any) => {
        const mins = Math.floor(s.time / 60).toString().padStart(2, '0');
        const secs = (s.time % 60).toString().padStart(2, '0');
        text += `${mins}:${secs} ${s.section || s.name}\n`;
      });
    }
    text += '\n# ACORDES\n';
    if (data?.chords) {
      data.chords.forEach((c: any) => {
        const mins = Math.floor(c.time / 60).toString().padStart(2, '0');
        const secs = (c.time % 60).toString().padStart(2, '0');
        text += `${mins}:${secs} ${c.chord}\n`;
      });
    }
    return text;
  };

  const parsePrompterText = (text: string) => {
    const lines = text.split('\n');
    const result = { chords: [] as any[], sections: [] as any[] };
    let currentBlock = '';

    for (const line of lines) {
      const t = line.trim();
      if (!t) continue;
      if (t.startsWith('#')) {
        currentBlock = t.toUpperCase().includes('ACORD') ? 'chords' : 'sections';
        continue;
      }
      
      const match = t.match(/^(\d{2}):(\d{2})\s+(.+)$/);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseInt(match[2], 10);
        const time = minutes * 60 + seconds;
        const content = match[3].trim();

        if (currentBlock === 'chords') {
          result.chords.push({ time, chord: content });
        } else {
          result.sections.push({ time, name: content });
        }
      }
    }
    return result;
  };

  const handleSavePrompter = async () => {
    if (!selectedSongId) return;
    const newData = parsePrompterText(prompterText);
    setPrompterData(newData);
    setIsEditingPrompter(false);
    
    // Save to Supabase
    await supabase.from('songs').update({ prompter_data: newData }).eq('id', selectedSongId);
  };
  // ------------------------------

  // ==========================================
  // LÓGICA DE EDITOR DE SECCIONES (LIVE TAPPING)
  // ==========================================
  useEffect(() => {
    if (!isEditingSections) return;
    
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignorar si el usuario está escribiendo en un input
      if (e.code === 'Space' && (e.target as HTMLElement).tagName !== 'INPUT' && (e.target as HTMLElement).tagName !== 'TEXTAREA') {
        e.preventDefault();
        isPlaying ? pause() : play();
      }
      
      if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'TEXTAREA') return;

      const keyMap: Record<string, string> = {
        'i': 'INTRO',
        'v': 'VERSO',
        'p': 'PRE-CORO',
        'c': 'CORO',
        'b': 'PUENTE',
        's': 'SOLO',
        'f': 'FINAL'
      };
      
      const sectionName = keyMap[e.key.toLowerCase()];
      if (sectionName) {
        // Clampear a 0 para que si el usuario presiona durante el pre-roll (tiempo negativo), 
        // se marque exactamente en el inicio de la música (0.0)
        let exactTime = Math.max(0, currentTimeRef.current);
        
        // Snapping Magnético a la Grilla de Compases (Beatmap)
        if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
          let closest = prompterData.beatTimes[0];
          let minDiff = Math.abs(closest - exactTime);
          for (let i = 1; i < prompterData.beatTimes.length; i++) {
            const diff = Math.abs(prompterData.beatTimes[i] - exactTime);
            if (diff < minDiff) {
              minDiff = diff;
              closest = prompterData.beatTimes[i];
            }
          }
          // Si el golpe está a menos de medio segundo, encajar.
          if (minDiff < 0.5) {
            exactTime = closest;
          }
        }
        
        // Inyectar en la base local (estado)
        setPrompterData(prev => {
          const newSections = [...(prev.sections || [])];
          // Evitar dobles clicks accidentales (filtramos si hay una muy cerca)
          const filtered = newSections.filter(s => Math.abs(s.time - exactTime) > 0.3);
          filtered.push({ name: sectionName, time: exactTime });
          filtered.sort((a, b) => a.time - b.time);
          return { ...prev, sections: filtered };
        });
      }
    };
    
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isEditingSections, prompterData.beatTimes]);

  const savePrompterData = async () => {
    try {
      const { error } = await supabase.from('songs').update({ prompter_data: prompterData }).eq('id', selectedSongId);
      if (error) throw error;
      alert('¡Estructura guardada exitosamente en Supabase!');
      setIsEditingSections(false);
      
      // Recargar el motor para reconstruir las Guías Vocales con las nuevas posiciones
      if (selectedSongId && dbStems.length > 0) {
         const baseOffset = prompterData.firstBeatOffset !== undefined 
            ? prompterData.firstBeatOffset 
            : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
         loadStems(prompterData.bpm, baseOffset + manualGridOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData);
      }
    } catch (e: any) {
      console.error(e);
      alert('Error guardando: ' + e.message);
    }
  };

  // ==========================================

  return (
    <div className="h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden">
      
      {/* HEADER / TRANSPORT */}
      <header className="h-20 bg-[#111] border-b border-[#222] flex items-center px-6 justify-between shrink-0">
        <div className="flex items-center space-x-4">
          <div className="bg-yellow-500 text-black font-black p-2 rounded">TLH</div>
          <select 
            className="bg-[#222] border border-[#333] text-white px-4 py-2 rounded outline-none"
            value={selectedSongId || ''}
            onChange={(e) => setSelectedSongId(e.target.value)}
          >
            <option value="">Selecciona un Setlist...</option>
            {songs.map(song => (
              <option key={song.id} value={song.id}>{song.title}</option>
            ))}
          </select>

          {selectedSongId && !audioLoaded && (
            <button onClick={handleLoadAudio} className="bg-blue-600 hover:bg-blue-500 px-4 py-2 rounded font-bold transition">
              Cargar Pistas a RAM
            </button>
          )}

          {/* Grid Nudge Controls */}
          <div className="flex items-center space-x-1 bg-[#1A1A1A] p-1.5 rounded border border-[#333] ml-2">
            <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider mr-2">Grid Nudge</span>
            <button onClick={() => handleNudge(-0.01)} className="bg-[#222] hover:bg-[#333] px-2 py-1 rounded text-xs text-gray-400 font-mono">-10</button>
            <button onClick={() => handleNudge(0.01)} className="bg-[#222] hover:bg-[#333] px-2 py-1 rounded text-xs text-gray-400 font-mono">+10</button>
            <span className="text-xs text-yellow-500 font-mono w-10 text-center">{(manualGridOffset * 1000).toFixed(0)}</span>
          </div>

          {/* Live Sync Engine */}
          <div className="flex items-center space-x-1 bg-[#1A1A1A] p-1.5 rounded border border-[#333] ml-2">
            <span className="text-[9px] text-red-500 font-bold uppercase tracking-wider mr-2 animate-pulse">Live Sync</span>
            <button 
              onClick={handleSetDownbeat} 
              disabled={!isPlaying}
              className="bg-red-900/30 hover:bg-red-900/60 text-red-400 border border-red-900/50 px-2 py-1 rounded text-[10px] font-bold disabled:opacity-30 transition"
              title="Presiona justo en el golpe fuerte del bombo para alinear la grilla instantáneamente"
            >
              SET DOWNBEAT
            </button>
            <button 
              onClick={handleLiveTap} 
              className="bg-blue-900/30 hover:bg-blue-900/60 text-blue-400 border border-blue-900/50 px-2 py-1 rounded text-[10px] font-bold transition"
              title="Presiona 4 veces al ritmo de la banda para ajustar el BPM en vivo"
            >
              LIVE TAP {liveTapTimes.length > 0 ? `(${liveTapTimes.length})` : ''}
            </button>
          </div>
        </div>

        {/* Transport Controls */}
        <div className="flex flex-col items-center flex-1 max-w-xl px-8">
          <div className="flex items-baseline space-x-2 mb-1">
            <span className="text-3xl font-mono text-yellow-500 tracking-wider">
              {formatTime(currentTime)}
            </span>
            <span className="text-sm font-mono text-gray-500">
              / {formatTime(totalDuration).substring(0, 5)}
            </span>
          </div>
          
          {/* TIMELINE SCRUBBER */}
          <div className="w-full flex items-center space-x-3 mb-2">
            <input 
              type="range" 
              min={-(preRollDuration || 0)} 
              max={totalDuration || 100} 
              step="0.1" 
              value={currentTime}
              onChange={(e) => seekTo(parseFloat(e.target.value))}
              disabled={!audioLoaded}
              className="flex-1 h-1.5 bg-[#222] rounded-lg appearance-none cursor-pointer disabled:opacity-50"
              style={{
                background: audioLoaded 
                  ? `linear-gradient(to right, #eab308 ${((currentTime + (preRollDuration || 0)) / (totalDuration + (preRollDuration || 0))) * 100}%, #222 ${((currentTime + (preRollDuration || 0)) / (totalDuration + (preRollDuration || 0))) * 100}%)`
                  : '#222'
              }}
            />
          </div>

          <div className="flex space-x-2">
            <button 
              onClick={() => { pause(); seekTo(-(preRollDuration || 0)); }} // Stop and reset
              className="bg-[#222] hover:bg-[#333] p-2 rounded transition text-gray-400"
            >
              <Square fill="currentColor" size={16} />
            </button>
            <button 
              onClick={isPlaying ? pause : play} 
              disabled={!audioLoaded || loadError !== null}
              className={`${isPlaying ? 'bg-yellow-500 text-black shadow-[0_0_15px_rgba(234,179,8,0.4)]' : 'bg-[#222] hover:bg-[#333] text-green-500'} px-6 py-2 rounded transition disabled:opacity-50 disabled:bg-[#111]`}
            >
              {isPlaying ? <Pause fill="currentColor" size={20} /> : <Play fill="currentColor" size={20} />}
            </button>
          </div>
        </div>

        {/* Routing Mode */}
        <div className="flex items-center space-x-3 bg-[#1A1A1A] p-2 rounded border border-[#333]">
          <MonitorSpeaker size={20} className="text-gray-400" />
          <div className="flex flex-col">
            <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Modo de Ruteo</span>
            <select 
              className="bg-transparent text-sm font-semibold outline-none text-white"
              value={routingMode}
              onChange={(e) => setRoutingMode(e.target.value as 'StereoSplit' | 'MultiChannel')}
            >
              <option value="StereoSplit">Stereo Split (L:Click/Cues R:Pistas)</option>
              <option value="MultiChannel">Multi-Canal (Interfaz USB)</option>
            </select>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Error Alert */}
        {loadError && (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-900/90 text-white px-6 py-3 rounded shadow-lg flex items-center z-50">
            <AlertCircle size={20} className="mr-3" />
            <span className="font-semibold">{loadError}</span>
          </div>
        )}

        {/* Progress Overlay */}
        {isDownloading && (
          <div className="absolute inset-0 bg-black/80 z-40 flex flex-col items-center justify-center backdrop-blur-sm">
            <div className="text-yellow-500 mb-4 animate-pulse">
              <MonitorSpeaker size={48} />
            </div>
            <h2 className="text-2xl font-bold mb-2">Cargando Pistas a la Memoria RAM</h2>
            <p className="text-gray-400 mb-6">{loadProgress.currentFile}</p>
            
            <div className="w-96 bg-[#222] rounded-full h-4 overflow-hidden border border-[#333]">
              <div 
                className="bg-yellow-500 h-full transition-all duration-300 ease-out"
                style={{ width: `${(loadProgress.loaded / Math.max(1, loadProgress.total)) * 100}%` }}
              ></div>
            </div>
            <p className="mt-2 text-sm font-bold text-yellow-500">{loadProgress.loaded} / {loadProgress.total}</p>
          </div>
        )}

        {/* MIXER RACK */}
        <div className="w-[45%] min-w-[500px] flex flex-col overflow-y-auto p-4 space-y-2 bg-[#0A0A0A]">
          {stems.map((stem) => {
            const nameLower = stem.name.toLowerCase();
            let icon = <Music size={16} />;
            let trackColor = 'bg-gray-500';
            
            if (nameLower.includes('drum') || nameLower.includes('bater') || nameLower.includes('perc')) {
               icon = <Activity size={16} />;
               trackColor = 'bg-red-500';
            } else if (nameLower.includes('vocal') || nameLower.includes('voz') || nameLower.includes('mic')) {
               icon = <Mic size={16} />;
               trackColor = 'bg-cyan-400';
            } else if (nameLower.includes('bass') || nameLower.includes('bajo')) {
               icon = <Music size={16} />;
               trackColor = 'bg-purple-500';
            } else if (nameLower.includes('guit')) {
               icon = <Music size={16} />;
               trackColor = 'bg-orange-400';
            } else if (nameLower.includes('key') || nameLower.includes('piano') || nameLower.includes('synth')) {
               icon = <Music size={16} />;
               trackColor = 'bg-pink-500';
            } else if (stem.type === 'Click') {
               icon = <Headphones size={16} />;
               trackColor = 'bg-yellow-500';
            } else if (stem.type === 'Cues') {
               icon = <Mic size={16} />;
               trackColor = 'bg-blue-500';
            }

            return (
              <div key={stem.id} className="w-full flex items-center bg-[#111] border border-[#222] rounded-lg p-3 overflow-hidden shrink-0 hover:bg-[#151515] transition">
                <div className="w-[280px] shrink-0 flex items-center space-x-3 pr-4 border-r border-[#333] mr-4">
                  <div className={`p-1.5 rounded-md ${trackColor} bg-opacity-20 text-white flex items-center justify-center shrink-0`}>
                    <div style={{ color: trackColor.replace('bg-', '') }}>{icon}</div>
                  </div>
                  <div className="text-sm font-bold truncate text-gray-200 tracking-wide" title={stem.name}>{stem.name}</div>
                </div>

                <div className="flex space-x-2 shrink-0 w-16 mr-4">
                  <button onClick={() => toggleMute(stem.id)} className={`w-7 h-7 flex items-center justify-center rounded text-[11px] font-black transition ${stem.muted ? 'bg-red-600 text-white' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}>M</button>
                  <button onClick={() => toggleSolo(stem.id)} className={`w-7 h-7 flex items-center justify-center rounded text-[11px] font-black transition ${stem.solo ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}>S</button>
                </div>

                <div className="flex-1 flex items-center relative group">
                  <input 
                    type="range" 
                    min="0" max="1" step="0.01" 
                    value={stem.volume}
                    onChange={(e) => handleVolumeChange(stem.id, parseFloat(e.target.value))}
                    className="w-full appearance-none bg-transparent cursor-pointer h-1.5 rounded-full"
                    style={{
                      boxShadow: 'inset 0 0 5px rgba(0,0,0,1)',
                      background: `linear-gradient(90deg, #3b82f6 ${stem.volume * 100}%, #111 ${stem.volume * 100}%)`
                    }}
                  />
                  <div className="absolute -top-6 left-1/2 transform -translate-x-1/2 opacity-0 group-hover:opacity-100 transition text-[10px] bg-black text-white px-2 py-1 rounded pointer-events-none">
                    {Math.round(stem.volume * 100)}%
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* PROMPTER AREA */}
        <div className="flex-1 bg-[#000] border-l border-[#222] flex flex-col relative">
          <div className="p-4 border-b border-[#222] flex items-center justify-between">
             <h2 className="font-bold flex items-center"><Mic size={18} className="mr-2 text-yellow-500" /> Prompter Visual</h2>
             
             <div className="flex items-center space-x-3">
               {isEditingPrompter ? (
                 <button onClick={handleSavePrompter} className="text-green-500 flex items-center space-x-1 hover:text-green-400 text-sm bg-green-900/30 px-3 py-1 rounded">
                   <Save size={14} /> <span>Guardar en Nube</span>
                 </button>
               ) : (
                 <button onClick={() => setIsEditingPrompter(true)} disabled={!selectedSongId} className="text-gray-400 flex items-center space-x-1 hover:text-white text-sm disabled:opacity-50">
                   <Edit3 size={14} /> <span>Editar Acordes</span>
                 </button>
               )}
                <button 
                  onClick={() => setIsEditingSections(!isEditingSections)}
                  className={`text-[10px] px-2 py-1 rounded border uppercase tracking-widest font-bold transition flex items-center space-x-1 ${isEditingSections ? 'bg-red-500 border-red-400 text-white shadow-[0_0_15px_rgba(239,68,68,0.6)]' : 'bg-[#222] border-[#444] text-gray-400 hover:bg-[#333]'}`}>
                  <span>{isEditingSections ? 'Modo Edición' : 'Editar Secciones'}</span>
                  <span className={`${isEditingSections ? 'bg-black text-red-500' : 'bg-red-500 text-white'} ml-1 px-1 rounded`}>EN VIVO</span>
                </button>
                {isEditingSections && (
                  <>
                    <button 
                      onClick={() => {
                        if (confirm('¿Estás seguro de borrar TODAS las secciones?')) {
                          setPrompterData(prev => ({ ...prev, sections: [] }));
                        }
                      }}
                      className="text-[10px] bg-red-900/40 hover:bg-red-800 px-3 py-1 rounded border border-red-500/50 text-red-200 uppercase tracking-widest transition ml-2"
                    >
                       Borrar Todo
                    </button>
                    <button 
                      onClick={savePrompterData} 
                      className="text-[10px] bg-green-600 px-3 py-1 rounded border border-green-400 text-white uppercase tracking-widest font-bold hover:bg-green-500 shadow-[0_0_10px_rgba(22,163,74,0.6)] flex items-center space-x-1 transition ml-2"
                    >
                      <Save size={12} className="mr-1" /> Guardar Cambios
                    </button>
                  </>
                )}
             </div>
          </div>
          
          <div className="flex-1 overflow-hidden">
            {isEditingPrompter ? (
              <div className="h-full flex flex-col p-4 bg-[#111]">
                <p className="text-xs text-gray-400 mb-2">Escribe usando el formato <code className="text-yellow-500 bg-[#222] px-1 rounded">MM:SS Texto</code></p>
                <textarea 
                  className="flex-1 bg-black border border-[#333] rounded p-4 text-sm font-mono text-gray-300 outline-none focus:border-yellow-500/50 resize-none leading-relaxed"
                  value={prompterText}
                  onChange={(e) => setPrompterText(e.target.value)}
                  placeholder="# SECCIONES\n00:00 INTRO\n00:15 CORO\n\n# ACORDES\n00:05 Am\n00:10 C"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="h-full p-6">
                <Prompter 
                  currentTime={currentTime}
                  bpm={prompterData.bpm || 0}
                  timeSignature={prompterData.timeSignature}
                  baseOffset={prompterData.firstBeatOffset}
                  beatTimes={prompterData.beatTimes}
                  chords={prompterData.chords || []}
                  sections={prompterData.sections || []}
                  isVamping={false}
                  isEditing={isEditingSections}
                  onRemoveSection={(index) => {
                     setPrompterData(prev => {
                        const s = [...(prev.sections || [])];
                        s.splice(index, 1);
                        return { ...prev, sections: s };
                     });
                  }}
                  gridOffset={manualGridOffset}
                />
              </div>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}

// Component exported directly at declaration now
