import argparse
from audiocraft.models import MusicGen
import torch
import torchaudio
import os

def main():
    parser = argparse.ArgumentParser(description="Generate isolated music stem")
    parser.add_argument('--prompt', required=True, help="Text prompt for generation")
    parser.add_argument('--duration', type=int, default=30, help="Duration in seconds")
    parser.add_argument('--output', required=True, help="Output WAV file path")
    args = parser.parse_args()

    # Load model (use 'small' for CPU, 'medium' for GPU)
    model = MusicGen.get_pretrained('facebook/musicgen-stereo-medium')
    model.set_generation_params(duration=args.duration)

    audio = model.generate([args.prompt], progress=True)

    torchaudio.save(args.output, audio[0].cpu(), sample_rate=model.sample_rate)
    print(f"Generated stem at {args.output}")

if __name__ == "__main__":
    main()