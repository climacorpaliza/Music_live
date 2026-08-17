const Replicate = require('replicate');
const { createClient } = require('@supabase/supabase-js');

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const SUPABASE_URL = 'https://ttneetsehlekoajpintk.supabase.co';
const supabase = createClient(SUPABASE_URL, process.env.SUPABASE_ANON_KEY);

function formatChordName(chord) {
  if (chord === 'N' || !chord) return null;
  let clean = chord.replace(':maj', '').replace(':min', 'm');
  clean = clean.replace(':maj7', 'maj7').replace(':min7', 'm7').replace(':7', '7');
  return clean;
}

module.exports = async function handler(req, res) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { predictionId, prompterData, songId } = req.body;

    if (!predictionId || !songId || !prompterData) {
      return res.status(400).json({ error: 'Faltan parámetros requeridos' });
    }

    console.log(`[IA-Status] Consultando Replicate: ${predictionId}`);
    const prediction = await replicate.predictions.get(predictionId);

    if (prediction.status !== 'succeeded') {
      if (prediction.status === 'failed' || prediction.status === 'canceled') {
        throw new Error(`Replicate finalizó con error: ${prediction.error || 'Cancelado'}`);
      }
      return res.status(200).json({ done: false, status: prediction.status });
    }

    console.log("[IA-Status] Replicate completado. RAW OUTPUT:", JSON.stringify(prediction.output));

    const rawOutput = prediction.output;
    const replicateChords =
      rawOutput?.chord_segments ||
      rawOutput?.chords ||
      rawOutput?.segments ||
      (Array.isArray(rawOutput) ? rawOutput : []);

    console.log(`[IA-Status] Total segmentos: ${replicateChords.length}`);
    if (replicateChords.length > 0) {
      console.log(`[IA-Status] Ejemplo:`, JSON.stringify(replicateChords[0]));
    }

    const finalChords = [];
    let lastChord = null;

    for (const seg of replicateChords) {
      const chordName = seg.chord || seg.label || seg.name || seg.value || null;
      const startTime = seg.start_time ?? seg.start ?? seg.time ?? null;

      if (chordName === null || startTime === null) continue;

      const formatted = formatChordName(String(chordName));
      if (formatted && formatted !== lastChord) {
        finalChords.push({
          time: Number(Number(startTime).toFixed(2)),
          chord: formatted
        });
        lastChord = formatted;
      }
    }

    console.log(`[IA-Status] Acordes finales: ${finalChords.length}`);

    prompterData.chords = finalChords;

    // Guardar en Supabase manteniendo los datos existentes (sections, beatTimes, etc.)
    const { data: existingSong } = await supabase
      .from('songs')
      .select('prompter_data')
      .eq('id', songId)
      .single();

    const mergedData = {
      ...(existingSong?.prompter_data || {}),
      ...prompterData,
      chords: finalChords  // Los acordes siempre se actualizan
    };

    const { error: updateError } = await supabase
      .from('songs')
      .update({ prompter_data: mergedData })
      .eq('id', songId);

    if (updateError) throw new Error(`Error guardando en BD: ${updateError.message}`);

    return res.status(200).json({
      done: true,
      message: 'Acordes procesados y guardados',
      data: mergedData
    });

  } catch (error) {
    console.error('[IA-Status] Error:', error);
    return res.status(500).json({ error: error.message });
  }
};
