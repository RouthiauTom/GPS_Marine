export function initializePwa() {
  const dialog = document.getElementById('offline-dialog');
  const status = document.getElementById('offline-status');
  const install = document.getElementById('install-app');
  const instructions = document.getElementById('install-instructions');
  let installPrompt = null;
  let registration = null;
  const standalone = () => window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const updateInstall = () => {
    install.hidden = !installPrompt || standalone();
    instructions.textContent = standalone() ? 'Application installée sur cet appareil.' :
      'Sur iPhone ou iPad : ouvrez cette page dans Safari, puis Partager → Sur l’écran d’accueil. Sur Android : utilisez « Installer l’application » dans le menu du navigateur, si proposé.';
  };
  const checkReady = () => {
    const worker = navigator.serviceWorker?.controller;
    if (!worker) return;
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      status.textContent = 'Vérification indisponible. Rouvrez l’application avec une connexion avant le départ.';
      channel.port1.close();
    }, 5000);
    channel.port1.onmessage = event => {
      clearTimeout(timer);
      channel.port1.close();
      status.textContent = event.data.ready
        ? 'Application prête hors connexion. Gérez séparément vos cartes téléchargées.'
        : 'Préparation incomplète. Reconnectez-vous avant le départ.';
    };
    worker.postMessage({ type: 'CHECK_OFFLINE' }, [channel.port2]);
  };
  const updateAvailable = () => {
    document.getElementById('offline-update').hidden =
      !navigator.serviceWorker?.controller || !registration?.waiting;
  };
  document.getElementById('menu-offline').addEventListener('click', () => {
    updateInstall();
    checkReady();
    dialog.showModal();
  });
  document.getElementById('close-offline').addEventListener('click', () => dialog.close());
  window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault();
    installPrompt = event;
    updateInstall();
  });
  window.addEventListener('appinstalled', () => { installPrompt = null; updateInstall(); });
  install.addEventListener('click', async () => {
    if (!installPrompt) return;
    const prompt = installPrompt;
    installPrompt = null;
    updateInstall();
    try { await prompt.prompt(); await prompt.userChoice; }
    catch { instructions.textContent = 'Utilisez le menu de votre navigateur pour installer l’application.'; }
  });
  updateInstall();
  if (!window.isSecureContext || !('serviceWorker' in navigator)) {
    status.textContent = 'Installation et ouverture hors connexion indisponibles ici. Utilisez HTTPS et un navigateur compatible.';
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange', () => { checkReady(); updateAvailable(); });
  window.addEventListener('online', checkReady);
  checkReady();
  navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' })
    .then(value => {
      registration = value;
      checkReady();
      updateAvailable();
      const watchInstallation = () => {
        const worker = registration.installing;
        worker?.addEventListener('statechange', () => {
          if (worker.state === 'installed') updateAvailable();
          if (worker.state === 'redundant' && !navigator.serviceWorker.controller) {
            status.textContent = 'Préparation interrompue. Rouvrez l’application avec une connexion avant le départ.';
          }
        });
      };
      watchInstallation();
      registration.addEventListener('updatefound', watchInstallation);
    }).catch(() => {
      if (navigator.serviceWorker.controller) { checkReady(); return; }
      status.textContent = 'Préparation hors connexion impossible. Vérifiez la connexion et rouvrez l’application.';
    });
}
