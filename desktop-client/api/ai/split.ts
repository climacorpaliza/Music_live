import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const token = process.env.REPLICATE_API_STEMS || process.env.VITE_REPLICATE_API_STEMS || process.env.REPLICATE_API_TOKEN || process.env.VITE_REPLICATE_API_TOKEN;
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
      // Usamos el modelo lucataco/mvsep-mdx23-music-separation (Ganador MDX'23)
      version: "510b9b91aec1bfa7d634e6c06ee80c18492fb0fc06aa1474533fbda90dd3dba4",
      input: {
        audio: audioUrl
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
