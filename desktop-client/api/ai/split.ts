import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const token = process.env.REPLICATE_API_TOKENstems || process.env.VITE_REPLICATE_API_TOKENstems || process.env.REPLICATE_API_TOKEN || process.env.VITE_REPLICATE_API_TOKEN;
const replicate = new Replicate({
  auth: token,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { audioUrl } = req.body;
    
    if (!audioUrl) return res.status(400).json({ error: 'Falta audioUrl' });

    console.log(`[IA] Iniciando Replicate Async Split... Audio: ${audioUrl}`);

    const prediction = await replicate.predictions.create({
      // Usamos el modelo cwalo/all-in-one-music-structure-analysis
      version: "6deeba047db17da69e9826c0285cd137cd2a81af05eb44ff496b7acd69b3a383",
      input: {
        music_input: audioUrl,
        demux: true, // Esto obliga a que nos devuelva los stems
        visualize: false // Ahorramos tiempo desactivando el video de visualización
      }
    });

    return res.status(200).json({ 
      success: true, 
      predictionId: prediction.id
    });

  } catch (error: any) {
    console.error('[IA] Error en endpoint split.ts:', error);
    return res.status(500).json({ error: error.message });
  }
}
