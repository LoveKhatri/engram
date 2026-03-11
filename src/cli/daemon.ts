import type { Command } from 'commander'

// TODO Phase 2: implement start / stop / status / init

export function registerDaemonCommands(program: Command): void {
    program
        .command('start')
        .description('Start the Engram daemon')
        .action(() => { console.log('TODO: start daemon') })

    program
        .command('stop')
        .description('Stop the Engram daemon')
        .action(() => { console.log('TODO: stop daemon') })

    program
        .command('status')
        .description('Show daemon status and config summary')
        .action(() => { console.log('TODO: status') })

    program
        .command('init')
        .description('Set up shell hook')
        .action(() => { console.log('TODO: init shell hook') })

    program
        .command('reindex')
        .description('Re-embed all events (use after switching providers)')
        .action(() => { console.log('TODO: reindex') })

    const config = program.command('config').description('Manage configuration')

    config
        .command('show')
        .description('Print current config')
        .action(() => { console.log('TODO: config show') })

    config
        .command('set <key> <value>')
        .description('Update a config value')
        .action(() => { console.log('TODO: config set') })
}