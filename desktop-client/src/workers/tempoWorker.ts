// @ts-ignore
import MusicTempo from 'music-tempo';

self.onmessage = function(e) {
  try {
    const audioData = new Float32Array(e.data);
    
    // Ejecuta el análisis profundo de la canción completa
    const mt = new MusicTempo(audioData);
    
    let bpm = Number(mt.tempo);
    let beats = mt.beats.map(Number);
    let firstBeat = beats.length > 0 ? beats[0] : 0.0;
    
    // Auto-Corrección de Falsos Positivos de Doble Tiempo
    // Si la pista detecta > 150 BPM (ej. 195 BPM), se asume que contó subdivisiones
    if (bpm > 150) {
      bpm = bpm / 2.0;
      // Filtramos la grilla para que mantenga solo los golpes fuertes reales (1, 3 en lugar de 1, 2, 3, 4)
      beats = beats.filter((_: any, index: number) => index % 2 === 0);
      firstBeat = beats.length > 0 ? beats[0] : 0.0;
    }

    // Redondeo de precisión para evitar flotantes largos en BD
    beats = beats.map((t: any) => Number(t.toFixed(3)));
    firstBeat = Number(firstBeat.toFixed(3));
    
    self.postMessage({ success: true, bpm, firstBeat, beatTimes: beats });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message });
  }
};
