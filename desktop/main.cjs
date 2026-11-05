// Agent Office desktop shell. The control plane stays a separate Node process (scripts/app.ts, the same code as
// `npm start`); this window only loads its local UI. The renderer is sandboxed and gets one IPC call: add a repository.
const { app, BrowserWindow, dialog, ipcMain, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const CONFIG = () => path.join(app.getPath('userData'), 'repositories.json');
const readRepos = () => { try { return JSON.parse(fs.readFileSync(CONFIG(), 'utf8')).filter((r) => typeof r === 'string'); } catch { return []; } };
const writeRepos = (repos) => fs.writeFileSync(CONFIG(), JSON.stringify(repos, null, 2));

let server = null, win = null, origin = null;

/** Start the control plane with system Node (it needs node:sqlite and type stripping) and resolve with its URL. */
function startServer(repos) {
  return new Promise((resolve, reject) => {
    const node = process.env.AO_NODE || (process.platform === 'win32' ? 'node.exe' : 'node');
    const child = spawn(node, [path.join(ROOT, 'scripts/app.ts'), ...repos, '--port', '0'], { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
    let out = '', err = '';
    child.stdout.on('data', (d) => {
      out += d; process.stdout.write(d);
      const m = /Agent Office: (http:\/\/127\.0\.0\.1:\d+)/.exec(out);
      if (m) resolve({ child, url: m[1] });
    });
    child.stderr.on('data', (d) => { err += d; process.stderr.write(d); });
    child.on('error', (e) => reject(new Error(`Could not start Node (${node}): ${e.message}. Install Node 22.18+ or set AO_NODE.`)));
    child.on('exit', (code) => reject(new Error(`Agent Office server exited with ${code}\n${(err || out).slice(-2000)}`)));
  });
}

async function pickRepository() {
  const r = await dialog.showOpenDialog(win ?? undefined, { title: 'Add a git repository', properties: ['openDirectory'] });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  if (!fs.existsSync(path.join(dir, '.git'))) { await dialog.showMessageBox(win ?? undefined, { type: 'warning', message: `${dir} is not a git repository.` }); return null; }
  return dir;
}

async function launch() {
  let repos = readRepos();
  if (!repos.length) {
    const first = process.env.AO_REPO || (await pickRepository());
    if (!first) return app.quit();
    repos = [first]; writeRepos(repos);
  }
  // shortcut: restarting the server stops running agents; recover() re-queues them on start. Upgrade to in-place project add.
  server?.child.kill();
  try { server = await startServer(repos); }
  catch (e) { await dialog.showMessageBox({ type: 'error', message: 'Agent Office could not start', detail: e.message }); return app.quit(); }
  origin = new URL(server.url).origin;
  if (!win) createWindow();
  await win.loadURL(server.url);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1440, height: 900, backgroundColor: '#090B0D', title: 'Agent Office', autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Stay on the local UI; https links open in the default browser, never inside this window.
  win.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== origin) { e.preventDefault(); if (/^https:/.test(url)) void shell.openExternal(url); } });
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:/.test(url)) void shell.openExternal(url); return { action: 'deny' }; });
  win.on('closed', () => { win = null; });
}

ipcMain.handle('ao:add-repository', async () => {
  const dir = await pickRepository();
  if (!dir) return false;
  const repos = readRepos();
  if (repos.some((r) => path.basename(r) === path.basename(dir))) {
    await dialog.showMessageBox(win, { type: 'warning', message: `A repository named ${path.basename(dir)} is already open.` });
    return false;
  }
  writeRepos([...repos, dir]);
  await launch();
  return true;
});

app.whenReady().then(launch);
app.on('window-all-closed', () => app.quit());
app.on('quit', () => server?.child.kill());
