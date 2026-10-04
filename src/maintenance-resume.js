const fishDrop = require('./fish-drop');
const waddleRace = require('./waddle-race');
const logger = require('./utils/logger');

async function resume(client) {
  if (!fishDrop.isStarted()) await fishDrop.start(client).catch(error => logger.error('Fish Drop resume failed', error));
  else await fishDrop.postDrop(client, Date.now(), { bypassActivityCheck: true }).catch(error => logger.error('Fish Drop resume failed', error));
  if (!waddleRace.isRunning()) await waddleRace.start(client).catch(error => logger.error('WaddleRace resume failed', error));
  else await waddleRace.startNow(client).catch(error => logger.error('WaddleRace resume failed', error));
  await require('./staff-list').refresh(client).catch(error => logger.error('Staff list resume failed', error));
  await require('./community-image').retryAnnouncement(client);
}

module.exports = { resume };
