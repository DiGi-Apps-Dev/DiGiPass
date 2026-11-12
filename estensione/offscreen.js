// Documento fuori schermo: copia negli appunti e, per i dati segreti, li svuota dopo il tempo scelto nelle Impostazioni.
const t = document.getElementById('t');
function scrivi(testo) {
  t.value = testo || ' ';
  t.select();
  document.execCommand('copy');
  t.value = '';
}
let timer;
chrome.runtime.onMessage.addListener((m) => {
  if (m?.a !== 'appunti') return;
  scrivi(m.testo);
  clearTimeout(timer);
  if (m.ms) timer = setTimeout(() => scrivi(' '), m.ms);
});
