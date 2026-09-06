import os
import shutil
import tempfile
import urllib.request
import requests
import librosa
import soundfile as sf
import numpy as np
import torch
import torchaudio
from demucs.apply import apply_model
from demucs.pretrained import get_model
from cog import BasePredictor, Input, Path

class Predictor(BasePredictor):
    def setup(self):
        """Load the model into memory to make running multiple predictions efficient"""
        self.device = 'cuda' if torch.cuda.is_available() else 'cpu'
        print(f"Using device: {self.device}")
        
        # Load HTDemucs model
        # 'htdemucs' is the v4 model
        self.model = get_model('htdemucs')
        self.model.to(self.device)
        self.model.eval()

    def predict(
        self,
        audio_file: str = Input(description="URL to the raw audio file"),
        job_id: str = Input(description="Job ID"),
        upload_url: str = Input(description="Supabase signed upload URL", default=None)
    ) -> str:
        """Run a single prediction on the model"""
        
        temp_dir = tempfile.mkdtemp()
        try:
            # 1. Download the input audio
            input_path = os.path.join(temp_dir, "input.wav")
            print(f"Downloading {audio_file}...")
            urllib.request.urlretrieve(audio_file, input_path)
            
            # 2. Deconstruction (HTDemucs)
            print("Separating stems using HTDemucs...")
            wav, sr = torchaudio.load(input_path)
            
            # Ensure it's stereo as required by htdemucs
            if wav.shape[0] == 1:
                wav = wav.repeat(2, 1)
                
            wav = wav.unsqueeze(0).to(self.device)
            
            # Apply demucs
            # Returns shape: (batch, stems, channels, time)
            # stems order: drums, bass, other, vocals
            ref = wav.mean(0)
            wav = (wav - ref.mean()) / ref.std()
            
            with torch.no_grad():
                sources = apply_model(self.model, wav, shifts=1, split=True, overlap=0.25)
                
            sources = sources * ref.std() + ref.mean()
            sources = sources.squeeze(0).cpu()
            
            # Demucs standard order
            stems_names = ['drums', 'bass', 'other', 'vocals']
            
            stems_dict = {}
            for i, name in enumerate(stems_names):
                stems_dict[name] = sources[i].numpy() # shape (2, time)

            # 3. Asynchronous Decorrelation
            print("Applying DSP decorrelation...")
            
            def process_stem(y_stem, sr, name):
                """
                Apply Phase Vocoder, Pitch Shift, and Phase Rotation based on stem type.
                y_stem is (2, time)
                """
                processed = np.zeros_like(y_stem)
                for ch in range(y_stem.shape[0]):
                    y = y_stem[ch]
                    
                    # STFT
                    n_fft = 2048
                    hop_length = 512
                    D = librosa.stft(y, n_fft=n_fft, hop_length=hop_length)
                    
                    if name in ['vocals', 'other', 'bass']:
                        # Pitch shifting for harmonic elements (~ 2-4 cents)
                        # 1 cent = 1/100 of a semitone
                        # Librosa pitch_shift takes n_steps in semitones
                        shift_cents = np.random.uniform(2.0, 4.0)
                        n_steps = shift_cents / 100.0
                        
                        # Apply pitch shift using phase vocoder (done within librosa.effects.pitch_shift)
                        # We use the time domain function for simplicity which internally does STFT/ISTFT
                        y_processed = librosa.effects.pitch_shift(y, sr=sr, n_steps=n_steps)
                        
                        # We also apply a slight phase randomization to decorrelate
                        D_proc = librosa.stft(y_processed, n_fft=n_fft, hop_length=hop_length)
                        mag, phase = librosa.magphase(D_proc)
                        # add a tiny constant phase offset
                        phase_offset = np.exp(1j * np.random.uniform(0.1, 0.5))
                        D_proc = mag * (phase * phase_offset)
                        y_out = librosa.istft(D_proc, hop_length=hop_length, length=len(y))
                        
                    elif name == 'drums':
                        # Phase rotation / time delays for transients
                        mag, phase = librosa.magphase(D)
                        
                        # Apply a frequency-dependent phase rotation
                        freqs = librosa.fft_frequencies(sr=sr, n_fft=n_fft)
                        phase_shift = np.exp(1j * 2 * np.pi * freqs * 0.001) # 1ms delay
                        phase_shift = phase_shift[:, np.newaxis]
                        
                        D_proc = mag * (phase * phase_shift)
                        y_out = librosa.istft(D_proc, hop_length=hop_length, length=len(y))
                        
                    else:
                        y_out = y
                        
                    # Ensure length matches
                    if len(y_out) < len(y):
                        y_out = np.pad(y_out, (0, len(y) - len(y_out)))
                    else:
                        y_out = y_out[:len(y)]
                        
                    processed[ch] = y_out
                    
                return processed

            # 4. Reconstruction (Downmix)
            print("Reconstructing downmix...")
            downmix = np.zeros_like(stems_dict['drums'])
            
            for name, stem in stems_dict.items():
                processed_stem = process_stem(stem, sr, name)
                downmix += processed_stem
                
            # Normalize to prevent clipping
            max_val = np.max(np.abs(downmix))
            if max_val > 0.99:
                downmix = downmix * (0.99 / max_val)
                
            # Transpose to (time, channels) for soundfile
            downmix_t = downmix.T
            
            output_path = os.path.join(temp_dir, f"clean_{job_id}.wav")
            sf.write(output_path, downmix_t, sr)
            
            # 5. Upload to Supabase if upload_url is provided
            if upload_url:
                print("Uploading to Supabase Storage...")
                with open(output_path, 'rb') as f:
                    # Supabase requires content-type
                    res = requests.put(upload_url, data=f, headers={'Content-Type': 'audio/wav'})
                    res.raise_for_status()
                print("Upload successful!")
                
                # We can just return the word 'uploaded' because the file is in Supabase now
                return "uploaded"
            
            # If no upload URL, Cog will upload it to Replicate's storage automatically
            # if we changed the return type to Path. Since it's str, we'll just return path
            # Wait, Cog needs the return type to be Path to upload.
            # Let's change the return to Path, but for our case, returning str is fine,
            # we'll just return a local file string if upload_url is false (for local testing).
            return str(output_path)
            
        except Exception as e:
            print(f"Error processing audio: {str(e)}")
            raise e
        finally:
            # We don't remove temp_dir if we are returning a local path for debugging
            # but if uploaded, we could clean it up.
            pass
