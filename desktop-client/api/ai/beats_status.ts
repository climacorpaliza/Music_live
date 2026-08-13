import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';

const replicateToken = process.env.REPLICATE_API_TOKEN;
const replicate = new Replicate({
  auth: replicateToken,
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const { predictionId } = req.body;
    
    if (!predictionId) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    console.log(`[IA-Beats-Status] Consultando Replicate para predictionId: ${predictionId}`);
    const prediction = await replicate.predictions.get(predictionId);
    console.log(`[IA-Beats-Status] Replicate respondió con status: ${prediction.status}`);
    
    if (prediction.status !== 'succeeded') {
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Replicate finalizó con error: ${prediction.error || 'Cancelado'}`);
      }
      return res.status(200).json({ done: false, status: prediction.status });
    }

    console.log("[IA-Beats-Status] Replicate finalizado con éxito. Devolviendo beats...");
    
    // BeatNet output is typically an array of beat times or objects. We pass it raw to the client for parsing.
    return res.status(200).json({ 
      done: true, 
      message: 'Beats procesados',
      data: prediction.output
    });

  } catch (error: any) {
    console.error('[IA-Beats-Status] Error en endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
}
