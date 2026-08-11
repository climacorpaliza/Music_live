// @ts-ignore
import MusicTempo from 'music-tempo';

self.onmessage = function(e) {
  try {
    const { buffer, sampleRate } = e.data;
    const audioData = new Float32Array(buffer);
    
    // Procesamos en bloques de 60 segundos para evitar que la memoria RAM se desborde y congele la PC
    const CHUNK_SECONDS = 60;
    const chunkSamples = sampleRate * CHUNK_SECONDS;
    
    let allBeats: number[] = [];
    let avgBpm = 0;
    let bpmCount = 0;

    for (let offset = 0; offset < audioData.length; offset += chunkSamples) {
      const chunk = audioData.slice(offset, offset + chunkSamples);
      if (chunk.length < sampleRate * 5) continue; // Ignorar bloques muy pequeños (<5s) al final

      const mt = new MusicTempo(chunk);
      let chunkBpm = Number(mt.tempo);
      let chunkBeats = mt.beats.map(Number);
      
      // Auto-Corrección de Falsos Positivos de Doble Tiempo
      if (chunkBpm > 150) {
        chunkBpm = chunkBpm / 2.0;
        chunkBeats = chunkBeats.filter((_: any, index: number) => index % 2 === 0);
      }

      const timeOffset = offset / sampleRate;
      chunkBeats = chunkBeats.map((b: number) => b + timeOffset);
      
      allBeats = allBeats.concat(chunkBeats);
      avgBpm += chunkBpm;
      bpmCount++;
    }

    if (bpmCount === 0) {
      throw new Error("No se pudo detectar el tempo en ninguna sección del audio.");
    }

    const finalBpm = avgBpm / bpmCount;
    let firstBeat = allBeats.length > 0 ? allBeats[0] : 0.0;

    // Redondeo de precisión para evitar flotantes largos en BD
    allBeats = allBeats.map((t: number) => Number(t.toFixed(3)));
    firstBeat = Number(firstBeat.toFixed(3));
    
    self.postMessage({ success: true, bpm: finalBpm, firstBeat, beatTimes: allBeats });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message });
  }
};
