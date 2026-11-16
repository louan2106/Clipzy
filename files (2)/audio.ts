import { chargerFFmpeg, monter } from './charger';

/** Étape 1 : son en mono, 16 kHz, MP3 32 kb/s (environ 15 Mo par heure). La vidéo ne part jamais. */
export async function extraireAudio(file: File, onProgress: (p: number) => void): Promise<Blob> {
  const ff = await chargerFFmpeg();
  const { chemin, demonter } = await monter(ff, file);
  const cb = ({ progress }: { progress: number }) => onProgress(Math.min(1, Math.max(0, progress)));
  ff.on('progress', cb);
  try {
    const code = await ff.exec(['-i', chemin, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'libmp3lame', '-b:a', '32k', 'sortie.mp3']);
    if (code !== 0) throw new Error('Impossible de lire le son de cette vidéo.');
    const data = await ff.readFile('sortie.mp3');
    return new Blob([data as BlobPart], { type: 'audio/mpeg' });
  } finally {
    ff.off('progress', cb);
    try { await ff.deleteFile('sortie.mp3'); } catch {}
    await demonter();
  }
}
