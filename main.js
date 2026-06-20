const { app, BrowserWindow, session, components } = require('electron');
const net = require('net');

const gotTheLock = app.requestSingleInstanceLock();

if (!gotTheLock) {
  app.quit();
  process.exit(0);
} else {

  app.commandLine.appendSwitch('ignore-gpu-blocklist');
  app.commandLine.appendSwitch('enable-gpu-rasterization');
  app.commandLine.appendSwitch('enable-zero-copy');
  app.commandLine.appendSwitch('disable-features', 'WebAuthentication');

  // Mise à jour de l'User-Agent et définition globale pour mieux cacher Electron
  const customUserAgent = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
  app.userAgentFallback = customUserAgent;
  
  const CLIENT_ID = '1517925767013601340';
  let mainWindow = null;

  // ==========================================
  // DISCORD RPC
  // ==========================================
  let ipc = null;
  let ipcReady = false;
  let nonce = 1;
  let recvBuffer = Buffer.alloc(0);
  let discordInterval = null;

  function encodeFrame(op, payload) {
    const json = JSON.stringify(payload);
    const jsonLen = Buffer.byteLength(json, 'utf8');
    const buf = Buffer.alloc(8 + jsonLen);
    buf.writeUInt32LE(op, 0);
    buf.writeUInt32LE(jsonLen, 4);
    buf.write(json, 8, 'utf8');
    return buf;
  }

  function sendFrame(op, payload) {
    if (ipc && !ipc.destroyed) {
      try { ipc.write(encodeFrame(op, payload)); } catch {}
    }
  }

  function parseFrames(data) {
    recvBuffer = Buffer.concat([recvBuffer, data]);
    while (recvBuffer.length >= 8) {
      const len = recvBuffer.readUInt32LE(4);
      if (recvBuffer.length < 8 + len) break;
      const json = recvBuffer.slice(8, 8 + len).toString('utf8');
      recvBuffer = recvBuffer.slice(8 + len);
      try {
        const msg = JSON.parse(json);
        console.log('[Discord] Frame:', msg.evt || msg.cmd);
        if (msg.evt === 'READY') {
          console.log('[Discord] RPC prêt ! Envoi activité immédiat...');
          ipcReady = true;
          pushActivity();
        }
      } catch (e) {}
    }
  }

let lastActivityCache = { title: null, isPlaying: null, end: 0 };

  function pushActivity() {
    if (!ipcReady || !mainWindow) return;
    
    mainWindow.webContents.executeJavaScript(`
      (() => {
        try {
          let isPlaying = false;
          let currentTime = 0;
          let duration = 0;

          // On vérifie directement les lecteurs audio/vidéo pour chopper le temps
          const medias = document.querySelectorAll('audio, video');
          for (const media of medias) {
            if (!media.paused && !media.muted) {
              isPlaying = true;
              currentTime = media.currentTime;
              duration = media.duration;
              break; // On a trouvé la musique en cours
            }
          }

          if (isPlaying && navigator.mediaSession && navigator.mediaSession.metadata) {
            const meta = navigator.mediaSession.metadata;
            const t = meta.title;
            const a = meta.artist || 'Nintendo';

            let artworkUrl = null;
            if (meta.artwork && meta.artwork.length > 0) {
              artworkUrl = meta.artwork[meta.artwork.length - 1].src;
            }

            return { title: t, artist: a, artworkUrl: artworkUrl, isPlaying: true, currentTime, duration };
          }
          
          return { title: null, artist: 'Nintendo', artworkUrl: null, isPlaying: false, currentTime: 0, duration: 0 };
        } catch (e) {
          return { title: null, artist: 'Nintendo', artworkUrl: null, isPlaying: false, currentTime: 0, duration: 0 };
        }
      })();
    `).then((data) => {
      const { title, artist, artworkUrl, isPlaying, currentTime, duration } = data;
      const assets = {};
      
      // --- CALCUL DES TIMESTAMPS POUR DISCORD ---
      const now = Date.now();
      let startTimestamp = null;
      let endTimestamp = null;

      if (isPlaying && duration > 0) {
        // On calcule le vrai timestamp (en millisecondes) de début et de fin
        startTimestamp = Math.round(now - (currentTime * 1000));
        endTimestamp = Math.round(startTimestamp + (duration * 1000));
      }

      // --- SYSTÈME ANTI-SPAM ---
      const isSameTrack = lastActivityCache.title === title && lastActivityCache.isPlaying === isPlaying;
      // On tolère 3 secondes de décalage au cas où le script boucle bizarrement, 
      // au-delà, on considère que l'utilisateur a cliqué sur la timeline (avance rapide)
      const isSameTime = Math.abs(lastActivityCache.end - (endTimestamp || 0)) < 3000;

      if (isSameTrack && isSameTime) {
        // Rien de nouveau : on annule l'envoi pour garder la console et le pipe propres !
        return; 
      }

      // On met à jour notre mémoire avec la nouvelle situation
      lastActivityCache = { title, isPlaying, end: (endTimestamp || 0) };

      // --- PRÉPARATION DES ASSETS ---
      if (isPlaying && title) {
        assets.large_image = artworkUrl || 'nintendo_music_logo'; 
        assets.large_text = artist;
      } else {
        assets.large_image = 'nintendo_music_logo';
        assets.large_text = 'Nintendo Music';
      }

      // --- CRÉATION DE L'OBJET D'ACTIVITÉ ---
      const activityObj = {
        details: (isPlaying && title) ? title : 'Dans les menus',
        state: (isPlaying && title) ? artist : 'En pause / Navigation',
        assets: assets,
        instance: false,
      };

      // On ajoute la barre de temps uniquement si une musique est en cours
      if (startTimestamp && endTimestamp) {
        activityObj.timestamps = {
          start: startTimestamp,
          end: endTimestamp
        };
      }

      sendFrame(1, {
        cmd: 'SET_ACTIVITY',
        args: {
          pid: process.pid,
          activity: activityObj
        },
        nonce: String(nonce++)
      });
      
      console.log('[Discord] NOUVEAU SET_ACTIVITY envoyé:', isPlaying && title ? `${title} (En lecture)` : 'Dans les menus (Pause)');
    }).catch(err => {
      console.error('[Discord] Erreur :', err);
    });
  }

  function connectIPC(attempt) {
    if (ipcReady) return;
    if (attempt > 9) {
      console.warn('[Discord] Aucun pipe dispo. Retry dans 15s...');
      setTimeout(() => connectIPC(0), 15000);
      return;
    }

    const pipePath = `\\\\?\\pipe\\discord-ipc-${attempt}`;
    console.log(`[Discord] Essai pipe ${attempt}...`);
    const socket = net.createConnection(pipePath);
    
    const connectTimeout = setTimeout(() => {
      if (!ipcReady && !socket.destroyed) {
        socket.destroy();
        connectIPC(attempt + 1);
      }
    }, 2000);

    socket.on('connect', () => {
      clearTimeout(connectTimeout);
      console.log(`[Discord] Connecté sur discord-ipc-${attempt} !`);
      ipc = socket;
      ipcReady = false;
      recvBuffer = Buffer.alloc(0);
      socket.write(encodeFrame(0, { v: 1, client_id: CLIENT_ID }));
    });

    socket.on('data', parseFrames);

    socket.on('error', () => {
      socket.destroy();
      if (!ipcReady) connectIPC(attempt + 1);
    });

    socket.on('close', () => {
      if (ipc === socket) {
        ipc = null;
        ipcReady = false;
        console.log('[Discord] Connexion perdue. Reconnexion dans 10s...');
        setTimeout(() => connectIPC(0), 10000);
      }
    });
  }

  // ==========================================
  // FENÊTRE
  // ==========================================
  function createWindow() {
    const nintendoSession = session.fromPartition('persist:nintendoMusic');

    nintendoSession.webRequest.onBeforeSendHeaders((details, callback) => {
      details.requestHeaders['User-Agent'] = customUserAgent;
      if (details.requestHeaders['sec-ch-ua']) {
        details.requestHeaders['sec-ch-ua'] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    });

    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      autoHideMenuBar: true,
      transparent: false,
      hasShadow: true,
      webPreferences: {
        session: nintendoSession,
        nodeIntegration: false,
        contextIsolation: true,
        disableBlinkFeatures: 'WebAuthentication',
        plugins: true,
        backgroundThrottling: false,
        acceleratedRendering: true
      }
    });

    mainWindow.loadURL('https://music.nintendo.com/');

    // --- DÉTECTION INSTANTANÉE ---
    // Ces deux lignes écoutent nativement le lecteur web
    mainWindow.webContents.on('media-started-playing', () => pushActivity());
    mainWindow.webContents.on('media-paused', () => pushActivity());

    let discordStarted = false;
    mainWindow.webContents.on('did-finish-load', () => {
      if (discordStarted) return;
      discordStarted = true;

      setTimeout(() => {
        connectIPC(0);
        
        // On passe l'intervalle de 15000 (15s) à 1000 (1s) !
        // Le système anti-spam protégera Discord des abus.
        discordInterval = setInterval(pushActivity, 1000);
      }, 5000);
    });
  }

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await components.whenReady();
      console.log("DRM Widevine prêts !");
    } catch (e) {
      console.error("Erreur DRM:", e);
    }

    app.on('web-contents-created', (event, contents) => {
      contents.on('enter-html-full-screen', () => false);
      contents.on('dom-ready', () => {
        contents.executeJavaScript(`
          if (navigator.credentials) {
            navigator.credentials.get    = function() { return Promise.reject(new Error("Cancel")); };
            navigator.credentials.create = function() { return Promise.reject(new Error("Cancel")); };
          }
        `).catch(() => {});
      });
    });

    createWindow();
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (discordInterval) clearInterval(discordInterval);
    if (ipc) ipc.destroy();
    app.quit();
    setTimeout(() => process.exit(0), 100);
  });

}