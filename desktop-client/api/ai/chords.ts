import type { VercelRequest, VercelResponse } from '@vercel/node';
import Replicate from 'replicate';
import { createClient } from '@supabase/supabase-js';
import * as os from 'os';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as mm from 'music-metadata';
import { execFile } from 'child_process';
import util from 'util';

const execFileAsync = util.promisify(execFile);

// Configurar Supabase
const supabaseUrl = process.env.VITE_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
const supabase = createClient(supabaseUrl, supabaseKey);

// Configurar Replicate con token de entorno
const replicateToken = process.env.REPLICATE_API_TOKEN || '';
const replicate = new Replicate({
  auth: replicateToken,
});

export const maxDuration = 300; // 5 minutes max duration para Vercel

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  try {
    const { songId, manualBpm, manualKey, timeSignature } = req.body;
    
    if (!songId) return res.status(400).json({ error: 'Falta songId' });

    // 1. Obtener Stems de la canción
    const { data: stems, error: stemsError } = await supabase
      .from('stems')
      .select('*')
      .eq('song_id', songId);

    if (stemsError || !stems || stems.length === 0) {
      return res.status(404).json({ error: 'No se encontraron stems para analizar.' });
    }

    // 2. Elegir ÚNICAMENTE el archivo Master (no leerá todos los archivos)
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

    console.log(`[IA] Stem seleccionado para análisis armónico: ${selectedStem.name}`);

    // 3. Descargar el audio a un archivo temporal local
    const fileResponse = await fetch(selectedStem.file_url);
    if (!fileResponse.ok) throw new Error(`Fallo al descargar audio: ${fileResponse.statusText}`);
    
    const arrayBuffer = await fileResponse.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    
    const tempFileName = `${Date.now()}_temp_stem.wav`;
    const tempFilePath = path.join(os.tmpdir(), tempFileName);
    await fs.writeFile(tempFilePath, buffer);
    console.log(`[IA] Audio descargado temporalmente a ${tempFilePath}`);

    // Extraer metadatos profesionales con music-metadata
    console.log('[DSP] Extrayendo metadatos matemáticos del archivo (Rekordbox/Serato/DAW)...');
    let extractedBpm = manualBpm;
    let extractedKey = manualKey;
    let extractedFirstBeat = 0.0;
    try {
      const metadata = await mm.parseFile(tempFilePath);
      if (!extractedBpm && metadata.common.bpm) {
        extractedBpm = metadata.common.bpm;
      }
      if (!extractedKey && metadata.common.key) {
        extractedKey = metadata.common.key;
      }
    } catch (err) {
      console.error("[DSP] Error leyendo metadatos:", err);
    }

    // Estrategias con Python (Librosa) - Manejadas con Try/Catch seguro para Vercel
    const scriptPath = path.join(process.cwd(), 'scripts', 'librosa_analyzer.py');
    let tempDrumPath = null;
    let drumBpm = null;
    let drumFirstBeat = 0.0;
    let drumBeatTimes: number[] = [];
    
    if (!manualBpm) {
      const drumStem = stems.find(s => s.name.toLowerCase().includes('drum') || s.name.toLowerCase().includes('bater') || s.name.toLowerCase().includes('perc'));
      if (drumStem) {
        try {
          const drumRes = await fetch(drumStem.file_url);
          if (drumRes.ok) {
            const dBuf = Buffer.from(await drumRes.arrayBuffer());
            tempDrumPath = path.join(os.tmpdir(), `${Date.now()}_temp_drum.wav`);
            await fs.writeFile(tempDrumPath, dBuf);
            
            console.log('[DSP] Ejecutando Python Librosa (si está disponible)...');
            const { stdout } = await execFileAsync('python', [scriptPath, tempDrumPath]);
            const result = JSON.parse(stdout);
            
            if (result.bpm) {
              drumBpm = result.bpm;
              drumFirstBeat = result.first_beat || 0.0;
              drumBeatTimes = result.beat_times || [];
            }
          }
        } catch (err) {
          console.warn("[DSP] Librosa/Python no disponible en este entorno (Vercel Node.js). Usando IA Remota...");
        }
      }
    }

    let masterKey = null;
    let masterBpm = null;
    let masterFirstBeat = 0.0;
    let masterBeatTimes: number[] = [];
    if (!manualKey) {
       try {
         const { stdout: masterOut } = await execFileAsync('python', [scriptPath, tempFilePath]);
         const masterResult = JSON.parse(masterOut);
         masterKey = masterResult.key;
         masterBpm = masterResult.bpm; 
         masterFirstBeat = masterResult.first_beat || 0.0;
         masterBeatTimes = masterResult.beat_times || [];
       } catch (err) {
         console.warn("[DSP] Librosa/Python no disponible. Omitiendo...");
       }
    }

    const finalCalculatedBpm = manualBpm ? Number(manualBpm) : (drumBpm || extractedBpm || masterBpm || 120);
    const finalCalculatedKey = manualKey || extractedKey || masterKey;
    extractedFirstBeat = drumFirstBeat > 0 ? drumFirstBeat : masterFirstBeat;
    const extractedBeatTimes = drumBeatTimes.length > 0 ? drumBeatTimes : masterBeatTimes;

    if (tempDrumPath) await fs.unlink(tempDrumPath).catch(e => console.error(e));
    await fs.unlink(tempFilePath).catch(e => console.error(e));

    // 4. Extraer Acordes usando Replicate (Modelo CNN-LSTM)
    console.log('[IA] Solicitando detección de acordes acústicos a Replicate...');
    const output: any = await replicate.run(
      "triadmusic/chord-detection-cnn-lstm:be95be0303fd42000c413aec595922499f8b946d65416f31fb0034c2daf81f19",
      {
        input: {
          audio: selectedStem.file_url,
          return_lab_file: false,
          chord_vocabulary: 'submission'
        }
      }
    );

    console.log("[IA] Replicate finalizado.");
    
    const replicateChords = output.chord_segments || [];
    
    const formatChordName = (chord: string) => {
      if (chord === 'N' || !chord) return null;
      let clean = chord.replace(':maj', '').replace(':min', 'm');
      clean = clean.replace(':maj7', 'maj7').replace(':min7', 'm7').replace(':7', '7');
      return clean;
    };

    const finalChords = [];
    let lastChord = null;

    for (const seg of replicateChords) {
      const formatted = formatChordName(seg.chord);
      if (formatted) {
        if (formatted !== lastChord) {
          finalChords.push({
            time: Number(seg.start_time.toFixed(2)),
            chord: formatted
          });
          lastChord = formatted;
        }
      }
    }

    // ALGORITMO DE EXTRACCIÓN DE BPM ARMÓNICO
    let harmonicBpm = null;
    if (finalChords.length > 5 && !manualBpm) {
      const diffs = [];
      for (let i = 1; i < finalChords.length; i++) {
        diffs.push(finalChords[i].time - finalChords[i - 1].time);
      }
      
      let bestBpm = 0;
      let minError = 999999;
      
      for (let bpm = 70; bpm <= 140; bpm++) {
        const beatDur = 60.0 / bpm;
        let totalError = 0;
        let validDiffs = 0;
        
        for (const dt of diffs) {
          if (dt < 1.0) continue; 
          let beats = Math.round(dt / beatDur);
          if (beats === 0) beats = 1;
          const expected = beats * beatDur;
          totalError += Math.abs(dt - expected);
          validDiffs++;
        }
        
        if (validDiffs > 0) {
          const avgError = totalError / validDiffs;
          if (avgError < minError) {
            minError = avgError;
            bestBpm = bpm;
          }
        }
      }
      
      if (minError < 0.15) {
        harmonicBpm = bestBpm;
      }
    }

    const finalBpm = finalCalculatedBpm !== 99 ? finalCalculatedBpm : (harmonicBpm || 120);

    const finalSections = [
      { time: 0, section: "INTRO" }
    ];

    const finalPrompterData = {
      bpm: Math.round(finalBpm),
      firstBeatOffset: Number(extractedFirstBeat.toFixed(3)),
      beatTimes: extractedBeatTimes,
      timeSignature: timeSignature || '4/4',
      chords: finalChords,
      sections: finalSections
    };

    console.log('[IA] PrompterData Final:', finalPrompterData);

    // 5. Guardar en Supabase
    const { error: updateError } = await supabase
      .from('songs')
      .update({ prompter_data: finalPrompterData })
      .eq('id', songId);

    if (updateError) {
      throw new Error(`Error guardando en BD: ${updateError.message}`);
    }

    return res.status(200).json({ 
      success: true, 
      message: 'Acordes detectados con Replicate',
      data: finalPrompterData
    });

  } catch (error: any) {
    console.error('[IA] Error en endpoint:', error);
    return res.status(500).json({ error: error.message });
  }
}
