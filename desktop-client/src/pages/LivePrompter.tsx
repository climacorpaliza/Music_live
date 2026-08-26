import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAudioEngine, StemTrack } from '../hooks/useAudioEngine';
import { Prompter } from '../components/Prompter';
import { Play, Pause, Square, Mic, Edit3, Save, AlertCircle, Music, Headphones, Activity, Sparkles, Loader2, Disc3 } from 'lucide-react';
import '../App.css';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function LivePrompter() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const { loadStems, play, pause, seekTo, isPlaying, currentTime, stems, setStems, loadProgress, totalDuration, preRollDuration, exportLiveMix, exportMultitrackToZip, exportFullMixToMp3 } = useAudioEngine([]);
  
  const [prompterData, setPrompterData] = useState<{bpm?: number, timeSignature?: string, firstBeatOffset?: number, beatTimes?: number[], chords: any[], sections: any[], lastAiDetection?: string}>({ chords: [], sections: [] });
  
  const [isDetectingChords, setIsDetectingChords] = useState(false);
  const [chordDetectionMsg, setChordDetectionMsg] = useState<string | null>(null);
  
  // Ref del tiempo para el editor en vivo (evitar stale closures y re-binds)
  const currentTimeRef = useRef(0);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);

  const [isEditingSections, setIsEditingSections] = useState(false);
  const [isEditingPrompter, setIsEditingPrompter] = useState(false);
  const [prompterText, setPrompterText] = useState('');
  
  const [isDraggingSlider, setIsDraggingSlider] = useState(false);
  const [localSliderTime, setLocalSliderTime] = useState(0);

  const [isExporting, setIsExporting] = useState(false);
  const [isExportingMultitrack, setIsExportingMultitrack] = useState(false);
  const [isExportingMp3, setIsExportingMp3] = useState(false);
  const [exportProgress, setExportProgress] = useState('');
  
  // Stems as returned from Supabase
  const [dbStems, setDbStems] = useState<any[]>([]);
  
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
        // NUEVO: Ahora sí cargamos el master a RAM. Es requerido para la IA de Acordes y útil si es la única pista.
        const playableStems = data;
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
            volume: stem.metadata?.volume !== undefined ? Number(stem.metadata.volume) : 0.8,
            pan: stem.metadata?.pan !== undefined ? Number(stem.metadata.pan) : 0,
            muted: stem.metadata?.muted !== undefined ? Boolean(stem.metadata.muted) : false,
            solo: stem.metadata?.solo !== undefined ? Boolean(stem.metadata.solo) : false,
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
          pan: 0,
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
          pan: 0,
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
      await loadStems(prompterData.bpm || 120, baseOffset + manualGridOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData, stems);
      setAudioLoaded(true);
    } catch (error: any) {
      setLoadError("Error descargando las pistas. Asegúrate de tener conexión y permisos CORS habilitados en el Bucket.");
      console.error(error);
    } finally {
      setIsDownloading(false);
    }
  };

  const handleSaveMixConfig = async () => {
    if (!selectedSongId) return;
    try {
      const updates = stems.filter(s => s.id !== 'synthetic-click' && s.id !== 'synthetic-cues').map(async (s) => {
        // Encontrar el stem original en dbStems para no sobreescribir metadata importante
        const originalStem = dbStems.find((dbS: any) => dbS.id === s.id);
        const newMetadata = {
          ...(originalStem?.metadata || {}),
          volume: s.volume,
          pan: s.pan,
          muted: s.muted,
          solo: s.solo
        };
        const { error } = await supabase.from('stems').update({ metadata: newMetadata }).eq('id', s.id);
        if (error) throw error;
      });

      await Promise.all(updates);
      
      // Recargar stems de la base de datos para asegurar sincronización en memoria
      const { data } = await supabase.from('stems').select('*').eq('song_id', selectedSongId);
      if (data) setDbStems(data);

      alert('¡Configuración de mezcla guardada exitosamente!');
    } catch (err: any) {
      alert(`Error al guardar configuración: ${err.message}`);
    }
  };

  const handleNudge = async (amount: number) => {
    const newOffset = manualGridOffset + amount;
    setManualGridOffset(newOffset);
    if (audioLoaded) {
      const baseOffset = prompterData.firstBeatOffset !== undefined 
        ? prompterData.firstBeatOffset 
        : (prompterData.chords && prompterData.chords.length > 0 ? prompterData.chords[0].time : 0);
      await loadStems(prompterData.bpm || 120, baseOffset + newOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData);
      
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



  const handleHalveTempo = async () => {
    if (!prompterData.bpm) return;
    const newBpm = prompterData.bpm / 2;
    let newBeatTimes = prompterData.beatTimes;
    if (newBeatTimes && newBeatTimes.length > 0) {
      newBeatTimes = newBeatTimes.filter((_, i) => i % 2 === 0);
    }
    const newData = { ...prompterData, bpm: newBpm, beatTimes: newBeatTimes };
    setPrompterData(newData);
    await loadStems(newBpm, (prompterData.firstBeatOffset || 0) + manualGridOffset, prompterData.timeSignature, newBeatTimes, newData);
    
    // Save to DB
    if (selectedSongId) {
      await supabase.from('songs').update({ prompter_data: newData }).eq('id', selectedSongId);
    }
  };

  const handleDoubleTempo = async () => {
    if (!prompterData.bpm) return;
    const newBpm = prompterData.bpm * 2;
    let newBeatTimes = prompterData.beatTimes;
    if (newBeatTimes && newBeatTimes.length > 0) {
      const doubled = [];
      for (let i = 0; i < newBeatTimes.length - 1; i++) {
        doubled.push(newBeatTimes[i]);
        doubled.push((newBeatTimes[i] + newBeatTimes[i+1]) / 2);
      }
      doubled.push(newBeatTimes[newBeatTimes.length - 1]);
      newBeatTimes = doubled;
    }
    const newData = { ...prompterData, bpm: newBpm, beatTimes: newBeatTimes };
    setPrompterData(newData);
    await loadStems(newBpm, (prompterData.firstBeatOffset || 0) + manualGridOffset, prompterData.timeSignature, newBeatTimes, newData);
    
    // Save to DB
    if (selectedSongId) {
      await supabase.from('songs').update({ prompter_data: newData }).eq('id', selectedSongId);
    }
  };

  const handleClearBeatGrid = async () => {
    // Esto borra el "Warped Grid" de la IA y fuerza al sistema a usar la grilla matemática pura
    if (!prompterData.bpm) return;
    const newData = { ...prompterData, beatTimes: [] };
    setPrompterData(newData);
    await loadStems(prompterData.bpm, (prompterData.firstBeatOffset || 0) + manualGridOffset, prompterData.timeSignature, [], newData);
    
    // Save to DB
    if (selectedSongId) {
      await supabase.from('songs').update({ prompter_data: newData }).eq('id', selectedSongId);
    }
    alert("Grilla IA descartada. El metrónomo ahora es 100% matemático y rígido.");
  };

  const handleDetectChordsAI = async () => {
    if (!selectedSongId) {
      alert("Selecciona una canción primero.");
      return;
    }
    if (!dbStems || dbStems.length === 0) {
      alert("No hay stems en la base de datos para esta canción.");
      return;
    }

    setIsDetectingChords(true);
    setChordDetectionMsg("Buscando el mejor stem para análisis armónico...");

    try {
      // ✅ NUEVO ENFOQUE: Prioridad ABSOLUTA al track MASTER para mayor solidez en los acordes
      let bestStem = dbStems.find((s: any) => s.metadata && s.metadata.is_master === true);

      if (!bestStem) {
        // Fallback si no hay master: Piano > Guitarra > etc.
        const EXCLUDED_KEYWORDS = ['drum', 'kick', 'snare', 'click', 'clave', 'bass', 'bajo', 'perc', 'hihat', 'cymbal'];
        const PREFERRED_KEYWORDS = ['rhythm guitar', 'electric guitar', 'guitar', 'guitarra', 'piano', 'keys', 'teclado', 'strings', 'pad', 'synth', 'organ'];

        const instrumentStems = dbStems.filter((s: any) => {
          const name = (s.name || s.file_name || '').toLowerCase();
          return !EXCLUDED_KEYWORDS.some(kw => name.includes(kw));
        });

        for (const kw of PREFERRED_KEYWORDS) {
          const found = instrumentStems.find((s: any) => {
            const name = (s.name || s.file_name || '').toLowerCase();
            return name.includes(kw);
          });
          if (found) {
            bestStem = found;
            break;
          }
        }
        if (!bestStem) bestStem = instrumentStems[0];
      }

      // Último recurso
      if (!bestStem) bestStem = dbStems[0];

      const stemName = bestStem.name || bestStem.file_name || 'Stem';
      const stemUrl = bestStem.file_url;

      console.log(`[IA PRO] Stem seleccionado para análisis: ${stemName}`);
      setChordDetectionMsg(`Analizando acordes en: ${stemName}...`);

      const res = await fetch('/api/ai/chords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          songId: selectedSongId,
          timeSignature: prompterData.timeSignature || "4/4",
          stems: [{ name: stemName, file_url: stemUrl, type: 'Instrument', metadata: { is_master: true } }],
          detectedBpm: prompterData.bpm,
          firstBeat: prompterData.firstBeatOffset || 0,
          beatTimes: prompterData.beatTimes || [],
          sections: prompterData.sections || []
        })
      });

      const responseText = await res.text();
      let data;
      try {
        data = JSON.parse(responseText);
      } catch (e) {
        throw new Error(`Respuesta inválida del servidor: ${responseText.substring(0, 100)}`);
      }
      if (!res.ok) throw new Error(data.error || 'Error desconocido del servidor IA');

      const { predictionId, prompterData: pdFromApi } = data;
      setChordDetectionMsg(`IA procesando acordes... (esto toma 2-5 minutos)`);

      let chordsPollCount = 1;
      let isChordsDone = false;

      while (!isChordsDone && chordsPollCount < 300) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch('/api/ai/chords/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            predictionId,
            prompterData: pdFromApi,
            songId: selectedSongId
          })
        });

        const statusText = await statusRes.text();
        let statusData;
        try {
          statusData = JSON.parse(statusText);
        } catch (e) {
          console.error("Respuesta no-JSON del servidor (polling):", statusText);
          throw new Error(`Respuesta inválida del servidor al consultar el estado de la IA.`);
        }

        if (!statusRes.ok) throw new Error(statusData.error || `Error en polling acordes (HTTP ${statusRes.status})`);

        if (statusData.done) {
          isChordsDone = true;
          setChordDetectionMsg("¡Acordes generados exitosamente!");

          const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
          if (songData?.prompter_data) {
            setPrompterData(songData.prompter_data);
          }
          setTimeout(() => setChordDetectionMsg(null), 5000);
        } else {
          if (statusData.status === 'starting' && chordsPollCount > 10) {
            setChordDetectionMsg(`IA despertando (cold boot)... puede tomar 5-10 min (Intento ${chordsPollCount})`);
          } else {
            setChordDetectionMsg(`IA procesando... Estado: ${statusData.status} (Intento ${chordsPollCount})`);
          }
        }
        chordsPollCount++;
      }

    } catch (error: any) {
      console.error("Error detecting chords AI:", error);
      alert(`Falló la detección IA: ${error.message}`);
      setChordDetectionMsg(null);
    } finally {
      setIsDetectingChords(false);
    }
  };


  const handleVolumeChange = (stemId: string, newVolume: number) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, volume: newVolume } : s));
  };

  const handlePanChange = (stemId: string, newPan: number) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, pan: newPan } : s));
  };

  const toggleMute = (stemId: string) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, muted: !s.muted } : s));
  };

  const toggleSolo = (stemId: string) => {
    setStems((prev: any[]) => prev.map((s: any) => s.id === stemId ? { ...s, solo: !s.solo } : s));
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
        const secs = (s.time % 60).toFixed(2).padStart(5, '0');
        text += `${mins}:${secs} ${s.section || s.name}\n`;
      });
    }
    text += '\n# ACORDES\n';
    if (data?.chords) {
      data.chords.forEach((c: any) => {
        const mins = Math.floor(c.time / 60).toString().padStart(2, '0');
        const secs = (c.time % 60).toFixed(2).padStart(5, '0');
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
      
      // Machea MM:SS o MM:SS.ss
      const match = t.match(/^(\d{2}):(\d{2}(?:\.\d+)?)\s+(.+)$/);
      if (match) {
        const minutes = parseInt(match[1], 10);
        const seconds = parseFloat(match[2]);
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
    const parsedData = parsePrompterText(prompterText);
    const newData = { ...prompterData, chords: parsedData.chords, sections: parsedData.sections };
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
         loadStems(prompterData.bpm || 120, baseOffset + manualGridOffset, prompterData.timeSignature, prompterData.beatTimes, prompterData);
      }
    } catch (e: any) {
      console.error(e);
      alert('Error guardando: ' + e.message);
    }
  };

  const handleExportLiveMix = async () => {
    if (!selectedSongId) return;
    if (confirm('¿Estás seguro de que deseas exportar la mezcla con la configuración de volumen y paneo actual? (Esto tomará unos segundos)')) {
      setIsExporting(true);
      try {
        await supabase.from('songs').update({ prompter_data: prompterData }).eq('id', selectedSongId);
        await exportLiveMix(selectedSongId, FAKE_BAND_ID, prompterData, setExportProgress);
        alert('¡Exportación dual completada exitosamente!');
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsExporting(false);
        setExportProgress('');
      }
    }
  };

  const handleExportMultitrackToZip = async () => {
    if (!selectedSongId) return;
    const song = songs.find(s => s.id === selectedSongId);
    const songName = song ? song.title : 'song';
    if (confirm('¿Estás seguro de que deseas exportar cada pista (stems, click, cues) en WAV separados dentro de un archivo ZIP? (Esto tomará unos minutos)')) {
      setIsExportingMultitrack(true);
      try {
        await supabase.from('songs').update({ prompter_data: prompterData }).eq('id', selectedSongId);
        await exportMultitrackToZip(songName, prompterData, setExportProgress);
        alert('¡Exportación Multitrack completada exitosamente!');
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsExportingMultitrack(false);
        setExportProgress('');
      }
    }
  };

  const handleExportFullMixMp3 = async () => {
    if (!selectedSongId) return;
    const song = songs.find(s => s.id === selectedSongId);
    const songName = song ? song.title : 'song';
    if (confirm('¿Deseas exportar la mezcla completa (todos los stems, click y cues) en formato MP3 (Alta Calidad 320kbps)?')) {
      setIsExportingMp3(true);
      try {
        await supabase.from('songs').update({ prompter_data: prompterData }).eq('id', selectedSongId);
        await exportFullMixToMp3(songName, prompterData, setExportProgress);
        alert('¡Exportación a MP3 completada exitosamente!');
      } catch (err: any) {
        alert(err.message);
      } finally {
        setIsExportingMp3(false);
        setExportProgress('');
      }
    }
  };

  // ==========================================

  return (
    <div className="h-screen bg-[#09090b] text-zinc-300 flex flex-col font-sans overflow-hidden select-none">
      
      {/* Error Alert */}
      {loadError && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-950 border border-red-900 text-red-200 px-4 py-2 rounded-md shadow-2xl flex items-center z-50 text-xs font-medium">
          <AlertCircle size={14} className="mr-2 text-red-500" />
          {loadError}
        </div>
      )}

      {/* HEADER / TRANSPORT (Sleek DAW Toolbar) */}
      <header className="h-14 bg-[#121214] border-b border-zinc-800/80 flex items-center px-4 justify-between shrink-0 z-20">
        
        {/* Left: Branding & Song Loader */}
        <div className="flex items-center gap-3 w-1/4">
          <div className="flex items-center justify-center w-6 h-6 bg-emerald-500/10 text-emerald-500 rounded border border-emerald-500/20">
             <Disc3 size={14} />
          </div>
          <div className="flex items-center gap-2 flex-1">
            <select 
              className="bg-[#09090b] border border-zinc-800 text-zinc-300 px-2 py-1 rounded text-xs outline-none focus:border-emerald-500/50 w-full max-w-[220px]"
              value={selectedSongId || ''}
              onChange={(e) => setSelectedSongId(e.target.value)}
            >
              <option value="">Load Project...</option>
              {songs.map(song => (
                <option key={song.id} value={song.id}>{song.title}</option>
              ))}
            </select>
          </div>
          {selectedSongId && !audioLoaded && (
            <button onClick={handleLoadAudio} className="bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-500 border border-emerald-500/20 px-3 py-1 rounded text-[10px] font-bold uppercase tracking-widest transition-colors whitespace-nowrap">
              Load RAM
            </button>
          )}
        </div>

        {/* Center: Transport & Time (Minimalist) */}
        <div className="flex flex-col items-center flex-1">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-1 bg-[#09090b] p-0.5 rounded border border-zinc-800/80">
              <button 
                onClick={() => { pause(); seekTo(-(preRollDuration || 0)); }} 
                className="bg-transparent hover:bg-zinc-800 w-8 h-7 flex items-center justify-center rounded transition-colors text-zinc-500 hover:text-zinc-300"
              >
                <Square fill="currentColor" size={12} />
              </button>
              <button 
                onClick={isPlaying ? pause : play} 
                disabled={!audioLoaded || loadError !== null}
                className={`w-10 h-7 flex items-center justify-center rounded transition-colors disabled:opacity-50 ${isPlaying ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300'}`}
              >
                {isPlaying ? <Pause fill="currentColor" size={14} /> : <Play fill="currentColor" size={14} className="ml-0.5" />}
              </button>
            </div>

            <div className="bg-[#09090b] border border-zinc-800/80 px-3 py-1 rounded flex items-center justify-center min-w-[100px]">
              <span className="text-sm font-mono font-bold text-zinc-200 tracking-wider">
                {formatTime(currentTime)}
              </span>
            </div>
          </div>
        </div>

        {/* Right: Tools & Nudge */}
        <div className="flex items-center gap-3 w-1/4 justify-end">
          <div className="flex items-center gap-1 bg-[#09090b] rounded border border-zinc-800/80 p-0.5">
            <button 
              onClick={handleDetectChordsAI}
              disabled={isDetectingChords}
              className="hover:bg-purple-500/10 text-purple-400 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest transition-colors disabled:opacity-50 flex items-center gap-1"
            >
              <Activity size={10} className={isDetectingChords ? "animate-pulse" : ""} />
              {isDetectingChords ? 'Analyzing...' : 'AI Pro'}
            </button>
            <div className="w-px h-3 bg-zinc-800 mx-1"></div>
            <button onClick={handleHalveTempo} className="px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 font-bold transition-colors">÷2</button>
            <button onClick={handleDoubleTempo} className="px-1.5 py-1 text-[10px] text-zinc-500 hover:text-zinc-300 font-bold transition-colors">x2</button>
            <button onClick={handleClearBeatGrid} className="hover:bg-red-500/10 text-red-500 px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest transition-colors ml-1">Clear Grid</button>
          </div>

          <div className="flex items-center gap-2 bg-[#09090b] rounded border border-zinc-800/80 p-0.5 px-2">
            <span className="text-[9px] text-zinc-500 font-bold uppercase">Nudge</span>
            <button onClick={() => handleNudge(-0.01)} className="text-zinc-500 hover:text-zinc-300 text-xs px-1">-</button>
            <span className="text-[10px] text-zinc-300 font-mono w-4 text-center">{(manualGridOffset * 1000).toFixed(0)}</span>
            <button onClick={() => handleNudge(0.01)} className="text-zinc-500 hover:text-zinc-300 text-xs px-1">+</button>
          </div>
        </div>
      </header>

      {/* MAIN LAYOUT */}
      <div className="flex-1 flex overflow-hidden relative">
        
        {/* Progress Overlays (Cleaned up) */}
        {isDownloading && (
          <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center backdrop-blur-sm">
            <Loader2 size={32} className="animate-spin text-emerald-500 mb-4" />
            <h2 className="text-sm font-bold text-zinc-200 tracking-widest uppercase mb-1">Loading Audio to RAM</h2>
            <p className="text-xs text-zinc-500 mb-6 font-mono">{loadProgress.currentFile}</p>
            <div className="w-64 bg-zinc-900 rounded-full h-1 overflow-hidden">
              <div className="bg-emerald-500 h-full transition-all duration-300" style={{ width: `${(loadProgress.loaded / Math.max(1, loadProgress.total)) * 100}%` }}></div>
            </div>
          </div>
        )}

        {chordDetectionMsg && (
          <div className="absolute inset-0 bg-black/90 z-40 flex flex-col items-center justify-center backdrop-blur-sm">
            <Sparkles size={32} className="animate-pulse text-purple-500 mb-4" />
            <h2 className="text-sm font-bold text-purple-400 tracking-widest uppercase mb-1">AI Chord Analysis</h2>
            <p className="text-xs text-zinc-400 mb-6 font-mono">{chordDetectionMsg}</p>
            <div className="w-64 bg-zinc-900 rounded-full h-1 overflow-hidden">
              <div className="bg-purple-500 h-full w-full animate-pulse"></div>
            </div>
          </div>
        )}

        {/* MIXER SIDEBAR (Industrial DAW Style) */}
        <div className="w-[320px] shrink-0 flex flex-col bg-[#121214] border-r border-zinc-800/80 z-10 shadow-2xl">
          <div className="h-8 border-b border-zinc-800/80 flex items-center px-4 bg-[#161619]">
            <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-500">Track Mixer</span>
          </div>
          
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {stems.map((stem) => {
              const nameLower = stem.name.toLowerCase();
              let Icon = Music;
              let themeClass = 'text-zinc-400';
              
              if (nameLower.includes('drum') || nameLower.includes('bater') || nameLower.includes('perc')) {
                 Icon = Activity; themeClass = 'text-orange-400';
              } else if (nameLower.includes('vocal') || nameLower.includes('voz') || nameLower.includes('mic')) {
                 Icon = Mic; themeClass = 'text-cyan-400';
              } else if (nameLower.includes('bass') || nameLower.includes('bajo')) {
                 Icon = Music; themeClass = 'text-purple-400';
              } else if (nameLower.includes('guit')) {
                 Icon = Music; themeClass = 'text-amber-400';
              } else if (nameLower.includes('key') || nameLower.includes('piano') || nameLower.includes('synth')) {
                 Icon = Music; themeClass = 'text-pink-400';
              } else if (stem.type === 'Click') {
                 Icon = Headphones; themeClass = 'text-emerald-500';
              } else if (stem.type === 'Cues') {
                 Icon = Mic; themeClass = 'text-blue-400';
              }

              return (
                <div key={stem.id} className="flex flex-col bg-[#18181b] border border-zinc-800/50 rounded overflow-hidden">
                  <div className="flex items-center p-2 border-b border-zinc-800/30">
                    <Icon size={12} className={`${themeClass} shrink-0 mr-2`} />
                    <span className="text-[11px] font-semibold text-zinc-300 truncate flex-1">{stem.name}</span>
                    <div className="flex gap-1 shrink-0">
                      <button onClick={() => toggleMute(stem.id)} className={`w-6 h-5 flex items-center justify-center rounded text-[9px] font-black transition-colors ${stem.muted ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>M</button>
                      <button onClick={() => toggleSolo(stem.id)} className={`w-6 h-5 flex items-center justify-center rounded text-[9px] font-black transition-colors ${stem.solo ? 'bg-amber-500/20 text-amber-400 border border-amber-500/30' : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}`}>S</button>
                    </div>
                  </div>
                  
                  <div className="flex items-center p-2 gap-3 bg-[#131316]">
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-[8px] text-zinc-600 font-bold">VOL</span>
                      <input 
                        type="range" min="0" max="1" step="0.01" value={stem.volume} onChange={(e) => handleVolumeChange(stem.id, parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-zinc-400 hover:accent-zinc-200"
                      />
                    </div>
                    <div className="flex items-center gap-2 flex-1">
                      <span className="text-[8px] text-zinc-600 font-bold">PAN</span>
                      <input 
                        type="range" min="-1" max="1" step="0.01" value={stem.pan} onChange={(e) => handlePanChange(stem.id, parseFloat(e.target.value))}
                        className="w-full h-1 bg-zinc-800 rounded-full appearance-none cursor-pointer accent-zinc-400 hover:accent-zinc-200"
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* PROMPTER VISUAL AREA */}
        <div className="flex-1 bg-[#09090b] flex flex-col relative overflow-hidden">
          {/* Prompter Header Toolbar */}
          <div className="h-12 border-b border-zinc-800/80 flex items-center justify-between px-4 bg-[#121214] shrink-0">
             <div className="flex items-center gap-3">
               <div className="flex items-center gap-1.5">
                 <Mic size={14} className="text-zinc-400" />
                 <h2 className="text-[10px] font-bold text-zinc-300 uppercase tracking-widest">Visual Prompter</h2>
               </div>
               
               <div className="w-px h-4 bg-zinc-800 mx-1"></div>
               
               <div className="flex items-center gap-2">
                  <button 
                    onClick={() => setIsEditingSections(!isEditingSections)}
                    className={`px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest transition-colors flex items-center gap-1 ${isEditingSections ? 'bg-red-500/20 text-red-400 border border-red-500/30' : 'text-zinc-500 hover:text-zinc-300 bg-[#09090b] border border-zinc-800'}`}
                  >
                    {isEditingSections ? 'Exit Live Edit' : 'Live Edit'}
                    {isEditingSections && <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse ml-1"></span>}
                  </button>
                  {isEditingSections && (
                    <>
                      <button onClick={() => { if (confirm('¿Borrar todas las secciones?')) setPrompterData(prev => ({ ...prev, sections: [] })); }} className="px-2 py-1 text-[9px] text-red-400/70 hover:text-red-400 uppercase tracking-widest font-bold">Clear All</button>
                      <button onClick={savePrompterData} className="px-2 py-1 text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded uppercase tracking-widest font-bold hover:bg-emerald-500/20">Save</button>
                    </>
                  )}
                  
                  {!isEditingSections && (
                    isEditingPrompter ? (
                      <button onClick={handleSavePrompter} className="px-2 py-1 text-[9px] text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded uppercase tracking-widest font-bold hover:bg-emerald-500/20 flex items-center gap-1">
                        <Save size={10} /> Save Chords
                      </button>
                    ) : (
                      <button onClick={() => { setPrompterText(stringifyPrompterData(prompterData)); setIsEditingPrompter(true); }} disabled={!selectedSongId} className="px-2 py-1 text-[9px] text-zinc-500 bg-[#09090b] border border-zinc-800 rounded uppercase tracking-widest font-bold hover:text-zinc-300 flex items-center gap-1">
                        <Edit3 size={10} /> Edit Chords
                      </button>
                    )
                  )}
               </div>
             </div>
             
             <div className="flex items-center gap-2">
                {/* Minimal Export Menu Group */}
                <div className="flex items-center gap-1 bg-[#09090b] p-0.5 rounded border border-zinc-800/80">
                  <button onClick={handleExportLiveMix} disabled={isExporting} className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
                    {isExporting ? (exportProgress || 'Exp...') : 'FOH/CUE'}
                  </button>
                  <div className="w-px h-3 bg-zinc-800"></div>
                  <button onClick={handleExportMultitrackToZip} disabled={isExportingMultitrack} className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
                    {isExportingMultitrack ? (exportProgress || 'Exp...') : 'Stems ZIP'}
                  </button>
                  <div className="w-px h-3 bg-zinc-800"></div>
                  <button onClick={handleExportFullMixMp3} disabled={isExportingMp3} className="px-2 py-1 text-[9px] font-bold uppercase tracking-widest text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-50">
                    {isExportingMp3 ? (exportProgress || 'Exp...') : 'Mix MP3'}
                  </button>
                </div>
                <button onClick={handleSaveMixConfig} className="px-3 py-1 bg-emerald-500 text-[#09090b] rounded text-[9px] font-bold uppercase tracking-widest hover:bg-emerald-400 transition-colors ml-1">
                  Save Config
                </button>
             </div>
          </div>
          
          {/* Playhead Timeline Scrubber */}
          <div className="h-6 bg-[#09090b] border-b border-zinc-800/50 flex items-center px-4 relative group cursor-pointer z-20">
            <input 
              type="range" min={-(preRollDuration || 0)} max={totalDuration || 100} step="0.1" 
              value={isDraggingSlider ? localSliderTime : currentTime}
              onPointerDown={(e) => { setLocalSliderTime(parseFloat(e.currentTarget.value)); setIsDraggingSlider(true); }}
              onPointerUp={() => { setIsDraggingSlider(false); seekTo(localSliderTime); }}
              onChange={(e) => { const val = parseFloat(e.target.value); setLocalSliderTime(val); if (!isPlaying) seekTo(val); }}
              disabled={!audioLoaded}
              className="absolute inset-0 w-full h-full opacity-0 cursor-pointer z-10"
            />
            <div className="w-full h-1 bg-zinc-800/80 rounded-full relative pointer-events-none">
              <div className="absolute top-0 bottom-0 left-0 bg-emerald-500/80 rounded-full" style={{ width: audioLoaded ? `${((currentTime + (preRollDuration || 0)) / (totalDuration + (preRollDuration || 0))) * 100}%` : '0%' }}></div>
            </div>
          </div>

          <div className="flex-1 overflow-hidden relative">
            {isEditingPrompter ? (
              <div className="h-full flex flex-col p-4 bg-[#09090b]">
                <p className="text-xs text-zinc-500 mb-2 font-mono uppercase tracking-widest">Format: <span className="text-emerald-400">MM:SS Text</span></p>
                <textarea 
                  className="flex-1 bg-[#121214] border border-zinc-800/80 rounded p-4 text-xs font-mono text-zinc-300 outline-none focus:border-emerald-500/50 resize-none leading-relaxed custom-scrollbar"
                  value={prompterText}
                  onChange={(e) => setPrompterText(e.target.value)}
                  placeholder="# SECTIONS\n00:00 INTRO\n00:15 CHORUS\n\n# CHORDS\n00:05 Am\n00:10 C"
                  spellCheck={false}
                />
              </div>
            ) : (
              <div className="h-full relative flex flex-col justify-center">
                {/* Optional: Add a very subtle radial gradient behind the prompter text */}
                <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,_var(--tw-gradient-stops))] from-zinc-900/30 via-[#09090b] to-[#09090b] pointer-events-none"></div>
                
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
