// Display preferences are scoped to this installation, and remain optional if storage is blocked.
export function initializeDisplay() {
  const key = `marine-gps-display:${new URL('../', import.meta.url).pathname}`;
  let preferences = { night: false, awake: true };
  try {
    const saved = JSON.parse(localStorage.getItem(key));
    if (typeof saved?.night === 'boolean') preferences.night = saved.night;
    if (typeof saved?.awake === 'boolean') preferences.awake = saved.awake;
  } catch { /* Keep defaults. */ }
  const night = document.getElementById('night-mode');
  const awake = document.getElementById('keep-awake');
  const status = document.getElementById('wake-status');
  const retry = document.getElementById('wake-retry');
  const supported = Boolean(window.isSecureContext && navigator.wakeLock?.request);
  let navigating = false, sentinel = null, pending = false, blocked = false, leaving = false;
  const wanted = () => supported && preferences.awake && navigating && !document.hidden && !leaving;
  const save = () => { try { localStorage.setItem(key, JSON.stringify(preferences)); } catch { /* Session only. */ } };
  const applyNight = () => {
    document.body.classList.toggle('night-mode', preferences.night);
    night.checked = preferences.night;
    document.querySelector('meta[name="theme-color"]').content = preferences.night ? '#101b20' : '#152522';
  };
  const render = () => {
    status.textContent = !supported ? 'Maintien de l’écran indisponible ici. Utilisez HTTPS et un navigateur compatible.' :
      !preferences.awake ? 'Maintien de l’écran désactivé.' :
      !navigating ? 'S’activera pendant le guidage d’une route, hors simulation.' :
      document.hidden || leaving ? 'Maintien suspendu : application masquée.' :
      sentinel && !sentinel.released ? 'Écran maintenu allumé pendant le guidage.' :
      blocked ? 'Maintien refusé ou interrompu par le téléphone. Vous pouvez réessayer.' : 'Activation du maintien de l’écran…';
    retry.hidden = !wanted() || !blocked;
    const badge = document.getElementById('screen-state');
    badge.hidden = !navigating || !preferences.awake;
    badge.textContent = sentinel && !sentinel.released ? 'Écran allumé' : 'Écran : maintien indisponible';
  };
  async function sync() {
    if (!wanted() && sentinel) {
      const old = sentinel;
      sentinel = null;
      try { await old.release(); } catch { /* May already have been released by the system. */ }
    }
    if (wanted() && !sentinel && !pending && !blocked) {
      pending = true;
      render();
      try {
        const acquired = await navigator.wakeLock.request('screen');
        if (!wanted()) await acquired.release();
        else {
          sentinel = acquired;
          blocked = acquired.released;
          if (acquired.released) sentinel = null;
          acquired.addEventListener('release', () => {
            if (sentinel !== acquired) return;
            sentinel = null;
            blocked = true; // Do not fight a system revocation in a retry loop.
            render();
          });
        }
      } catch { blocked = true; }
      finally { pending = false; }
    }
    render();
    if (wanted() && !sentinel && !pending && !blocked) void sync();
  }
  night.addEventListener('change', () => { preferences.night = night.checked; applyNight(); save(); });
  awake.checked = preferences.awake;
  awake.disabled = !supported;
  awake.addEventListener('change', () => { preferences.awake = awake.checked; blocked = false; save(); void sync(); });
  retry.addEventListener('click', () => { blocked = false; void sync(); });
  document.addEventListener('visibilitychange', () => { blocked = false; void sync(); });
  window.addEventListener('pagehide', () => { leaving = true; void sync(); });
  window.addEventListener('pageshow', () => { leaving = false; blocked = false; void sync(); });
  const settings = document.getElementById('settings-dialog');
  document.getElementById('open-settings').addEventListener('click', () => settings.showModal());
  document.getElementById('close-settings').addEventListener('click', () => settings.close());
  for (const id of ['menu-display', 'menu-offline']) {
    document.getElementById(id).addEventListener('click', () => settings.close(), { capture: true });
  }
  const dialog = document.getElementById('display-dialog');
  document.getElementById('menu-display').addEventListener('click', () => { render(); dialog.showModal(); });
  document.getElementById('close-display').addEventListener('click', () => dialog.close());
  applyNight(); render();
  return {
    setNavigating(value) {
      if (navigating === value) return;
      navigating = value; blocked = false; void sync();
    }
  };
}
