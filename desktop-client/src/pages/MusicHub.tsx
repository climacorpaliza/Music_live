import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Secure Player Component
const SecurePlayer = ({ album }: { album: any }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTrack, setCurrentTrack] = useState(0);

  // Security: Prevent context menu (right click) on the player area
  const preventContextMenu = (e: React.MouseEvent) => e.preventDefault();

  useEffect(() => {
    // Reset track when album changes
    setCurrentTrack(0);
    setIsPlaying(false);
    setProgress(0);
  }, [album]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const updateProgress = () => {
      setProgress((audio.currentTime / (audio.duration || 1)) * 100);
    };
    
    audio.addEventListener('timeupdate', updateProgress);
    return () => audio.removeEventListener('timeupdate', updateProgress);
  }, []);

  useEffect(() => {
    // Auto-play when track changes if we were already playing, or just load
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(() => console.log('Auto-play prevented'));
      }
    }
  }, [currentTrack]);

  const togglePlay = () => {
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.pause();
      } else {
        audioRef.current.play();
      }
      setIsPlaying(!isPlaying);
    }
  };
  
  if (!album) return null;
  
  const tracks = album.tracks || [];
  const currentTrackData = tracks[currentTrack];

  return (
    <div 
      className="bg-[#121214] border border-[#b08b4a]/20 p-6 rounded-xl shadow-2xl relative overflow-hidden group select-none transition-all duration-700"
      onContextMenu={preventContextMenu}
    >
      <div className="absolute inset-0 bg-gradient-to-br from-[#b08b4a]/10 to-transparent opacity-50 pointer-events-none"></div>
      
      <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
        {/* Album Art / Visualizer */}
        <div className="w-48 h-48 rounded-lg border border-zinc-800 flex items-center justify-center relative overflow-hidden shrink-0 shadow-[0_0_30px_rgba(0,0,0,0.5)]">
           <div 
             className={`absolute inset-0 bg-cover bg-center transition-transform duration-[10s] ease-linear ${isPlaying ? 'scale-125' : 'scale-100'}`} 
             style={{ backgroundImage: `url(${album.cover_url})` }}
           ></div>
           {isPlaying && (
             <div className="absolute inset-0 bg-black/30 backdrop-blur-[2px] flex items-center justify-center animate-pulse">
                <div className="w-16 h-16 rounded-full border-4 border-[#b08b4a]/50 flex items-center justify-center animate-spin" style={{ animationDuration: '4s' }}>
                  <div className="w-4 h-4 bg-[#181716] rounded-full"></div>
                </div>
             </div>
           )}
        </div>

        {/* Player Controls & Info */}
        <div className="flex-1 w-full">
          <h3 className="font-oswald text-[#b08b4a] text-xs tracking-[0.2em] uppercase mb-2">Now Playing</h3>
          <h2 className="font-raleway text-3xl font-bold text-white mb-1">{currentTrackData ? currentTrackData.title : 'No track selected'}</h2>
          <p className="font-lato text-zinc-400 mb-6">{album.artist}</p>

          {/* Secure Audio Element */}
          <audio ref={audioRef} src={currentTrackData?.audio_url || ''} preload="none" onEnded={() => setIsPlaying(false)} />

          {/* Progress Bar */}
          <div className="w-full h-1.5 bg-zinc-900 rounded-full mb-6 relative cursor-not-allowed">
             <div className="absolute top-0 left-0 h-full bg-[#b08b4a] rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button 
                className="text-zinc-500 hover:text-white transition-colors"
                onClick={() => setCurrentTrack(Math.max(0, currentTrack - 1))}
              >
                <SkipBack size={24} />
              </button>
              <button 
                onClick={togglePlay}
                className="w-14 h-14 bg-[#b08b4a] hover:bg-[#c9a056] text-[#181716] rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(176,139,74,0.3)]"
                disabled={!currentTrackData}
              >
                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
              </button>
              <button 
                className="text-zinc-500 hover:text-white transition-colors"
                onClick={() => setCurrentTrack(Math.min(tracks.length - 1, currentTrack + 1))}
              >
                <SkipForward size={24} />
              </button>
            </div>
            
            <div className="flex flex-col items-end gap-1">
              <span className="font-lato text-xs text-zinc-500">Track {tracks.length > 0 ? currentTrack + 1 : 0} of {tracks.length}</span>
              <div className="flex items-center gap-2 text-zinc-500 hidden md:flex">
                 <Volume2 size={16} />
                 <div className="w-20 h-1 bg-zinc-800 rounded-full">
                   <div className="w-2/3 h-full bg-zinc-500 rounded-full"></div>
                 </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      
      {/* Tracklist Preview */}
      <div className="mt-8 pt-6 border-t border-zinc-800/50">
        <h4 className="font-oswald text-zinc-400 text-xs tracking-widest uppercase mb-4">Tracklist</h4>
        <div className="space-y-2 h-[200px] overflow-y-auto pr-2 custom-scrollbar">
          {tracks.length === 0 ? <p className="text-zinc-500 font-lato text-sm">No tracks available for this album.</p> : tracks.map((track: any, idx: number) => (
            <div 
              key={track.id} 
              onClick={() => { setCurrentTrack(idx); setIsPlaying(true); }}
              className={`flex items-center justify-between p-2 rounded-md cursor-pointer transition-colors ${idx === currentTrack ? 'bg-zinc-800/50 text-[#b08b4a]' : 'hover:bg-zinc-900/50 text-zinc-400 hover:text-white'}`}
            >
              <div className="flex items-center gap-3">
                <span className="font-oswald w-4 text-xs opacity-50">{idx + 1}</span>
                <span className="font-lato text-sm">{track.title}</span>
              </div>
              <span className="font-lato text-xs opacity-50">{track.duration}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};


// Main Landing Page Component
export default function MusicHub() {
  const [albums, setAlbums] = useState<any[]>([]);
  const [siteConfig, setSiteConfig] = useState<any>(null);
  const [activeAlbum, setActiveAlbum] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    // Fetch CMS Config
    const { data: config } = await supabase.from('site_config').select('*').limit(1).single();
    if (config) setSiteConfig(config);

    // Fetch Albums with Tracks
    const { data: albumsData } = await supabase.from('albums').select('*, tracks(*)').order('created_at', { ascending: false });
    
    if (albumsData && albumsData.length > 0) {
      // Sort tracks for each album
      albumsData.forEach(a => {
        if(a.tracks) {
          a.tracks.sort((t1: any, t2: any) => t1.track_number - t2.track_number);
        }
      });
      setAlbums(albumsData);
      setActiveAlbum(albumsData[0]);
    }
    
    setLoading(false);
  };

  const handleAlbumSelect = (album: any) => {
    setActiveAlbum(album);
    const playlistSection = document.getElementById('playlist');
    if (playlistSection) {
      playlistSection.scrollIntoView({ behavior: 'smooth' });
    }
  };

  if (loading) {
    return <div className="min-h-screen bg-[#181716] flex items-center justify-center text-[#b08b4a] font-oswald text-2xl tracking-widest">LOADING ENGINE...</div>;
  }

  return (
    <div className="min-h-screen bg-[#181716] text-white selection:bg-[#b08b4a] selection:text-[#181716]">
      
      {/* HEADER / NAV */}
      <header className="fixed top-0 w-full z-50 bg-[#181716]/90 backdrop-blur-md border-b border-zinc-800/50">
        <div className="max-w-7xl mx-auto px-6 h-20 flex items-center justify-between">
          <div className="font-oswald text-3xl font-bold tracking-wider">
            <span className="text-white">TL</span><span className="text-[#b08b4a]">H</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-8 font-oswald text-sm tracking-[0.1em] text-zinc-400">
            <a href="#projects" className="hover:text-white transition-colors duration-300">PROJECTS</a>
            <a href="#playlist" className="hover:text-white transition-colors duration-300">PLAYLIST</a>
            <a href="#studio" className="hover:text-white transition-colors duration-300">STUDIO</a>
            <a href="#about" className="hover:text-white transition-colors duration-300">ABOUT</a>
          </nav>

          <div className="flex items-center gap-4">
            <Link 
              to="/admin/cms" 
              className="font-oswald text-zinc-500 hover:text-white px-4 py-2 tracking-[0.1em] uppercase text-sm transition-all duration-300"
            >
              CMS
            </Link>
            <Link 
              to="/login" 
              className="font-oswald border border-[#b08b4a] text-[#b08b4a] hover:bg-[#b08b4a] hover:text-[#181716] px-6 py-2 tracking-[0.1em] uppercase text-sm transition-all duration-300"
            >
              Login
            </Link>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 min-h-[90vh] flex items-center">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
           <div className="absolute top-1/4 -right-1/4 w-[800px] h-[800px] bg-[#b08b4a]/5 rounded-full blur-3xl"></div>
           <div className="absolute -bottom-1/4 -left-1/4 w-[600px] h-[600px] bg-[#b08b4a]/5 rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-7xl mx-auto w-full relative z-10 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-oswald text-[#b08b4a] text-sm md:text-base tracking-[0.3em] uppercase mb-6">{siteConfig?.hero_subtitle || 'Tandao Live Hub'}</h2>
            <h1 className="font-raleway text-5xl md:text-7xl font-bold leading-[1.1] mb-6">
              {siteConfig?.hero_title || 'THE PREMIER MUSIC PLATFORM'}
            </h1>
            <p className="font-lato text-lg text-zinc-400 mb-10 max-w-lg leading-relaxed">
              {siteConfig?.hero_description || 'Explore exclusive projects, stream secure playlists, and manage your live sets.'}
            </p>
            <div className="flex flex-wrap gap-4">
              <a href="#playlist" className="font-oswald bg-[#b08b4a] hover:bg-[#c9a056] text-[#181716] px-8 py-4 tracking-[0.1em] uppercase text-sm font-bold transition-all duration-300 flex items-center gap-2">
                Listen Now <Play size={16} fill="currentColor" />
              </a>
              <a href="#projects" className="font-oswald border border-zinc-700 hover:border-zinc-500 text-white px-8 py-4 tracking-[0.1em] uppercase text-sm font-bold transition-all duration-300">
                Explore Projects
              </a>
            </div>
          </div>
          
          <div className="relative aspect-square md:aspect-auto md:h-[600px] w-full">
            <div className="absolute inset-0 border border-zinc-800 rounded-2xl transform rotate-3 scale-95 transition-transform duration-700 hover:rotate-0 hover:scale-100 flex flex-col overflow-hidden">
               <div className="h-8 bg-[#121214] border-b border-zinc-800 flex items-center px-4 gap-2">
                 <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
                 <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div>
                 <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
               </div>
               <div className="flex-1 bg-[#0a0a0c] bg-cover bg-center opacity-60" style={{ backgroundImage: `url(${activeAlbum?.cover_url || ''})` }}></div>
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED PROJECTS MODULE */}
      <section id="projects" className="py-24 bg-[#121214] border-t border-zinc-900">
        <div className="max-w-7xl mx-auto px-6">
          <div className="flex items-end justify-between mb-16">
            <div>
              <h2 className="font-oswald text-[#b08b4a] text-sm tracking-[0.2em] uppercase mb-4">Discover</h2>
              <h3 className="font-raleway text-4xl md:text-5xl font-bold">Featured Projects</h3>
            </div>
          </div>

          {albums.length === 0 ? (
            <div className="text-center py-20 text-zinc-500 font-lato border border-zinc-800 border-dashed rounded-xl">
              No albums published yet. Go to CMS Admin to add some.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-6">
              {albums.map((album) => (
                <div key={album.id} className="group cursor-pointer" onClick={() => handleAlbumSelect(album)}>
                  <div className={`relative aspect-square bg-zinc-900 overflow-hidden mb-4 rounded-lg transition-all duration-500 ${activeAlbum?.id === album.id ? 'ring-2 ring-[#b08b4a] ring-offset-4 ring-offset-[#121214] scale-[1.02]' : ''}`}>
                    <div className="absolute inset-0 bg-gradient-to-t from-[#181716] via-[#181716]/40 to-transparent opacity-90 z-10"></div>
                    <div 
                      className="w-full h-full bg-cover bg-center group-hover:scale-110 transition-transform duration-700"
                      style={{ backgroundImage: `url(${album.cover_url})` }}
                    ></div>
                    
                    <div className="absolute bottom-4 left-4 right-4 z-20">
                      <span className="font-oswald bg-[#b08b4a] text-[#181716] text-[10px] px-2 py-1 tracking-[0.2em] uppercase font-bold mb-2 inline-block shadow-lg">Album</span>
                      <h4 className="font-raleway text-xl font-bold text-white mb-1 group-hover:text-[#b08b4a] transition-colors line-clamp-1">{album.title}</h4>
                      <p className="font-lato text-zinc-400 text-xs flex items-center justify-between">
                        {album.artist}
                        <span className="opacity-0 group-hover:opacity-100 transition-opacity"><Play size={14} fill="currentColor" className="text-[#b08b4a]" /></span>
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SECURE PLAYLIST MODULE */}
      <section id="playlist" className="py-32 bg-[#181716] relative">
        <div className="max-w-4xl mx-auto px-6">
          <div className="text-center mb-16">
            <h2 className="font-oswald text-[#b08b4a] text-sm tracking-[0.2em] uppercase mb-4">Secure Streaming</h2>
            <h3 className="font-raleway text-4xl md:text-5xl font-bold mb-6">Latest Playlist</h3>
            <p className="font-lato text-zinc-400 max-w-2xl mx-auto">
              Listen to our curated selection of tracks directly from the engine. Our secure player protects artist IP while delivering high-quality audio.
            </p>
          </div>
          
          {albums.length > 0 ? (
            <SecurePlayer album={activeAlbum} />
          ) : (
            <div className="text-center py-20 text-zinc-500 font-lato bg-[#121214] rounded-xl border border-zinc-800">
              No audio loaded.
            </div>
          )}
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-[#0a0a0c] pt-24 pb-12 border-t border-zinc-900">
        <div className="max-w-7xl mx-auto px-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-16">
            <div className="col-span-1 md:col-span-2">
              <div className="font-oswald text-3xl font-bold tracking-wider mb-6">
                <span className="text-white">TL</span><span className="text-[#b08b4a]">H</span>
              </div>
              <p className="font-lato text-zinc-500 max-w-sm">
                The premier engine for musical projects, secure streaming, and live performance management.
              </p>
            </div>
            <div className="border-t border-zinc-900 pt-8 flex flex-col md:flex-row items-center justify-between font-lato text-sm text-zinc-600 col-span-1 md:col-span-4">
              <p>&copy; {new Date().getFullYear()} Tandao Live Hub. All rights reserved.</p>
              <p className="mt-2 md:mt-0">Designed for Professional Audio</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
