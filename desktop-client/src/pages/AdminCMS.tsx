import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { Plus, Trash2, Edit2, Save, Music, Image as ImageIcon, CheckCircle } from 'lucide-react';

export default function AdminCMS() {
  const [albums, setAlbums] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  
  const [newAlbumTitle, setNewAlbumTitle] = useState('');
  const [newAlbumArtist, setNewAlbumArtist] = useState('');
  const [newAlbumCover, setNewAlbumCover] = useState('');

  const [selectedAlbumId, setSelectedAlbumId] = useState<string | null>(null);
  const [tracks, setTracks] = useState<any[]>([]);
  
  const [newTrackTitle, setNewTrackTitle] = useState('');
  const [newTrackDuration, setNewTrackDuration] = useState('');
  const [newTrackUrl, setNewTrackUrl] = useState('');

  const [siteConfig, setSiteConfig] = useState<any>(null);

  useEffect(() => {
    fetchAlbums();
    fetchSiteConfig();
  }, []);

  useEffect(() => {
    if (selectedAlbumId) {
      fetchTracks(selectedAlbumId);
    }
  }, [selectedAlbumId]);

  const fetchAlbums = async () => {
    const { data } = await supabase.from('albums').select('*').order('created_at', { ascending: false });
    if (data) setAlbums(data);
    setLoading(false);
  };

  const fetchTracks = async (albumId: string) => {
    const { data } = await supabase.from('tracks').select('*').eq('album_id', albumId).order('track_number', { ascending: true });
    if (data) setTracks(data);
  };

  const fetchSiteConfig = async () => {
    const { data } = await supabase.from('site_config').select('*').limit(1).single();
    if (data) setSiteConfig(data);
  };

  const handleCreateAlbum = async (e: React.FormEvent) => {
    e.preventDefault();
    const { data } = await supabase.from('albums').insert([
      { title: newAlbumTitle, artist: newAlbumArtist, cover_url: newAlbumCover }
    ]).select();
    
    if (data) {
      setAlbums([data[0], ...albums]);
      setNewAlbumTitle('');
      setNewAlbumArtist('');
      setNewAlbumCover('');
    }
  };

  const handleDeleteAlbum = async (id: string) => {
    if (window.confirm('Delete this album and all its tracks?')) {
      await supabase.from('albums').delete().eq('id', id);
      setAlbums(albums.filter(a => a.id !== id));
      if (selectedAlbumId === id) setSelectedAlbumId(null);
    }
  };

  const handleCreateTrack = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAlbumId) return;

    const { data } = await supabase.from('tracks').insert([
      { 
        album_id: selectedAlbumId, 
        title: newTrackTitle, 
        duration: newTrackDuration, 
        audio_url: newTrackUrl,
        track_number: tracks.length + 1
      }
    ]).select();
    
    if (data) {
      setTracks([...tracks, data[0]]);
      setNewTrackTitle('');
      setNewTrackDuration('');
      setNewTrackUrl('');
    }
  };

  const handleDeleteTrack = async (id: string) => {
    await supabase.from('tracks').delete().eq('id', id);
    setTracks(tracks.filter(t => t.id !== id));
  };

  const handleUpdateSiteConfig = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!siteConfig) return;
    
    await supabase.from('site_config').update({
      hero_title: siteConfig.hero_title,
      hero_subtitle: siteConfig.hero_subtitle,
      hero_description: siteConfig.hero_description
    }).eq('id', siteConfig.id);
    
    alert('Site config updated!');
  };

  return (
    <div className="p-8 pb-32 max-w-7xl mx-auto space-y-12 animate-fade-in bg-[#0a0a0c] min-h-screen text-white">
      <header className="mb-12">
        <h1 className="text-3xl font-bold font-oswald tracking-widest text-[#b08b4a] mb-2">CMS ADMIN</h1>
        <p className="text-zinc-400 font-lato">Manage albums, tracks, and public site configuration.</p>
      </header>

      <section className="bg-[#181716] border border-zinc-800 rounded-xl p-6">
        <h2 className="text-xl font-bold font-raleway mb-6 flex items-center gap-2"><Edit2 size={20} className="text-[#b08b4a]"/> Site Configuration</h2>
        {siteConfig ? (
          <form onSubmit={handleUpdateSiteConfig} className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div className="space-y-4">
               <div>
                 <label className="block font-oswald text-xs uppercase tracking-widest text-zinc-500 mb-1">Hero Title</label>
                 <input 
                   type="text" 
                   value={siteConfig.hero_title} 
                   onChange={e => setSiteConfig({...siteConfig, hero_title: e.target.value})}
                   className="w-full bg-[#121214] border border-zinc-800 rounded px-4 py-2 font-raleway focus:border-[#b08b4a] outline-none"
                 />
               </div>
               <div>
                 <label className="block font-oswald text-xs uppercase tracking-widest text-zinc-500 mb-1">Hero Subtitle</label>
                 <input 
                   type="text" 
                   value={siteConfig.hero_subtitle} 
                   onChange={e => setSiteConfig({...siteConfig, hero_subtitle: e.target.value})}
                   className="w-full bg-[#121214] border border-zinc-800 rounded px-4 py-2 font-raleway focus:border-[#b08b4a] outline-none"
                 />
               </div>
            </div>
            <div>
               <label className="block font-oswald text-xs uppercase tracking-widest text-zinc-500 mb-1">Hero Description</label>
               <textarea 
                 rows={4}
                 value={siteConfig.hero_description} 
                 onChange={e => setSiteConfig({...siteConfig, hero_description: e.target.value})}
                 className="w-full bg-[#121214] border border-zinc-800 rounded px-4 py-2 font-lato focus:border-[#b08b4a] outline-none resize-none"
               ></textarea>
               <button type="submit" className="mt-4 font-oswald bg-[#b08b4a] text-[#181716] font-bold px-6 py-2 rounded flex items-center gap-2 hover:bg-[#c9a056] transition-colors">
                 <Save size={16} /> Save Config
               </button>
            </div>
          </form>
        ) : <p className="text-zinc-500">Loading config...</p>}
      </section>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="bg-[#181716] border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-bold font-raleway mb-6 flex items-center gap-2"><ImageIcon size={20} className="text-[#b08b4a]"/> Albums</h2>
          <form onSubmit={handleCreateAlbum} className="mb-8 grid grid-cols-2 gap-4 bg-[#121214] p-4 rounded-lg border border-zinc-800/50">
            <input required type="text" placeholder="Album Title" value={newAlbumTitle} onChange={e => setNewAlbumTitle(e.target.value)} className="bg-[#0a0a0c] border border-zinc-800 rounded px-3 py-2 text-sm focus:border-[#b08b4a] outline-none font-lato"/>
            <input required type="text" placeholder="Artist" value={newAlbumArtist} onChange={e => setNewAlbumArtist(e.target.value)} className="bg-[#0a0a0c] border border-zinc-800 rounded px-3 py-2 text-sm focus:border-[#b08b4a] outline-none font-lato"/>
            <input required type="url" placeholder="Cover URL" value={newAlbumCover} onChange={e => setNewAlbumCover(e.target.value)} className="col-span-2 bg-[#0a0a0c] border border-zinc-800 rounded px-3 py-2 text-sm focus:border-[#b08b4a] outline-none font-lato"/>
            <button type="submit" className="col-span-2 bg-[#b08b4a] text-[#181716] font-bold py-2 rounded flex items-center justify-center gap-2 font-oswald">
              <Plus size={16} /> Create Album
            </button>
          </form>
          <div className="space-y-3 h-[400px] overflow-y-auto pr-2 custom-scrollbar">
            {loading ? <p className="text-zinc-500">Loading...</p> : albums.map(album => (
              <div key={album.id} onClick={() => setSelectedAlbumId(album.id)} className={`flex items-center gap-4 p-3 rounded-lg border cursor-pointer transition-colors ${selectedAlbumId === album.id ? 'bg-[#b08b4a]/10 border-[#b08b4a]' : 'bg-[#121214] border-zinc-800 hover:border-zinc-700'}`}>
                <img src={album.cover_url} alt="Cover" className="w-12 h-12 rounded object-cover" />
                <div className="flex-1">
                  <h4 className="font-bold font-raleway text-sm">{album.title}</h4>
                  <p className="text-xs font-lato text-zinc-400">{album.artist}</p>
                </div>
                <button onClick={(e) => { e.stopPropagation(); handleDeleteAlbum(album.id); }} className="text-red-500/50 hover:text-red-500">
                  <Trash2 size={16} />
                </button>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-[#181716] border border-zinc-800 rounded-xl p-6">
          <h2 className="text-xl font-bold font-raleway mb-6 flex items-center gap-2"><Music size={20} className="text-[#b08b4a]"/> Tracks</h2>
          {!selectedAlbumId ? (
            <div className="flex flex-col items-center justify-center h-[300px] text-zinc-500">
              <CheckCircle size={48} className="mb-4 opacity-20" />
              <p className="font-lato">Select an album to manage tracks.</p>
            </div>
          ) : (
            <>
              <form onSubmit={handleCreateTrack} className="mb-8 grid grid-cols-3 gap-4 bg-[#121214] p-4 rounded-lg border border-zinc-800/50">
                <input required type="text" placeholder="Track Title" value={newTrackTitle} onChange={e => setNewTrackTitle(e.target.value)} className="col-span-2 bg-[#0a0a0c] border border-zinc-800 rounded px-3 py-2 text-sm focus:border-[#b08b4a] outline-none"/>
                <input required type="text" placeholder="Duration (e.g. 3:45)" value={newTrackDuration} onChange={e => setNewTrackDuration(e.target.value)} className="bg-[#0a0a0c] border border-zinc-800 rounded px-3 py-2 text-sm focus:border-[#b08b4a] outline-none"/>
                <input type="url" placeholder="MP3 URL (Optional for now)" value={newTrackUrl} onChange={e => setNewTrackUrl(e.target.value)} className="col-span-3 bg-[#0a0a0c] border border-zinc-800 rounded px-3 py-2 text-sm focus:border-[#b08b4a] outline-none"/>
                <button type="submit" className="col-span-3 bg-[#b08b4a] text-[#181716] font-bold py-2 rounded flex items-center justify-center font-oswald">
                  <Plus size={16} /> Add Track
                </button>
              </form>
              <div className="space-y-2 h-[350px] overflow-y-auto pr-2 custom-scrollbar">
                {tracks.map((track, idx) => (
                  <div key={track.id} className="flex items-center gap-4 p-3 bg-[#121214] border border-zinc-800 rounded-lg group hover:border-[#b08b4a]/50">
                    <span className="text-xs font-oswald text-zinc-500 w-4">{idx + 1}</span>
                    <div className="flex-1">
                      <h4 className="font-bold font-raleway text-sm">{track.title}</h4>
                      <p className="text-xs font-lato text-zinc-500">{track.duration}</p>
                    </div>
                    <button onClick={() => handleDeleteTrack(track.id)} className="text-red-500/0 group-hover:text-red-500">
                      <Trash2 size={16} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}
