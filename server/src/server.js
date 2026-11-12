import { creaApp, leggiConfigurazione } from './app.js';

const config = leggiConfigurazione();
if (!config.chiave) {
  console.error('Manca DIGIPASS_AUTH_KEY nel file .env (32 byte in base64url).');
  process.exit(1);
}
const { app, chiudi } = await creaApp(config);

const server = app.listen(config.porta, config.indirizzo, () => {
  console.log(`DiGiPass pronto su http://${config.indirizzo}:${config.porta}`);
});
server.on('error', (err) => {
  console.error(err.code === 'EADDRINUSE' ? `La porta ${config.porta} è già occupata.` : err.message);
  process.exit(1);
});

function esci() {
  server.close(() => { chiudi(); process.exit(0); });
  server.closeAllConnections();
}
process.on('SIGINT', esci);
process.on('SIGTERM', esci);
