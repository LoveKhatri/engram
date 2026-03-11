import os from 'os'
import path from 'path'

function home(...parts: string[]): string {
  return path.join(os.homedir(), ...parts)
}

function appDataDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env['APPDATA'] ?? home('AppData', 'Roaming'), 'engram')
    default:
      return home('.config', 'engram')
  }
}

function dataDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(process.env['APPDATA'] ?? home('AppData', 'Roaming'), 'engram')
    case 'darwin':
      return home('Library', 'Application Support', 'engram')
    default:
      return home('.local', 'share', 'engram')
  }
}

function defaultScreenshotsDir(): string {
  switch (process.platform) {
    case 'win32':
      return path.join(os.homedir(), 'Pictures', 'Screenshots')
    case 'darwin':
      return home('Desktop')
    default: {
      const linuxDefault = home('Pictures', 'Screenshots')
      return linuxDefault
    }
  }
}

export const paths = {
  configDir: appDataDir(),
  configFile: path.join(appDataDir(), 'config.toml'),
  dataDir: dataDir(),
  dbFile: path.join(dataDir(), 'engram.db'),
  pidFile: path.join(dataDir(), 'daemon.pid'),
  logFile: path.join(dataDir(), 'daemon.log'),
  defaultScreenshotsDir: defaultScreenshotsDir(),
}
