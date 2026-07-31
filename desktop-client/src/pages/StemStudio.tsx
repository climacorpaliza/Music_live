import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import StemUploader from '../components/StemUploader';
import { Music, FolderPlus, Disc3 } from 'lucide-react';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function StemStudio() {
  const [songs, setSongs] = useState<any[]>([]);
  const [selectedSongId, setSelectedSongId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchSongs();
  }, []);

  const fetchSongs = async () => {
    setLoading(true);
    const { data } = await supabase
      .from('songs')
      .select('*')
      .order('title');
    if (data) setSongs(data);
    setLoading(false);
  };

  const handleUploadComplete = (newSongId?: string) => {
    fetchSongs();
    if (newSongId) {
      setSelectedSongId(newSongId);
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
        <div className="col-span-1 bg-white/[0.02] border border-white/5 rounded-2xl p-6 shadow-xl backdrop-blur-xl">
          <h2 className="text-xl font-semibold text-white mb-4 flex items-center gap-2">
            <Music size={20} className="text-blue-400" />
            Librería
          </h2>
          
          <div className="space-y-2 max-h-[500px] overflow-y-auto pr-2 custom-scrollbar">
            {loading ? (
              <p className="text-gray-500 text-sm">Cargando...</p>
            ) : songs.length === 0 ? (
              <p className="text-gray-500 text-sm">No hay canciones. Sube un ZIP para crear una.</p>
            ) : (
              songs.map((song) => (
                <button
                  key={song.id}
                  onClick={() => setSelectedSongId(song.id)}
                  className={`w-full text-left px-4 py-3 rounded-xl transition-all ${
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

        {/* Panel Derecho: Uploader */}
        <div className="col-span-1 lg:col-span-2">
          <div className="bg-white/[0.02] border border-white/5 rounded-2xl p-6 shadow-xl backdrop-blur-xl h-full flex flex-col justify-center min-h-[400px]">
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-white flex items-center gap-2">
                <FolderPlus size={20} className="text-purple-400" />
                Cargar Archivos
              </h2>
              {selectedSongId ? (
                <p className="text-sm text-gray-400 mt-1">
                  Sube pistas sueltas a la canción seleccionada, o sube un ZIP para crear una nueva.
                </p>
              ) : (
                <p className="text-sm text-yellow-500/80 mt-1">
                  Sube un archivo .ZIP con las pistas para crear una nueva canción automáticamente.
                </p>
              )}
            </div>

            <StemUploader 
              songId={selectedSongId}
              bandId={FAKE_BAND_ID}
              onUploadComplete={handleUploadComplete}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
