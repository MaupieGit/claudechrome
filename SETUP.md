# ClaudeChrome — Setup and Build Instructions

## What's Been Built

### ✅ Completed
- **Extension source** (`extension/src/`) — all TypeScript and config files
- **Extension build** (`extension/dist/`) — ready to load into Chrome
- **Extension icons** — 16×16, 48×48, 128×128 PNGs
- **Go host binary source** (`host/`) — main.go, config.go, session.go

### ⏳ Pending: Go Binary Build
The Go bridge server binary (`claudechrome-host.exe`) needs to be built. This requires Go to be installed on your machine.

---

## Step 1: Install Go

1. Download Go from https://go.dev/dl/
2. Choose **Go 1.22+** for Windows
3. Run the installer (MSI file)
4. After installation, verify:
   ```powershell
   go version
   # Should output: go version go1.X.X windows/amd64
   ```

---

## Step 2: Build the Go Host Binary

Once Go is installed, open PowerShell and run:

```powershell
cd C:\DevOpsRepo\claudechrome\host

# Initialize Go module (one-time)
go mod init claudechrome/host

# Download dependencies
go get github.com/UserExistsError/conpty@v0.1.4
go get github.com/coder/websocket@v1.8.14

# Build the binary
go build -ldflags="-s -w" -o ..\claudechrome-host.exe .

# Verify it built
Test-Path ..\claudechrome-host.exe
```

This produces `C:\DevOpsRepo\claudechrome\claudechrome-host.exe` — a self-contained executable with no runtime dependencies.

---

## Step 3: Load the Extension in Chrome

1. Open **Chrome** (or any Chromium-based browser: Edge, Brave, etc.)
2. Navigate to `chrome://extensions`
3. Enable **Developer mode** (toggle in top-right corner)
4. Click **Load unpacked**
5. Navigate to `C:\DevOpsRepo\claudechrome\extension\dist` and select it
6. The extension appears with the "CC" icon

The extension is now installed!

---

## Step 4: Start the Host Binary

Open a **PowerShell or Command Prompt** and run:

```powershell
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell powershell
```

You should see:
```
claudechrome-host starting: shell="powershell" addr=127.0.0.1:7681
listening on ws://127.0.0.1:7681/terminal
```

The host is now running and ready for the extension to connect.

---

## Step 5: Use the Extension

1. Navigate to any webpage in Chrome
2. Click the **ClaudeChrome icon** in the toolbar (puzzle-piece menu → pin it for easy access)
3. A **dockable terminal panel** appears on the right side of the page
4. You can:
   - **Type shell commands** and see live output
   - **Resize the panel** by dragging the left edge
   - **Dock to the bottom** by clicking the ⊥ button in the header
   - **Dock to the right** by clicking the ⊢ button
   - **Toggle visibility** by clicking the icon again or the ✕ button

---

## Alternative Shell Selection

To use a different shell, pass `--shell` when starting the host:

```powershell
# PowerShell 7+ (pwsh)
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell pwsh

# cmd.exe
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell cmd

# Git Bash
C:\DevOpsRepo\claudechrome\claudechrome-host.exe --shell bash
```

---

## File Structure

```
C:\DevOpsRepo\claudechrome\
├── claudechrome-host.exe         ← built from host/ (run this to start server)
├── SETUP.md                      ← this file
│
├── host\                         ← Go bridge source
│   ├── go.mod                    ← Go module file (created after: go mod init)
│   ├── go.sum                    ← Go dependencies (created after: go get)
│   ├── main.go
│   ├── config.go
│   └── session.go
│
├── extension\                    ← Chrome MV3 extension source
│   ├── src\
│   │   ├── background.ts         ← service worker
│   │   ├── content\content.ts    ← content script (dockable panel)
│   │   └── panel\
│   │       ├── panel.html
│   │       ├── panel.ts
│   │       └── panel.css
│   ├── public\icons\             ← 16/48/128 PNG icons
│   ├── manifest.json
│   ├── package.json
│   ├── vite.config.ts
│   ├── tsconfig.json
│   └── dist\                     ← built extension (load this into Chrome)
│
└── install\
    └── start-host.bat            ← optional launcher script
```

---

## Troubleshooting

### "Panel doesn't appear when I click the icon"
- Verify the content script was injected: F12 (DevTools) → Console on the active page
- Look for errors like "Refused to load the script" — this indicates an issue with `web_accessible_resources`
- Try navigating to a simple page like `https://example.com`

### "WebSocket error in the terminal"
- Confirm the host binary is running: `C:\DevOpsRepo\claudechrome\claudechrome-host.exe`
- Check port 7681 is free: `netstat -an | findstr 7681`
- Look for "listening on ws://..." in the host binary output

### "go build" fails
- Confirm Go is installed: `go version`
- Try running from the `host\` directory explicitly
- Make sure you ran `go mod init` first

### "npm install" fails in the extension directory
- Delete `node_modules\` and `package-lock.json`
- Run `npm install` again
- Check you have Node.js v18+ installed: `node --version`

### "Chrome extension won't load"
- Check `manifest.json` is valid JSON (no trailing commas)
- Verify the `dist/` directory exists and contains `manifest.json`
- In `chrome://extensions`, look for red error text describing the issue

---

## Deploying to Another PC

Once you have the complete setup:

1. Copy `claudechrome-host.exe` to the target PC (anywhere)
2. Run it: `claudechrome-host.exe`
3. Load the extension from `extension\dist\` in Chrome (Load unpacked)

**No Node.js, no npm, no Go runtime needed** on the target machine — just the `.exe`.

---

## Next Steps

1. **Install Go** from https://go.dev/dl/
2. **Build the host binary** with the `go build` command above
3. **Start the host binary** 
4. **Click the extension icon** and enjoy your terminal!

For questions, refer to the plan at `C:\Users\MauricePerreijn\.claude\plans\i-want-to-create-declarative-locket.md`.
