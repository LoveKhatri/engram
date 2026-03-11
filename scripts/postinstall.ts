// Runs after `npm install -g engram`
// Prints setup instructions. Must never throw — failure would break install.

try {
  console.log(`
╔══════════════════════════════════════════╗
║           Engram installed ✓             ║
╚══════════════════════════════════════════╝

To get started, run:

  engram init      Set up your shell hook
  engram start     Start the background daemon

Full docs: https://github.com/LoveKhatri/engram
`)
} catch {
  // silent
}