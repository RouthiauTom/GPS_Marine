import { tilesForBounds, listOfflineMaps, downloadOfflineMap, deleteOfflineMap } from './offline-maps.js';

const size = bytes => `${(bytes / 1024 / 1024).toFixed(1)} Mo`;

export function initializeOfflineMaps(map) {
  const dialog = document.getElementById('maps-dialog');
  const status = document.getElementById('maps-status');
  const download = document.getElementById('download-map');
  const cancel = document.getElementById('cancel-map-download');
  const progress = document.getElementById('map-download-progress');
  const detail = document.getElementById('map-detail');
  const name = document.getElementById('map-zone-name');
  let bounds;
  let controller = null;

  const estimate = () => {
    if (controller) return;
    try {
      const tiles = tilesForBounds(bounds, Number(detail.value));
      status.textContent = `${tiles.length} tuiles · environ ${size(tiles.length * 50000)} (estimation indicative, maximum 100 Mo).`;
      download.disabled = !navigator.onLine || !globalThis.caches;
      if (!navigator.onLine) status.textContent = 'Reconnectez-vous pour télécharger une zone.';
      if (!globalThis.caches) status.textContent = 'Le stockage des cartes nécessite HTTPS et un navigateur compatible.';
    } catch (error) { status.textContent = error.message; download.disabled = true; }
  };
  const refresh = async () => {
    const list = document.getElementById('downloaded-maps');
    try {
      const zones = await listOfflineMaps();
      list.replaceChildren();
      if (!zones.length) list.textContent = 'Aucune zone téléchargée.';
      for (const zone of zones) {
        const row = document.createElement('li');
        const title = document.createElement('strong');
        title.textContent = zone.name;
        const info = document.createElement('p');
        const date = new Date(zone.sourceDate);
        info.textContent = zone.status === 'ready'
          ? `${size(zone.bytes)} · détail ${zone.maxZoom} · source ${Number.isNaN(date.getTime()) ? 'de date inconnue' : date.toLocaleDateString('fr-FR')}`
          : 'Téléchargement incomplet — à supprimer puis recommencer.';
        const actions = document.createElement('div');
        actions.className = 'map-zone-actions';
        const view = document.createElement('button');
        view.type = 'button'; view.textContent = 'Afficher'; view.disabled = zone.status !== 'ready';
        view.addEventListener('click', () => { map.showOfflineRegion(zone); dialog.close(); });
        const remove = document.createElement('button');
        remove.type = 'button'; remove.textContent = 'Supprimer';
        remove.disabled = Boolean(controller);
        remove.addEventListener('click', async () => {
          if (!confirm(`Supprimer la carte « ${zone.name} » de cet appareil ?`)) return;
          remove.disabled = true;
          try { await deleteOfflineMap(zone.id); await refresh(); }
          catch { status.textContent = 'Suppression impossible. Réessayez.'; remove.disabled = false; }
        });
        actions.append(view, remove); row.append(title, info, actions); list.append(row);
      }
      const storage = await navigator.storage?.estimate?.();
      document.getElementById('maps-storage').textContent = storage?.quota
        ? `Stockage du site : ${size(storage.usage)} utilisés sur environ ${size(storage.quota)} disponibles au total.` : '';
    } catch { status.textContent = 'Impossible de lire les cartes locales. Vérifiez le stockage du navigateur.'; }
  };
  document.getElementById('open-offline-maps').addEventListener('click', () => {
    document.getElementById('offline-dialog').close();
    if (!controller) {
      bounds = map.getVisibleBounds();
      document.getElementById('map-zone-bounds').textContent = `Zone visible : ${bounds.map(value => value.toFixed(3)).join(' / ')} (ouest, sud, est, nord).`;
      estimate();
    }
    refresh(); dialog.showModal();
  });
  document.getElementById('close-maps').addEventListener('click', () => dialog.close());
  document.getElementById('use-online-map').addEventListener('click', () => { map.useAutomaticMap(); dialog.close(); });
  detail.addEventListener('change', estimate);
  window.addEventListener('online', estimate);
  window.addEventListener('offline', estimate);
  cancel.addEventListener('click', () => controller?.abort());
  download.addEventListener('click', async () => {
    if (controller) return;
    controller = new AbortController();
    download.disabled = true; detail.disabled = true; name.disabled = true;
    cancel.hidden = false; progress.hidden = false; progress.value = 0;
    status.textContent = 'Préparation de la source… Gardez cette page ouverte.';
    await refresh();
    try {
      const zone = await downloadOfflineMap({ name: name.value, bounds, maxZoom: Number(detail.value), signal: controller.signal,
        onProgress: ({ completed, total, bytes }) => {
          progress.max = total; progress.value = completed;
          status.textContent = `${completed} / ${total} tuiles · ${size(bytes)}. Gardez cette page ouverte.`;
        }
      });
      status.textContent = `« ${zone.name} » téléchargée (${size(zone.bytes)}). Utilisez Afficher pour vérifier le fond hors ligne.`;
      // Best effort only: browsers can still evict non-persistent storage.
      navigator.storage?.persist?.().catch(() => {});
    } catch (error) {
      status.textContent = controller.signal.aborted ? 'Téléchargement annulé. Aucun ajout partiel conservé.'
        : `Échec : ${error.message || 'vérifiez la connexion et réessayez'}`;
    } finally {
      controller = null; cancel.hidden = true; progress.hidden = true;
      detail.disabled = false; name.disabled = false; download.disabled = !navigator.onLine;
      await refresh();
    }
  });
}
