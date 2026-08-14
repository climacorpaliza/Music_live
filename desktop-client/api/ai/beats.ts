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

    // 1. Preferir siempre la pista Maestra (Master) porque contiene todos los instrumentos (ideal para silencios de batería)
    let selectedStem = stems.find((s: any) => s.metadata && s.metadata.is_master === true);
    // 2. Fallback a batería o metrónomo si no hay master
    if (!selectedStem) selectedStem = stems.find((s: any) => s.name.toLowerCase().includes('drum') || s.name.toLowerCase().includes('bateria'));
    if (!selectedStem) selectedStem = stems.find((s: any) => s.name.toLowerCase().includes('click') || s.name.toLowerCase().includes('metronomo'));
    // 3. Último recurso, cualquier pista
    if (!selectedStem) selectedStem = stems[0];

    console.log(`[IA-Beats] Iniciando Replicate Async... Stem: ${selectedStem.name}`);

    // Call Sakemin All-In-One model with retry logic for 502/503 errors
    let prediction;
    let retries = 3;
    while (retries > 0) {
      try {
        prediction = await replicate.predictions.create({
          version: "001b4137be6ac67bdc28cb5cffacf128b874f530258d033de23121e785cb7290", 
          input: {
            music_input: selectedStem.file_url || selectedStem.url,
            include_embeddings: false,
            include_activations: false,
            model: "harmonix-all"
          }
        });
        break; // Success
      } catch (err: any) {
        if (err.message && err.message.includes('502') && retries > 1) {
          console.warn(`[IA-Beats] Replicate 502 error. Retrying in 3 seconds... (${retries - 1} retries left)`);
          await new Promise(res => setTimeout(res, 3000));
          retries--;
        } else {
          throw err;
        }
      }
    }

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
