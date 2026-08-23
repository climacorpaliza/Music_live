import { useEffect, useState, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { useAudioEngine, StemTrack } from '../hooks/useAudioEngine';
import { Prompter } from '../components/Prompter';
import { Play, Pause, Square, MonitorSpeaker, Mic, Edit3, Save, AlertCircle, Music, Headphones, Activity, Sparkles } from 'lucide-react';
import '../App.css';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function LivePrompter() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const { loadStems, play, pause, seekTo, isPlaying, currentTime, routingMode, setRoutingMode, stems, setStems, loadProgress, totalDuration, preRollDuration, exportLiveMix, exportMultitrackToZip, exportFullMixToMp3 } = useAudioEngine([]);
  
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
    <div className="h-screen bg-[#050505] text-white flex flex-col font-sans overflow-hidden">
      
      {/* HEADER / TRANSPORT */}
      <header className="h-20 bg-[#111] border-b border-[#222] flex items-center px-6 justify-between shrink-0">
        
        {/* Left: Song Selector & Loader */}
        <div className="flex items-center space-x-4 w-[30%] min-w-[320px]">
          <div className="bg-gradient-to-br from-yellow-400 to-yellow-600 text-black font-black p-2 rounded shadow-lg">TLH</div>
          <div className="flex flex-col flex-1">
            <select 
              className="bg-[#222] border border-[#333] text-white px-3 py-1.5 rounded text-sm outline-none w-full"
              value={selectedSongId || ''}
              onChange={(e) => setSelectedSongId(e.target.value)}
            >
              <option value="">Selecciona una Canción...</option>
              {songs.map(song => (
                <option key={song.id} value={song.id}>{song.title}</option>
              ))}
            </select>
            {prompterData?.lastAiDetection && (
              <span className="text-[10px] text-purple-400 mt-1 flex items-center">
                <Activity size={10} className="mr-1" />
                IA: {prompterData.lastAiDetection}
              </span>
            )}
          </div>

          {selectedSongId && !audioLoaded && (
            <button onClick={handleLoadAudio} className="bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded text-sm font-bold transition shadow-lg whitespace-nowrap">
              Cargar a RAM
            </button>
          )}
        </div>

        {/* Center: Transport Controls (Ableton/Logic Style) */}
        <div className="flex flex-col items-center flex-1 px-8">
          <div className="flex items-center space-x-4 mb-2">
            {/* Play/Stop Buttons */}
            <div className="flex space-x-1 bg-black p-1 rounded-lg border border-[#333] shadow-inner">
              <button 
                onClick={() => { pause(); seekTo(-(preRollDuration || 0)); }} 
                className="bg-[#222] hover:bg-[#333] w-10 h-10 flex items-center justify-center rounded transition text-gray-400"
                title="Stop & Reset"
              >
                <Square fill="currentColor" size={16} />
              </button>
              <button 
                onClick={isPlaying ? pause : play} 
                disabled={!audioLoaded || loadError !== null}
                className={`${isPlaying ? 'bg-yellow-500 text-black shadow-[0_0_15px_rgba(234,179,8,0.4)]' : 'bg-[#222] hover:bg-[#333] text-green-500'} w-12 h-10 flex items-center justify-center rounded transition disabled:opacity-50 disabled:bg-[#111]`}
              >
                {isPlaying ? <Pause fill="currentColor" size={20} /> : <Play fill="currentColor" size={20} />}
              </button>
            </div>

            {/* Time Display */}
            <div className="bg-black border border-[#333] px-4 py-1.5 rounded-lg flex items-baseline space-x-2 shadow-inner min-w-[150px] justify-center">
              <span className="text-2xl font-mono text-yellow-500 tracking-wider">
                {formatTime(currentTime)}
              </span>
            </div>
          </div>
          
          {/* TIMELINE SCRUBBER */}
          <div className="w-full flex items-center space-x-3 max-w-xl">
            <input 
              type="range" 
              min={-(preRollDuration || 0)} 
              max={totalDuration || 100} 
              step="0.1" 
              value={isDraggingSlider ? localSliderTime : currentTime}
              onPointerDown={() => setIsDraggingSlider(true)}
              onPointerUp={(e) => {
                setIsDraggingSlider(false);
                seekTo(parseFloat(e.currentTarget.value));
              }}
              onChange={(e) => {
                setLocalSliderTime(parseFloat(e.target.value));
                if (!isPlaying) {
                  // If paused, we can scrub and immediately see the prompter update without stuttering audio
                  seekTo(parseFloat(e.target.value));
                }
              }}
              disabled={!audioLoaded}
              className="flex-1 h-2 bg-[#222] rounded-full appearance-none cursor-pointer disabled:opacity-50"
              style={{
                background: audioLoaded 
                  ? `linear-gradient(to right, #eab308 ${((currentTime + (preRollDuration || 0)) / (totalDuration + (preRollDuration || 0))) * 100}%, #222 ${((currentTime + (preRollDuration || 0)) / (totalDuration + (preRollDuration || 0))) * 100}%)`
                  : '#222'
              }}
            />
          </div>
        </div>

        {/* Right: AI Tools & Settings */}
        <div className="flex flex-col items-end space-y-2">
          {/* AI Tools Group */}
          <div className="flex items-center bg-[#1A1A1A] rounded-lg border border-[#333] p-1 shadow-lg">
            <button 
              onClick={handleDetectChordsAI}
              disabled={isDetectingChords}
              className="bg-purple-600/20 hover:bg-purple-600/40 text-purple-400 px-3 py-1.5 rounded-md text-xs font-bold transition disabled:opacity-50 flex items-center space-x-1.5 mr-1"
              title="Detectar acordes con IA (usa la grilla ya detectada en Stem Studio)"
            >
              {isDetectingChords ? (
                <>
                  <Activity size={12} className="animate-pulse" />
                  <span>ANALIZANDO...</span>
                </>
              ) : (
                <>
                  <Activity size={12} />
                  <span>IA PRO</span>
                </>
              )}
            </button>


            <div className="w-px h-6 bg-[#333] mx-1"></div>

            <button 
              onClick={handleHalveTempo}
              className="px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 font-bold transition"
              title="Reducir el BPM a la mitad (Baladas)"
            >
              ÷2
            </button>
            <button 
              onClick={handleDoubleTempo}
              className="px-2 py-1.5 text-xs text-gray-400 hover:text-white hover:bg-white/10 font-bold transition mr-1"
              title="Duplicar el BPM"
            >
              x2
            </button>
            <button 
              onClick={handleClearBeatGrid} 
              className="bg-red-900/40 hover:bg-red-600 hover:text-white text-red-400 px-3 py-1.5 rounded-md text-xs font-bold transition ml-1"
              title="Forzar al metrónomo a ser matemáticamente perfecto"
            >
              LIMPIAR GRILLA
            </button>
          </div>

          {/* Grid Nudge & Routing */}
          <div className="flex items-center space-x-3">
            <div className="flex items-center bg-[#1A1A1A] p-1 rounded border border-[#333]">
              <span className="text-[9px] text-gray-500 font-bold uppercase mr-1.5 px-1">Nudge</span>
              <button onClick={() => handleNudge(-0.01)} className="bg-[#222] hover:bg-[#333] px-2 py-0.5 rounded text-[10px] text-gray-400 font-mono">-</button>
              <span className="text-[10px] text-yellow-500 font-mono w-6 text-center">{(manualGridOffset * 1000).toFixed(0)}</span>
              <button onClick={() => handleNudge(0.01)} className="bg-[#222] hover:bg-[#333] px-2 py-0.5 rounded text-[10px] text-gray-400 font-mono">+</button>
            </div>
            
            <div className="flex items-center bg-[#1A1A1A] px-2 py-1 rounded border border-[#333]">
              <MonitorSpeaker size={12} className="text-gray-400 mr-2" />
              <select 
                className="bg-transparent text-[10px] font-semibold outline-none text-gray-300 uppercase tracking-wide cursor-pointer"
                value={routingMode}
                onChange={(e) => setRoutingMode(e.target.value as 'StereoSplit' | 'MultiChannel')}
              >
                <option value="StereoSplit">Stereo Split</option>
                <option value="MultiChannel">Multi-Canal</option>
              </select>
            </div>
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

        {/* Chord Detection Overlay */}
        {chordDetectionMsg && (
          <div className="absolute inset-0 bg-black/90 z-50 flex flex-col items-center justify-center backdrop-blur-sm">
            <div className="text-pink-500 mb-4 animate-pulse">
              <Sparkles size={48} />
            </div>
            <h2 className="text-2xl font-bold mb-2 text-pink-400">Analizando Acordes (IA)</h2>
            <p className="text-pink-200 text-lg">{chordDetectionMsg}</p>
            <div className="w-96 bg-[#222] rounded-full h-2 mt-6 overflow-hidden border border-pink-900/50">
              <div className="bg-pink-500 h-full w-full animate-pulse"></div>
            </div>
          </div>
        )}

        {/* MIXER RACK */}
        <div className="w-[28%] min-w-[280px] max-w-[340px] flex flex-col overflow-y-auto p-2 space-y-1.5 bg-[#0A0A0A] custom-scrollbar z-10 shadow-xl border-r border-[#1a1a1a]">
          {stems.map((stem) => {
            const nameLower = stem.name.toLowerCase();
            let icon = <Music size={12} />;
            let trackColor = 'bg-gray-500';
            
            if (nameLower.includes('drum') || nameLower.includes('bater') || nameLower.includes('perc')) {
               icon = <Activity size={12} />;
               trackColor = 'bg-red-500';
            } else if (nameLower.includes('vocal') || nameLower.includes('voz') || nameLower.includes('mic')) {
               icon = <Mic size={12} />;
               trackColor = 'bg-cyan-400';
            } else if (nameLower.includes('bass') || nameLower.includes('bajo')) {
               icon = <Music size={12} />;
               trackColor = 'bg-purple-500';
            } else if (nameLower.includes('guit')) {
               icon = <Music size={12} />;
               trackColor = 'bg-orange-400';
            } else if (nameLower.includes('key') || nameLower.includes('piano') || nameLower.includes('synth')) {
               icon = <Music size={12} />;
               trackColor = 'bg-pink-500';
            } else if (stem.type === 'Click') {
               icon = <Headphones size={12} />;
               trackColor = 'bg-yellow-500';
            } else if (stem.type === 'Cues') {
               icon = <Mic size={12} />;
               trackColor = 'bg-blue-500';
            }

            return (
              <div key={stem.id} className="w-full flex items-center bg-[#111] border border-[#222] rounded-md p-1.5 overflow-hidden shrink-0 hover:bg-[#151515] transition">
                
                {/* Icon & Name */}
                <div className="w-[120px] shrink-0 flex items-center space-x-2 pr-2 border-r border-[#333] mr-2">
                  <div className={`p-1 rounded-md ${trackColor} bg-opacity-20 text-white flex items-center justify-center shrink-0`}>
                    <div style={{ color: trackColor.replace('bg-', '') }}>{icon}</div>
                  </div>
                  <div className="text-[10px] font-bold truncate text-gray-300 tracking-wide" title={stem.name}>{stem.name}</div>
                </div>

                {/* M/S Buttons */}
                <div className="flex flex-col space-y-1 shrink-0 w-5 mr-2">
                  <button onClick={() => toggleMute(stem.id)} className={`w-5 h-4 flex items-center justify-center rounded text-[8px] font-black transition ${stem.muted ? 'bg-red-600 text-white' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}>M</button>
                  <button onClick={() => toggleSolo(stem.id)} className={`w-5 h-4 flex items-center justify-center rounded text-[8px] font-black transition ${stem.solo ? 'bg-yellow-500 text-black shadow-[0_0_10px_rgba(234,179,8,0.5)]' : 'bg-[#222] text-gray-500 hover:bg-[#333]'}`}>S</button>
                </div>

                {/* Sliders */}
                <div className="flex-1 flex flex-col justify-center pr-2 space-y-1.5">
                  <div className="flex items-center relative group">
                    <span className="text-[7px] text-gray-500 font-bold mr-1.5 w-2">V</span>
                    <input 
                      type="range" 
                      min="0" max="1" step="0.01" 
                      value={stem.volume}
                      onChange={(e) => handleVolumeChange(stem.id, parseFloat(e.target.value))}
                      className="w-full appearance-none bg-transparent cursor-pointer h-[4px] rounded-full"
                      style={{
                        boxShadow: 'inset 0 0 5px rgba(0,0,0,1)',
                        background: `linear-gradient(90deg, #3b82f6 ${stem.volume * 100}%, #111 ${stem.volume * 100}%)`
                      }}
                    />
                  </div>
                  <div className="flex items-center relative group">
                    <span className="text-[7px] text-gray-500 font-bold mr-1.5 w-2">P</span>
                    <input 
                      type="range" 
                      min="-1" max="1" step="0.01" 
                      value={stem.pan}
                      onChange={(e) => handlePanChange(stem.id, parseFloat(e.target.value))}
                      className="w-full appearance-none bg-transparent cursor-pointer h-[4px] rounded-full"
                      style={{
                        boxShadow: 'inset 0 0 5px rgba(0,0,0,1)',
                        background: `linear-gradient(90deg, #111 ${((stem.pan + 1) / 2) * 100}%, #a855f7 ${((stem.pan + 1) / 2) * 100}%)`
                      }}
                    />
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
                 <button onClick={() => {
                  setPrompterText(stringifyPrompterData(prompterData));
                  setIsEditingPrompter(true);
                }} disabled={!selectedSongId} className="text-gray-400 flex items-center space-x-1 hover:text-white text-sm disabled:opacity-50">
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
                
                <button 
                  onClick={handleExportLiveMix}
                  disabled={isExporting}
                  className="bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded font-bold shadow-lg disabled:opacity-50 text-sm whitespace-nowrap"
                >
                  {isExporting ? (exportProgress || 'Exportando...') : 'Exportar FOH/CUE'}
                </button>
                <button 
                  onClick={handleExportMultitrackToZip}
                  disabled={isExportingMultitrack}
                  className="bg-orange-600 hover:bg-orange-500 text-white px-4 py-2 rounded font-bold shadow-lg disabled:opacity-50 text-sm whitespace-nowrap ml-2"
                >
                  {isExportingMultitrack ? (exportProgress || 'Exportando...') : 'Exportar Stems ZIP'}
                </button>
                <button 
                  onClick={handleExportFullMixMp3}
                  disabled={isExportingMp3}
                  className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded font-bold shadow-lg disabled:opacity-50 text-sm whitespace-nowrap ml-2"
                >
                  {isExportingMp3 ? (exportProgress || 'Exportando...') : 'Exportar Mezcla MP3'}
                </button>
                <button 
                  onClick={handleSaveMixConfig}
                  className="bg-purple-600 hover:bg-purple-500 text-white px-4 py-2 rounded font-bold shadow-lg text-sm whitespace-nowrap ml-2"
                >
                  Guardar Configuración
                </button>
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
