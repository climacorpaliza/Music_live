// @ts-ignore
import MusicTempo from 'music-tempo';

self.onmessage = function(e) {
  try {
    const { buffer, sampleRate } = e.data;
    const audioData = new Float32Array(buffer);
    
    // Ejecutamos el análisis de tempo orgánico en la canción COMPLETA
    // Esto evita los "golpes dobles" y saltos de compás que ocurren en las fronteras
    const mt = new MusicTempo(audioData);
    let bpm = Number(mt.tempo);
    let beats = mt.beats.map(Number);
    
    // Auto-Corrección de Falsos Positivos de Doble Tiempo
    // Si la batería es muy agresiva (> 150 BPM), asumimos que el modelo contó subdivisiones (1 y 2 y 3 y 4)
    if (bpm > 150) {
      bpm = bpm / 2.0;
      // Filtramos la grilla para que mantenga solo los golpes fuertes reales (los downbeats)
      beats = beats.filter((_: any, index: number) => index % 2 === 0);
    }

    if (beats.length === 0) {
      throw new Error("No se pudo detectar el tempo en ninguna sección del audio.");
    }

    let firstBeat = beats.length > 0 ? beats[0] : 0.0;

    // Redondeo de precisión para evitar flotantes largos en la Base de Datos
    beats = beats.map((t: number) => Number(t.toFixed(3)));
    firstBeat = Number(firstBeat.toFixed(3));
    
    self.postMessage({ success: true, bpm, firstBeat, beatTimes: beats });
  } catch (error: any) {
    self.postMessage({ success: false, error: error.message });
  }
};
