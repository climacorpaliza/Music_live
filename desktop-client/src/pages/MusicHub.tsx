import React, { useRef, useState, useEffect } from 'react';
import { Play, Pause, SkipBack, SkipForward, Volume2, Music, ArrowRight } from 'lucide-react';
import { Link } from 'react-router-dom';

// Secure Player Component
const SecurePlayer = () => {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  
  // Fake playlist for demo
  const playlist = [
    { title: "Midnight City Blues", artist: "Spaghetti Blue Blues", duration: "3:45" },
    { title: "Desert Wind", artist: "Spaghetti Blue Blues", duration: "4:20" },
    { title: "Neon Lights", artist: "Spaghetti Blue Blues", duration: "3:10" }
  ];
  const [currentTrack] = useState(0);

  // Security: Prevent context menu (right click) on the player area
  const preventContextMenu = (e: React.MouseEvent) => e.preventDefault();

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const updateProgress = () => {
      setProgress((audio.currentTime / (audio.duration || 1)) * 100);
    };
    
    audio.addEventListener('timeupdate', updateProgress);
    return () => audio.removeEventListener('timeupdate', updateProgress);
  }, []);

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

  return (
    <div 
      className="bg-[#121214] border border-[#b08b4a]/20 p-6 rounded-xl shadow-2xl relative overflow-hidden group select-none"
      onContextMenu={preventContextMenu}
    >
      {/* Decorative gradient */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#b08b4a]/10 to-transparent opacity-50 pointer-events-none"></div>
      
      <div className="relative z-10 flex flex-col md:flex-row items-center gap-8">
        {/* Album Art / Visualizer Placeholder */}
        <div className="w-48 h-48 bg-[#0a0a0c] rounded-lg border border-zinc-800 flex items-center justify-center relative overflow-hidden shrink-0">
           <Music size={48} className="text-[#b08b4a]/40" />
           {isPlaying && (
             <div className="absolute inset-0 bg-[url('https://res2.weblium.site/res/5cb874d98daa1d0023d47da3/5cff90a75da05700239abe86_optimized')] bg-cover bg-center opacity-30 mix-blend-overlay animate-pulse"></div>
           )}
        </div>

        {/* Player Controls & Info */}
        <div className="flex-1 w-full">
          <h3 className="font-oswald text-[#b08b4a] text-xs tracking-[0.2em] uppercase mb-2">Now Playing</h3>
          <h2 className="font-raleway text-3xl font-bold text-white mb-1">{playlist[currentTrack].title}</h2>
          <p className="font-lato text-zinc-400 mb-6">{playlist[currentTrack].artist}</p>

          {/* Secure Audio Element (No controls attribute) */}
          {/* src is empty for demo, but normally would point to a signed, expiring URL */}
          <audio ref={audioRef} src="" preload="none" onEnded={() => setIsPlaying(false)} />

          {/* Progress Bar */}
          <div className="w-full h-1.5 bg-zinc-900 rounded-full mb-6 relative cursor-not-allowed">
             <div className="absolute top-0 left-0 h-full bg-[#b08b4a] rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-4">
              <button className="text-zinc-500 hover:text-white transition-colors">
                <SkipBack size={24} />
              </button>
              <button 
                onClick={togglePlay}
                className="w-14 h-14 bg-[#b08b4a] hover:bg-[#c9a056] text-[#181716] rounded-full flex items-center justify-center transition-all hover:scale-105 active:scale-95 shadow-[0_0_20px_rgba(176,139,74,0.3)]"
              >
                {isPlaying ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" className="ml-1" />}
              </button>
              <button className="text-zinc-500 hover:text-white transition-colors">
                <SkipForward size={24} />
              </button>
            </div>
            
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
  );
};


// Main Landing Page Component
export default function MusicHub() {
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

          <Link 
            to="/login" 
            className="font-oswald border border-[#b08b4a] text-[#b08b4a] hover:bg-[#b08b4a] hover:text-[#181716] px-6 py-2 tracking-[0.1em] uppercase text-sm transition-all duration-300"
          >
            Artist Login
          </Link>
        </div>
      </header>

      {/* HERO SECTION */}
      <section className="relative pt-32 pb-20 md:pt-48 md:pb-32 px-6 min-h-[90vh] flex items-center">
        {/* Abstract Background Elements */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
           <div className="absolute top-1/4 -right-1/4 w-[800px] h-[800px] bg-[#b08b4a]/5 rounded-full blur-3xl"></div>
           <div className="absolute -bottom-1/4 -left-1/4 w-[600px] h-[600px] bg-[#b08b4a]/5 rounded-full blur-3xl"></div>
        </div>

        <div className="max-w-7xl mx-auto w-full relative z-10 grid md:grid-cols-2 gap-12 items-center">
          <div>
            <h2 className="font-oswald text-[#b08b4a] text-sm md:text-base tracking-[0.3em] uppercase mb-6">Tandao Live Hub</h2>
            <h1 className="font-raleway text-5xl md:text-7xl font-bold leading-[1.1] mb-6">
              THE PREMIER <br />
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-white to-zinc-500">MUSIC PLATFORM</span>
            </h1>
            <p className="font-lato text-lg text-zinc-400 mb-10 max-w-lg leading-relaxed">
              Explore exclusive projects, stream secure playlists, and manage your live sets all in one professional environment.
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
               {/* Decorative App Mockup */}
               <div className="h-8 bg-[#121214] border-b border-zinc-800 flex items-center px-4 gap-2">
                 <div className="w-2.5 h-2.5 rounded-full bg-red-500/50"></div>
                 <div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div>
                 <div className="w-2.5 h-2.5 rounded-full bg-green-500/50"></div>
               </div>
               <div className="flex-1 bg-[#0a0a0c] bg-[url('https://res2.weblium.site/res/5cb874d98daa1d0023d47da3/5cff90a75da05700239abe86_optimized')] bg-cover bg-center opacity-60"></div>
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
            <a href="#" className="hidden md:flex font-lato text-zinc-400 hover:text-white items-center gap-2 transition-colors">
              View All <ArrowRight size={16} />
            </a>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[1, 2, 3].map((item) => (
              <div key={item} className="group cursor-pointer">
                <div className="relative aspect-[4/5] bg-zinc-900 overflow-hidden mb-6">
                  {/* Placeholder for project image */}
                  <div className="absolute inset-0 bg-gradient-to-t from-[#181716] via-transparent to-transparent opacity-80 z-10"></div>
                  <div className="w-full h-full bg-zinc-800 group-hover:scale-105 transition-transform duration-700"></div>
                  
                  <div className="absolute bottom-6 left-6 z-20">
                    <span className="font-oswald bg-[#b08b4a] text-[#181716] text-[10px] px-2 py-1 tracking-[0.2em] uppercase font-bold mb-3 inline-block">New Release</span>
                    <h4 className="font-raleway text-2xl font-bold text-white mb-1 group-hover:text-[#b08b4a] transition-colors">Project Name {item}</h4>
                    <p className="font-lato text-zinc-400 text-sm">Artist / Band</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
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
          
          <SecurePlayer />
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
            
            <div>
              <h4 className="font-oswald text-white tracking-[0.1em] mb-6">PLATFORM</h4>
              <ul className="space-y-4 font-lato text-zinc-500">
                <li><a href="#" className="hover:text-[#b08b4a] transition-colors">Projects</a></li>
                <li><a href="#" className="hover:text-[#b08b4a] transition-colors">Playlists</a></li>
                <li><a href="#" className="hover:text-[#b08b4a] transition-colors">Live Studio</a></li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-oswald text-white tracking-[0.1em] mb-6">CONTACT</h4>
              <ul className="space-y-4 font-lato text-zinc-500">
                <li><a href="#" className="hover:text-[#b08b4a] transition-colors">Support</a></li>
                <li><a href="#" className="hover:text-[#b08b4a] transition-colors">Artist Inquiry</a></li>
                <li><a href="#" className="hover:text-[#b08b4a] transition-colors">Terms of Service</a></li>
              </ul>
            </div>
          </div>
          
          <div className="border-t border-zinc-900 pt-8 flex flex-col md:flex-row items-center justify-between font-lato text-sm text-zinc-600">
            <p>&copy; {new Date().getFullYear()} Tandao Live Hub. All rights reserved.</p>
            <p className="mt-2 md:mt-0">Designed for Professional Audio</p>
          </div>
        </div>
      </footer>

    </div>
  );
}
