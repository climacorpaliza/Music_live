import { useEffect, useState } from 'react';
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

           beatsPrompterData = {
             bpm: rawOutput.bpm,
             beatTimes: rawOutput.beats || [],
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
      // PASO 2: DETECCIÓN DE ACORDES Y CUANTIZACIÓN MAGNÉTICA
      // ---------------------------------------------------------
      setAiSuccessMessage(`Paso 2/2: Tempo detectado. Iniciando análisis de Armonía...`);

      const res = await fetch('/api/ai/chords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          songId: selectedSongId,
          manualKey: manualKey || undefined,
          timeSignature,
          stems,
          detectedBpm: beatsPrompterData.bpm,
          firstBeat: beatsPrompterData.beatTimes?.[0] || 0,
          beatTimes: beatsPrompterData.beatTimes || [],
          sections: beatsPrompterData.sections || []
        })
      });
      
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error desconocido del servidor IA');

      const { predictionId, prompterData } = data; // prompterData enviado por la API chords

      // 3. POLLING DE ACORDES
      let chordsPollCount = 1;
      let isChordsDone = false;

      while (!isChordsDone && chordsPollCount < 300) {
        await new Promise(r => setTimeout(r, 2000));
        const statusRes = await fetch('/api/ai/status', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ 
            predictionId,
            prompterData, // Se le pasa el prompterData actual para que la IA en el backend haga la cuantización a la grilla
            songId: selectedSongId
          })
        });
        
        const statusData = await statusRes.json();
        if (!statusRes.ok) throw new Error(statusData.error || 'Error en polling acordes');

        if (statusData.done) {
          isChordsDone = true;
          setAiSuccessMessage("¡Tempo y Acordes generados y guardados exitosamente!");
          setTimeout(() => setAiSuccessMessage(null), 5000);
        } else {
          if (statusData.status === 'starting' && chordsPollCount > 10) {
            setAiSuccessMessage(`Paso 2/2: IA Acordes despertando (Cold Boot). Puede tomar de 5 a 10 min... (Intento ${chordsPollCount})`);
          } else {
            setAiSuccessMessage(`Paso 2/2: IA Acordes Procesando... Estado: ${statusData.status} (Intento ${chordsPollCount})`);
          }
        }
        chordsPollCount++;
      }

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
    <div className="h-full flex flex-col p-8 bg-gradient-to-br from-[#0a0a0a] to-[#121212] overflow-y-auto">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2 flex items-center gap-3">
            <Disc3 className="text-purple-500" size={32} />
            Stem Studio
          </h1>
          <p className="text-gray-400">Gestiona las canciones y sube nuevas pistas de audio (Stems).</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Panel Izquierdo: Selección de Canción */}
        <div className="col-span-1 bg-white/[0.02] border border-white/5 rounded-2xl p-6 shadow-xl backdrop-blur-xl h-fit">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Music size={20} className="text-blue-400" />
            Librería de Canciones
          </h2>
          
          <div className="space-y-2 max-h-[600px] overflow-y-auto pr-2 custom-scrollbar">
            {loadingSongs ? (
              <div className="flex items-center gap-2 text-gray-500">
                <Loader2 size={16} className="animate-spin" />
                <span className="text-sm">Cargando...</span>
              </div>
            ) : songs.length === 0 ? (
              <p className="text-gray-500 text-sm">No hay canciones. Sube un ZIP para crear una.</p>
            ) : (
              songs.map((song) => (
                <button
                  key={song.id}
                  onClick={() => setSelectedSongId(song.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all flex items-center justify-between group ${
                    selectedSongId === song.id 
                      ? 'bg-blue-600/20 text-blue-400 border border-blue-500/30' 
                      : 'text-gray-300 hover:bg-white/5 border border-transparent'
                  }`}
                >
                  <div className="font-medium truncate">{song.title}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Panel Derecho: Detalles de la Canción y Uploader */}
        <div className="col-span-1 lg:col-span-2 space-y-6">
          
          {/* Uploader Section */}
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FolderPlus size={20} className="text-purple-400" />
                Cargar Archivos
              </h2>
              {selectedSongId ? (
                <p className="text-sm text-gray-400 mt-1">
                  Sube pistas individuales a la canción seleccionada, o arrastra un ZIP para crear una nueva carpeta.
                </p>
              ) : (
                <p className="text-sm text-yellow-500/80 mt-1">
                  Selecciona una canción a la izquierda, o sube un archivo .ZIP para crear una nueva automáticamente.
                </p>
              )}
            </div>

            <StemUploader 
              songId={selectedSongId}
              bandId={FAKE_BAND_ID}
              onUploadComplete={handleUploadComplete}
            />

            {selectedSongId && (
              <div className="mt-4 p-4 border border-blue-500/30 bg-blue-900/10 rounded-xl relative overflow-hidden group">
                <input 
                  type="file" 
                  accept="audio/mpeg, audio/wav, audio/mp3" 
                  onChange={handleSplitMP3}
                  disabled={isSplitting}
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
                />
                <div className="flex items-center justify-between pointer-events-none relative z-0">
                  <div className="flex items-center gap-3">
                    <Sparkles className="text-blue-400" size={24} />
                    <div>
                      <h4 className="font-bold text-blue-100">Separar Pistas con IA</h4>
                      <p className="text-xs text-blue-300/70">
                        {isSplitting 
                          ? splitMessage 
                          : "Haz clic aquí para subir un MP3. La IA extraerá Batería, Bajo, Voces y Otros mágicamente."}
                      </p>
                    </div>
                  </div>
                  {isSplitting ? (
                    <RefreshCw className="text-blue-400 animate-spin" size={20} />
                  ) : (
                    <div className="px-3 py-1 bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold rounded shadow-lg pointer-events-auto">
                      Subir MP3
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* AI Intelligence Section */}
          {selectedSongId && (
            <div className="bg-[#1A1A1A] p-6 rounded-2xl border border-purple-900/50 shadow-xl relative overflow-hidden backdrop-blur-xl">
              <div className="absolute top-0 right-0 w-32 h-32 bg-purple-600/10 rounded-full blur-3xl -mr-10 -mt-10 pointer-events-none"></div>
              
              <h4 className="text-sm font-bold text-gray-200 mb-4 flex items-center">
                <span className="w-2 h-2 rounded-full bg-purple-500 mr-2 shadow-[0_0_8px_rgba(168,85,247,0.8)]"></span>
                Inteligencia Artificial (Detección de Tempo y Notas)
              </h4>
              
              <div className="space-y-4 relative z-10">
                <div className="flex space-x-2">
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Compás</label>
                    <select value={timeSignature} onChange={(e) => setTimeSignature(e.target.value)} className="w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-xs text-white focus:border-purple-500 outline-none transition">
                      <option value="4/4">4/4 (Estándar)</option>
                      <option value="3/4">3/4 (Vals)</option>
                      <option value="6/8">6/8 (Balada)</option>
                    </select>
                  </div>
                  <div className="flex-1">
                    <label className="text-[10px] text-gray-400 font-bold uppercase tracking-wider mb-1 block">Clave (Opcional)</label>
                    <input type="text" value={manualKey} onChange={(e) => setManualKey(e.target.value)} placeholder="Ej: Bb Major" className="w-full bg-[#111] border border-[#333] rounded px-3 py-2 text-xs text-white focus:border-purple-500 outline-none transition" />
                  </div>
                </div>
                
                <button 
                  onClick={handleGenerateChordsAI}
                  disabled={!selectedSongId || isGeneratingAI || stems.length === 0}
                  className="w-full bg-purple-600 hover:bg-purple-500 text-white p-3 rounded-xl font-bold text-sm shadow-[0_0_15px_rgba(147,51,234,0.3)] transition flex items-center justify-center disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isGeneratingAI ? <RefreshCw className="animate-spin mr-2" size={18} /> : <Sparkles className="mr-2" size={18} />}
                  {isGeneratingAI ? "Analizando Armonía..." : "✨ Detectar Tempo y Notas con IA"}
                </button>
                
                {aiSuccessMessage ? (
                  <p className="text-xs text-green-400 leading-tight flex items-center bg-green-900/20 p-3 rounded-xl">
                    <CheckCircle size={16} className="mr-2 shrink-0" />
                    {aiSuccessMessage}
                  </p>
                ) : (
                  <p className="text-[10px] text-gray-500 leading-tight italic">
                    Al hacer clic, el motor AI detectará automáticamente el BPM, la clave y el mapa de acordes de los Stems y los guardará para el Live Prompter.
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Stems List Section */}
          {selectedSongId && (
            <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
              <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
                <FileAudio size={20} className="text-green-400" />
                Pistas (Stems) de la Canción
              </h2>

              {loadingStems ? (
                <div className="flex items-center justify-center p-8 text-gray-500">
                  <Loader2 size={24} className="animate-spin mr-2" />
                  Cargando pistas...
                </div>
              ) : stems.length === 0 ? (
                <div className="text-center p-8 bg-black/20 rounded-xl border border-white/5">
                  <p className="text-gray-400">Esta canción aún no tiene pistas.</p>
                  <p className="text-gray-500 text-sm mt-1">Sube tus archivos usando la caja de arriba.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {stems.map(stem => (
                    <div key={stem.id} className="flex items-center justify-between p-3 bg-black/40 border border-white/5 rounded-xl hover:bg-white/5 transition-colors group">
                      <div className="flex items-center gap-3 overflow-hidden">
                        <div className="p-2 bg-blue-500/10 text-blue-400 rounded-lg shrink-0">
                          <FileAudio size={16} />
                        </div>
                        <div className="truncate">
                          <p className="text-sm font-medium text-white truncate">{stem.name}</p>
                          <p className="text-xs text-gray-500">{stem.type || 'Audio'}</p>
                        </div>
                      </div>
                      
                      <button 
                        onClick={() => deleteStem(stem.id)}
                        className="p-2 text-gray-500 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                        title="Eliminar pista"
                      >
                        <Trash2 size={16} />
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
