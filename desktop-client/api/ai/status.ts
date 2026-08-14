import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

const replicateToken = process.env.REPLICATE_API_TOKEN;
const replicate = new Replicate({
  auth: replicateToken,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { predictionId, prompterData, songId } = req.body;
    
    if (!predictionId || !songId || !prompterData) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    console.log(`[IA-Status] Consultando Replicate para predictionId: ${predictionId}`);
    const prediction = await replicate.predictions.get(predictionId);
    console.log(`[IA-Status] Replicate respondió con status: ${prediction.status}`);
    
    if (prediction.status !== 'succeeded') {
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Replicate finalizó con error: ${prediction.error || 'Cancelado'}`);
      }
      return res.status(200).json({ done: false, status: prediction.status });
    }

    console.log("[IA-Status] Replicate finalizado con éxito. Procesando acordes...");
    
    const replicateChords = (prediction.output as any)?.chord_segments || [];
    
    const formatChordName = (chord: string) => {
      if (chord === 'N' || !chord) return null;
      let clean = chord.replace(':maj', '').replace(':min', 'm');
      clean = clean.replace(':maj7', 'maj7').replace(':min7', 'm7').replace(':7', '7');
      return clean;
    };

    const finalChords = [];
    let lastChord = null;

    for (const seg of replicateChords) {
      const formatted = formatChordName(seg.chord);
      if (formatted) {
        if (formatted !== lastChord) {
          finalChords.push({
            time: Number(seg.start_time.toFixed(2)),
            chord: formatted
          });
          lastChord = formatted;
        }
      }
    }

    // SERVER-SIDE QUANTIZATION: Aplicar la propuesta del usuario
    // Si ya tenemos el tempo (beatTimes), ajustamos los acordes a esa grilla exacta
    let quantizedChords = finalChords;
    
    if (prompterData.beatTimes && prompterData.beatTimes.length > 0) {
      const beatTimes = prompterData.beatTimes;
      const eighthGrid = [];
      for (let i = 0; i < beatTimes.length - 1; i++) {
        eighthGrid.push(beatTimes[i]); // Downbeat
        eighthGrid.push((beatTimes[i] + beatTimes[i + 1]) / 2); // Corchea (mid-beat)
      }
      eighthGrid.push(beatTimes[beatTimes.length - 1]);

      const firstBeatTime = beatTimes[0];
      
      // 1. Descartar basura generada antes del inicio real de la canción
      const validChords = finalChords.filter(c => c.time >= firstBeatTime - 0.2);
      
      const alignedChords: { time: number; chord: string }[] = [];
      let currentActiveChord = null;

      for (const chord of validChords) {
        // Encontrar la línea de la grilla más cercana
        let closest = eighthGrid[0];
        let minDiff = Math.abs(closest - chord.time);
        
        for (let i = 1; i < eighthGrid.length; i++) {
          const diff = Math.abs(eighthGrid[i] - chord.time);
          if (diff < minDiff) {
            minDiff = diff;
            closest = eighthGrid[i];
          }
        }

        // Obligamos a que el acorde encaje perfectamente en la corchea más cercana
        const snappedTime = Number(closest.toFixed(3));

        // Solo guardamos si es un cambio de acorde real en ese tiempo
        if (alignedChords.length === 0 || alignedChords[alignedChords.length - 1].time !== snappedTime) {
          if (currentActiveChord !== chord.chord) {
             alignedChords.push({ time: snappedTime, chord: chord.chord });
             currentActiveChord = chord.chord;
          }
        } else if (alignedChords[alignedChords.length - 1].time === snappedTime) {
          // Si varios acordes caen en el mismo tick de la grilla, nos quedamos con el último detectado
          alignedChords[alignedChords.length - 1].chord = chord.chord;
          currentActiveChord = chord.chord;
        }
      }
      
      quantizedChords = alignedChords;
      console.log(`[IA-Status] Cuantización exitosa: ${quantizedChords.length} acordes alineados a la grilla.`);
    }

    let harmonicBpm = null;
    if (quantizedChords.length > 5) {
      const diffs = [];
      for (let i = 1; i < quantizedChords.length; i++) {
        diffs.push(quantizedChords[i].time - quantizedChords[i - 1].time);
      }
      
      let bestBpm = 0;
      let minError = 999999;
      
      for (let bpm = 70; bpm <= 140; bpm++) {
        const beatDur = 60.0 / bpm;
        let totalError = 0;
        let validDiffs = 0;
        
        for (const dt of diffs) {
          if (dt < 1.0) continue; 
          let beats = Math.round(dt / beatDur);
          if (beats === 0) beats = 1;
          const expected = beats * beatDur;
          totalError += Math.abs(dt - expected);
          validDiffs++;
        }
        
        if (validDiffs > 0) {
          const avgError = totalError / validDiffs;
          if (avgError < minError) {
            minError = avgError;
            bestBpm = bpm;
          }
        }
      }
      
      if (minError < 0.15) {
        console.log(`[IA-Status] BPM Armónico Detectado: ${bestBpm} (Error Promedio: ${minError.toFixed(3)}s)`);
        harmonicBpm = bestBpm;
      }
    }

    const currentBpm = prompterData.bpm;
    const finalBpm = currentBpm !== 99 && currentBpm !== 120 ? currentBpm : (harmonicBpm || currentBpm);
    
    prompterData.bpm = Number(Number(finalBpm).toFixed(2));
    prompterData.chords = quantizedChords;
    prompterData.lastAiDetection = new Date().toLocaleString();

    console.log('[IA-Status] PrompterData Final ensamblado. Guardando en Supabase...');

    const { error: updateError } = await supabase
      .from('songs')
      .update({ prompter_data: prompterData })
      .eq('id', songId);

    if (updateError) {
      throw new Error(`Error guardando en BD: ${updateError.message}`);
    }

    return res.status(200).json({ 
      done: true, 
      message: 'Acordes procesados y guardados',
      data: prompterData
    });

  } catch (error: any) {
    console.error('[IA-Status] Error en endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
}
