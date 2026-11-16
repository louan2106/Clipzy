import { extraireAudio } from './ffmpeg/audio';
import { supabaseNavigateur } from './supabase-navigateur';

export type Etape = 'verification' | 'audio' | 'envoi' | 'transcription';
const GO2 = 2 * 1024 ** 3, MO500 = 500 * 1024 ** 2, TROIS_H = 3 * 3600;

/** Durée lue avec un élément vidéo caché (rien n'est envoyé). */
export function lireDuree(file: File): Promise<number> {
  return new Promise((ok, ko) => {
    const v = document.createElement('video'); const url = URL.createObjectURL(file);
    v.preload = 'metadata'; v.muted = true;
    v.onloadedmetadata = () => { URL.revokeObjectURL(url); isFinite(v.duration) ? ok(v.duration) : ko(new Error('Durée illisible.')); };
    v.onerror = () => { URL.revokeObjectURL(url); ko(new Error('Ce fichier ne peut pas être lu par ton navigateur.')); };
    v.src = url;
  });
}

const json = async (r: Response) => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.erreur ?? 'Erreur serveur.'); return j; };

/** Les 3 étapes de l'import. Rien ne part avant que durée, taille et heures restantes soient vérifiées. */
export async function importerVideo(o: {
  file: File; langue: string; certifie: boolean; resteSecondes: number; mobile: boolean;
  onEtape: (e: Etape, progression: number) => void;
}): Promise<string> {
  const { file, onEtape } = o;
  if (!o.certifie) throw new Error('Coche la case qui certifie que la vidéo est la tienne ou que tu as l’accord de son auteur.');
  if (file.size > GO2) throw new Error('Ce fichier dépasse 2 Go. Exporte une version plus légère en 720p avec HandBrake (gratuit), puis réessaie.');
  if (o.mobile && file.size > MO500) throw new Error('Sur téléphone, l’import marche jusqu’à 500 Mo. Utilise un ordinateur pour ce fichier.');
  onEtape('verification', 0);
  const duree = await lireDuree(file);
  if (duree > TROIS_H) throw new Error('Cette vidéo dépasse 3 h. Découpe-la en deux avant de l’importer.');
  if (duree > o.resteSecondes) throw new Error(`Il te reste ${Math.floor(o.resteSecondes / 3600)} h ${Math.floor((o.resteSecondes % 3600) / 60)} min ce mois-ci : cette vidéo est trop longue.`);

  const audio = await extraireAudio(file, p => onEtape('audio', p));          // étape 1 (navigateur)
  onEtape('envoi', 0);
  const { videoId, chemin, token } = await json(await fetch('/api/upload-url', { // étape 2 (URL signée)
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nom: file.name, taille: file.size, duree, langue: o.langue, certifie: true }),
  }));
  const { error } = await supabaseNavigateur().storage.from('audios').uploadToSignedUrl(chemin, token, audio, { contentType: 'audio/mpeg' });
  if (error) throw new Error('L’envoi du son a échoué. Vérifie ta connexion et réessaie.');
  onEtape('transcription', 0);                                                  // étape 3 : l'utilisateur peut fermer l'onglet
  await json(await fetch('/api/transcrire', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ videoId }) }));
  return videoId;
}

/** Au retour dans le studio : le fichier re-sélectionné doit correspondre à la vidéo enregistrée. */
export async function fichierCorrespond(file: File, v: { nom_fichier: string; taille_octets: number; duree_secondes: number }) {
  if (file.name !== v.nom_fichier || file.size !== Number(v.taille_octets)) return false;
  return Math.abs((await lireDuree(file)) - v.duree_secondes) <= 2;
}
