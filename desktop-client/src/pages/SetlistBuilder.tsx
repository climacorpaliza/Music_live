import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, ArrowUp, ArrowDown, ListMusic, Save, Music } from 'lucide-react';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function SetlistBuilder() {
  const [setlists, setSetlists] = useState<any[]>([]);
  const [selectedSetlistId, setSelectedSetlistId] = useState<string | null>(null);
  
  const [setlistSongs, setSetlistSongs] = useState<any[]>([]);
  const [allSongs, setAllSongs] = useState<any[]>([]);
  
  const [newSetlistName, setNewSetlistName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Fetch all setlists and all available songs
  useEffect(() => {
    fetchSetlists();
    fetchAllSongs();
  }, []);

  // When a setlist is selected, fetch its songs
  useEffect(() => {
    if (selectedSetlistId) {
      fetchSetlistSongs(selectedSetlistId);
    } else {
      setSetlistSongs([]);
    }
  }, [selectedSetlistId]);

  const fetchSetlists = async () => {
    const { data, error } = await supabase
      .from('setlists')
      .select('*')
      .eq('band_id', FAKE_BAND_ID)
      .order('created_at', { ascending: false });
      
    if (error) console.error(error);
    else setSetlists(data || []);
  };

  const fetchAllSongs = async () => {
    const { data, error } = await supabase
      .from('songs')
      .select('id, title, foh_mix_url, cue_mix_url')
      .eq('band_id', FAKE_BAND_ID)
      .order('title', { ascending: true });
      
    if (error) console.error(error);
    else setAllSongs(data || []);
  };

  const fetchSetlistSongs = async (setId: string) => {
    const { data, error } = await supabase
      .from('setlist_songs')
      .select(`
        id,
        position,
        song:songs (id, title, foh_mix_url, cue_mix_url)
      `)
      .eq('setlist_id', setId)
      .order('position', { ascending: true });
      
    if (error) {
      console.error(error);
    } else {
      // Map it slightly for easier rendering
      const mapped = (data || []).map(item => ({
        id: item.id,
        position: item.position,
        songId: (item.song as any).id,
        title: (item.song as any).title,
        hasAudio: !!(item.song as any).foh_mix_url && !!(item.song as any).cue_mix_url
      }));
      setSetlistSongs(mapped);
    }
  };

  const createSetlist = async () => {
    if (!newSetlistName.trim()) return;
    setIsSaving(true);
    const { data, error } = await supabase
      .from('setlists')
      .insert({ title: newSetlistName, band_id: FAKE_BAND_ID })
      .select()
      .single();
      
    setIsSaving(false);
    if (error) {
      alert('Error creando setlist: ' + error.message);
    } else if (data) {
      setNewSetlistName('');
      setSetlists([data, ...setlists]);
      setSelectedSetlistId(data.id);
    }
  };

  const deleteSetlist = async (id: string) => {
    if (!confirm('¿Estás seguro de eliminar este setlist?')) return;
    const { error } = await supabase.from('setlists').delete().eq('id', id);
    if (error) {
      alert(error.message);
    } else {
      setSetlists(setlists.filter(s => s.id !== id));
      if (selectedSetlistId === id) setSelectedSetlistId(null);
    }
  };

  const addSongToSetlist = async (songId: string) => {
    if (!selectedSetlistId) return;
    const newPosition = setlistSongs.length;
    
    const { data, error } = await supabase
      .from('setlist_songs')
      .insert({
        setlist_id: selectedSetlistId,
        song_id: songId,
        position: newPosition
      })
      .select(`
        id,
        position,
        song:songs (id, title, foh_mix_url, cue_mix_url)
      `)
      .single();
      
    if (error) {
      alert('Error agregando canción: ' + error.message);
    } else if (data) {
      const newItem = {
        id: data.id,
        position: data.position,
        songId: (data.song as any).id,
        title: (data.song as any).title,
        hasAudio: !!(data.song as any).foh_mix_url && !!(data.song as any).cue_mix_url
      };
      setSetlistSongs([...setlistSongs, newItem]);
    }
  };

  const removeSongFromSetlist = async (setlistSongId: string) => {
    const { error } = await supabase.from('setlist_songs').delete().eq('id', setlistSongId);
    if (error) {
      alert(error.message);
    } else {
      const filtered = setlistSongs.filter(s => s.id !== setlistSongId);
      // Re-assign positions locally
      const updated = filtered.map((s, index) => ({ ...s, position: index }));
      setSetlistSongs(updated);
      savePositions(updated);
    }
  };

  const moveSong = (index: number, direction: 'up' | 'down') => {
    if (direction === 'up' && index === 0) return;
    if (direction === 'down' && index === setlistSongs.length - 1) return;
    
    const newArr = [...setlistSongs];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    
    // Swap
    const temp = newArr[index];
    newArr[index] = newArr[targetIndex];
    newArr[targetIndex] = temp;
    
    // Update positions
    const updated = newArr.map((s, i) => ({ ...s, position: i }));
    setSetlistSongs(updated);
    savePositions(updated);
  };

  const savePositions = async (songs: any[]) => {
    // Fire and forget batch update
    for (const song of songs) {
      supabase.from('setlist_songs').update({ position: song.position }).eq('id', song.id).then();
    }
  };

  return (
    <div className="h-full flex bg-[#0a0a0a] text-white overflow-hidden p-6 gap-6 font-sans">
      
      {/* LEFT COLUMN: Setlist Management */}
      <div className="w-1/3 flex flex-col gap-4">
        <div className="bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-md">
          <h2 className="text-xl font-bold flex items-center gap-2 mb-4">
            <ListMusic className="text-yellow-500" /> Mis Setlists
          </h2>
          
          <div className="flex gap-2 mb-6">
            <input 
              type="text"
              placeholder="Nuevo Setlist..."
              value={newSetlistName}
              onChange={e => setNewSetlistName(e.target.value)}
              className="flex-1 bg-black/50 border border-white/10 rounded-lg px-4 py-2 outline-none focus:border-yellow-500 transition text-sm"
              onKeyDown={e => e.key === 'Enter' && createSetlist()}
            />
            <button 
              onClick={createSetlist}
              disabled={!newSetlistName.trim() || isSaving}
              className="bg-yellow-600 hover:bg-yellow-500 disabled:opacity-50 text-black p-2 rounded-lg transition font-bold"
            >
              <Plus size={20} />
            </button>
          </div>

          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-2">
            {setlists.map(setlist => (
              <div 
                key={setlist.id} 
                onClick={() => setSelectedSetlistId(setlist.id)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition border ${
                  selectedSetlistId === setlist.id 
                  ? 'bg-yellow-500/20 border-yellow-500/50 shadow-[0_0_15px_rgba(234,179,8,0.1)]' 
                  : 'bg-white/5 border-transparent hover:bg-white/10'
                }`}
              >
                <span className="font-medium truncate">{setlist.title}</span>
                <button 
                  onClick={(e) => { e.stopPropagation(); deleteSetlist(setlist.id); }}
                  className="text-gray-500 hover:text-red-400 p-1 rounded transition"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
            {setlists.length === 0 && (
              <p className="text-gray-500 text-sm text-center py-4">No hay setlists. Crea uno arriba.</p>
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: Setlist Songs & Catalog */}
      <div className="flex-1 flex flex-col gap-6">
        {selectedSetlistId ? (
          <>
            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-md flex flex-col overflow-hidden">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-xl font-bold text-yellow-400">Repertorio Actual</h2>
                <span className="text-xs bg-white/10 px-3 py-1 rounded-full font-mono text-gray-300">
                  {setlistSongs.length} CANCIONES
                </span>
              </div>
              
              <div className="flex-1 overflow-y-auto space-y-2 pr-2">
                {setlistSongs.map((ss, index) => (
                  <div key={ss.id} className="flex items-center bg-black/40 border border-white/5 rounded-lg p-2 group hover:bg-black/60 transition">
                    <div className="flex flex-col mr-3 opacity-30 group-hover:opacity-100 transition">
                      <button onClick={() => moveSong(index, 'up')} disabled={index === 0} className="hover:text-yellow-400 disabled:opacity-30">
                        <ArrowUp size={14} />
                      </button>
                      <button onClick={() => moveSong(index, 'down')} disabled={index === setlistSongs.length - 1} className="hover:text-yellow-400 disabled:opacity-30">
                        <ArrowDown size={14} />
                      </button>
                    </div>
                    
                    <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/10 text-xs font-bold text-gray-400 mr-4 shrink-0">
                      {index + 1}
                    </div>
                    
                    <div className="flex-1 min-w-0">
                      <p className="font-bold truncate text-[15px]">{ss.title}</p>
                      <p className="text-[10px] uppercase font-bold tracking-widest mt-1">
                        {ss.hasAudio ? (
                          <span className="text-green-400 flex items-center"><Save size={10} className="mr-1" /> AUDIO LISTO</span>
                        ) : (
                          <span className="text-red-400 flex items-center"><Music size={10} className="mr-1" /> REQUIERE EXPORTAR EN STUDIO</span>
                        )}
                      </p>
                    </div>
                    
                    <button 
                      onClick={() => removeSongFromSetlist(ss.id)}
                      className="ml-4 text-red-900 hover:text-red-400 p-2 rounded transition"
                    >
                      <Trash2 size={18} />
                    </button>
                  </div>
                ))}
                
                {setlistSongs.length === 0 && (
                  <div className="h-full flex items-center justify-center flex-col text-gray-500 opacity-50">
                    <ListMusic size={48} className="mb-4" />
                    <p>Repertorio vacío.</p>
                    <p className="text-sm">Agrega canciones desde el catálogo abajo.</p>
                  </div>
                )}
              </div>
            </div>

            <div className="h-1/3 bg-white/5 border border-white/10 rounded-xl p-5 shadow-lg backdrop-blur-md flex flex-col">
              <h2 className="text-lg font-bold mb-3 text-gray-300">Catálogo de Canciones</h2>
              <div className="flex-1 overflow-y-auto grid grid-cols-2 lg:grid-cols-3 gap-2 pr-2">
                {allSongs.map(song => {
                  const hasAudio = !!song.foh_mix_url && !!song.cue_mix_url;
                  return (
                    <div 
                      key={song.id} 
                      className={`flex items-center justify-between p-2 rounded border ${hasAudio ? 'bg-black/50 border-white/5 hover:border-yellow-500/50' : 'bg-red-900/10 border-red-900/30 opacity-60'} transition group`}
                    >
                      <span className="text-sm font-medium truncate flex-1 mr-2" title={song.title}>{song.title}</span>
                      <button 
                        onClick={() => addSongToSetlist(song.id)}
                        className="bg-white/10 hover:bg-yellow-500 hover:text-black w-6 h-6 flex items-center justify-center rounded transition"
                        title="Añadir al Setlist"
                      >
                        <Plus size={14} />
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="h-full flex items-center justify-center text-gray-500 opacity-50 border-2 border-dashed border-white/10 rounded-xl">
            <div className="text-center">
              <ListMusic size={48} className="mx-auto mb-4" />
              <p className="text-lg">Selecciona o crea un Setlist</p>
            </div>
          </div>
        )}
      </div>

    </div>
  );
}
