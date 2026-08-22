import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';

const replicate = new Replicate({ auth: process.env.REPLICATE_API_TOKEN });

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://ttneetsehlekoajpintk.supabase.co';
const supabase = createClient(SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

function formatChordName(chord) {
  if (chord === 'N' || !chord) return null;
  let clean = chord.replace(':maj', '').replace(':min', 'm');
  clean = clean.replace(':maj7', 'maj7').replace(':min7', 'm7').replace(':7', '7');
  return clean;
}

export default async function handler(req, res) {
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

    let rawOutput = prediction.output;

    if (typeof rawOutput === 'string' && rawOutput.startsWith('http')) {
      console.log("[IA-Status] Replicate devolvió una URL, descargando JSON...");
      try {
        const fetchRes = await fetch(rawOutput);
        rawOutput = await fetchRes.json();
      } catch (err) {
        console.error("[IA-Status] Error descargando JSON de Replicate:", err);
      }
    }

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

    // Merge con datos existentes para no perder beatTimes/sections/bpm
    const { data: existingSong } = await supabase
      .from('songs')
      .select('prompter_data')
      .eq('id', songId)
      .single();

    const mergedData = {
      ...prompterData,
      ...(existingSong?.prompter_data || {}),
      chords: finalChords
    };

    const { error: updateError } = await supabase
      .from('songs')
      .update({ prompter_data: mergedData })
      .eq('id', songId);

    if (updateError) throw new Error(`Error guardando en BD: ${updateError.message}`);

    console.log(`[IA-Status] Guardado en Supabase OK. Acordes: ${finalChords.length}`);

    return res.status(200).json({
      done: true,
      message: 'Acordes procesados y guardados',
      data: mergedData
    });

  } catch (error) {
    console.error('[IA-Status] Error:', error);
    return res.status(500).json({ error: error.message });
  }
}
