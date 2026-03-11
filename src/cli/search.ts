import type { Command } from 'commander'

// TODO Phase 5: implement search command

export function registerSearchCommand(program: Command): void {
    program
        .command('search <query>')
        .description('Search your history with natural language')
        .action((_query: string) => { console.log('TODO: search') })
}