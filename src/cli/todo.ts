import type { Command } from 'commander'

// TODO Phase 6: implement todo subcommands

export function registerTodoCommands(program: Command): void {
    const todo = program.command('todo').description('Manage todos')

    todo
        .command('add <text>')
        .description('Add a todo item')
        .action((_text: string) => { console.log('TODO: todo add') })

    todo
        .command('list')
        .description('List open todos')
        .option('--all', 'Include completed todos')
        .action(() => { console.log('TODO: todo list') })

    todo
        .command('done <id>')
        .description('Mark a todo as done')
        .action((_id: string) => { console.log('TODO: todo done') })

    todo
        .command('delete <id>')
        .description('Delete a todo')
        .action((_id: string) => { console.log('TODO: todo delete') })
}