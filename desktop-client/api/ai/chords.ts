import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';

// Configurar Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar Replicate con token de entorno o fallback
const replicateToken = process.env.REPLICATE_API_TOKENstems || process.env.VITE_REPLICATE_API_TOKENstems || process.env.REPLICATE_API_TOKEN || process.env.VITE_REPLICATE_API_TOKEN;
const replicate = new Replicate({
  auth: replicateToken,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { songId, manualKey, timeSignature, stems, detectedBpm, firstBeat, beatTimes } = req.body;
    
    if (!songId) return res.status(400).json({ error: 'Falta songId' });
    if (!stems || stems.length === 0) return res.status(404).json({ error: 'No stems' });

    let selectedStem = stems.find((s: any) => s.metadata && s.metadata.is_master === true);
    if (!selectedStem) selectedStem = stems.find((s: any) => s.name.toLowerCase().includes('master') || s.name.toLowerCase().includes('mezcla') || s.name.toLowerCase().includes('full'));
    if (!selectedStem) selectedStem = stems.find((s: any) => !s.name.toLowerCase().includes('click') && !s.name.toLowerCase().includes('drum')) || stems[0];

    const finalCalculatedBpm = Number(detectedBpm) || 120;
    const extractedFirstBeat = firstBeat || 0.0;
    const extractedBeatTimes = beatTimes || [];
    const finalCalculatedKey = manualKey || "C Major";

    console.log(`[IA] Iniciando Replicate Async... Stem: ${selectedStem.name}`);

    const prediction = await replicate.predictions.create({
      version: "be95be0303fd42000c413aec595922499f8b946d65416f31fb0034c2daf81f19",
      input: {
        audio: selectedStem.file_url,
        return_lab_file: false,
        chord_vocabulary: 'submission'
      }
    });

    const finalSections = [
      { time: Number(extractedFirstBeat.toFixed(3)), section: "INTRO" }
    ];

    const initialPrompterData = {
      bpm: Number(finalCalculatedBpm.toFixed(2)), 
      firstBeatOffset: Number(extractedFirstBeat.toFixed(3)),
      beatTimes: extractedBeatTimes, 
      timeSignature: timeSignature || '4/4',
      chords: [], 
      sections: finalSections
    };

    return res.status(200).json({ 
      success: true, 
      predictionId: prediction.id,
      prompterData: initialPrompterData
    });

  } catch (error: any) {
    console.error('[IA] Error en endpoint chords.ts:', error);
    return res.status(500).json({ error: error.message });
  }
}
