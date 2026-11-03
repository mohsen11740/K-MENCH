const { app, BrowserWindow } = require('electron')
const path = require('node:path')

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 640,
    autoHideMenuBar: true,
    backgroundColor: '#071329',
    title: 'BM | baran-mench',
    icon: path.join(__dirname, '..', 'build', 'icon.ico'),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
