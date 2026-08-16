

import React, { useState } from 'react';
import { UploadCloud, CheckCircle, AlertTriangle, FileAudio, Archive } from 'lucide-react';
import { supabase } from '../lib/supabase';
import JSZip from 'jszip';

interface StemUploaderProps {
  songId?: string | null;
  bandId: string;
  onUploadComplete?: (newSongId?: string) => void;
}

export default function StemUploader({ songId, bandId, onUploadComplete }: StemUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<'idle' | 'success' | 'error' | 'processing'>('idle');
  const [errorMessage, setErrorMessage] = useState('');
  const [progressInfo, setProgressInfo] = useState('');

  // Mejorado con Timeout Anti-Congelamiento
  const getAudioDuration = (file: File | Blob): Promise<number> => {
    const audioPromise = new Promise<number>((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const audio = new Audio(url);
      audio.addEventListener('loadedmetadata', () => {
        URL.revokeObjectURL(url);
        resolve(audio.duration);
      });
      audio.addEventListener('error', (e) => reject(e));
    });

    // Timeout de 2 segundos. Si falla, asume duración 0 para no romper la subida.
    const timeoutPromise = new Promise<number>((resolve) => {
      setTimeout(() => resolve(0), 2000);
    });

    return Promise.race([audioPromise, timeoutPromise]).catch(() => 0);
  };

  const checkDuplicateName = async (targetSongId: string, baseName: string) => {
    const { data } = await supabase
      .from('stems')
      .select('id')
      .eq('song_id', targetSongId)
      .eq('name', baseName)
      .limit(1);
    
    return data && data.length > 0;
  };

  const uploadSingleFile = async (file: File | Blob, fileName: string, fileType: string, targetSongId: string) => {
    const baseName = fileName.split('.')[0] || 'Nuevo Stem';
    
    // Check duplicates
    const isDuplicate = await checkDuplicateName(targetSongId, baseName);
    if (isDuplicate) {
      throw new Error(`Ya existe una pista llamada "${baseName}" en esta carpeta.`);
    }

    // 1. Obtener duración real para pasarle al backend (con protección timeout)
    const durationSeconds = await getAudioDuration(file);
    
    // 2. Subir al Storage
    const storagePath = `${bandId}/${targetSongId}/${Date.now()}_${fileName}`;
    const { error: uploadError } = await supabase.storage
      .from('audios')
      .upload(storagePath, file, { contentType: fileType });

    if (uploadError) throw uploadError;

    // 3. Obtener URL pública
    const { data: publicUrlData } = supabase.storage.from('audios').getPublicUrl(storagePath);

    // Identificar si es un Master Track
    const isMaster = baseName.toLowerCase().includes('master') || 
                     baseName.toLowerCase().includes('full') || 
                     baseName.toLowerCase().includes('mezcla');

    // 4. Insertar en la tabla stems
    const { error: dbError } = await supabase.from('stems').insert({
      song_id: targetSongId,
      name: baseName,
      file_url: publicUrlData.publicUrl,
      type: 'Audio',
      metadata: {
        duration_seconds: Math.round(durationSeconds),
        format: fileType,
        original_name: fileName,
        is_master: isMaster
      }
    });

    if (dbError) throw dbError;
  };

  const createNewSongFromZip = async (zipName: string) => {
    const title = zipName.replace(/\.zip$/i, '').trim();
    // Use the fake band id owner for now since we bypass auth
    const { data, error } = await supabase.from('songs').insert({
      band_id: bandId,
      title: title
    }).select('id').single();

    if (error) throw error;
    return data.id;
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    setUploadStatus('processing');
    setErrorMessage('');
    
    let activeSongId = songId;

    try {
      if (file.name.toLowerCase().endsWith('.zip') || file.type === 'application/zip') {
        setProgressInfo('Creando nueva Carpeta/Canción...');
        activeSongId = await createNewSongFromZip(file.name);

        setProgressInfo('Descomprimiendo archivo ZIP...');
        const zip = new JSZip();
        const loadedZip = await zip.loadAsync(file);
        
        const validExtensions = ['.wav', '.mp3', '.ogg', '.flac', '.m4a'];
        const audioFiles = Object.keys(loadedZip.files).filter(filename => {
          const isDir = loadedZip.files[filename].dir;
          const isMacTrash = filename.includes('__MACOSX') || filename.includes('.DS_Store');
          const isAudio = validExtensions.some(ext => filename.toLowerCase().endsWith(ext));
          return !isDir && !isMacTrash && isAudio;
        });

        if (audioFiles.length === 0) {
          throw new Error("No se encontraron archivos de audio válidos dentro del ZIP.");
        }

        let uploadedCount = 0;
        for (const filename of audioFiles) {
          setProgressInfo(`Subiendo pista ${uploadedCount + 1} de ${audioFiles.length}: ${filename.split('/').pop()}`);
          
          const fileData = await loadedZip.files[filename].async('blob');
          const ext = filename.split('.').pop()?.toLowerCase();
          const mimeType = ext === 'wav' ? 'audio/wav' : ext === 'mp3' ? 'audio/mpeg' : 'audio/ogg';
          
          const actualFilename = filename.split('/').pop() || filename;
          await uploadSingleFile(fileData, actualFilename, mimeType, activeSongId as string);
          uploadedCount++;
        }
      } else {
        // Individual file upload
        if (!activeSongId) {
          throw new Error("Por favor selecciona una carpeta (Canción) primero para subir pistas sueltas, o sube un archivo ZIP para crear una nueva.");
        }
        setProgressInfo('Subiendo pista individual...');
        await uploadSingleFile(file, file.name, file.type, activeSongId);
      }

      setUploadStatus('success');
      setProgressInfo('');
      if (onUploadComplete) onUploadComplete(activeSongId ?? undefined);
    } catch (error: any) {
      console.error('Error uploading stem:', error);
      setUploadStatus('error');
      if (error.message?.includes('Tier Limit Reached')) {
        setErrorMessage('Almacenamiento Lleno: Has superado el límite de 1GB de tu cuenta Supabase Free (o el archivo es muy pesado). Borra canciones antiguas en WAV para liberar espacio.');
      } else {
        setErrorMessage(error.message || 'Hubo un error al procesar los archivos.');
      }
    } finally {
      setIsUploading(false);
      if (event.target) event.target.value = ''; // Reset input
    }
  };

  return (
    <div className={`border-2 border-dashed ${!songId ? 'border-yellow-600/50 hover:border-yellow-500' : 'border-gray-600 hover:border-gray-500'} rounded-lg p-8 text-center bg-gray-900/50 hover:bg-gray-800/50 transition relative group`}>
      <input 
        type="file" 
        accept="audio/*,.zip,application/zip" 
        onChange={handleFileUpload} 
        disabled={isUploading}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed z-10"
      />
      
      <div className="flex flex-col items-center justify-center space-y-4 relative z-0">
        {isUploading ? (
          <div className="animate-spin text-blue-500">
            <UploadCloud size={48} />
          </div>
        ) : uploadStatus === 'success' ? (
          <CheckCircle size={48} className="text-green-500" />
        ) : uploadStatus === 'error' ? (
          <AlertTriangle size={48} className="text-red-500" />
        ) : (
          <div className="flex space-x-4">
            <FileAudio size={48} className={!songId ? "text-gray-600" : "text-gray-400"} />
            <Archive size={48} className="text-yellow-500/70" />
          </div>
        )}

        <div className="text-white font-medium">
          {isUploading ? 'Procesando archivos...' : 
           !songId ? (
             <span className="text-yellow-500">Arrastra un .ZIP aquí para crear una Canción nueva</span>
           ) : (
             'Arrastra un Stem a esta carpeta o sube un ZIP'
           )}
        </div>
        
        {progressInfo && (
          <div className="text-blue-400 text-sm animate-pulse">
            {progressInfo}
          </div>
        )}

        {uploadStatus === 'error' && (
          <div className="text-red-400 text-sm max-w-sm">
            {errorMessage}
          </div>
        )}
        
        {uploadStatus === 'success' && (
          <div className="text-green-400 text-sm">
            ¡Operación exitosa!
          </div>
        )}
      </div>
    </div>
  );
}
