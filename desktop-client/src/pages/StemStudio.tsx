import { useEffect, useState } from 'react';
import './StemStudio.css';
import { supabase } from '../lib/supabase';
import StemUploader from '../components/StemUploader';
import { Music, FolderPlus, Disc3, FileAudio, Loader2, Trash2, Sparkles, CheckCircle, RefreshCw } from 'lucide-react';

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
  
  useEffect(() => {
    fetchSongs();
  }, []);

  useEffect(() => {
    if (selectedSongId) {
      fetchStems(selectedSongId);
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
      // ---------------------------------------------------------
      // PASO 1: DETECCIÓN DE TEMPO Y SECCIONES (SAKEMIN AI)
      // ---------------------------------------------------------
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
             console.log("Fetching JSON from URL:", rawOutput[0]);
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
               // Extrapolar hacia atrás (para rellenar intros de piano/guitarra sin batería)
               let firstBeat = beatTimes[0];
               while (firstBeat - beatInterval >= 0) {
                   firstBeat -= beatInterval;
                   beatTimes.unshift(firstBeat);
               }
               // Extrapolar hacia adelante hasta 600 segundos (10 minutos)
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

      // ---------------------------------------------------------
      // PASO 2: GUARDAR TEMPO Y GRILLA
      // ---------------------------------------------------------
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
    
    // Opcional: También borrar de Storage si quisieras
    const { error } = await supabase.from('stems').delete().eq('id', stemId);
    if (!error && selectedSongId) {
      fetchStems(selectedSongId);
    } else if (error) {
      console.error("Error al borrar stem:", error);
      alert("Error al borrar el archivo");
    }
  };

  const handleSplitMP3 = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedSongId) return alert("Selecciona o crea una canción primero.");
    const file = e.target.files?.[0];
    if (!file) return;

    setIsSplitting(true);
    setSplitMessage("Subiendo archivo original...");
    
    try {
      // 1. Upload to Supabase Storage temporarily
      const storagePath = `${FAKE_BAND_ID}/temp/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from('audios').upload(storagePath, file);
      if (uploadError) throw uploadError;

      const { data: publicUrlData } = supabase.storage.from('audios').getPublicUrl(storagePath);
      const audioUrl = publicUrlData.publicUrl;

      setSplitMessage("Iniciando IA en la nube...");

      // 2. Start Replicate Job
      const res = await fetch('/api/ai/split', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioUrl })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al iniciar IA');

      const { predictionId } = data;
      setSplitMessage("Separando pistas (Esto puede tomar 1-3 minutos)...");

      // 3. Poll for results
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
            setSplitMessage("¡Separación completada! Descargando stems y procesando...");
            
            // Output format of cwalo/all-in-one-music-structure-analysis is a JSON string/object or array of URLs.
            // Usually, if it's an array, output[1] is bass, etc.
            // Let's assume output is an array of URLs.
            const outputUrls = Array.isArray(statusData.output) ? statusData.output : [statusData.output];
            
            for (let i = 0; i < outputUrls.length; i++) {
              const url = outputUrls[i];
              if (typeof url !== 'string' || !url.startsWith('http')) continue;
              
              let stemName = `Stem ${i}`;
              if (url.includes('bass')) stemName = 'Bass';
              else if (url.includes('drums')) stemName = 'Drums';
              else if (url.includes('other')) stemName = 'Other';
              else if (url.includes('vocals')) stemName = 'Vocals';
              else if (url.endsWith('.json')) continue; // Skip metadata file for stems
              
              // Download from Replicate URL
              const res = await fetch(url);
              const blob = await res.blob();
              
              // Upload to Supabase
              const finalPath = `${FAKE_BAND_ID}/${selectedSongId}/${Date.now()}_${stemName}.wav`;
              await supabase.storage.from('audios').upload(finalPath, blob, { contentType: 'audio/wav' });
              const { data: finalUrl } = supabase.storage.from('audios').getPublicUrl(finalPath);
              
              // Save to database
              await supabase.from('stems').insert({
                song_id: selectedSongId,
                name: stemName,
                file_url: finalUrl.publicUrl,
                type: 'Audio',
                metadata: { original_name: `${stemName}.wav`, format: 'audio/wav', is_master: false }
              });
            }

            setSplitMessage("¡Todo listo!");
            setTimeout(() => setSplitMessage(null), 5000);
            setIsSplitting(false);
            fetchStems(selectedSongId);

            // Borramos el MP3 temporal
            await supabase.storage.from('audios').remove([storagePath]);
          } else {
            setSplitMessage(`Separando pistas (Intento ${pollCount})... Puede tardar un par de minutos.`);
            pollCount++;
            setTimeout(poll, 5000);
          }
        } catch (pollErr: any) {
          console.error(pollErr);
          setSplitMessage(null);
          setIsSplitting(false);
          alert(`Falló el proceso: ${pollErr.message}`);
        }
      };
      
      setTimeout(poll, 5000);
    } catch (e: any) {
      console.error(e);
      setIsSplitting(false);
      setSplitMessage(null);
      alert('Error en el proceso de Split: ' + e.message);
    }
    
    if (e.target) e.target.value = '';
  };

  return (
    <div className="h-full flex flex-col p-10 bg-[#09090b] overflow-y-auto custom-scrollbar">
      <div className="mb-10 flex items-center justify-between anim-enter" style={{ animationDelay: '0ms' }}>
        <div>
          <h1 className="text-4xl font-extrabold text-white mb-2 flex items-center gap-3 tracking-tight">
            <Disc3 className="text-blue-500" size={36} strokeWidth={2.5} />
            Stem Studio
          </h1>
          <p className="text-gray-400 text-base font-medium">Librería maestra. Sube, organiza y procesa tus multi-tracks.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Panel Izquierdo: Selección de Canción */}
        <div className="col-span-1 premium-card p-6 h-fit anim-enter" style={{ animationDelay: '50ms' }}>
          <h2 className="text-lg font-bold text-white mb-5 flex items-center gap-2 tracking-wide uppercase text-xs opacity-80">
            <Music size={16} className="text-blue-400" />
            Librería de Canciones
          </h2>
          
          <div className="space-y-1.5 max-h-[600px] overflow-y-auto pr-3 custom-scrollbar">
            {loadingSongs ? (
              <div className="flex items-center gap-2 text-gray-500 p-4">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm font-medium">Cargando catálogo...</span>
              </div>
            ) : songs.length === 0 ? (
              <p className="text-gray-500 text-sm p-4 bg-white/[0.02] rounded-lg border border-white/5">
                No hay canciones. Sube un ZIP para crear una.
              </p>
            ) : (
              songs.map((song, i) => (
                <button
                  key={song.id}
                  onClick={() => setSelectedSongId(song.id)}
                  className={`pressable w-full text-left px-4 py-3 rounded-xl flex items-center justify-between group anim-enter ${
                    selectedSongId === song.id 
                      ? 'bg-blue-600/15 text-blue-300 border border-blue-500/30 shadow-[0_0_15px_rgba(59,130,246,0.15)]' 
                      : 'text-gray-300 bg-transparent hover:bg-white/[0.04] border border-transparent hover:border-white/5'
                  }`}
                  style={{ animationDelay: `${(i * 30) + 100}ms` }}
                >
                  <div className="font-semibold truncate text-[15px]">{song.title}</div>
                  {selectedSongId === song.id && (
                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400 shadow-[0_0_8px_rgba(96,165,250,0.8)]" />
                  )}
                </button>
              ))
            )}
          </div>
        </div>

        {/* Panel Derecho: Detalles de la Canción y Uploader */}
        <div className="col-span-1 lg:col-span-2 space-y-8">
          
          {/* Uploader Section */}
          <div className="premium-card p-8 anim-enter" style={{ animationDelay: '100ms' }}>
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-white flex items-center gap-3 tracking-tight">
                <FolderPlus size={24} className="text-blue-400" />
                Cargar Archivos
              </h2>
              {selectedSongId ? (
                <p className="text-sm text-gray-400 mt-2">
                  Sube pistas individuales a la canción seleccionada, o arrastra un ZIP para crear una nueva carpeta.
                </p>
              ) : (
                <p className="text-sm text-yellow-500/90 mt-2 font-medium bg-yellow-500/10 p-3 rounded-lg border border-yellow-500/20 inline-block">
                  Selecciona una canción a la izquierda, o sube un archivo .ZIP para crear una nueva automáticamente.
                </p>
              )}
            </div>

            <div className="blur-transition" style={{ opacity: selectedSongId ? 1 : 0.6 }}>
              <StemUploader 
                songId={selectedSongId}
                bandId={FAKE_BAND_ID}
                onUploadComplete={handleUploadComplete}
              />
            </div>

            {selectedSongId && (
              <div className="mt-6 p-5 border border-blue-500/20 bg-blue-900/10 rounded-xl relative overflow-hidden group hover:border-blue-500/40 transition-colors pressable">
                <input 
                  type="file" 
                  accept="audio/mpeg, audio/wav, audio/mp3" 
                  onChange={handleSplitMP3}
                  disabled={isSplitting}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                />
                <div className="flex items-center justify-between pointer-events-none relative z-0">
                  <div className="flex items-center gap-4">
                    <div className="p-3 bg-blue-500/20 rounded-lg group-hover:scale-110 transition-transform duration-300 ease-[cubic-bezier(0.23,1,0.32,1)]">
                      <Sparkles className="text-blue-400" size={24} />
                    </div>
                    <div>
                      <h4 className="font-bold text-blue-100 text-base">Separar Pistas con IA</h4>
                      <p className="text-sm text-blue-300/70 mt-0.5">
                        {isSplitting 
                          ? splitMessage 
                          : "Sube un MP3 para extraer Batería, Bajo, Voces y Otros."}
                      </p>
                    </div>
                  </div>
                  {isSplitting ? (
                    <RefreshCw className="text-blue-400 animate-spin" size={24} />
                  ) : (
                    <div className="px-4 py-2 bg-blue-600 group-hover:bg-blue-500 text-white text-sm font-bold rounded-lg shadow-lg pointer-events-auto transition-colors">
                      Subir MP3
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AI Intelligence Section */}
          {selectedSongId && (
            <div className="ai-glass-panel p-8 rounded-2xl relative overflow-hidden anim-enter" style={{ animationDelay: '150ms' }}>
              <div className="absolute top-0 right-0 w-48 h-48 bg-purple-600/20 rounded-full blur-[60px] -mr-10 -mt-10 pointer-events-none"></div>
              
              <h4 className="text-lg font-bold text-gray-100 mb-6 flex items-center tracking-tight">
                <span className="w-2.5 h-2.5 rounded-full bg-purple-500 mr-3 shadow-[0_0_12px_rgba(168,85,247,0.9)] animate-pulse"></span>
                Inteligencia Artificial (Tempo y Rejilla)
              </h4>
              
              <div className="space-y-5 relative z-10">
                <div className="flex space-x-4">
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-1.5 block">Compás</label>
                    <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} className="w-full bg-[#09090b] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all">
                      <option value="4/4">4/4 (Estándar)</option>
                      <option value="3/4">3/4 (Vals)</option>
                      <option value="6/8">6/8 (Balada)</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[11px] text-gray-400 font-bold uppercase tracking-widest mb-1.5 block">Clave (Opcional)</label>
                    <input type="text" value={manualKey} onChange={(e) => setManualKey(e.target.value)} placeholder="Ej: Bb Major" className="w-full bg-[#09090b] border border-white/10 rounded-lg px-4 py-3 text-sm text-white focus:border-purple-500 focus:ring-1 focus:ring-purple-500 outline-none transition-all placeholder:text-gray-600" />
                  </div>
                </div>
                
                <button 
                  onClick={handleGenerateChordsAI}
                  disabled={!selectedSongId || isGeneratingAI || stems.length === 0}
                  className="pressable w-full bg-purple-600 hover:bg-purple-500 text-white p-4 rounded-xl font-bold text-base shadow-[0_0_20px_rgba(147,51,234,0.3)] flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed group"
                >
                  {isGeneratingAI ? <RefreshCw className="animate-spin mr-3" size={20} /> : <Sparkles className="mr-3 group-hover:scale-110 transition-transform duration-300" size={20} />}
                  {isGeneratingAI ? "Analizando Tempo..." : "✨ Detectar Tempo y Grilla"}
                </button>
                
                <div className="blur-transition" style={{ opacity: 1 }}>
                  {aiSuccessMessage ? (
                    <p className="text-sm text-green-400 font-medium leading-tight flex items-center bg-green-900/20 p-4 rounded-xl border border-green-500/20">
                      <CheckCircle size={18} className="mr-3 shrink-0" />
                      {aiSuccessMessage}
                    </p>
                  ) : (
                    <div>
                      <p className="text-xs text-gray-400 leading-relaxed mb-3">
                        El motor AI detectará automáticamente el BPM y la cuadrícula rítmica con precisión de milisegundos, optimizándolo para el Live Prompter.
                      </p>

                    {songs.find(s => s.id === selectedSongId)?.prompter_data?.lastAiDetection && (
                      <div className="flex items-center text-xs text-purple-300 bg-purple-900/20 p-2 rounded border border-purple-500/20">
                        <CheckCircle size={14} className="mr-2" />
                        Última detección exitosa: {songs.find(s => s.id === selectedSongId)?.prompter_data?.lastAiDetection}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
          )}

          {/* Stems List Section */}
          {selectedSongId && (
            <div className="premium-card p-8 anim-enter" style={{ animationDelay: '200ms' }}>
              <div className="flex items-center justify-between mb-6">
                <h2 className="text-xl font-bold text-white flex items-center gap-3 tracking-tight">
                  <FileAudio size={22} className="text-emerald-400" />
                  Pistas del Proyecto
                </h2>
                <span className="bg-white/5 text-gray-400 text-xs font-bold px-3 py-1 rounded-full border border-white/10">
                  {stems.length} Archivos
                </span>
              </div>

              {loadingStems ? (
                <div className="flex items-center justify-center p-12 text-gray-500 blur-transition">
                  <Loader2 size={28} className="animate-spin mr-3 text-blue-500" />
                  <span className="font-medium">Cargando pistas...</span>
                </div>
              ) : stems.length === 0 ? (
                <div className="text-center p-12 bg-[#09090b]/50 rounded-2xl border border-dashed border-white/10 blur-transition">
                  <p className="text-gray-300 font-medium">Este proyecto está vacío</p>
                  <p className="text-gray-500 text-sm mt-2">Usa el panel superior para subir o generar pistas.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 blur-transition">
                  {stems.map((stem, i) => (
                    <div 
                      key={stem.id} 
                      className="flex items-center justify-between p-4 bg-[#09090b]/80 border border-white/5 rounded-xl hover:bg-white/[0.04] hover:border-white/10 transition-all duration-200 group anim-enter"
                      style={{ animationDelay: `${(i * 40) + 250}ms` }}
                    >
                      <div className="flex items-center gap-4 overflow-hidden">
                        <div className="p-2.5 bg-blue-500/10 text-blue-400 rounded-lg shrink-0 group-hover:bg-blue-500/20 group-hover:text-blue-300 transition-colors">
                          <FileAudio size={18} />
                        </div>
                        <div className="truncate">
                          <p className="text-[15px] font-semibold text-gray-200 truncate group-hover:text-white transition-colors">{stem.name}</p>
                          <p className="text-xs text-gray-500 mt-0.5">{stem.type || 'Audio'}</p>
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => deleteStem(stem.id)}
                        className="p-2.5 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-all duration-200 opacity-0 group-hover:opacity-100 shrink-0 pressable"
                        title="Eliminar pista"
                      >
                        <Trash2 size={18} />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
