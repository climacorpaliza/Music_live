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

    let harmonicBpm = null;
    if (finalChords.length > 5) {
      const diffs = [];
      for (let i = 1; i < finalChords.length; i++) {
        diffs.push(finalChords[i].time - finalChords[i - 1].time);
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
    prompterData.chords = finalChords;

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
