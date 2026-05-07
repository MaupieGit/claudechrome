package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"sync"
	"time"

	"github.com/UserExistsError/conpty"
	"github.com/coder/websocket"
)

// Grace period after the last client disconnects before the session is reaped.
// Long enough to absorb hard-refresh / page-navigation gaps; short enough that
// a closed tab doesn't leak its PowerShell process for very long.
const reapGracePeriod = 60 * time.Second

// heartbeatInterval / heartbeatTimeout govern the per-client PING loop that
// keeps idle WebSockets alive and surfaces dead connections quickly.
const (
	heartbeatInterval = 30 * time.Second
	heartbeatTimeout  = 10 * time.Second
)

type TabSession struct {
	id        string
	shellCmd  string
	pty       *conpty.ConPty
	ctx       context.Context
	cancel    context.CancelFunc
	restartID int
	alive     bool
	hasOutput bool
	ptyMu     sync.Mutex

	clients     map[*websocket.Conn]bool
	reapTimer   *time.Timer
	clientMutex sync.Mutex
}

// cancelReapLocked stops a pending reap. Caller must hold clientMutex.
func (ts *TabSession) cancelReapLocked() {
	if ts.reapTimer != nil {
		ts.reapTimer.Stop()
		ts.reapTimer = nil
	}
}

// scheduleReapLocked arms the reap timer. Caller must hold clientMutex.
func (ts *TabSession) scheduleReapLocked() {
	if ts.reapTimer != nil {
		ts.reapTimer.Stop()
	}
	ts.reapTimer = time.AfterFunc(reapGracePeriod, ts.reap)
}

// reap removes the session and closes its PTY if still no clients are attached.
// Acquires sessionMutex first so a racing getOrCreateSession can't hand this
// session out to a new client between our check and the delete.
func (ts *TabSession) reap() {
	sessionMutex.Lock()
	ts.clientMutex.Lock()
	clientCount := len(ts.clients)
	if clientCount == 0 {
		ts.reapTimer = nil
		delete(sessions, ts.id)
	}
	ts.clientMutex.Unlock()
	sessionMutex.Unlock()

	if clientCount > 0 {
		return
	}
	log.Printf("session %s: reaped after %s idle", ts.id, reapGracePeriod)
	ts.Close()
}

type controlMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func newTabSession(id, shellCmd string) (*TabSession, error) {
	ts := &TabSession{
		id:       id,
		shellCmd: shellCmd,
		clients:  make(map[*websocket.Conn]bool),
	}
	if err := ts.startPTY(); err != nil {
		return nil, err
	}
	log.Printf("session %s created", id)
	return ts, nil
}

func (ts *TabSession) startPTY() error {
	pty, err := conpty.Start(ts.shellCmd,
		conpty.ConPtyDimensions(80, 24),
		conpty.ConPtyWorkDir(workDir()),
	)
	if err != nil {
		return err
	}
	ctx, cancel := context.WithCancel(context.Background())

	ts.ptyMu.Lock()
	ts.pty = pty
	ts.ctx = ctx
	ts.cancel = cancel
	ts.alive = true
	ts.hasOutput = false
	ts.restartID++
	myID := ts.restartID
	ts.ptyMu.Unlock()

	go ts.ptyReader(pty, ctx, myID)
	return nil
}

func (ts *TabSession) ptyReader(pty *conpty.ConPty, ctx context.Context, myID int) {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		n, err := pty.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("session %s: pty read error: %v", ts.id, err)
			}
			break
		}
		if n == 0 {
			continue
		}

		ts.ptyMu.Lock()
		ts.hasOutput = true
		ts.ptyMu.Unlock()

		ts.clientMutex.Lock()
		for conn := range ts.clients {
			if err := conn.Write(context.Background(), websocket.MessageBinary, buf[:n]); err != nil {
				log.Printf("session %s: ws write error: %v", ts.id, err)
				delete(ts.clients, conn)
			}
		}
		ts.clientMutex.Unlock()
	}

	ts.ptyMu.Lock()
	currentID := ts.restartID
	if currentID == myID {
		ts.alive = false
	}
	ts.ptyMu.Unlock()

	// Stale pre-restart goroutines must not broadcast.
	// On intentional kill the connections are already closed, so the broadcast no-ops.
	if currentID == myID {
		ts.broadcastText(`{"type":"shell-exited"}`)
	}
}

func (ts *TabSession) broadcastText(msg string) {
	ts.clientMutex.Lock()
	defer ts.clientMutex.Unlock()
	for conn := range ts.clients {
		_ = conn.Write(context.Background(), websocket.MessageText, []byte(msg))
	}
}

func (ts *TabSession) restart() error {
	ts.ptyMu.Lock()
	cancel := ts.cancel
	pty := ts.pty
	ts.ptyMu.Unlock()

	cancel()
	pty.Close()

	return ts.startPTY()
}

// AttachClient sends the session status to the client, then begins streaming.
// Status "alive" means the shell is running and has history — client shows a dialog.
// Status "new" means a fresh session (either brand-new or auto-restarted after death).
func (ts *TabSession) AttachClient(conn *websocket.Conn) {
	ts.ptyMu.Lock()
	var status string
	switch {
	case !ts.hasOutput:
		status = "new"
	case ts.alive:
		status = "alive"
	default:
		status = "dead"
	}
	ts.ptyMu.Unlock()

	// Dead sessions restart automatically; client sees them as "new"
	if status == "dead" {
		if err := ts.restart(); err != nil {
			log.Printf("session %s: auto-restart failed: %v", ts.id, err)
		}
		status = "new"
	}

	statusMsg, _ := json.Marshal(map[string]string{"type": "session-status", "status": status})

	// Write status before adding to clients map so ptyReader doesn't race this write
	_ = conn.Write(context.Background(), websocket.MessageText, statusMsg)

	ts.clientMutex.Lock()
	ts.cancelReapLocked()
	ts.clients[conn] = true
	ts.clientMutex.Unlock()

	go ts.heartbeat(conn)
	go ts.handleClient(conn)
}

// heartbeat sends a WebSocket PING every heartbeatInterval. Browsers auto-respond
// to PING frames at the protocol level, so no client-side code is needed. Two roles:
//  1. Keeps the connection bytes-active so idle timeouts (browser, OS, intermediaries)
//     don't silently drop a long-lived tab.
//  2. Detects a dead client within ~heartbeatTimeout instead of waiting for TCP
//     keepalive (Windows default is 2 hours), so the reap timer can start promptly.
func (ts *TabSession) heartbeat(conn *websocket.Conn) {
	ticker := time.NewTicker(heartbeatInterval)
	defer ticker.Stop()
	for range ticker.C {
		ctx, cancel := context.WithTimeout(context.Background(), heartbeatTimeout)
		err := conn.Ping(ctx)
		cancel()
		if err != nil {
			log.Printf("session %s: heartbeat failed, closing client: %v", ts.id, err)
			conn.CloseNow()
			return
		}
		if *flagDebug {
			log.Printf("session %s: heartbeat ok", ts.id)
		}
	}
}

func (ts *TabSession) handleClient(conn *websocket.Conn) {
	defer func() {
		ts.clientMutex.Lock()
		delete(ts.clients, conn)
		remaining := len(ts.clients)
		ts.clientMutex.Unlock()
		conn.CloseNow()
		log.Printf("session %s: client disconnected, %d remaining", ts.id, remaining)

		if remaining == 0 {
			ts.ptyMu.Lock()
			alive := ts.alive
			ts.ptyMu.Unlock()
			if !alive {
				removeSession(ts.id)
			} else {
				ts.clientMutex.Lock()
				ts.scheduleReapLocked()
				ts.clientMutex.Unlock()
				log.Printf("session %s: no clients, reaping in %s if no reconnect", ts.id, reapGracePeriod)
			}
		}
	}()

	for {
		msgType, data, err := conn.Read(context.Background())
		if err != nil {
			if *flagDebug {
				log.Printf("session %s: client read error: %v", ts.id, err)
			}
			return
		}

		switch msgType {
		case websocket.MessageBinary:
			ts.ptyMu.Lock()
			pty := ts.pty
			ts.ptyMu.Unlock()
			if _, err := pty.Write(data); err != nil {
				log.Printf("session %s: pty write error: %v", ts.id, err)
				return
			}
		case websocket.MessageText:
			var msg controlMsg
			if err := json.Unmarshal(data, &msg); err != nil {
				log.Printf("session %s: bad control message: %v", ts.id, err)
				continue
			}
			switch msg.Type {
			case "resize":
				if msg.Cols > 0 && msg.Rows > 0 {
					ts.ptyMu.Lock()
					pty := ts.pty
					ts.ptyMu.Unlock()
					if err := pty.Resize(msg.Cols, msg.Rows); err != nil {
						log.Printf("session %s: resize error: %v", ts.id, err)
					}
				}
			case "new-session":
				if err := ts.restart(); err != nil {
					log.Printf("session %s: restart failed: %v", ts.id, err)
				}
			case "kill-session":
				removeSession(ts.id)
				ts.Close()
				return
			}
		}
	}
}

func (ts *TabSession) Close() {
	ts.clientMutex.Lock()
	ts.cancelReapLocked()
	for conn := range ts.clients {
		conn.CloseNow()
	}
	ts.clientMutex.Unlock()

	ts.ptyMu.Lock()
	ts.cancel()
	ts.pty.Close()
	ts.ptyMu.Unlock()

	log.Printf("session %s closed", ts.id)
}
