export function initializeHome() {
  const home = document.getElementById('home-page');
  const open = () => {
    if (home.open) home.close();
    home.showModal();
  };
  const enterMap = () => {
    home.close();
    history.replaceState(null, '', `${location.pathname}${location.search}#carte`);
    document.getElementById('open-settings').focus();
  };
  document.getElementById('home-map').addEventListener('click', enterMap);
  document.getElementById('home-settings').addEventListener('click', () => {
    home.close();
    document.getElementById('open-settings').click();
  });
  document.getElementById('return-home').addEventListener('click', () => {
    document.getElementById('settings-dialog').close();
    history.replaceState(null, '', `${location.pathname}${location.search}`);
    open();
  });
  home.addEventListener('cancel', event => { event.preventDefault(); enterMap(); });
  if (location.hash === '#carte') home.close();
  else open();
}
