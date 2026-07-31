import React, { useEffect, useRef, useState, useMemo } from 'react';

export interface ChordEvent {
  chord: string;
  time: number;
}

export interface SectionEvent {
  name?: string;
  section?: string;
  time: number;
}

export interface PrompterProps {
  currentTime: number;
  bpm?: number;
  timeSignature?: string;
  baseOffset?: number;
  beatTimes?: number[];
  chords: ChordEvent[];
  sections: SectionEvent[];
  isVamping: boolean;
  gridOffset?: number;
  onVampTrigger?: (sectionStart: number, sectionEnd: number) => void;
  isEditing?: boolean;
  onRemoveSection?: (index: number) => void;
}

const PIXELS_PER_BEAT = 150; // Ancho visual de cada golpe (beat)

export const Prompter: React.FC<PrompterProps> = ({ currentTime, bpm, timeSignature = '4/4', baseOffset, beatTimes, chords, sections, isVamping, gridOffset, onVampTrigger, isEditing, onRemoveSection }) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Mapear colores según el nombre de la sección
  const getSectionColor = (name: string) => {
    const lower = (name || '').toLowerCase();
    if (lower.includes('intro')) return 'bg-pink-400 border-pink-300 text-black';
    if (lower.includes('verso')) return 'bg-orange-500 border-orange-400 text-black';
    if (lower.includes('pre-coro') || lower.includes('precoro')) return 'bg-yellow-400 border-yellow-300 text-black';
    if (lower.includes('coro')) return 'bg-blue-500 border-blue-400 text-white';
    if (lower.includes('puente')) return 'bg-purple-500 border-purple-400 text-white';
    if (lower.includes('solo')) return 'bg-green-500 border-green-400 text-black';
    if (lower.includes('final') || lower.includes('outro')) return 'bg-red-500 border-red-400 text-white';
    return 'bg-gray-500 border-gray-400 text-white';
  };

  // Convertir sections a sectionBlocks con duración
  const sectionBlocks = (sections || []).map((sec, i, arr) => {
    const nextTime = arr[i + 1]?.time || (sec.time + 10);
    return {
      ...sec,
      duration: Math.max(nextTime - sec.time, 0.5) // Mínimo medio segundo visual
    };
  });

  // Calculate pixel positions based on zoom basado en el BPM. Si no hay BPM, usa 120 por defecto.
  const activeBpm = bpm && bpm > 0 ? bpm : 120;
  const beatsPerSecond = activeBpm / 60;
  const pixelsPerSecond = beatsPerSecond * PIXELS_PER_BEAT;
  const scrollPosition = currentTime * pixelsPerSecond;

  // Auto-scroll logic horizontal based on currentTime
  useEffect(() => {
    if (containerRef.current) {
      // 120px fijos desde la izquierda para dar máximo espacio al futuro (derecha)
      containerRef.current.style.transform = `translateX(calc(120px - ${scrollPosition}px))`;
    }
  }, [currentTime, pixelsPerSecond, scrollPosition]);

  // Find active section (compatible con todos los navegadores)
  let activeSectionIndex = -1;
  for (let i = sections.length - 1; i >= 0; i--) {
    if (sections[i].time <= currentTime) {
      activeSectionIndex = i;
      break;
    }
  }
  const activeSection = activeSectionIndex >= 0 ? sections[activeSectionIndex] : null;

  // Enhance chords with duration and AUTO-QUANTIZE for block rendering
  const chordBlocks = useMemo(() => {
    const defaultOffset = chords.length > 0 ? chords[0].time : 0;
    const baseOffsetTime = baseOffset !== undefined ? baseOffset : defaultOffset;
    const gridOffsetTime = baseOffsetTime + (gridOffset || 0);
    const beatDuration = activeBpm > 0 ? 60 / activeBpm : 0.5;
    const eighthNoteDuration = beatDuration / 2;

    // Primera pasada: Cuantizar todos los acordes a la octava (corchea) más cercana de la grilla
    const quantizedChords = chords.map(chord => {
      let qTime = chord.time;
      // No cuantizamos el primer acorde porque es el Ancla (Offset) de la grilla
      if (activeBpm > 0 && chord.time !== gridOffsetTime) {
        const timeFromOffset = chord.time - gridOffsetTime;
        const eighthNotes = Math.round(timeFromOffset / eighthNoteDuration);
        const snappedTime = gridOffsetTime + (eighthNotes * eighthNoteDuration);
        
        // Solo cuantizamos si el margen de error de la IA es menor a 0.25s
        if (Math.abs(snappedTime - chord.time) < 0.25) {
          qTime = snappedTime;
        }
      }
      return { ...chord, time: qTime };
    });

    // Segunda pasada: Calcular duraciones basadas en los tiempos ya cuantizados
    return quantizedChords.map((chord, index) => {
      const nextChord = quantizedChords[index + 1];
      const duration = nextChord ? Math.max(0.1, nextChord.time - chord.time) : 10;
      return {
        ...chord,
        duration,
        isActive: currentTime >= chord.time && currentTime < chord.time + duration
      };
    });
  }, [chords, currentTime, activeBpm, gridOffset]);

  const handleVamp = () => {
    if (activeSectionIndex >= 0 && onVampTrigger) {
      const start = activeSection!.time;
      const end = sections[activeSectionIndex + 1] ? sections[activeSectionIndex + 1].time : start + 30;
      onVampTrigger(start, end);
    }
  };

  return (
    <div className="prompter-container bg-[#050505] text-white p-0 rounded-lg overflow-hidden h-full w-full relative border-2 border-[#1a1a1a] shadow-[inset_0_0_50px_rgba(0,0,0,0.8)]">
      
      {/* Header Overlay */}
      <div className="absolute top-0 left-0 right-0 bg-gradient-to-b from-[#111] to-transparent p-4 z-20 flex justify-between items-start pointer-events-none">
        <div>
          <h2 className="text-2xl font-black text-yellow-500 uppercase tracking-widest drop-shadow-lg">
            {activeSection ? (activeSection.name || activeSection.section) : 'STANDBY'}
          </h2>
          <p className="text-xs text-gray-400 font-mono mt-1">LÍNEA DE TIEMPO MUSICAL</p>
        </div>
        <button 
          onClick={handleVamp}
          className={`px-4 py-1.5 rounded font-bold text-xs pointer-events-auto shadow-lg transition ${isVamping ? 'bg-red-600 text-white animate-pulse shadow-[0_0_20px_red]' : 'bg-[#222] text-gray-400 hover:bg-[#333]'}`}
        >
          {isVamping ? 'VAMPING (LOOP ACTIVO)' : 'TRIGGER VAMP'}
        </button>
        {/* Cheat Sheet Flotante (Solo Edición) */}
        {isEditing && (
          <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 bg-[#111] border border-red-500/50 rounded-xl px-6 py-3 shadow-[0_10px_30px_rgba(0,0,0,0.8)] z-50 flex space-x-6 items-center">
             <div className="text-red-400 font-bold text-xs uppercase tracking-widest flex items-center shrink-0">
                <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse mr-2"></span>
                Grabación al vuelo
             </div>
             <div className="flex space-x-4 text-[10px] text-gray-300 font-mono">
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">I</span> Intro</div>
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">V</span> Verso</div>
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">P</span> Pre-Coro</div>
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">C</span> Coro</div>
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">B</span> Puente</div>
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">S</span> Solo</div>
                <div><span className="bg-[#333] text-white px-1.5 py-0.5 rounded border border-[#555]">F</span> Final</div>
             </div>
          </div>
        )}
      </div>

      {/* Grid Background (Dinámico vs Estático) */}
      {!beatTimes || beatTimes.length === 0 ? (
        <div className="absolute inset-0 z-0 opacity-20" 
             style={{
               backgroundImage: `linear-gradient(90deg, #333 1px, transparent 1px), linear-gradient(90deg, #555 2px, transparent 2px)`,
               backgroundSize: `${PIXELS_PER_BEAT}px 100%, ${PIXELS_PER_BEAT * (parseInt(timeSignature.split('/')[0]) || 4)}px 100%`, // Línea gruesa por compás dinámico
               backgroundPosition: `calc(120px - ${(currentTime * pixelsPerSecond) - ((baseOffset !== undefined ? baseOffset : (chords.length > 0 ? chords[0].time : 0)) + (gridOffset || 0)) * pixelsPerSecond}px) 0`,
             }}>
        </div>
      ) : (
        <div className="absolute inset-0 z-0 opacity-30">
          {beatTimes.filter(t => t >= currentTime - 5 && t <= currentTime + 15).map((time, i) => {
            const isDownbeat = beatTimes.indexOf(time) % (parseInt(timeSignature.split('/')[0]) || 4) === 0;
            // Ajustar el tiempo del beat agregándole el nudge del usuario
            const adjustedTime = time + (gridOffset || 0);
            return (
              <div key={`beat-${i}`} 
                   className={`absolute top-0 bottom-0 ${isDownbeat ? 'bg-[#555] w-[2px]' : 'bg-[#333] w-[1px]'}`}
                   style={{
                     left: `calc(120px + ${(adjustedTime - currentTime) * pixelsPerSecond}px)`
                   }}
              />
            );
          })}
        </div>
      )}

      {/* BPM Indicator */}
      {bpm && (
        <div className="absolute bottom-4 left-4 z-40 bg-[#111] border border-[#333] text-gray-400 px-3 py-1 rounded text-xs font-mono flex items-center shadow-lg">
          <div className="w-2 h-2 bg-yellow-500 rounded-full mr-2 animate-pulse"></div>
          BPM: {Math.round(bpm)}
        </div>
      )}

      {/* Scrolling Content (Horizontal) */}
      <div className="relative h-full w-full flex items-center">
        
        {/* Playhead Line (Fixed) */}
        <div className="absolute top-0 bottom-0 w-1 bg-yellow-500 z-30 shadow-[0_0_15px_rgba(234,179,8,1)]" style={{ left: '120px' }}>
          <div className="absolute -top-2 -left-2 w-5 h-5 bg-yellow-500 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.8)]"></div>
          <div className="absolute -bottom-2 -left-2 w-5 h-5 bg-yellow-500 rounded-full shadow-[0_0_10px_rgba(234,179,8,0.8)]"></div>
        </div>
        
        {/* Tracks Container */}
        <div ref={containerRef} className="absolute left-0 h-64 flex flex-col justify-center gap-4 transition-transform duration-75 ease-linear z-10 will-change-transform">
          
          {/* Section Track */}
          <div className="relative h-14 w-full mt-4">
            {sectionBlocks.map((block, i) => {
              const isActive = currentTime >= block.time && currentTime < block.time + block.duration;
              const isPast = currentTime >= block.time + block.duration;
              const colorClass = getSectionColor(block.name || block.section);
              
              return (
                <div 
                  key={`sec-${i}`}
                  className={`absolute h-full flex flex-col justify-center border-l-4 ${colorClass} ${isActive ? 'brightness-125 shadow-[0_0_20px_rgba(255,255,255,0.4)] z-20' : isPast ? 'opacity-50 z-10' : 'opacity-90 z-10'} transition-all cursor-pointer rounded-r hover:brightness-110`}
                  style={{
                    left: block.time * pixelsPerSecond,
                    width: block.duration * pixelsPerSecond
                  }}
                >
                  <div className="px-3 flex justify-between items-center w-full">
                    <span className={`text-lg font-black uppercase tracking-widest ${isActive ? 'scale-105' : ''} transition-transform origin-left truncate drop-shadow-md`}>
                      {block.name || block.section}
                    </span>
                    {isEditing && (
                      <button 
                        onClick={(e) => { e.stopPropagation(); onRemoveSection && onRemoveSection(i); }}
                        className="bg-black/60 text-white w-6 h-6 flex items-center justify-center rounded-full hover:bg-red-500 hover:scale-110 transition z-50 shrink-0 ml-2 shadow-lg"
                      >✖</button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Chord Track */}
          <div className="relative h-40 w-full flex items-center">
            {chordBlocks.map((block, i) => {
              const isPast = currentTime >= block.time + block.duration;
              
              return (
                <div 
                  key={i} 
                  className={`absolute h-full flex flex-col justify-center border-l-2 ${block.isActive ? 'border-yellow-400 bg-yellow-500/20 shadow-[inset_0_0_30px_rgba(234,179,8,0.2)]' : isPast ? 'border-gray-700 bg-gray-900/40' : 'border-[#333] bg-[#111]'} transition-colors duration-200 cursor-pointer hover:bg-white/5 rounded-r-lg`}
                  style={{ 
                    left: block.time * pixelsPerSecond, 
                    width: Math.max(block.duration * pixelsPerSecond - 2, 20) // -2px para margen visual
                  }}
                  onDoubleClick={() => {
                    // TODO: Implementar edición
                    alert(`Editar acorde ${block.chord} en el futuro`);
                  }}
                >
                  <div className="px-4">
                    <span className={`text-5xl font-black block ${block.isActive ? 'text-yellow-400 drop-shadow-[0_0_10px_rgba(234,179,8,0.8)] scale-110' : isPast ? 'text-gray-600' : 'text-gray-300'} transition-all origin-left`}>
                      {block.chord}
                    </span>
                    <span className="text-[10px] font-mono text-gray-500 mt-2 block opacity-50">
                      {Math.floor(block.time / 60)}:{(block.time % 60).toString().padStart(2, '0')}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
      
      {/* Sombra difuminada en los bordes para dar efecto de profundidad */}
      <div className="absolute inset-y-0 left-0 w-32 bg-gradient-to-r from-[#050505] to-transparent z-20 pointer-events-none"></div>
      <div className="absolute inset-y-0 right-0 w-32 bg-gradient-to-l from-[#050505] to-transparent z-20 pointer-events-none"></div>
    </div>
  );
};
