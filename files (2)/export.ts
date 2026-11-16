import { chargerFFmpeg, monter } from './charger';
import { genererASS, type Mot, type Options } from '../subtitles';

/** Centre du cadre (0 à 1 dans l'image) et zoom (≥ 1). */
export type Cadre = { cx: number; cy: number; zoom: number };
export type Format = 'recadre' | 'ecran_partage' | 'fond_floute';

export type ParamsExport = {
  fichier: File; vw: number; vh: number;          // dimensions de la vidéo source
  debutMs: number; finMs: number;
  format: Format; cadres: Cadre[];                // 1 cadre (recadré) ou 2 (écran partagé : haut, bas)
  mots: Mot[]; opts: Options;                     // mots du clip, déjà corrigés
  titreHaut: string; hd: boolean;
  onProgress: (p: number, restantSecondes: number | null) => void;
};

const pair = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
const borne = (v: number, a: number, b: number) => Math.min(Math.max(v, a), b);

/** Boîte de découpe de rapport largeur/hauteur donné, centrée sur (cx, cy), le plus grand possible / zoom. */
function boite(vw: number, vh: number, rapport: number, c: Cadre) {
  let h = vh / Math.max(1, c.zoom), w = h * rapport;
  if (w > vw) { w = vw; h = w / rapport; }
  w = pair(w); h = pair(h);
  return { w, h, x: Math.round(borne(c.cx * vw - w / 2, 0, vw - w)), y: Math.round(borne(c.cy * vh - h / 2, 0, vh - h)) };
}

const temps = (ms: number) => { const cs = Math.round(ms / 10); return `${Math.floor(cs / 360000)}:${String(Math.floor(cs / 6000) % 60).padStart(2, '0')}:${String(Math.floor(cs / 100) % 60).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`; };

export async function exporterClip(p: ParamsExport): Promise<Blob> {
  const W = p.hd ? 1080 : 720, H = p.hd ? 1920 : 1280;
  const duree = (p.finMs - p.debutMs) / 1000;

  // --- Filtre vidéo selon le format ---
  let fv: string;
  if (p.format === 'recadre') {
    const b = boite(p.vw, p.vh, 9 / 16, p.cadres[0] ?? { cx: 0.5, cy: 0.5, zoom: 1 });
    fv = `[0:v]crop=${b.w}:${b.h}:${b.x}:${b.y},scale=${W}:${H}[v]`;
  } else if (p.format === 'ecran_partage') {
    const a = boite(p.vw, p.vh, 9 / 8, p.cadres[0] ?? { cx: 0.3, cy: 0.5, zoom: 1 });
    const c = boite(p.vw, p.vh, 9 / 8, p.cadres[1] ?? { cx: 0.7, cy: 0.5, zoom: 1 });
    fv = `[0:v]split=2[s1][s2];[s1]crop=${a.w}:${a.h}:${a.x}:${a.y},scale=${W}:${H / 2}[h];` +
         `[s2]crop=${c.w}:${c.h}:${c.x}:${c.y},scale=${W}:${H / 2}[b];[h][b]vstack=inputs=2[v]`;
  } else {
    fv = `[0:v]split=2[bg][fg];[bg]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:2[fond];` +
         `[fg]scale=${W}:-2[av];[fond][av]overlay=(W-w)/2:(H-h)/2[v]`;
  }
  fv += ';[v]subtitles=/sous-titres.ass:fontsdir=/polices[out]'; // libass met le fichier ASS (720×1280) à l'échelle

  // --- Sous-titres (+ titre en haut, dans la zone sûre) ---
  let ass = genererASS(p.mots, p.debutMs, p.opts);
  const titre = p.titreHaut.trim().replace(/[{}\\]/g, '');
  if (titre) ass += `Dialogue: 1,0:00:00.00,${temps(p.finMs - p.debutMs)},Clip,,0,0,0,,{\\an8\\pos(360,150)\\fs54}${p.opts.majuscules ? titre.toUpperCase() : titre}\n`;

  const ff = await chargerFFmpeg();
  const { chemin, demonter } = await monter(ff, p.fichier);
  const debut = Date.now();
  const cb = ({ progress }: { progress: number }) => {
    const pr = borne(progress, 0, 1);
    p.onProgress(pr, pr > 0.03 ? Math.round(((Date.now() - debut) / pr) * (1 - pr) / 1000) : null);
  };
  ff.on('progress', cb);
  try {
    await ff.createDir('/polices');
    await ff.writeFile('/polices/Montserrat-ExtraBold.ttf', new Uint8Array(await (await fetch('/fonts/Montserrat-ExtraBold.ttf')).arrayBuffer()));
    await ff.writeFile('/sous-titres.ass', ass);
    const code = await ff.exec([
      '-ss', (p.debutMs / 1000).toFixed(3), '-t', duree.toFixed(3), '-i', chemin,   // -ss avant -i : rapide
      '-filter_complex', fv, '-map', '[out]', '-map', '0:a?',
      '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
      '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', 'clip.mp4',
    ]);
    if (code !== 0) throw new Error('L’export a échoué. Ferme les autres onglets et reste en 720p.');
    return new Blob([(await ff.readFile('clip.mp4')) as BlobPart], { type: 'video/mp4' });
  } finally {
    ff.off('progress', cb);
    for (const f of ['clip.mp4', '/sous-titres.ass', '/polices/Montserrat-ExtraBold.ttf']) { try { await ff.deleteFile(f); } catch {} }
    try { await ff.deleteDir('/polices'); } catch {}
    await demonter();
  }
}

/** Nom du fichier : clipzy-nom-de-la-video-clip-3.mp4 */
export const nomFichier = (video: string, n: number) =>
  `clipzy-${video.replace(/\.[^.]+$/, '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50)}-clip-${n}.mp4`;
