# Engram

> Passive CLI daemon for semantic terminal history search.

Engram runs silently in the background, capturing every command you run and OCR-ing your screenshots. Ask it anything later with plain English.

```bash
engram search "that docker networking thing"
```

## Install

```bash
npm install -g engram
engram init
engram start
```

## Usage

```
engram init                         Set up shell hook
engram start / stop / status        Control the daemon
engram search <query>               Search with natural language
engram reindex                      Rebuild embeddings after switching providers
engram todo add/list/done/delete    Simple todo manager
engram config show / set            Manage config
```

## Configuration

Config lives at `~/.config/engram/config.toml` (Linux/macOS) or `%APPDATA%\engram\config.toml` (Windows).

See [ENGRAM_SPEC.md](./ENGRAM_SPEC.md) for full config reference.

## Providers

| Provider | Model | Notes |
|---|---|---|
| Ollama | nomic-embed-text | Self-hosted, set `ENGRAM_OLLAMA_HOST` |
| Gemini | text-embedding-004 | Set `GEMINI_API_KEY` |