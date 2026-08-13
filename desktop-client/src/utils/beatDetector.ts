// src/utils/beatDetector.ts

/**
 * Analiza un AudioBuffer y detecta picos transitorios (beats).
 * Ideal para procesar pistas de "Click" o "Drums".
 * 
 * @param buffer El AudioBuffer completo de la pista.
 * @param expectedBpm Opcional. Ayuda a limpiar duplicados cercanos.
 * @returns Array de tiempos en segundos [0.5, 1.2, ...]
 */
export async function detectBeats(buffer: AudioBuffer, expectedBpm: number = 120): Promise<number[]> {
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    1, // mono
    buffer.length,
    buffer.sampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  // Filtrar frecuencias medias y altas para aislar bombos / clicks
  const filter = offlineCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 150; // Cortar todo por encima de 150Hz
  filter.Q.value = 1;

  source.connect(filter);
  filter.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const data = renderedBuffer.getChannelData(0);

  const peaks = getPeaks(data);
  const groups = getIntervals(peaks);
  const top = groups.sort((a, b) => b.count - a.count).splice(0, 5);
  console.log("Grupos de tempo detectados:", top);
  
  // Si encontramos picos rítmicos muy marcados, los limpiamos usando el BPM estimado (o el más fuerte).
  const beatTimes = cleanDuplicatedPeaks(peaks, renderedBuffer.sampleRate, expectedBpm);
  
  return beatTimes;
}

interface Peak {
  position: number;
  volume: number;
}

/**
 * Busca los picos máximos en la señal de audio usando una ventana.
 */
function getPeaks(data: Float32Array): Peak[] {
  // What we're doing here is grouping data into segments
  // and finding the highest volume in each segment.
  const partSize = 22050; // 0.5 segundos a 44.1kHz aprox
  const parts = data.length / partSize;
  let peaks: Peak[] = [];

  for (let i = 0; i < parts; i++) {
    let max: Peak | null = null;
    for (let j = i * partSize; j < (i + 1) * partSize; j++) {
      const volume = Math.abs(data[j]);
      if (!max || (volume > max.volume)) {
        max = {
          position: j,
          volume: volume
        };
      }
    }
    if (max) {
      peaks.push(max);
    }
  }

  // Ordenar picos por volumen
  peaks.sort((a, b) => b.volume - a.volume);

  if (peaks.length === 0) return [];

  // Quedarse con los picos que tienen al menos la mitad del volumen máximo
  const topPeaks = peaks.filter((p) => p.volume > (peaks[0].volume * 0.5));
  
  // Ordenar cronológicamente
  topPeaks.sort((a, b) => a.position - b.position);

  return topPeaks;
}

interface IntervalGroup {
  tempo: number;
  count: number;
}

function getIntervals(peaks: Peak[]): IntervalGroup[] {
  const groups: IntervalGroup[] = [];
  peaks.forEach((peak, index) => {
    for (let i = 1; (index + i) < peaks.length && i < 10; i++) {
      const group = {
        tempo: (60 * 44100) / (peaks[index + i].position - peak.position),
        count: 1
      };
      
      while (group.tempo < 90) { group.tempo *= 2; }
      while (group.tempo > 180) { group.tempo /= 2; }
      
      group.tempo = Math.round(group.tempo);

      if (!(groups.some((interval) => (interval.tempo === group.tempo ? interval.count++ : 0)))) {
        groups.push(group);
      }
    }
  });
  return groups;
}

/**
 * Una implementación de detección más robusta (Adaptive Onset Detection).
 * Optimizado: Downsampling y tamaño de ventana grande para procesamiento ultrarrápido.
 */
export async function detectBeatsAdaptive(buffer: AudioBuffer, expectedBpm: number): Promise<number[]> {
  // Optimizacion 1: Downsampling. No necesitamos 44.1kHz para detectar graves.
  // Renderizamos a 11025Hz. Es 4x más rápido de procesar en JS.
  const targetSampleRate = 11025; 
  const offlineCtx = new (window.OfflineAudioContext || (window as any).webkitOfflineAudioContext)(
    1, 
    Math.floor(buffer.duration * targetSampleRate), 
    targetSampleRate
  );

  const source = offlineCtx.createBufferSource();
  source.buffer = buffer;

  const filter = offlineCtx.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.value = 250; 
  filter.Q.value = 1;

  source.connect(filter);
  filter.connect(offlineCtx.destination);
  source.start(0);

  const renderedBuffer = await offlineCtx.startRendering();
  const data = renderedBuffer.getChannelData(0);

  const beatTimes: number[] = [];
  
  // Calcular energía RMS en ventanas.
  // Optimizacion 2: Ventana de 50ms, pero con un "hop size" (salto) de 10ms.
  // Esto reduce enormemente el número de iteraciones comparado con iterar sample a sample.
  const windowSize = Math.floor(targetSampleRate * 0.05); // 50ms
  const hopSize = Math.floor(targetSampleRate * 0.01); // 10ms
  
  let energies = [];
  for (let i = 0; i < data.length - windowSize; i += hopSize) {
    let sum = 0;
    // Bucle interno corto
    for (let j = 0; j < windowSize; j++) {
      sum += data[i+j] * data[i+j];
    }
    energies.push(Math.sqrt(sum / windowSize));
  }

  // Encontrar el umbral general (mean + delta)
  let totalEnergy = 0;
  for (let i = 0; i < energies.length; i++) {
    totalEnergy += energies[i];
  }
  const meanEnergy = totalEnergy / (energies.length || 1);
  const threshold = meanEnergy * 1.5;

  let lastBeatTime = -999;
  const minInterval = (60 / (expectedBpm + 20)) * 0.8; // 80% del tiempo esperado mínimo entre beats

  for (let i = 1; i < energies.length - 1; i++) {
    // Si es un pico local y supera el umbral
    if (energies[i] > energies[i-1] && energies[i] > energies[i+1] && energies[i] > threshold) {
      const timeSeconds = (i * hopSize) / targetSampleRate;
      
      // Debounce: solo aceptar si pasó suficiente tiempo desde el último beat
      if (timeSeconds - lastBeatTime > minInterval) {
        beatTimes.push(timeSeconds);
        lastBeatTime = timeSeconds;
      }
    }
  }

  return beatTimes;
}

function cleanDuplicatedPeaks(peaks: Peak[], sampleRate: number, expectedBpm: number): number[] {
  const minDistance = (60 / expectedBpm) * 0.75 * sampleRate;
  
  const clean: number[] = [];
  let lastPos = -minDistance * 2;

  peaks.forEach(p => {
    if (p.position - lastPos >= minDistance) {
      clean.push(p.position / sampleRate);
      lastPos = p.position;
    }
  });

  return clean;
}

/**
 * Algoritmo de Interpolaci�n de Inercia.
 * Si encuentra silencios prolongados (huecos sin transientes), 
 * los rellena matem�ticamente usando la inercia del tempo previo.
 */
export function interpolateMissingBeats(beats: number[]): number[] {
  if (beats.length < 5) return beats;
  
  const filledBeats: number[] = [beats[0]];
  let lastValidInterval = beats[1] - beats[0];

  for (let i = 1; i < beats.length; i++) {
    const dt = beats[i] - filledBeats[filledBeats.length - 1];
    
    // Si el espacio es m�s de 1.5 veces el intervalo promedio (significa que se salt� al menos 1 beat)
    if (dt > lastValidInterval * 1.5) {
      // Calcular cu�ntos beats caben en ese hueco bas�ndose en el �ltimo tempo
      const missingBeatsCount = Math.round(dt / lastValidInterval) - 1;
      const actualInterval = dt / (missingBeatsCount + 1);
      
      for (let j = 1; j <= missingBeatsCount; j++) {
        filledBeats.push(filledBeats[filledBeats.length - 1] + actualInterval);
      }
    } else {
      // Actualizar inercia (Promedio m�vil simple para suavizar)
      lastValidInterval = (lastValidInterval * 0.7) + (dt * 0.3);
    }
    
    filledBeats.push(beats[i]);
  }

  return filledBeats;
}
