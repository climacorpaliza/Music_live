import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import StemUploader from '../components/StemUploader';
import { Music, FolderPlus, Disc3, FileAudio, Loader2, Trash2, Sparkles, CheckCircle, RefreshCw } from 'lucide-react';
// @ts-ignore
import MusicTempo from 'music-tempo';

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

  const analyzeTempoLocally = async (url: string) => {
    try {
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      const ctx = new AudioContextClass();
      const response = await fetch(url);
      if (!response.ok) throw new Error('Error al descargar audio para analizar');
      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      
      let audioData: Float32Array;
      // Usar el primer canal (mono) para el análisis
      if (audioBuffer.numberOfChannels === 2) {
        const channel1Data = audioBuffer.getChannelData(0);
        const channel2Data = audioBuffer.getChannelData(1);
        const length = channel1Data.length;
        audioData = new Float32Array(length);
        for (let i = 0; i < length; i++) {
          audioData[i] = (channel1Data[i] + channel2Data[i]) / 2.0;
        }
      } else {
        audioData = audioBuffer.getChannelData(0);
      }

      // Evitar congelamientos procesando audio muy largo: limitamos el análisis a los primeros 60 segundos
      const MAX_SECONDS = 60;
      const maxSamples = Math.min(audioData.length, ctx.sampleRate * MAX_SECONDS);
      const audioDataTrimmed = audioData.slice(0, maxSamples);

      const mt = new MusicTempo(audioDataTrimmed);
      const bpm = mt.tempo;
      const firstBeat = mt.beats.length > 0 ? mt.beats[0] : 0.0;
      // Generar grilla
      const duration = audioBuffer.duration;
      const interval = 60.0 / bpm;
      const beatTimes = [];
      let t = firstBeat;
      while (t <= duration) {
        beatTimes.push(Number(t.toFixed(3)));
        t += interval;
      }

      console.log(`[Frontend DSP] BPM Detectado: ${bpm}, First Beat: ${firstBeat}`);
      return { bpm, firstBeat, beatTimes };
    } catch (err) {
      console.error("[Frontend DSP] Error analizando tempo:", err);
      return null;
    }
  };

  const handleGenerateChordsAI = async () => {
    if (!selectedSongId) return;
    setIsGeneratingAI(true);
    setAiSuccessMessage(null);
    
    try {
      // 1. Detección Local de BPM para evitar colapsos en Vercel
      let detectedBpm = null;
      let firstBeat = 0.0;
      let beatTimes: number[] = [];

      const drumStem = stems.find(s => s.name.toLowerCase().includes('drum') || s.name.toLowerCase().includes('bater') || s.name.toLowerCase().includes('perc'));
      const masterStem = stems.find(s => s.name.toLowerCase().includes('master')) || stems[0];
      const targetStem = drumStem || masterStem;

      if (targetStem) {
        const tempoData = await analyzeTempoLocally(targetStem.file_url);
        if (tempoData) {
          detectedBpm = tempoData.bpm;
          firstBeat = tempoData.firstBeat;
          beatTimes = tempoData.beatTimes;
        }
      }

      // 2. Enviar a Vercel para extracción de Acordes (Replicate) y guardado
      const res = await fetch('/api/ai/chords', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          songId: selectedSongId,
          manualKey: manualKey || undefined,
          timeSignature,
          stems, // Send stems so backend can find chordStem
          detectedBpm,
          firstBeat,
          beatTimes
        })
      });
      
      const data = await res.json();
      
      if (!res.ok) {
        throw new Error(data.error || 'Error desconocido del servidor IA');
      }

      const { predictionId, prompterData } = data;
      setAiSuccessMessage(`Modelo iniciado... Procesando acordes en la nube.`);

      // 3. POLLING: Consultar a Vercel cada 3 segundos sin causar Timeout
      const pollInterval = setInterval(async () => {
        try {
          const statusRes = await fetch('/api/ai/status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ 
              predictionId,
              prompterData,
              songId: selectedSongId
            })
          });
          
          const statusData = await statusRes.json();
          if (!statusRes.ok) throw new Error(statusData.error || 'Error en polling');

          if (statusData.done) {
            clearInterval(pollInterval);
            setIsGeneratingAI(false);
            setAiSuccessMessage("¡Acordes generados y guardados en la nube exitosamente!");
            setTimeout(() => setAiSuccessMessage(null), 5000);
          } else {
            setAiSuccessMessage(`IA Procesando... Estado: ${statusData.status}`);
          }
        } catch (pollErr: any) {
          clearInterval(pollInterval);
          setIsGeneratingAI(false);
          console.error("Error en polling:", pollErr);
          alert(`Falló la comprobación de IA: ${pollErr.message}`);
        }
      }, 3000);

    } catch (error: any) {
      console.error("Error saving AI chords:", error);
      alert(`Falló la detección IA: ${error.message}\n(Asegúrate de que el backend en Next.js esté corriendo en el puerto 3000 o configura VITE_API_URL)`);
      setIsGeneratingAI(false);
    }
    // No usamos `finally { setIsGeneratingAI(false); }` aquí porque el polling maneja el final del proceso.
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
