import os
from gtts import gTTS

def generate_cues():
    output_dir = os.path.join(os.path.dirname(__file__), "..", "public", "cues")
    if not os.path.exists(output_dir):
        os.makedirs(output_dir)

    cues = {
        "intro": "Intro",
        "verso": "Verso",
        "pre-coro": "Precoro",
        "coro": "Coro",
        "puente": "Puente",
        "solo": "Solo",
        "final": "Final",
        "1": "Uno",
        "2": "Dos",
        "3": "Tres",
        "4": "Cuatro"
    }

    print("Generando Cues de Voz...")
    for filename, text in cues.items():
        filepath = os.path.join(output_dir, f"{filename}.mp3")
        if not os.path.exists(filepath):
            print(f"Generando {filename}.mp3 -> '{text}'")
            tts = gTTS(text=text, lang='es-us', slow=False)
            tts.save(filepath)
        else:
            print(f"Ya existe {filename}.mp3")
            
    print("¡Generación completa!")

if __name__ == "__main__":
    generate_cues()
