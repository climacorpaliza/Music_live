import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Download, Share2 } from 'lucide-react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';

// Secure Player Component with Split Layout (Editorial Style)
const SecurePlayer = ({ album }: { album: any }) => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentTrack, setCurrentTrack] = useState(0);

  const preventContextMenu = (e: React.MouseEvent) => e.preventDefault();

  useEffect(() => {
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
    if (audioRef.current) {
      if (isPlaying) {
        audioRef.current.play().catch(() => console.log('Auto-play prevented'));
      }
    }
  }, [currentTrack, isPlaying]);

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
    <div className="flex flex-col lg:flex-row gap-16 items-start" onContextMenu={preventContextMenu}>
      
      {/* LEFT COLUMN: Cover & Metadata */}
      <div className="w-full lg:w-5/12 flex flex-col gap-6">
        <div className="relative aspect-square w-full shadow-[0_20px_50px_rgba(0,0,0,0.5)] group overflow-hidden">
          <div 
            className={`w-full h-full bg-cover bg-center transition-transform duration-[15s] ease-linear ${isPlaying ? 'scale-110' : 'scale-100'}`}
            style={{ backgroundImage: `url(${album.cover_url})` }}
          />
          {isPlaying && (
            <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
               <div className="w-16 h-16 rounded-full border-2 border-white/50 border-t-white animate-spin"></div>
            </div>
          )}
        </div>
        
        <div className="mt-2">
          <h2 className="font-raleway text-3xl font-bold uppercase tracking-wide leading-tight mb-2">
            {album.title}
          </h2>
          <h3 className="font-lato text-xl text-zinc-300 mb-6">{album.artist}</h3>
          
          <div className="flex flex-wrap items-center gap-4 mb-8">
            {album.buy_link ? (
              <a href={album.buy_link} target="_blank" rel="noreferrer" className="border border-white hover:bg-white hover:text-black transition-colors px-6 py-2 font-oswald tracking-widest text-sm uppercase flex items-center gap-2">
                Buy / Stream <Download size={14} />
              </a>
            ) : (
              <button className="border border-zinc-700 text-zinc-500 cursor-not-allowed px-6 py-2 font-oswald tracking-widest text-sm uppercase flex items-center gap-2">
                Download <Download size={14} />
              </button>
            )}
            
            <button className="text-zinc-400 hover:text-white transition-colors flex items-center gap-2 font-oswald tracking-widest text-sm uppercase">
              <Share2 size={14} /> Share
            </button>
          </div>

          {(album.credits || album.release_date) && (
            <div className="space-y-2 border-l-2 border-[#b08b4a] pl-4 mb-6">
              {album.credits && <p className="font-lato text-sm text-zinc-400 leading-relaxed">{album.credits}</p>}
              {album.release_date && <p className="font-lato text-sm text-zinc-500">{album.release_date}</p>}
            </div>
          )}
          
          {album.description && (
            <p className="font-lato text-zinc-400 leading-relaxed text-sm">
              {album.description}
            </p>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN: Player & Tracklist */}
      <div className="w-full lg:w-7/12 flex flex-col pt-2 lg:pt-0">
        
        {/* Minimalist Player */}
        <div className="mb-10 flex flex-col">
           <audio ref={audioRef} src={currentTrackData?.audio_url || ''} preload="none" onEnded={() => setIsPlaying(false)} />
           
           <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-4">
              <div className="flex items-center gap-4">
                <button 
                  onClick={togglePlay}
                  className="w-12 h-12 rounded-full border border-white flex items-center justify-center hover:bg-white hover:text-black transition-colors"
                  disabled={!currentTrackData}
                >
                  {isPlaying ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" className="ml-1" />}
                </button>
                <div>
                  <h4 className="font-oswald uppercase tracking-widest text-sm text-white line-clamp-1">
                    {currentTrackData ? currentTrackData.title : 'SELECT A TRACK'}
                  </h4>
                  <p className="font-lato text-xs text-zinc-500">{album.artist}</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 text-zinc-500">
                <button onClick={() => setCurrentTrack(Math.max(0, currentTrack - 1))} className="hover:text-white transition-colors"><SkipBack size={18}/></button>
                <button onClick={() => setCurrentTrack(Math.min(tracks.length - 1, currentTrack + 1))} className="hover:text-white transition-colors"><SkipForward size={18}/></button>
              </div>
           </div>

           {/* Progress Line */}
           <div className="flex items-center gap-3">
             <span className="font-lato text-xs text-zinc-500 tabular-nums">
               {audioRef.current ? Math.floor(audioRef.current.currentTime / 60) + ':' + ('0' + Math.floor(audioRef.current.currentTime % 60)).slice(-2) : '0:00'}
             </span>
             <div className="flex-1 h-[2px] bg-zinc-800 relative cursor-not-allowed">
                <div className="absolute top-0 left-0 h-full bg-white transition-all duration-300" style={{ width: `${progress}%` }}></div>
             </div>
             <span className="font-lato text-xs text-zinc-500 tabular-nums">
               {currentTrackData ? currentTrackData.duration : '0:00'}
             </span>
           </div>
        </div>

        {/* Tracklist */}
        <div className="flex flex-col">
          {tracks.length === 0 ? (
            <p className="text-zinc-500 font-lato text-sm py-4 border-t border-zinc-800">No tracks available.</p>
          ) : (
            tracks.map((track: any, idx: number) => (
              <div 
                key={track.id} 
                onClick={() => { setCurrentTrack(idx); setIsPlaying(true); }}
                className={`flex items-center justify-between py-4 border-t border-zinc-800 cursor-pointer transition-colors group ${idx === currentTrack ? 'text-white' : 'text-zinc-400 hover:text-white hover:bg-zinc-900/30'}`}
              >
                <div className="flex items-center gap-6">
                  <span className={`font-oswald text-xs tracking-widest ${idx === currentTrack ? 'text-[#b08b4a]' : 'opacity-50'}`}>
                    {(idx + 1).toString().padStart(2, '0')}
                  </span>
                  <span className="font-lato font-bold">{track.title}</span>
                </div>
                <div className="flex items-center gap-4">
                  {idx === currentTrack && isPlaying && (
                    <div className="flex items-end gap-1 h-3">
                      <div className="w-1 bg-[#b08b4a] h-full animate-[bounce_1s_infinite]"></div>
                      <div className="w-1 bg-[#b08b4a] h-2/3 animate-[bounce_1s_infinite_100ms]"></div>
                      <div className="w-1 bg-[#b08b4a] h-full animate-[bounce_1s_infinite_200ms]"></div>
                    </div>
                  )}
                  <span className="font-lato text-xs opacity-50 group-hover:opacity-100 transition-opacity">
                    {track.duration}
                  </span>
                </div>
              </div>
            ))
          )}
          <div className="border-t border-zinc-800"></div>
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
    const { data: config } = await supabase.from('site_config').select('*').limit(1).single();
    if (config) setSiteConfig(config);

    const { data: albumsData } = await supabase.from('albums').select('*, tracks(*)').order('created_at', { ascending: false });
    
    if (albumsData && albumsData.length > 0) {
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
    return <div className="min-h-screen bg-[#0a0a0c] flex items-center justify-center text-[#b08b4a] font-oswald text-2xl tracking-widest">LOADING ENGINE...</div>;
  }

  return (
    <div className="min-h-screen bg-[#0a0a0c] text-white selection:bg-[#b08b4a] selection:text-[#181716]">
      
      {/* HEADER / NAV */}
      <header className="fixed top-0 w-full z-50 bg-[#0a0a0c]/90 backdrop-blur-md border-b border-zinc-900">
        <div className="max-w-7xl mx-auto px-6 h-24 flex items-center justify-between">
          <div className="font-oswald text-3xl font-bold tracking-wider">
            <span className="text-white">TL</span><span className="text-[#b08b4a]">H</span>
          </div>
          
          <nav className="hidden md:flex items-center gap-10 font-oswald text-xs tracking-[0.2em] text-zinc-400">
            <a href="#projects" className="hover:text-white transition-colors duration-300">PROJECTS</a>
            <a href="#playlist" className="hover:text-white transition-colors duration-300">LISTEN</a>
            <a href="#about" className="hover:text-white transition-colors duration-300">ABOUT</a>
          </nav>

          <div className="flex items-center gap-6">
            <Link 
              to="/admin/cms" 
              className="font-oswald text-zinc-500 hover:text-white px-2 py-2 tracking-[0.1em] uppercase text-xs transition-all duration-300"
            >
              CMS
            </Link>
            <Link 
              to="/login" 
              className="font-oswald border border-[#b08b4a] text-[#b08b4a] hover:bg-[#b08b4a] hover:text-[#181716] px-6 py-2 tracking-[0.1em] uppercase text-xs transition-all duration-300"
            >
              Login
            </Link>
          </div>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-40 pb-20 md:pt-48 md:pb-32 px-6 min-h-[85vh] flex items-center border-b border-zinc-900">
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
              <a href="#projects" className="font-oswald border border-zinc-700 hover:border-white text-white px-8 py-4 tracking-[0.1em] uppercase text-sm font-bold transition-all duration-300">
                Explore Projects
              </a>
            </div>
          </div>
          
          <div className="relative aspect-square md:aspect-auto md:h-[600px] w-full hidden md:block">
            <div className="absolute inset-0 right-10 top-10 border border-zinc-800 bg-[#121214] opacity-50"></div>
            <div className="absolute inset-0 left-10 bottom-10 bg-[#181716] bg-cover bg-center shadow-2xl transition-all duration-1000 grayscale hover:grayscale-0" style={{ backgroundImage: `url(${activeAlbum?.cover_url || ''})` }}></div>
          </div>
        </div>
      </section>

      {/* FEATURED PROJECTS MODULE */}
      <section id="projects" className="py-24 bg-[#0a0a0c]">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-16 border-b border-zinc-900 pb-8 flex items-end justify-between">
            <h3 className="font-raleway text-4xl font-bold tracking-wide">DISCOGRAPHY.</h3>
            <span className="font-oswald text-zinc-500 tracking-widest text-sm hidden md:block">SELECT TO PLAY</span>
          </div>

          {albums.length === 0 ? (
            <div className="text-center py-20 text-zinc-500 font-lato border border-zinc-800 border-dashed">
              No albums published yet. Go to CMS Admin to add some.
            </div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-8">
              {albums.map((album) => (
                <div key={album.id} className="group cursor-pointer flex flex-col gap-4" onClick={() => handleAlbumSelect(album)}>
                  <div className={`relative aspect-square bg-zinc-900 overflow-hidden transition-all duration-500 ${activeAlbum?.id === album.id ? 'ring-2 ring-white ring-offset-4 ring-offset-[#0a0a0c]' : 'opacity-70 group-hover:opacity-100'}`}>
                    <div 
                      className="w-full h-full bg-cover bg-center group-hover:scale-105 transition-transform duration-700 grayscale group-hover:grayscale-0"
                      style={{ backgroundImage: `url(${album.cover_url})` }}
                    ></div>
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                      <div className="w-12 h-12 rounded-full border border-white flex items-center justify-center backdrop-blur-sm">
                        <Play size={20} fill="currentColor" className="text-white ml-1" />
                      </div>
                    </div>
                  </div>
                  <div>
                    <h4 className="font-raleway font-bold text-white text-sm md:text-base leading-tight group-hover:text-[#b08b4a] transition-colors">{album.title}</h4>
                    <p className="font-lato text-zinc-500 text-xs mt-1">{album.artist}</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* SECURE PLAYLIST MODULE (EDITORIAL LAYOUT) */}
      <section id="playlist" className="py-24 bg-[#121214] border-t border-zinc-900 relative">
        <div className="max-w-7xl mx-auto px-6">
          <div className="mb-16 border-b border-zinc-800 pb-8 flex items-end justify-between">
            <h3 className="font-raleway text-4xl font-bold tracking-wide">ALBUM FOCUS.</h3>
          </div>
          
          {albums.length > 0 ? (
            <SecurePlayer album={activeAlbum} />
          ) : (
            <div className="text-center py-20 text-zinc-500 font-lato">
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
              <p className="font-lato text-zinc-500 max-w-sm text-sm">
                The premier engine for musical projects, secure streaming, and live performance management.
              </p>
            </div>
            <div className="col-span-1 md:col-span-4 border-t border-zinc-900 pt-8 flex flex-col md:flex-row items-center justify-between font-lato text-xs tracking-widest uppercase text-zinc-600">
              <p>&copy; {new Date().getFullYear()} Tandao Live Hub.</p>
              <p className="mt-2 md:mt-0">Professional Audio Experience</p>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}
