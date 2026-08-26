import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const token = process.env.REPLICATE_API_STEMS || process.env.VITE_REPLICATE_API_STEMS || process.env.REPLICATE_API_TOKEN || process.env.VITE_REPLICATE_API_TOKEN;
const replicate = new Replicate({ auth: token });

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') { return res.status(200).end(); }
  try {
    const { predictionId } = req.body;
    if (!predictionId) return res.status(400).json({ error: 'Falta predictionId' });

    const prediction = await replicate.predictions.get(predictionId);
    
    if (prediction.status === 'succeeded') {
      console.log("[IA] Split completado exitosamente.");
      return res.status(200).json({ done: true, status: prediction.status, output: prediction.output });
    } else if (prediction.status === 'failed') {
      return res.status(500).json({ error: 'El modelo falló en Replicate.' });
    } else {
      return res.status(200).json({ done: false, status: prediction.status });
    }
  } catch (error: any) {
    console.error('[IA] Error en endpoint split-status.ts:', error);
    return res.status(500).json({ error: error.message });
  }
}
