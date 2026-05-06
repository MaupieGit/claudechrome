package main

import (
	"context"
	"encoding/json"
	"io"
	"log"
	"sync"

	"github.com/UserExistsError/conpty"
	"github.com/coder/websocket"
)

type PersistentSession struct {
	pty         *conpty.ConPty
	clients     map[*websocket.Conn]bool
	clientMutex sync.Mutex
	ctx         context.Context
	cancel      context.CancelFunc
	shellCmd    string
}

type controlMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func NewPersistentSession(shellCmd string) (*PersistentSession, error) {
	pty, err := conpty.Start(shellCmd,
		conpty.ConPtyDimensions(80, 24),
		conpty.ConPtyWorkDir(workDir()),
	)
	if err != nil {
		return nil, err
	}

	ctx, cancel := context.WithCancel(context.Background())

	ps := &PersistentSession{
		pty:      pty,
		clients:  make(map[*websocket.Conn]bool),
		ctx:      ctx,
		cancel:   cancel,
		shellCmd: shellCmd,
	}

	go ps.ptyReader()
	log.Printf("persistent session created with shell: %s", shellCmd)

	return ps, nil
}

func (ps *PersistentSession) ptyReader() {
	buf := make([]byte, 4096)
	for {
		select {
		case <-ps.ctx.Done():
			return
		default:
		}

		n, err := ps.pty.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Printf("pty read error: %v", err)
			}
			break
		}
		if n == 0 {
			continue
		}

		ps.clientMutex.Lock()
		for conn := range ps.clients {
			if err := conn.Write(ps.ctx, websocket.MessageBinary, buf[:n]); err != nil {
				log.Printf("ws write error: %v", err)
				delete(ps.clients, conn)
			}
		}
		ps.clientMutex.Unlock()
	}
	ps.broadcastText(`{"type":"shell-exited"}`)
}

func (ps *PersistentSession) broadcastText(msg string) {
	ps.clientMutex.Lock()
	defer ps.clientMutex.Unlock()
	for conn := range ps.clients {
		_ = conn.Write(context.Background(), websocket.MessageText, []byte(msg))
	}
}

func (ps *PersistentSession) AttachClient(conn *websocket.Conn) {
	ps.clientMutex.Lock()
	ps.clients[conn] = true
	ps.clientMutex.Unlock()

	go ps.handleClient(conn)
}

func (ps *PersistentSession) handleClient(conn *websocket.Conn) {
	defer func() {
		ps.clientMutex.Lock()
		delete(ps.clients, conn)
		ps.clientMutex.Unlock()
		conn.CloseNow()
		log.Printf("client disconnected, %d clients remaining", len(ps.clients))
	}()

	for {
		msgType, data, err := conn.Read(ps.ctx)
		if err != nil {
			if *flagDebug {
				log.Printf("client read error: %v", err)
			}
			return
		}

		switch msgType {
		case websocket.MessageBinary:
			if _, err := ps.pty.Write(data); err != nil {
				log.Printf("pty write error: %v", err)
				return
			}
		case websocket.MessageText:
			var msg controlMsg
			if err := json.Unmarshal(data, &msg); err != nil {
				log.Printf("bad control message: %v", err)
				continue
			}
			if msg.Type == "resize" && msg.Cols > 0 && msg.Rows > 0 {
				if err := ps.pty.Resize(msg.Cols, msg.Rows); err != nil {
					log.Printf("resize error: %v", err)
				}
			}
		}
	}
}

func (ps *PersistentSession) Close() {
	ps.clientMutex.Lock()
	for conn := range ps.clients {
		conn.CloseNow()
	}
	ps.clientMutex.Unlock()

	ps.cancel()
	ps.pty.Close()
	log.Printf("persistent session closed")
}
