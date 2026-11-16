import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

let instance: FFmpeg | null = null;

/** Charge ffmpeg.wasm (cœur mono-thread, servi depuis /public/ffmpeg : aucun en-tête spécial requis). */
export async function chargerFFmpeg(): Promise<FFmpeg> {
  if (instance) return instance;
  const ff = new FFmpeg();
  await ff.load({
    coreURL: await toBlobURL('/ffmpeg/ffmpeg-core.js', 'text/javascript'),
    wasmURL: await toBlobURL('/ffmpeg/ffmpeg-core.wasm', 'application/wasm'),
  });
  instance = ff;
  return ff;
}

/** Monte le fichier en lecture (WORKERFS) sans le copier en mémoire. Repli : copie en mémoire. */
export async function monter(ff: FFmpeg, file: File) {
  const ext = (file.name.split('.').pop() ?? 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '') || 'mp4';
  const nom = `source.${ext}`;
  try {
    await ff.createDir('/in');
    await ff.mount('WORKERFS' as any, { files: [new File([file], nom, { type: file.type })] }, '/in');
    return { chemin: `/in/${nom}`, demonter: async () => { try { await ff.unmount('/in'); } catch {} try { await ff.deleteDir('/in'); } catch {} } };
  } catch {
    await ff.writeFile(nom, new Uint8Array(await file.arrayBuffer()));
    return { chemin: nom, demonter: async () => { try { await ff.deleteFile(nom); } catch {} } };
  }
}
