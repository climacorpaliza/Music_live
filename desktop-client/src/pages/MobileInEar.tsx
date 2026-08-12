import React, { useEffect, useState, useRef } from 'react';
import { useSyncSlave } from '../hooks/useSyncSlave';
import { Volume2, Power, Music, Activity } from 'lucide-react';
import { Prompter } from '../components/Prompter';

const FAKE_BAND_ID = "00000000-0000-0000-0000-000000000000";

export default function MobileInEar() {
  const { currentSongId, songData, isPlaying, playTrigger, pauseTrigger, seekTrigger } = useSyncSlave(FAKE_BAND_ID);
  
  const [hasInteracted, setHasInteracted] = useState(false);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);
  const [cueBuffer, setCueBuffer] = useState<AudioBuffer | null>(null);
  const [loadStatus, setLoadStatus] = useState<string>('Esperando Master...');
  
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  
  const [currentTime, setCurrentTime] = useState(0);
  const startTimeRef = useRef(0);
  const animationFrameRef = useRef(0);
  const [volume, setVolume] = useState(1);

  // Initialize AudioContext on first tap
  const handleConnect = () => {
    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    gain.gain.value = volume;
    
    setAudioCtx(ctx);
    gainRef.current = gain;
    setHasInteracted(true);
    
    // Play a tiny silent buffer to unlock audio on iOS
    const silentBuffer = ctx.createBuffer(1, 1, 22050);
    const source = ctx.createBufferSource();
    source.buffer = silentBuffer;
    source.connect(ctx.destination);
    source.start();
  };

  useEffect(() => {
    if (gainRef.current) {
      gainRef.current.gain.value = volume;
    }
  }, [volume]);

  // Load new song when Master says LOAD_SONG
  useEffect(() => {
    if (songData && audioCtx) {
      loadAudio(songData.cue_mix_url);
    }
  }, [songData, audioCtx]);

  const loadAudio = async (url: string) => {
    if (!audioCtx) return;
    setLoadStatus('Descargando...');
    try {
      const res = await fetch(url);
      const array = await res.arrayBuffer();
      setLoadStatus('Decodificando...');
      const buffer = await audioCtx.decodeAudioData(array);
      setCueBuffer(buffer);
      setLoadStatus('Listo (Standby)');
      setCurrentTime(0);
    } catch (e: any) {
      setLoadStatus('Error: ' + e.message);
    }
  };

  // Handle Transport Triggers
  useEffect(() => {
    if (!audioCtx || !cueBuffer || !hasInteracted) return;

    if (playTrigger) {
      // PLAY TRIGGER RECEIVED
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch (e) {}
      }

      const source = audioCtx.createBufferSource();
      source.buffer = cueBuffer;
      source.connect(gainRef.current!);
      sourceRef.current = source;

      // Calculate when to start
      const timeUntilStartMs = Math.max(0, playTrigger.startAt - Date.now());
      const exactContextTime = audioCtx.currentTime + (timeUntilStartMs / 1000);

      source.start(exactContextTime, playTrigger.offset);
      
      startTimeRef.current = exactContextTime - playTrigger.offset;
      
      cancelAnimationFrame(animationFrameRef.current);
      updateTime();
      setLoadStatus('EN VIVO');
    }
  }, [playTrigger]);

  useEffect(() => {
    if (pauseTrigger) {
      if (sourceRef.current) {
        try { sourceRef.current.stop(); } catch (e) {}
      }
      cancelAnimationFrame(animationFrameRef.current);
      setLoadStatus('Pausado');
    }
  }, [pauseTrigger]);

  useEffect(() => {
    if (seekTrigger) {
      setCurrentTime(seekTrigger.offset);
    }
  }, [seekTrigger]);

  const updateTime = () => {
    if (!audioCtx) return;
    
    // In strict PWA, if the screen locks, requestAnimationFrame might throttle.
    // However, Web Audio keeps playing. We just update the visual time.
    const globalTime = audioCtx.currentTime - startTimeRef.current;
    
    const preRoll = getPreRoll(songData);
    const visualTime = globalTime - preRoll;
    
    setCurrentTime(visualTime);
    animationFrameRef.current = requestAnimationFrame(updateTime);
  };

  const getPreRoll = (song: any) => {
    if (!song?.prompter_data?.bpm) return 0;
    const beatsPerMeasure = parseInt(song.prompter_data.timeSignature?.split('/')[0]) || 4;
    return (60 / song.prompter_data.bpm) * beatsPerMeasure;
  };

  // VIEW RENDERS
  if (!hasInteracted) {
    return (
      <div className="flex flex-col items-center justify-center h-screen bg-[#0a0a0a] text-white">
        <div className="p-4 bg-gradient-to-br from-blue-500 to-purple-600 rounded-2xl mb-8 shadow-lg shadow-blue-500/20">
          <Music size={48} className="text-white" />
        </div>
        <h1 className="text-3xl font-black tracking-wider mb-2">IN-EAR MÓVIL</h1>
        <p className="text-gray-400 mb-12 text-center max-w-xs">
          Sistema personal de monitoreo e In-Ears.
        </p>
        <button 
          onClick={handleConnect}
          className="bg-blue-600 hover:bg-blue-500 text-white font-bold py-4 px-12 rounded-full text-xl flex items-center shadow-[0_0_30px_rgba(37,99,235,0.4)] transition-all"
        >
          <Power className="mr-3" />
          CONECTAR
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-black text-white relative">
      
      {/* Top Header */}
      <div className="flex items-center justify-between p-4 bg-[#111] border-b border-[#222] z-20">
        <div className="flex items-center space-x-3">
          <div className="p-2 bg-blue-500/20 rounded-lg">
            <Volume2 size={20} className="text-blue-400" />
          </div>
          <div>
            <h2 className="font-bold text-sm leading-tight truncate w-32">
              {songData ? songData.title : 'Esperando Master...'}
            </h2>
            <div className="flex items-center text-[10px] uppercase font-bold tracking-widest text-gray-500">
              <Activity size={10} className="mr-1" /> {loadStatus}
            </div>
          </div>
        </div>
        
        {/* Personal Mixer */}
        <div className="flex items-center w-32">
          <input 
            type="range" 
            min="0" max="1" step="0.05"
            value={volume}
            onChange={e => setVolume(parseFloat(e.target.value))}
            className="w-full accent-blue-500"
          />
        </div>
      </div>

      {/* Prompter Visual Area */}
      <div className="flex-1 relative overflow-hidden">
        {songData ? (
          <Prompter 
            currentTime={currentTime}
            bpm={songData.prompter_data?.bpm || 0}
            timeSignature={songData.prompter_data?.timeSignature}
            baseOffset={songData.prompter_data?.firstBeatOffset}
            beatTimes={songData.prompter_data?.beatTimes}
            chords={songData.prompter_data?.chords || []}
            sections={songData.prompter_data?.sections || []}
            isVamping={false}
            isEditing={false}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none opacity-5">
            <Music size={200} />
          </div>
        )}
        
        {!isPlaying && (
          <div className="absolute inset-0 bg-black/50 flex items-center justify-center backdrop-blur-[2px] z-30">
            <p className="text-xl font-bold tracking-widest text-white/50">STANDBY</p>
          </div>
        )}
      </div>

    </div>
  );
}
