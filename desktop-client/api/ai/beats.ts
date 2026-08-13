import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

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
    const { songId, stems } = req.body;
    
    if (!songId) return res.status(400).json({ error: 'Falta songId' });
    if (!stems || stems.length === 0) return res.status(404).json({ error: 'No stems' });

    let selectedStem = stems.find((s: any) => s.name.toLowerCase().includes('click') || s.name.toLowerCase().includes('metronomo'));
    if (!selectedStem) selectedStem = stems.find((s: any) => s.name.toLowerCase().includes('drum') || s.name.toLowerCase().includes('bateria'));
    if (!selectedStem) selectedStem = stems.find((s: any) => s.metadata && s.metadata.is_master === true) || stems[0];

    console.log(`[IA-Beats] Iniciando Replicate Async... Stem: ${selectedStem.name}`);

    // Call BeatNet model
    const prediction = await replicate.predictions.create({
      model: "e7mac/beatnet", 
      input: {
        audio: selectedStem.file_url
      }
    });

    return res.status(200).json({ 
      success: true, 
      predictionId: prediction.id,
      message: 'Iniciado el análisis de beats'
    });

  } catch (error: any) {
    console.error('[IA-Beats] Error en endpoint beats.ts:', error);
    return res.status(500).json({ error: error.message });
  }
}
