import Replicate from 'replicate';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { songId, manualKey, timeSignature, stems, detectedBpm, firstBeat, beatTimes } = req.body;

    if (!songId) return res.status(400).json({ error: 'Falta songId' });
    if (!stems || stems.length === 0) return res.status(404).json({ error: 'No se encontraron stems para analizar.' });

    // Elegir el stem master (ghost bounce subido por el frontend)
    let selectedStem = stems.find(s => s.metadata && s.metadata.is_master === true);
    if (!selectedStem) {
      selectedStem = stems.find(s =>
        s.name.toLowerCase().includes('master') ||
        s.name.toLowerCase().includes('mezcla') ||
        s.name.toLowerCase().includes('full')
      );
    }
    if (!selectedStem) {
      selectedStem = stems.find(s => !s.name.toLowerCase().includes('click') && !s.name.toLowerCase().includes('drum')) || stems[0];
    }

    console.log(`[IA] Stem seleccionado: ${selectedStem.name}`);
    console.log(`[IA] Enviando Master Ghost Bounce a Replicate TriadMusic (Acordes)`);

    const finalCalculatedBpm = detectedBpm || 120;
    const extractedFirstBeat = firstBeat || 0.0;
    const extractedBeatTimes = beatTimes || [];

    const prediction = await replicate.predictions.create({
      version: "be95be0303fd42000c413aec595922499f8b946d65416f31fb0034c2daf81f19",
      input: {
        audio: selectedStem.file_url,
        return_lab_file: false,
        chord_vocabulary: 'submission'
      }
    });

    console.log(`[IA] Predicción creada: ${prediction.id}`);

    const initialPrompterData = {
      bpm: Number(Number(finalCalculatedBpm).toFixed(2)),
      firstBeatOffset: Number(Number(extractedFirstBeat).toFixed(3)),
      beatTimes: extractedBeatTimes,
      timeSignature: timeSignature || '4/4',
      chords: [],
      sections: [{ time: Number(Number(extractedFirstBeat).toFixed(3)), name: "INTRO" }]
    };

    return res.status(200).json({
      success: true,
      predictionId: prediction.id,
      prompterData: initialPrompterData
    });

  } catch (error) {
    console.error('[IA] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
