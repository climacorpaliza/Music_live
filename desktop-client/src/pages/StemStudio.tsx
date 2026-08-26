import { useEffect, useState, useRef } from 'react';
import './StemStudio.css';
import { supabase } from '../lib/supabase';
import StemUploader from '../components/StemUploader';
import { Music, FolderPlus, Disc3, FileAudio, Loader2, Trash2, Sparkles, CheckCircle, RefreshCw, Play, Pause } from 'lucide-react';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function StemStudio() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [stems, setStems] = useState<any[]>([]);
  const [loadingSongs, setLoadingSongs] = useState(true);
  const [loadingStems, setLoadingStems] = useState(false);

  // AI Generator state
  const [isGeneratingAI, setIsGeneratingAI] = useState(false);
  const [aiSuccessMessage, setAiSuccessMessage] = useState<string | null>(null);
  const [manualKey, setManualKey] = useState<string>('');
  



  const [timeSignature, setTimeSignature] = useState<string>('4/4');

  // AI Splitter State
  const [isSplitting, setIsSplitting] = useState(false);
  const [splitMessage, setSplitMessage] = useState<string | null>(null);
  
  // Audio Playback State
  const [playingStemId, setPlayingStemId] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  const togglePlay = (stem: any) => {
    if (playingStemId === stem.id) {
      audioRef.current?.pause();
      setPlayingStemId(null);
    } else {
      if (audioRef.current) {
         audioRef.current.src = stem.file_url;
         audioRef.current.play().catch(e => console.error("Playback failed", e));
         setPlayingStemId(stem.id);
      }
    }
  };

  useEffect(() => {
    fetchSongs();
  }, []);

  useEffect(() => {
    if (selectedSongId) {
      fetchStems(selectedSongId);
      // Stop playing if song changes
      if (audioRef.current) {
        audioRef.current.pause();
        setPlayingStemId(null);
      }
    } else {
      setStems([]);
    }
  }, [selectedSongId]);

  const fetchSongs = async () => {
    setLoadingSongs(true);
    const { data } = await supabase
      .from('songs')
      .select('*')
      .order('title');
    if (data) setSongs(data);
    setLoadingSongs(false);
  };

  const fetchStems = async (songId: string) => {
    setLoadingStems(true);
    const { data } = await supabase
      .from('stems')
      .select('*')
      .eq('song_id', songId)
      .order('name');
    if (data) setStems(data);
    setLoadingStems(false);
  };

  const handleUploadComplete = (newSongId?: string) => {
    fetchSongs();
    if (newSongId) {
      setSelectedSongId(newSongId);
      fetchStems(newSongId);
    } else if (selectedSongId) {
      fetchStems(selectedSongId);
    }
  };

  const handleGenerateChordsAI = async () => {
    if (!selectedSongId) return;
    setIsGeneratingAI(true);
    setAiSuccessMessage(null);
    
    try {
      setAiSuccessMessage(`Paso 1/2: Iniciando análisis de Tempo...`);

      const beatsRes = await fetch('/api/ai/beats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ songId: selectedSongId, stems })
      });
      const beatsData = await beatsRes.json();
      if (!beatsRes.ok) throw new Error(beatsData.error || 'Error iniciando Sakemin');
      
      const beatsPredictionId = beatsData.predictionId;
      let isBeatsDone = false;
      let beatsPrompterData = null;
      let pollCount = 1;

      while (!isBeatsDone && pollCount < 300) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch('/api/ai/beats_status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ predictionId: beatsPredictionId })
        });
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Error en polling tempo');
        
        if (statusData.done) {
           isBeatsDone = true;
           
           let rawOutput = statusData.data;
           if (Array.isArray(rawOutput) && rawOutput.length > 0 && typeof rawOutput[0] === 'string' && rawOutput[0].startsWith('http')) {
             const beatFileRes = await fetch(rawOutput[0]);
             rawOutput = await beatFileRes.json();
           }
           
           const newSections: any[] = [];
           if (rawOutput.segments && rawOutput.segments.length > 0) {
             rawOutput.segments.forEach((seg: any) => {
                newSections.push({ name: seg.label.toUpperCase(), time: seg.start });
             });
           }

           let beatTimes: number[] = rawOutput.beats || [];
           const downbeats: number[] = rawOutput.downbeats || [];
           const firstDownbeatTime = downbeats.length > 0 ? downbeats[0] : (beatTimes.length > 0 ? beatTimes[0] : 0);

           if (beatTimes.length > 0 && rawOutput.bpm > 0) {
               const beatInterval = 60 / rawOutput.bpm;
               let firstBeat = beatTimes[0];
               while (firstBeat - beatInterval >= 0) {
                   firstBeat -= beatInterval;
                   beatTimes.unshift(firstBeat);
               }
               let lastBeat = beatTimes[beatTimes.length - 1];
               while (lastBeat + beatInterval <= 600) {
                   lastBeat += beatInterval;
                   beatTimes.push(lastBeat);
               }
           }

           beatsPrompterData = {
             bpm: rawOutput.bpm,
             beatTimes: beatTimes,
             firstBeatOffset: firstDownbeatTime,
             sections: newSections
           };
           
        } else {
           if (statusData.status === 'starting' && pollCount > 10) {
             setAiSuccessMessage(`Paso 1/2: IA Tempo despertando (Cold Boot, puede tardar hasta 5-10 min) (Intento ${pollCount})`);
           } else {
             setAiSuccessMessage(`Paso 1/2: IA Tempo Procesando... Estado: ${statusData.status} (Intento ${pollCount})`);
           }
        }
        pollCount++;
      }

      if (!isBeatsDone || !beatsPrompterData) {
         throw new Error('Timeout esperando el análisis de Tempo');
      }

      setAiSuccessMessage(`Tempo detectado. Guardando en la base de datos...`);
      
      const { data: songData } = await supabase.from('songs').select('prompter_data').eq('id', selectedSongId).single();
      const currentPrompterData = songData?.prompter_data || {};
      
      const finalPrompterData = {
        ...currentPrompterData,
        bpm: beatsPrompterData.bpm,
        beatTimes: beatsPrompterData.beatTimes,
        firstBeatOffset: beatsPrompterData.firstBeatOffset,
        sections: beatsPrompterData.sections.length > 0 ? beatsPrompterData.sections : currentPrompterData.sections,
        lastAiDetection: new Date().toLocaleString('es-PE')
      };

      const { error: updateError } = await supabase.from('songs').update({ prompter_data: finalPrompterData }).eq('id', selectedSongId);
      if (updateError) throw new Error(updateError.message);

      setAiSuccessMessage("¡Tempo y Grilla generados y guardados exitosamente!");
      fetchSongs();
      setTimeout(() => setAiSuccessMessage(null), 5000);

    } catch (error: any) {
      console.error("Error saving AI:", error);
      alert(`Falló la detección IA: ${error.message}`);
    } finally {
      setIsGeneratingAI(false);
    }
  };

  const deleteStem = async (stemId: string) => {
    if (!confirm('¿Estás seguro de que quieres eliminar esta pista?')) return;
    
    if (playingStemId === stemId) {
      audioRef.current?.pause();
      setPlayingStemId(null);
    }
    
    const { error } = await supabase.from('stems').delete().eq('id', stemId);
    if (!error && selectedSongId) {
      fetchStems(selectedSongId);
    } else if (error) {
      console.error("Error al borrar stem:", error);
      alert("Error al borrar el archivo");
    }
  };

    const handleSplitMP3 = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSplitting(true);
    setSplitMessage("Creando carpeta para la canción...");
    
    try {
      // 1. Crear una nueva canción (carpeta) automáticamente con el nombre del archivo
      const newSongName = file.name.split('.').slice(0, -1).join('.') || file.name;
      const { data: newSongData, error: songError } = await supabase
        .from('songs')
        .insert({ band_id: FAKE_BAND_ID, title: newSongName })
        .select('id')
        .single();
        
      if (songError) throw new Error("No se pudo crear la canción: " + songError.message);
      const targetSongId = newSongData.id;

      // Seleccionar automáticamente la nueva canción en la UI
      setSelectedSongId(targetSongId);
      await fetchSongs();

      setSplitMessage("Subiendo archivo original...");
      
      const storagePath = `${FAKE_BAND_ID}/temp/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('audios').upload(storagePath, file);
      if (uploadError) throw new Error("Error subiendo audio: " + uploadError.message);

      const { data: publicUrlData } = supabase.storage.from('audios').getPublicUrl(storagePath);
      const audioUrl = publicUrlData.publicUrl;

      setSplitMessage("Iniciando IA en la nube...");

      const res = await fetch('/api/ai/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar IA');

      const { predictionId } = data;
      setSplitMessage("Separando pistas (Esto puede tomar 1-3 minutos)...");

      let pollCount = 1;
      const poll = async () => {
        try {
          const statusRes = await fetch('/api/ai/split-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ predictionId })
          });
          const statusData = await statusRes.json();
          if (!statusRes.ok) throw new Error(statusData.error || 'Error en polling');

          if (statusData.done) {
            setSplitMessage("¡Separación completada! Descargando stems y guardando...");
            
            const outputUrls = Array.isArray(statusData.output) ? statusData.output : [statusData.output];
            
            for (let i = 0; i < outputUrls.length; i++) {
              const url = outputUrls[i];
              if (typeof url !== 'string' || !url.startsWith('http')) continue;
              
              let stemName = `Stem ${i}`;
              let isMasterFlag = false;
              
              if (url.includes('bass')) stemName = 'Bass';
              else if (url.includes('drums')) stemName = 'Drums';
              else if (url.includes('other')) stemName = 'Other';
              else if (url.includes('vocals')) stemName = 'Vocals';
              else if (url.includes('instrum') && !url.includes('instrum2')) {
                 stemName = 'Mezcla Master';
                 isMasterFlag = true;
              }
              else continue; // Ignorar instrum2.wav o json
              
              // Evitar error de CORS o fallos silenciosos
              const fetchRes = await fetch(url);
              if (!fetchRes.ok) throw new Error(`Replicate devolvió error ${fetchRes.status} para ${stemName}`);
              const blob = await fetchRes.blob();
              
              const finalPath = `${FAKE_BAND_ID}/${targetSongId}/${Date.now()}_${stemName}.wav`;
              const { error: stemUploadError } = await supabase.storage.from('audios').upload(finalPath, blob, { contentType: 'audio/wav' });
              
              // Si el storage falla (ej. límite de 1GB de Supabase), abortamos para no crear stems fantasmas
              if (stemUploadError) throw new Error(`Error guardando ${stemName} en Storage: ` + stemUploadError.message);
              
              const { data: finalUrl } = supabase.storage.from('audios').getPublicUrl(finalPath);
              
              await supabase.from('stems').insert({
                song_id: targetSongId,
                name: stemName,
                file_url: finalUrl.publicUrl,
                type: 'Audio',
                metadata: { original_name: `${stemName}.wav`, format: 'audio/wav', is_master: isMasterFlag }
              });
            }

            setSplitMessage("¡Todo listo!");
            setTimeout(() => setSplitMessage(null), 5000);
            fetchStems(targetSongId); // Cargar los nuevos stems

            await supabase.storage.from('audios').remove([storagePath]); // Limpiar temporal
            setIsSplitting(false);
          } else {
            setSplitMessage(`Procesando... intento ${pollCount}`);
            pollCount++;
            setTimeout(poll, 5000);
          }
        } catch (error: any) {
          console.error("Error en poll:", error);
          alert("Error: " + error.message);
          setSplitMessage("Error al procesar las plicas.");
          setIsSplitting(false);
        }
      };
      
      setTimeout(poll, 5000);
      
    } catch (error: any) {
      console.error("Error en split:", error);
      alert("Error crítico: " + error.message);
      setIsSplitting(false);
      setSplitMessage(null);
    } finally {
      if (e.target) e.target.value = ''; // Limpiar el input para permitir subir el mismo archivo de nuevo
    }
  };;

  return (
    <div className="h-full flex flex-col bg-[#111113] overflow-hidden text-zinc-300 select-none">
      {/* Hidden Audio Player for Previews */}
      <audio 
        ref={audioRef} 
        onEnded={() => setPlayingStemId(null)}
        onError={() => {
           console.error("Audio playback error");
           setPlayingStemId(null);
        }}
      />

      {/* Header - DAW Style */}
      <div className="flex items-center justify-between px-4 py-3 bg-[#18181b] border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <Disc3 className="text-emerald-500" size={18} strokeWidth={2.5} />
          <h1 className="text-xs font-bold text-zinc-200 tracking-widest uppercase">Stem Studio</h1>
        </div>
        <div className="text-[10px] font-bold tracking-widest uppercase text-zinc-500">
          Master Library
        </div>
      </div>

      {/* Main Workspace */}
      <div className="flex flex-1 overflow-hidden">
        
        {/* Sidebar - Project/Song Browser */}
        <div className="w-72 flex flex-col bg-[#09090b] border-r border-zinc-800 shrink-0 z-10">
          <div className="px-4 py-2 border-b border-zinc-800 bg-[#121214] flex items-center gap-2 shrink-0">
            <Music size={12} className="text-zinc-500" />
            <h2 className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Projects</h2>
          </div>
          
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-0.5">
            {loadingSongs ? (
              <div className="flex items-center gap-2 text-zinc-500 p-3">
                <Loader2 size={12} className="animate-spin" />
                <span className="text-xs">Loading...</span>
              </div>
            ) : songs.length === 0 ? (
              <p className="text-zinc-600 text-xs p-3">No projects found.</p>
            ) : (
              songs.map((song) => (
                <button
                  key={song.id}
                  onClick={() => setSelectedSongId(song.id)}
                  className={`w-full text-left px-3 py-2 flex items-center justify-between rounded text-xs transition-colors ${
                    selectedSongId === song.id 
                      ? 'bg-zinc-800 text-zinc-100 font-medium' 
                      : 'text-zinc-400 hover:bg-zinc-800/50 hover:text-zinc-200'
                  }`}
                >
                  <div className="truncate pr-2">{song.title}</div>
                  {selectedSongId === song.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-emerald-500 shrink-0 shadow-[0_0_8px_rgba(16,185,129,0.5)]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col overflow-y-auto bg-[#141417] custom-scrollbar relative">
          {!selectedSongId ? (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600">
              <FolderPlus size={48} className="mb-4 opacity-20" strokeWidth={1} />
              <p className="text-sm font-medium text-zinc-400">Select a project to view stems</p>
              <p className="text-xs mt-1 opacity-70">or upload a .ZIP to create a new one.</p>
              <div className="mt-8 w-80">
                <StemUploader 
                  songId={selectedSongId}
                  bandId={FAKE_BAND_ID}
                  onUploadComplete={handleUploadComplete}
                />
              </div>
            </div>
          ) : (
            <div className="p-6 space-y-6 max-w-6xl mx-auto w-full">
              
              {/* Top Controls Toolbar */}
              <div className="flex flex-col xl:flex-row gap-4 shrink-0">
                
                {/* Uploader / Adder (Red/Orange Theme) */}
                <div className="flex-1 bg-[#1a1a1e] border border-zinc-800/80 rounded-lg p-4 flex flex-col gap-4">
                  <div className="flex items-center gap-2 pb-2 border-b border-zinc-800/50">
                    <FolderPlus size={14} className="text-orange-500" />
                    <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Add Audio Files</h3>
                  </div>
                  
                  <div className="flex-1 flex flex-col gap-4">
                    <div className="text-xs w-full flex items-center justify-center border border-orange-500/20 hover:border-orange-500/50 bg-orange-950/10 rounded transition-colors overflow-hidden py-1">
                       <StemUploader 
                          songId={selectedSongId}
                          bandId={FAKE_BAND_ID}
                          onUploadComplete={handleUploadComplete}
                        />
                    </div>
                    
                    <div className="relative h-[40px] group bg-red-950/20 border border-red-500/30 hover:border-red-500/60 rounded flex items-center justify-between px-3 cursor-pointer transition-colors overflow-hidden">
                      <input type="file" accept="audio/mpeg, audio/wav, audio/mp3" onChange={handleSplitMP3} disabled={isSplitting} className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10" />
                      <div className="flex items-center gap-2 pointer-events-none z-0">
                        {isSplitting ? <RefreshCw size={14} className="animate-spin text-red-400" /> : <Sparkles size={14} className="text-red-400" />}
                        <span className="text-xs font-semibold text-zinc-300">
                          {isSplitting ? splitMessage : "AI Studio Splitter (WAV / 320k)"}
                        </span>
                      </div>
                    </div>
                  </div>
                </div>

                {/* AI Tempo & Grid Module */}
                <div className="flex-1 bg-[#1a1a1e] border border-zinc-800/80 rounded-lg p-4 flex flex-col gap-4">
                  <div className="flex items-center justify-between pb-2 border-b border-zinc-800/50">
                    <div className="flex items-center gap-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-purple-500 animate-pulse" />
                      <h3 className="text-[10px] font-bold text-zinc-400 uppercase tracking-widest">Global Grid & Tempo</h3>
                    </div>
                    {songs.find(s => s.id === selectedSongId)?.prompter_data?.lastAiDetection && (
                       <div className="flex items-center gap-1 text-[9px] text-zinc-500 uppercase tracking-wider">
                         <CheckCircle size={10} className="text-zinc-600" /> Synced
                       </div>
                    )}
                  </div>
                  
                  <div className="flex gap-3">
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Signature</label>
                      <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} className="h-[32px] bg-[#09090b] border border-zinc-800 rounded text-xs text-zinc-300 px-2 focus:border-purple-500 focus:outline-none">
                        <option value="4/4">4/4</option>
                        <option value="3/4">3/4</option>
                        <option value="6/8">6/8</option>
                      </select>
                    </div>
                    <div className="flex-1 flex flex-col gap-1.5">
                      <label className="text-[9px] font-bold text-zinc-500 uppercase tracking-wider">Key (Optional)</label>
                      <input type="text" value={manualKey} onChange={(e) => setManualKey(e.target.value)} placeholder="e.g. Bb Maj" className="h-[32px] bg-[#09090b] border border-zinc-800 rounded text-xs text-zinc-300 px-2 focus:border-purple-500 focus:outline-none placeholder:text-zinc-700" />
                    </div>
                  </div>
                  
                  <button 
                    onClick={handleGenerateChordsAI}
                    disabled={isGeneratingAI || stems.length === 0}
                    className="w-full h-[32px] bg-purple-600/10 hover:bg-purple-600/20 border border-purple-500/30 text-purple-400 text-xs font-bold rounded flex items-center justify-center gap-2 disabled:opacity-50 transition-colors"
                  >
                    {isGeneratingAI ? <RefreshCw className="animate-spin" size={14} /> : null}
                    {isGeneratingAI ? "Analyzing..." : "Auto-Detect Tempo"}
                  </button>
                  {aiSuccessMessage && <div className="text-[10px] text-green-400 bg-green-900/10 px-2 py-1.5 rounded border border-green-900/30 truncate">{aiSuccessMessage}</div>}
                </div>

              </div>

              {/* Tracks / Stems Section (DAW Style) */}
              <div className="flex flex-col bg-[#09090b] border border-zinc-800/80 rounded-lg overflow-hidden shrink-0 shadow-2xl">
                {/* Tracks Header */}
                <div className="flex items-center px-4 py-2 bg-[#121214] border-b border-zinc-800">
                   <div className="w-[320px] text-[10px] font-bold text-zinc-500 uppercase tracking-widest shrink-0">Track Name</div>
                   <div className="flex-1 text-[10px] font-bold text-zinc-500 uppercase tracking-widest pl-4">Waveform</div>
                   <div className="w-[100px] text-[10px] font-bold text-zinc-500 uppercase tracking-widest text-right pr-2 shrink-0">Controls</div>
                </div>

                {loadingStems ? (
                  <div className="flex items-center justify-center py-16 text-zinc-500">
                    <Loader2 size={20} className="animate-spin mr-3 text-zinc-400" />
                    <span className="text-sm font-medium">Loading tracks...</span>
                  </div>
                ) : stems.length === 0 ? (
                  <div className="flex flex-col items-center justify-center py-16 bg-[#09090b]">
                    <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center mb-3">
                      <FileAudio size={20} className="text-zinc-700" />
                    </div>
                    <p className="text-sm text-zinc-500 font-medium">No audio tracks</p>
                    <p className="text-xs text-zinc-600 mt-1">Upload files or extract stems to begin.</p>
                  </div>
                ) : (
                  <div className="flex flex-col divide-y divide-zinc-800/50">
                    {stems.map((stem) => (
                      <div key={stem.id} className="flex min-h-[64px] bg-[#09090b] hover:bg-[#121214] transition-colors group">
                        {/* Track Info (Left panel of DAW track) */}
                        <div className="w-[320px] px-4 py-3 flex flex-col justify-center border-r border-zinc-800/50 bg-[#101012] group-hover:bg-[#141417] shrink-0">
                           <div className="flex items-start gap-2.5">
                             <div className="w-5 h-5 shrink-0 rounded flex items-center justify-center bg-zinc-800 text-zinc-400 mt-0.5">
                               <FileAudio size={11} />
                             </div>
                             <span className="text-[13px] font-semibold text-zinc-200 leading-snug whitespace-normal break-words">{stem.name}</span>
                           </div>
                           <span className="text-[9px] text-zinc-600 pl-7 uppercase tracking-wider font-bold mt-1.5">{stem.type || 'Audio'}</span>
                        </div>
                        
                        {/* Fake Waveform area (Center) */}
                        <div className="flex-1 flex items-center px-4 py-2 relative">
                          <div className="absolute inset-y-2 left-4 right-4 bg-[#141417] border border-zinc-800/50 rounded flex items-center justify-center overflow-hidden">
                             {/* A purely visual fake waveform representation for DAW feel */}
                             <div className={`w-full h-full flex items-center gap-[1px] opacity-[0.15] px-1 transition-opacity duration-300 ${playingStemId === stem.id ? 'opacity-[0.8] animate-pulse' : ''}`}>
                                {Array.from({length: 80}).map((_, i) => (
                                  <div key={i} className={`flex-1 ${playingStemId === stem.id ? 'bg-emerald-400' : 'bg-emerald-500'} rounded-sm`} style={{ height: `${10 + Math.random() * 80}%` }}></div>
                                ))}
                             </div>
                          </div>
                        </div>

                        {/* Controls (Right) */}
                        <div className="w-[100px] flex items-center justify-end px-4 gap-1 shrink-0">
                          <button 
                            onClick={() => togglePlay(stem)}
                            className="w-8 h-8 flex items-center justify-center text-zinc-400 hover:text-emerald-400 hover:bg-emerald-500/10 rounded transition-colors"
                            title={playingStemId === stem.id ? "Pause" : "Play"}
                          >
                            {playingStemId === stem.id ? <Pause size={15} /> : <Play size={15} />}
                          </button>
                          <button 
                            onClick={() => deleteStem(stem.id)}
                            className="w-8 h-8 flex items-center justify-center text-zinc-600 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors"
                            title="Delete Track"
                          >
                            <Trash2 size={15} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

            </div>
          )}
        </div>
      </div>
    </div>
  );
}
