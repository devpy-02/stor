const { app, BrowserWindow, shell } = require('electron');
const express = require('express');
const path = require('node:path');

let mainWindow;
let server;

function startLocalServer() {
  const web = express();
  const distPath = path.join(__dirname, '..', 'dist');

  // Local-only compatibility endpoint used by the existing Abzarreza lookup feature.
  web.get('/api/abzarreza/search', async (req, res) => {
    try {
      const q = typeof req.query.q === 'string' ? req.query.q : '';
      const customUrl = typeof req.query.url === 'string' ? req.query.url : '';
      if (!q && !customUrl) return res.status(400).json({ error: 'Missing query or url parameter' });

      let targetUrl;
      if (customUrl) {
        const parsed = new URL(customUrl);
        if (parsed.protocol !== 'https:' || !['abzarreza.com', 'www.abzarreza.com'].includes(parsed.hostname)) {
          return res.status(400).json({ error: 'Only HTTPS URLs on abzarreza.com are allowed' });
        }
        targetUrl = parsed.toString();
      } else {
        targetUrl = `https://abzarreza.com/?s=${encodeURIComponent(q)}&post_type=product`;
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 8000);
      try {
        const upstream = await fetch(targetUrl, {
          signal: controller.signal,
          headers: {
            'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
            'Accept-Language': 'fa,en;q=0.9',
            'Referer': 'https://abzarreza.com/'
          }
        });
        const html = await upstream.text();
        res.status(upstream.status).type('html').send(html);
      } finally {
        clearTimeout(timeout);
      }
    } catch (error) {
      res.status(502).json({ error: error?.message || 'Proxy Error' });
    }
  });

  web.use(express.static(distPath, { extensions: ['html'] }));
  web.get('*', (_req, res) => res.sendFile(path.join(distPath, 'index.html')));

  return new Promise((resolve, reject) => {
    server = web.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') return reject(new Error('Could not start local app server'));
      resolve(`http://127.0.0.1:${address.port}`);
    });
    server.once('error', reject);
  });
}

async function createWindow() {
  const appUrl = await startLocalServer();
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 940,
    minWidth: 900,
    minHeight: 650,
    show: false,
    autoHideMenuBar: true,
    backgroundColor: '#f1f5f9',
    icon: path.join(__dirname, '..', 'public', 'icon-512.png'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true
    }
  });

  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url === 'about:blank') return { action: 'allow' };
    if (/^https?:|^mailto:|^sms:/i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!url.startsWith(appUrl)) {
      event.preventDefault();
      if (/^https?:|^mailto:|^sms:/i.test(url)) shell.openExternal(url);
    }
  });
  await mainWindow.loadURL(appUrl);
  mainWindow.on('closed', () => { mainWindow = null; });
}

app.whenReady().then(createWindow).catch((error) => {
  console.error('Failed to start Hami Tools:', error);
  app.quit();
});

app.on('window-all-closed', () => {
  if (server) server.close();
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow().catch(console.error);
});
