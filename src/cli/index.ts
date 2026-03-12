#!/usr/bin/env node
import { Command } from 'commander'
import { registerDaemonCommands } from './daemon'
import { registerSearchCommand } from './search'
import { registerTodoCommands } from './todo'
import { registerWebCommand } from './web'
import { setDebug } from '../utils/logger'
import fs from 'fs';
import path from 'path';

const packageJsonPath = path.join(__dirname, '../..', 'package.json');
const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
const version = packageJson.version || '0.1.0';

const program = new Command()

program
    .name('engram')
    .description('Passive CLI daemon for semantic terminal history search')
    .version(version || '0.0.0')
    .option('--debug', 'Enable debug logging')
    .hook('preAction', (cmd) => {
        if ((cmd.opts() as { debug?: boolean }).debug) {
            setDebug(true)
        }
    })

registerDaemonCommands(program)
registerSearchCommand(program)
registerTodoCommands(program)
registerWebCommand(program)

program.parse(process.argv)
