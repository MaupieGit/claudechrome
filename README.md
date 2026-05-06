# ClaudeChrome — Browser Extension with Dockable Terminal

A Chromium browser extension that embeds a real shell terminal in a dockable, resizable panel — exactly like Firefox DevTools. Works on Windows with PowerShell, cmd.exe, Git Bash, or any shell.

## Features

✨ **Dockable Panel** — Lock to the right or bottom of your browser window. Resizable with drag handles.

✨ **Real Terminal** — Spawns actual PowerShell/cmd/pwsh/bash processes via Windows ConPTY. Not a fake web terminal.

✨ **Per-Tab Sessions** — Each browser tab gets its own independent shell session.

✨ **Zero Dependencies** — Ship the host binary to any PC. No Node.js, no npm, no runtime required.

✨ **Auto-Reconnect** — If the host crashes, the terminal automatically reconnects when restarted.

✨ **Dark Theme** — VS Code-style dark terminal with proper syntax highlighting for shell output.

✨ **WebSocket Binary Frames** — Efficient raw PTY data streaming (no base64 overhead).

## Quick Start

### 1. Install Go
Download [Go 1.22+](https://go.dev/dl/) and run the Windows MSI installer.

### 2. Build the Host Binary
```powershell
cd C:\DevOpsRepo\claudechrome\host
go mod init claudechrome/host
go get github.com/UserExistsError/conpty@v0.1.4
go get github.com/coder/websocket@v1.8.14
go build -ldflags="-s -w" -o ..\claudechrome-host.exe .
```

### 3. Start the Host
```powershell
C:\DevOpsRepo\claudechrome\claudechrome-host.exe
```
You'll see: `listening on ws://127.0.0.1:7681/terminal`

### 4. Load the Extension
- Open **Chrome** and navigate to `chrome://extensions`
- Enable **Developer mode** (toggle in top-right)
- Click **Load unpacked**
- Select: `C:\DevOpsRepo\claudechrome\extension\dist`

### 5. Use It!
- Click the **CC icon** in the toolbar
- A dockable terminal panel appears
- Type shell commands!

## What's Inside

```
C:\DevOpsRepo\claudechrome\
├── extension/dist/              # ← Load this into Chrome (ready now)
├── host/                        # ← Go source (needs: go build)
├── QUICK_START.txt              # ← Start here!
├── SETUP.md                     # ← Full setup & deployment guide
├── BUILD_STATUS.md              # ← Current build status
└── README.md                    # ← This file
```

## Architecture

```
Chrome Extension (MV3)
  ↓ Content script injects iframe
  ↓
  iframe (xterm.js + WebSocket)
  ↓ ws://127.0.0.1:7681
  ↓
Go Binary (main.go, config.go, session.go)
  ↓ ConPTY
  ↓
Shell Process (powershell.exe, cmd.exe, pwsh.exe, bash.exe, etc.)
```

**Key Design Decisions:**
- **WebSocket over Native Messaging:** Binary frames for zero encoding overhead
- **Content Script + iframe:** Allows docking to right/bottom (Side Panel API only does right)
- **Go instead of Node.js:** Single self-contained `.exe`, deployable to any Windows PC
- **ConPTY:** Real Windows pseudo-console, full VT sequence support

## Configuration

### Change Default Shell
When starting the host, use `--shell` flag:

```powershell
# PowerShell 7+
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell pwsh

# cmd.exe
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell cmd

# Git Bash
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell bash

# PowerShell 5.1 (default)
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell powershell
```

### Change Port
```powershell
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --addr 127.0.0.1:9000
```

Then update the extension's WebSocket URL in `extension/src/panel/panel.ts`.

## Files Overview

### Extension Source
- **`extension/src/background.ts`** — Service worker. Relays toolbar icon clicks to the content script.
- **`extension/src/content/content.ts`** — Content script. Injects the dockable panel with Shadow DOM into every page.
- **`extension/src/panel/panel.ts`** — Terminal UI. xterm.js, WebSocket, ResizeObserver.
- **`extension/manifest.json`** — MV3 manifest. Declares permissions, content scripts, web_accessible_resources.

### Go Host Binary
- **`host/main.go`** — HTTP server, WebSocket upgrade, origin validation (`chrome-extension://` only), session lifecycle.
- **`host/config.go`** — Shell configuration map, `--shell` and `--addr` flag parsing.
- **`host/session.go`** — Per-connection PTY bridge. Goroutine shuttles PTY output → WebSocket binary frames. Main loop shuttles WebSocket → PTY input + handles resize JSON control messages.

## Security

✅ **Origin Validation** — Only `chrome-extension://` origins can upgrade to WebSocket. Web pages cannot connect.

✅ **Localhost Only** — Host binds to `127.0.0.1:7681`, not `0.0.0.0`. Network-inaccessible.

✅ **No Remote Code Execution** — Everything runs locally. No cloud, no external APIs.

✅ **Runs as Current User** — The shell inherits the permissions of the user running the Go binary.

## Deployment

**Single Machine (Laptop):**
1. Build the binary once: `go build -o claudechrome-host.exe .`
2. Load the extension unpacked from `extension/dist/`
3. Start the host: `claudechrome-host.exe`

**Multiple Machines (Team):**
1. Build the binary on Windows: `go build -ldflags="-s -w" -o claudechrome-host.exe .`
2. Distribute `claudechrome-host.exe` to each machine (copy-paste, no installer)
3. Each user loads the extension in Chrome and runs the `.exe`

**Production/Packaged:**
1. Build: `go build -ldflags="-s -w" -o claudechrome-host.exe .`
2. Package `claudechrome-host.exe` with `extension/dist/` in an installer or ZIP
3. User: extract, run `.exe`, load extension from the included `extension/dist/`

## Troubleshooting

### "Panel doesn't appear when I click the icon"
- Open DevTools (F12) on the webpage
- Check the Console for errors (e.g., "Refused to load `src/panel/panel.html`")
- Verify `web_accessible_resources` in `manifest.json` includes the panel HTML
- Try navigating to a simple page like `https://example.com`

### "WebSocket error in the terminal"
- Verify the host is running: `C:\DevOpsRepo\claudechrome\claudechrome-host.exe`
- Check port 7681 is free: `netstat -an | findstr 7681`
- Look for "listening on ws://..." in the host output

### "go build" fails
- Verify Go is installed: `go version`
- Make sure you're in `C:\DevOpsRepo\claudechrome\host\`
- Run `go mod init claudechrome/host` first (one-time setup)
- Try `go get -u ./...` to update dependencies

### "npm run build" fails
- Delete `node_modules/` and `package-lock.json`
- Run `npm install` again
- Ensure Node.js v18+ is installed: `node --version`

### "Origin forbidden" error in the host logs
- Only `chrome-extension://` origins are allowed
- Web pages (e.g., `http://localhost:3000`) cannot connect
- This is by design — the extension is isolated from untrusted web content

## Documentation

- **[QUICK_START.txt](./QUICK_START.txt)** — Fastest path to a working setup
- **[SETUP.md](./SETUP.md)** — Detailed setup, deployment, and troubleshooting
- **[BUILD_STATUS.md](./BUILD_STATUS.md)** — Current build status and file checklist
- **[Implementation Plan](https://example.com/plan)** — Full technical design (see `.claude/plans/`)

## License

MIT (Unlicensed for now — modify freely)

## Author

Built with Claude Code by Maurice Perreijn

---

**Ready to get started?** See [QUICK_START.txt](./QUICK_START.txt) or [SETUP.md](./SETUP.md).
