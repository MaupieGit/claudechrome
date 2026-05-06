package main

import (
	"context"
	"encoding/json"
	"io"
	"log"

	"github.com/UserExistsError/conpty"
	"github.com/coder/websocket"
)

type Session struct {
	ws  *websocket.Conn
	pty *conpty.ConPty
}

type controlMsg struct {
	Type string `json:"type"`
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
}

func (s *Session) Run(ctx context.Context) {
	ctx, cancel := context.WithCancel(ctx)
	defer cancel()
	defer s.pty.Close()
	defer s.ws.CloseNow()

	go func() {
		buf := make([]byte, 4096)
		for {
			n, err := s.pty.Read(buf)
			if err != nil {
				if err != io.EOF {
					log.Printf("pty read error: %v", err)
				}
				cancel()
				return
			}
			if n == 0 {
				continue
			}
			if err := s.ws.Write(ctx, websocket.MessageBinary, buf[:n]); err != nil {
				log.Printf("ws write error: %v", err)
				cancel()
				return
			}
		}
	}()

	for {
		msgType, data, err := s.ws.Read(ctx)
		if err != nil {
			log.Printf("ws read closed: %v", err)
			return
		}
		switch msgType {
		case websocket.MessageBinary:
			if _, err := s.pty.Write(data); err != nil {
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
				if err := s.pty.Resize(msg.Cols, msg.Rows); err != nil {
					log.Printf("resize error: %v", err)
				}
			}
		}
	}
}
