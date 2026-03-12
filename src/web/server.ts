import express from 'express'
import fs from 'fs'
import os from 'os'
import type { DB } from '../db'
import type { EngramConfig } from '../config'
import { paths } from '../utils/paths'
import {
  getAllEvents,
  countEvents,
  insertTodo,
  getTodo,
  listTodos,
  markTodoDone,
  deleteTodo,
  listAllTags,
  hybridSearch,
  getTagsForEvents,
} from '../db/queries'
import { createProvider } from '../providers/types'

// Strip ANSI escape codes from log lines before sending over SSE
function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*m/g, '')
}

function isDaemonRunning(): boolean {
  if (!fs.existsSync(paths.pidFile)) return false
  try {
    const pid = parseInt(fs.readFileSync(paths.pidFile, 'utf-8').trim(), 10)
    if (isNaN(pid)) return false
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

function getDbSizeMb(): number {
  try {
    return fs.statSync(paths.dbFile).size / (1024 * 1024)
  } catch {
    return 0
  }
}

function getDaemonPid(): number | null {
  try {
    const pid = parseInt(fs.readFileSync(paths.pidFile, 'utf-8').trim(), 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-var-requires
const APP_VERSION: string = (require('../../package.json') as { version: string }).version

const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Engram Dashboard</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script defer src="https://cdn.jsdelivr.net/npm/alpinejs@3.14.1/dist/cdn.min.js"></script>
  <style>
    [x-cloak] { display: none !important; }
    ::-webkit-scrollbar { width: 4px; height: 4px; }
    ::-webkit-scrollbar-track { background: #0f172a; }
    ::-webkit-scrollbar-thumb { background: #334155; border-radius: 2px; }
  </style>
</head>
<body class="bg-slate-900 text-slate-300 font-mono text-sm h-screen flex flex-col" x-data="app()" x-init="init()" x-cloak>
  <header class="flex items-center justify-between px-4 py-2 border-b border-slate-700 shrink-0">
    <div class="flex items-center gap-3">
      <span class="text-cyan-400 font-bold">&#9889; engram</span>
      <span class="text-slate-500 text-xs" x-text="status ? 'v' + status.version : ''"></span>
    </div>
    <div class="flex items-center gap-2">
      <span class="w-2 h-2 rounded-full" :class="status && status.daemonRunning ? 'bg-green-400' : 'bg-red-500'"></span>
      <span class="text-xs text-slate-400" x-text="status && status.daemonRunning ? 'daemon running' : 'daemon stopped'"></span>
    </div>
  </header>

  <div class="flex flex-1 overflow-hidden">
    <nav class="w-36 border-r border-slate-700 flex flex-col shrink-0 pt-1">
      <template x-for="item in nav" :key="item.id">
        <button
          @click="navigate(item.id)"
          class="px-4 py-2.5 text-left text-xs transition-colors border-l-2"
          :class="panel === item.id
            ? 'bg-slate-800 text-cyan-400 border-cyan-400'
            : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800 border-transparent'"
          x-text="item.label">
        </button>
      </template>
    </nav>

    <main class="flex-1 overflow-auto p-4">

      <!-- Overview -->
      <div x-show="panel === 'overview'">
        <h2 class="text-cyan-400 font-bold mb-4">Overview</h2>
        <template x-if="status">
          <div class="space-y-4">
            <div class="grid grid-cols-2 gap-3 lg:grid-cols-4">
              <div class="bg-slate-800 rounded p-3 border border-slate-700">
                <div class="text-xs text-slate-500 mb-1">Commands</div>
                <div class="text-2xl font-bold text-cyan-400" x-text="(status.eventCounts.commands || 0).toLocaleString()"></div>
              </div>
              <div class="bg-slate-800 rounded p-3 border border-slate-700">
                <div class="text-xs text-slate-500 mb-1">Screenshots</div>
                <div class="text-2xl font-bold text-cyan-400" x-text="(status.eventCounts.screenshots || 0).toLocaleString()"></div>
              </div>
              <div class="bg-slate-800 rounded p-3 border border-slate-700">
                <div class="text-xs text-slate-500 mb-1">Indexed</div>
                <div class="text-2xl font-bold text-green-400" x-text="(status.embeddingCounts.indexed || 0).toLocaleString()"></div>
              </div>
              <div class="bg-slate-800 rounded p-3 border border-slate-700">
                <div class="text-xs text-slate-500 mb-1">Pending</div>
                <div class="text-2xl font-bold text-yellow-400" x-text="(status.embeddingCounts.pending || 0).toLocaleString()"></div>
              </div>
            </div>
            <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
              <div class="bg-slate-800 rounded p-3 border border-slate-700">
                <div class="text-xs text-slate-500 mb-2">Daemon</div>
                <div class="flex items-center gap-2">
                  <span class="w-2 h-2 rounded-full" :class="status.daemonRunning ? 'bg-green-400' : 'bg-red-500'"></span>
                  <span class="text-xs" x-text="status.daemonRunning ? 'Running (PID ' + status.pid + ')' : 'Stopped'"></span>
                </div>
              </div>
              <div class="bg-slate-800 rounded p-3 border border-slate-700">
                <div class="text-xs text-slate-500 mb-2">Provider</div>
                <div class="text-xs text-slate-200" x-text="status.provider"></div>
              </div>
            </div>
            <div>
              <div class="text-xs text-slate-500 mb-2">Recent Activity</div>
              <div class="space-y-0.5">
                <template x-for="e in recentEvents" :key="e.id">
                  <div class="flex items-center gap-2 py-1 px-2 rounded hover:bg-slate-800">
                    <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                      :class="e.type === 'command' ? 'bg-cyan-900 text-cyan-300' : 'bg-purple-900 text-purple-300'"
                      x-text="e.type === 'command' ? 'cmd' : 'img'">
                    </span>
                    <span class="flex-1 truncate text-xs text-slate-300" x-text="e.type === 'command' ? e.content : tidyPath(e.source)"></span>
                    <span class="text-slate-600 text-xs shrink-0" x-text="formatAge(e.createdAt)"></span>
                  </div>
                </template>
              </div>
            </div>
          </div>
        </template>
      </div>

      <!-- Commands -->
      <div x-show="panel === 'commands'">
        <h2 class="text-cyan-400 font-bold mb-4">Commands</h2>
        <div class="overflow-x-auto">
          <table class="w-full text-xs border-collapse">
            <thead>
              <tr class="border-b border-slate-700 text-slate-500 text-left">
                <th class="py-2 pr-4 w-20">When</th>
                <th class="py-2 pr-4 w-48">Directory</th>
                <th class="py-2 pr-4">Command</th>
                <th class="py-2">Tags</th>
              </tr>
            </thead>
            <tbody>
              <template x-for="e in commands" :key="e.id">
                <tr class="border-b border-slate-800 hover:bg-slate-800 cursor-pointer" @click="copyToClipboard(e.content)">
                  <td class="py-1.5 pr-4 text-slate-500" x-text="formatAge(e.createdAt)"></td>
                  <td class="py-1.5 pr-4 text-slate-400 truncate max-w-xs" x-text="tidyPath(e.source)"></td>
                  <td class="py-1.5 pr-4 text-slate-200" x-text="e.content"></td>
                  <td class="py-1.5">
                    <div class="flex flex-wrap gap-1">
                      <template x-for="tag in (e.tags || [])" :key="tag">
                        <span class="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-sky-300" x-text="tag"></span>
                      </template>
                    </div>
                  </td>
                </tr>
              </template>
              <tr x-show="commands.length === 0">
                <td colspan="4" class="py-4 text-slate-500 text-center">No commands recorded yet.</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>

      <!-- Screenshots -->
      <div x-show="panel === 'screenshots'">
        <h2 class="text-cyan-400 font-bold mb-4">Screenshots</h2>
        <div class="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <template x-for="e in screenshots" :key="e.id">
            <div class="bg-slate-800 rounded border border-slate-700 p-3">
              <div class="flex items-start justify-between gap-2 mb-2">
                <a :href="'file://' + (e.source || '').replace(/ /g, '%20')"
                   target="_blank"
                   class="text-cyan-400 hover:underline text-xs truncate"
                   x-text="tidyPath(e.source)">
                </a>
                <span class="text-slate-500 text-xs shrink-0" x-text="formatAge(e.createdAt)"></span>
              </div>
              <p class="text-slate-400 text-xs line-clamp-3" x-text="e.content"></p>
              <div class="flex flex-wrap gap-1 mt-2">
                <template x-for="tag in (e.tags || [])" :key="tag">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-sky-300" x-text="tag"></span>
                </template>
              </div>
            </div>
          </template>
          <div x-show="screenshots.length === 0" class="text-slate-500 text-sm col-span-full">No screenshots recorded yet.</div>
        </div>
      </div>

      <!-- Search -->
      <div x-show="panel === 'search'">
        <h2 class="text-cyan-400 font-bold mb-4">Search</h2>
        <input
          type="text"
          x-model="searchQuery"
          @input="onSearchInput()"
          placeholder="Search your history..."
          class="w-full bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500 mb-4"
        >
        <div class="space-y-2">
          <template x-for="r in searchResults" :key="r.id">
            <div class="bg-slate-800 rounded border border-slate-700 p-3">
              <div class="flex items-center gap-2 mb-1">
                <span class="text-xs px-1.5 py-0.5 rounded shrink-0"
                  :class="r.type === 'command' ? 'bg-cyan-900 text-cyan-300' : 'bg-purple-900 text-purple-300'"
                  x-text="r.type">
                </span>
                <span class="text-slate-500 text-xs" x-text="formatAge(r.createdAt)"></span>
              </div>
              <p class="text-slate-200 text-xs mb-1 break-all" x-text="r.type === 'command' ? r.content : tidyPath(r.source)"></p>
              <p class="text-slate-500 text-xs" x-show="r.type === 'command'" x-text="tidyPath(r.source)"></p>
              <div class="flex flex-wrap gap-1 mt-2">
                <template x-for="tag in (r.tags || [])" :key="tag">
                  <span class="text-xs px-1.5 py-0.5 rounded bg-slate-700 text-sky-300 cursor-pointer hover:bg-slate-600"
                    x-text="tag"
                    @click="searchTag(tag)">
                  </span>
                </template>
              </div>
            </div>
          </template>
          <div x-show="searchQuery && searchResults.length === 0" class="text-slate-500 text-sm">No results found.</div>
          <div x-show="!searchQuery" class="text-slate-600 text-sm">Type to search your history.</div>
        </div>
      </div>

      <!-- Todos -->
      <div x-show="panel === 'todos'">
        <h2 class="text-cyan-400 font-bold mb-4">Todos</h2>
        <form @submit.prevent="addTodo()" class="flex gap-2 mb-3">
          <input
            type="text"
            x-model="newTodo"
            placeholder="Add a new todo..."
            class="flex-1 bg-slate-800 border border-slate-600 rounded px-3 py-2 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
          >
          <button type="submit" class="px-4 py-2 bg-cyan-700 hover:bg-cyan-600 rounded text-sm text-white transition-colors">Add</button>
        </form>
        <label class="flex items-center gap-2 text-xs text-slate-400 mb-4 cursor-pointer select-none">
          <input type="checkbox" x-model="showCompleted" @change="loadTodos()" class="accent-cyan-400">
          Show completed
        </label>
        <div class="space-y-1">
          <template x-for="todo in filteredTodos" :key="todo.id">
            <div class="flex items-center gap-3 py-2 px-3 rounded hover:bg-slate-800 group">
              <input type="checkbox" :checked="todo.done" @change="markDone(todo.id)" :disabled="todo.done" class="accent-cyan-400 shrink-0">
              <span class="flex-1 text-sm" :class="todo.done ? 'line-through text-slate-600' : 'text-slate-200'" x-text="todo.text"></span>
              <span class="text-slate-600 text-xs shrink-0" x-text="formatAge(todo.createdAt)"></span>
              <button @click="deleteTodo(todo.id)" class="text-slate-600 hover:text-red-400 opacity-0 group-hover:opacity-100 text-xs transition-opacity">&#10005;</button>
            </div>
          </template>
          <div x-show="todos.length === 0" class="text-slate-500 text-sm px-3">No todos yet.</div>
        </div>
      </div>

      <!-- Tags -->
      <div x-show="panel === 'tags'">
        <h2 class="text-cyan-400 font-bold mb-4">Tags</h2>
        <div class="flex flex-wrap gap-2">
          <template x-for="tag in tags" :key="tag.name">
            <button
              @click="searchTag(tag.name)"
              class="px-3 py-1 rounded bg-slate-800 border border-slate-700 hover:border-cyan-500 hover:text-cyan-400 transition-colors text-slate-300"
              :style="'font-size: ' + Math.max(0.65, Math.min(1.5, 0.65 + tag.count * 0.06)) + 'rem'"
            >
              <span x-text="tag.name"></span>
              <span class="text-slate-500 ml-1" style="font-size: 0.65rem;" x-text="'(' + tag.count + ')'"></span>
            </button>
          </template>
          <div x-show="tags.length === 0" class="text-slate-500 text-sm">No tags yet. Tags are generated automatically via Ollama.</div>
        </div>
      </div>

      <!-- Logs -->
      <div x-show="panel === 'logs'" class="flex flex-col" style="height: calc(100vh - 120px);">
        <div class="flex items-center justify-between mb-3">
          <h2 class="text-cyan-400 font-bold">Logs</h2>
          <button @click="clearLogs()" class="text-xs text-slate-500 hover:text-slate-300 border border-slate-700 rounded px-2 py-1 transition-colors">Clear</button>
        </div>
        <div id="log-container" class="flex-1 overflow-auto bg-slate-950 rounded border border-slate-800 p-3 space-y-0.5">
          <div x-show="logs.length === 0" class="text-slate-600 text-xs">No log entries yet. Start the daemon to see logs.</div>
          <template x-for="(entry, i) in logs" :key="i">
            <div class="text-xs leading-5 break-all" :class="logClass(entry.line)" x-text="entry.line"></div>
          </template>
        </div>
      </div>

      <!-- Config -->
      <div x-show="panel === 'config'">
        <h2 class="text-cyan-400 font-bold mb-4">Config</h2>
        <template x-if="status">
          <div>
            <div class="text-xs text-slate-500 mb-4" x-text="'File: ' + status.configPath"></div>
            <table class="w-full text-xs border-collapse">
              <thead>
                <tr class="border-b border-slate-700 text-slate-500 text-left">
                  <th class="py-2 pr-8 w-48">Key</th>
                  <th class="py-2">Value</th>
                </tr>
              </thead>
              <tbody>
                <template x-for="row in configRows" :key="row.key">
                  <tr class="border-b border-slate-800">
                    <td class="py-2 pr-8 text-slate-400" x-text="row.key"></td>
                    <td class="py-2 text-slate-200" x-text="row.value"></td>
                  </tr>
                </template>
              </tbody>
            </table>
          </div>
        </template>
      </div>

    </main>
  </div>

  <!-- Toast -->
  <div
    x-show="toast"
    x-transition:enter="transition ease-out duration-200"
    x-transition:enter-start="opacity-0 translate-y-2"
    x-transition:enter-end="opacity-100 translate-y-0"
    x-transition:leave="transition ease-in duration-150"
    x-transition:leave-start="opacity-100"
    x-transition:leave-end="opacity-0"
    class="fixed bottom-4 right-4 bg-slate-800 border border-slate-600 rounded px-4 py-2 text-sm text-slate-200 shadow-lg z-50"
    x-text="toast"
    style="display:none"
  ></div>

  <script>
  function app() {
    return {
      panel: 'overview',
      nav: [
        { id: 'overview',     label: 'Overview'     },
        { id: 'commands',     label: 'Commands'     },
        { id: 'screenshots',  label: 'Screenshots'  },
        { id: 'search',       label: 'Search'       },
        { id: 'todos',        label: 'Todos'        },
        { id: 'tags',         label: 'Tags'         },
        { id: 'logs',         label: 'Logs'         },
        { id: 'config',       label: 'Config'       },
      ],
      status: null,
      recentEvents: [],
      commands: [],
      screenshots: [],
      searchQuery: '',
      searchResults: [],
      searchTimeout: null,
      todos: [],
      showCompleted: false,
      newTodo: '',
      tags: [],
      logs: [],
      logSource: null,
      toast: '',
      toastTimer: null,

      get filteredTodos() {
        if (this.showCompleted) return this.todos;
        return this.todos.filter(function(t) { return !t.done; });
      },

      get configRows() {
        if (!this.status || !this.status.config) return [];
        var c = this.status.config;
        return [
          { key: 'provider.type',        value: c.provider.type },
          { key: 'ollama.host',           value: c.ollama.host },
          { key: 'ollama.model',          value: c.ollama.model },
          { key: 'gemini.model',          value: c.gemini.model },
          { key: 'daemon.port',           value: String(c.daemon.port) },
          { key: 'search.maxResults',     value: String(c.search.maxResults) },
          { key: 'screenshots.watchDir',  value: c.screenshots.watchDir || '(default)' },
          { key: 'debug',                 value: String(c.debug) },
        ];
      },

      async init() {
        await this.loadStatus();
        await this.loadRecentEvents();
      },

      async navigate(p) {
        this.panel = p;
        if (p === 'overview')    { await this.loadStatus(); await this.loadRecentEvents(); }
        else if (p === 'commands')     await this.loadCommands();
        else if (p === 'screenshots')  await this.loadScreenshots();
        else if (p === 'todos')        await this.loadTodos();
        else if (p === 'tags')         await this.loadTags();
        else if (p === 'logs')         this.startLogs();
      },

      async loadStatus() {
        try {
          var r = await fetch('/api/status');
          this.status = await r.json();
        } catch(e) {}
      },

      async loadRecentEvents() {
        try {
          var r = await fetch('/api/events?limit=10');
          this.recentEvents = await r.json();
        } catch(e) { this.recentEvents = []; }
      },

      async loadCommands() {
        try {
          var r = await fetch('/api/events?type=command&limit=50');
          this.commands = await r.json();
        } catch(e) { this.commands = []; }
      },

      async loadScreenshots() {
        try {
          var r = await fetch('/api/events?type=screenshot&limit=50');
          this.screenshots = await r.json();
        } catch(e) { this.screenshots = []; }
      },

      onSearchInput() {
        clearTimeout(this.searchTimeout);
        var self = this;
        this.searchTimeout = setTimeout(function() { self.doSearch(); }, 300);
      },

      async doSearch() {
        if (!this.searchQuery.trim()) { this.searchResults = []; return; }
        try {
          var r = await fetch('/api/search?q=' + encodeURIComponent(this.searchQuery) + '&limit=20');
          this.searchResults = await r.json();
        } catch(e) { this.searchResults = []; }
      },

      async loadTodos() {
        try {
          var r = await fetch('/api/todos');
          this.todos = await r.json();
        } catch(e) { this.todos = []; }
      },

      async addTodo() {
        if (!this.newTodo.trim()) return;
        try {
          await fetch('/api/todos', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text: this.newTodo }),
          });
          this.newTodo = '';
          await this.loadTodos();
        } catch(e) {}
      },

      async markDone(id) {
        try {
          await fetch('/api/todos/' + id + '/done', { method: 'PATCH' });
          await this.loadTodos();
        } catch(e) {}
      },

      async deleteTodo(id) {
        try {
          await fetch('/api/todos/' + id, { method: 'DELETE' });
          await this.loadTodos();
        } catch(e) {}
      },

      async loadTags() {
        try {
          var r = await fetch('/api/tags');
          this.tags = await r.json();
        } catch(e) { this.tags = []; }
      },

      searchTag(name) {
        this.searchQuery = name;
        this.panel = 'search';
        this.doSearch();
      },

      startLogs() {
        if (this.logSource) { this.logSource.close(); this.logSource = null; }
        var self = this;
        this.logSource = new EventSource('/api/logs');
        this.logSource.onmessage = function(e) {
          var data = JSON.parse(e.data);
          self.logs.push(data);
          if (self.logs.length > 500) self.logs.shift();
          self.$nextTick(function() {
            var el = document.getElementById('log-container');
            if (el) el.scrollTop = el.scrollHeight;
          });
        };
      },

      clearLogs() { this.logs = []; },

      copyToClipboard(text) {
        var self = this;
        navigator.clipboard.writeText(text)
          .then(function() { self.showToast('Copied: ' + text.slice(0, 50)); })
          .catch(function() { self.showToast('Copy failed'); });
      },

      showToast(msg) {
        var self = this;
        this.toast = msg;
        clearTimeout(this.toastTimer);
        this.toastTimer = setTimeout(function() { self.toast = ''; }, 2500);
      },

      formatAge(ts) {
        var secs = Math.floor(Date.now() / 1000) - ts;
        if (secs < 60) return 'just now';
        var mins = Math.floor(secs / 60);
        if (mins < 60) return mins + 'm ago';
        var hours = Math.floor(mins / 60);
        if (hours < 24) return hours + 'h ago';
        var days = Math.floor(hours / 24);
        if (days < 14) return days + 'd ago';
        var weeks = Math.floor(days / 7);
        if (weeks < 8) return weeks + 'w ago';
        var months = Math.floor(days / 30);
        return months + 'mo ago';
      },

      tidyPath(p) {
        if (!p) return '';
        var home = (this.status && this.status.homeDir) || '';
        if (home && p.startsWith(home)) return '~' + p.slice(home.length);
        return p;
      },

      logClass(line) {
        if (!line) return 'text-slate-600';
        if (line.indexOf('[debug]') !== -1) return 'text-slate-500';
        if (line.indexOf('[info]')  !== -1) return 'text-cyan-400';
        if (line.indexOf('[warn]')  !== -1) return 'text-yellow-400';
        if (line.indexOf('[error]') !== -1) return 'text-red-400';
        return 'text-slate-300';
      },
    };
  }
  </script>
</body>
</html>`

export function startWebServer(port: number, db: DB, config: EngramConfig): void {
  const app = express()
  app.use(express.json())

  const provider = createProvider(config)

  // --- GET / ---
  app.get('/', (_req, res) => {
    res.setHeader('Content-Type', 'text/html; charset=utf-8')
    res.send(DASHBOARD_HTML)
  })

  // --- GET /api/status ---
  app.get('/api/status', (_req, res) => {
    const daemonRunning = isDaemonRunning()
    const pid = getDaemonPid()
    const dbSizeMb = getDbSizeMb()

    let eventCounts = { commands: 0, screenshots: 0 }
    let embeddingCounts = { indexed: 0, pending: 0 }

    try {
      eventCounts = countEvents(db)
      const indexed = (db.prepare('SELECT count(*) AS n FROM embeddings').get() as { n: number }).n
      const pending = (db.prepare(
        'SELECT count(*) AS n FROM events e LEFT JOIN embeddings em ON em.event_id = e.id WHERE em.event_id IS NULL'
      ).get() as { n: number }).n
      embeddingCounts = { indexed, pending }
    } catch { /* db might not be ready */ }

    const providerLine = config.provider.type === 'ollama'
      ? `ollama (${config.ollama.host} / ${config.ollama.model})`
      : `gemini (${config.gemini.model})`

    res.json({
      version: APP_VERSION,
      daemonRunning,
      pid,
      provider: providerLine,
      dbPath: paths.dbFile,
      dbSizeMb: parseFloat(dbSizeMb.toFixed(2)),
      eventCounts,
      embeddingCounts,
      watchDir: config.screenshots.watchDir || paths.defaultScreenshotsDir,
      configPath: paths.configFile,
      homeDir: os.homedir(),
      config,
    })
  })

  // --- GET /api/events ---
  app.get('/api/events', (req, res) => {
    try {
      const limit = parseInt(String(req.query['limit'] ?? '50'), 10)
      const type = String(req.query['type'] ?? '')

      let rows = getAllEvents(db)
      if (type === 'command' || type === 'screenshot') {
        rows = rows.filter(r => r.type === type)
      }
      rows = rows.slice(-limit).reverse()

      let tagsMap = new Map<number, string[]>()
      try { tagsMap = getTagsForEvents(db, rows.map(r => r.id)) } catch { /* tags table might not exist */ }

      const result = rows.map(r => ({
        id: r.id,
        type: r.type,
        content: r.content,
        source: r.source,
        exitCode: r.exit_code,
        sessionId: r.session_id,
        createdAt: r.created_at,
        tags: tagsMap.get(r.id) ?? [],
      }))

      res.json(result)
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- GET /api/search ---
  app.get('/api/search', async (req, res) => {
    const q = String(req.query['q'] ?? '').trim()
    const limit = parseInt(String(req.query['limit'] ?? '20'), 10)

    if (!q) {
      // Return most recent events when query is empty
      try {
        const rows = getAllEvents(db).slice(-limit).reverse()
        let tagsMap = new Map<number, string[]>()
        try { tagsMap = getTagsForEvents(db, rows.map(r => r.id)) } catch { /* ignore */ }
        res.json(rows.map(r => ({
          id: r.id, type: r.type, content: r.content, source: r.source,
          exitCode: r.exit_code, sessionId: r.session_id, createdAt: r.created_at,
          distance: 0, tags: tagsMap.get(r.id) ?? [],
        })))
      } catch (err) {
        res.status(500).json({ error: String(err) })
      }
      return
    }

    try {
      const embedding = await provider.embed(q)
      const results = hybridSearch(db, embedding, q, limit)

      let tagsMap = new Map<number, string[]>()
      try { tagsMap = getTagsForEvents(db, results.map(r => r.id)) } catch { /* ignore */ }

      res.json(results.map(r => ({
        id: r.id, type: r.type, content: r.content, source: r.source,
        exitCode: r.exit_code, sessionId: r.session_id, createdAt: r.created_at,
        distance: r.distance, tags: tagsMap.get(r.id) ?? [],
      })))
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- GET /api/todos ---
  app.get('/api/todos', (_req, res) => {
    try {
      const rows = listTodos(db, true)
      res.json(rows.map(r => ({
        id: r.id, text: r.text, done: r.done === 1,
        createdAt: r.created_at, doneAt: r.done_at,
      })))
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- POST /api/todos ---
  app.post('/api/todos', (req, res) => {
    try {
      const text = String((req.body as { text?: string }).text ?? '').trim()
      if (!text) { res.status(400).json({ error: 'text required' }); return }
      const row = insertTodo(db, text)
      res.status(201).json({ id: row.id, text: row.text, done: false, createdAt: row.created_at, doneAt: null })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- PATCH /api/todos/:id/done ---
  app.patch('/api/todos/:id/done', (req, res) => {
    try {
      const id = parseInt(req.params['id']!, 10)
      const changed = markTodoDone(db, id)
      if (!changed) { res.status(404).json({ error: 'not found or already done' }); return }
      const row = getTodo(db, id)!
      res.json({ id: row.id, text: row.text, done: row.done === 1, createdAt: row.created_at, doneAt: row.done_at })
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- DELETE /api/todos/:id ---
  app.delete('/api/todos/:id', (req, res) => {
    try {
      const id = parseInt(req.params['id']!, 10)
      const deleted = deleteTodo(db, id)
      if (!deleted) { res.status(404).json({ error: 'not found' }); return }
      res.status(204).send()
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- GET /api/tags ---
  app.get('/api/tags', (_req, res) => {
    try {
      res.json(listAllTags(db))
    } catch (err) {
      res.status(500).json({ error: String(err) })
    }
  })

  // --- GET /api/logs (SSE) ---
  app.get('/api/logs', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()

    // Send last 50 lines on connect
    let lastSize = 0
    try {
      const content = fs.readFileSync(paths.logFile, 'utf-8')
      const lines = content.split('\n').filter(l => l.trim())
      const last50 = lines.slice(-50)
      for (const line of last50) {
        res.write(`data: ${JSON.stringify({ line: stripAnsi(line), ts: Date.now() })}\n\n`)
      }
      lastSize = fs.statSync(paths.logFile).size
    } catch { /* log file may not exist yet */ }

    // Poll for new lines
    let trailingBuf = ''
    const logWatcher = (_curr: fs.Stats, prev: fs.Stats) => {
      try {
        const curr = fs.statSync(paths.logFile)
        if (curr.size <= lastSize) return
        const fd = fs.openSync(paths.logFile, 'r')
        const toRead = curr.size - lastSize
        const buf = Buffer.alloc(toRead)
        fs.readSync(fd, buf, 0, toRead, lastSize)
        fs.closeSync(fd)
        lastSize = curr.size
        trailingBuf += buf.toString('utf-8')
        const parts = trailingBuf.split('\n')
        trailingBuf = parts.pop() ?? ''
        for (const line of parts) {
          if (line.trim()) {
            res.write(`data: ${JSON.stringify({ line: stripAnsi(line), ts: Date.now() })}\n\n`)
          }
        }
      } catch { /* ignore */ }
    }

    fs.watchFile(paths.logFile, { interval: 500 }, logWatcher)

    req.on('close', () => {
      fs.unwatchFile(paths.logFile, logWatcher)
    })
  })

  app.listen(port, '127.0.0.1', () => {
    // listening — caller logs the URL
  })
}
