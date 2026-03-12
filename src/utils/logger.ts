import chalk from 'chalk'

type Level = 'debug' | 'info' | 'warn' | 'error'

let _debug = process.env['ENGRAM_DEBUG'] === 'true'

export function setDebug(enabled: boolean): void {
  _debug = enabled
  if (enabled) process.env['ENGRAM_DEBUG'] = 'true'
}

export function isDebug(): boolean {
  return _debug
}

function shouldLog(level: Level): boolean {
  if (level === 'debug') return _debug
  return true
}

function format(level: Level, msg: string, ...args: unknown[]): string {
  const extra = args.length ? ' ' + args.map(a =>
    a instanceof Error ? a.message : String(a)
  ).join(' ') : ''

  switch (level) {
    case 'debug': return chalk.gray(`[debug] ${msg}${extra}`)
    case 'info':  return chalk.blue(`[info] ${msg}${extra}`)
    case 'warn':  return chalk.yellow(`[warn] ${msg}${extra}`)
    case 'error': return chalk.red(`[error] ${msg}${extra}`)
  }
}

export const logger = {
  debug(msg: string, ...args: unknown[]) {
    if (shouldLog('debug')) console.error(format('debug', msg, ...args))
  },
  info(msg: string, ...args: unknown[]) {
    if (shouldLog('info')) console.error(format('info', msg, ...args))
  },
  warn(msg: string, ...args: unknown[]) {
    if (shouldLog('warn')) console.error(format('warn', msg, ...args))
  },
  error(msg: string, ...args: unknown[]) {
    if (shouldLog('error')) {
      console.error(format('error', msg, ...args))
      if (_debug) {
        for (const arg of args) {
          if (arg instanceof Error && arg.stack) console.error(arg.stack)
        }
      }
    }
  },
}
