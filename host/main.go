package main

import (
	"context"
	"flag"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strings"
	"sync"
	"syscall"

	"github.com/coder/websocket"
)

var (
	sessions     = make(map[string]*TabSession)
	sessionMutex sync.Mutex
)

func getOrCreateSession(id, shellCmd string) (*TabSession, error) {
	sessionMutex.Lock()
	defer sessionMutex.Unlock()

	if ts, ok := sessions[id]; ok {
		return ts, nil
	}

	ts, err := newTabSession(id, shellCmd)
	if err != nil {
		return nil, err
	}
	sessions[id] = ts
	return ts, nil
}

func removeSession(id string) {
	sessionMutex.Lock()
	delete(sessions, id)
	sessionMutex.Unlock()
	log.Printf("session %s removed", id)
}

func main() {
	flag.Parse()

	shellCmd, err := resolveShell()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	log.Printf("claudechrome-host starting: shell=%q addr=%s", *flagShell, *flagAddr)

	mux := http.NewServeMux()
	mux.HandleFunc("/terminal", func(w http.ResponseWriter, r *http.Request) {
		origin := r.Header.Get("Origin")
		if *flagDebug {
			log.Printf("connection attempt: origin=%q user-agent=%q", origin, r.Header.Get("User-Agent"))
		}
		if origin != "" && !strings.HasPrefix(origin, "chrome-extension://") {
			if *flagDebug {
				log.Printf("rejected origin: %q", origin)
			}
			http.Error(w, "forbidden origin", http.StatusForbidden)
			return
		}

		sessionID := r.URL.Query().Get("session")
		if sessionID == "" {
			http.Error(w, "missing session id", http.StatusBadRequest)
			return
		}

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			log.Printf("ws accept error: %v", err)
			return
		}

		ts, err := getOrCreateSession(sessionID, shellCmd)
		if err != nil {
			log.Printf("session create error: %v", err)
			conn.CloseNow()
			return
		}

		ts.AttachClient(conn)

		if *flagDebug {
			log.Printf("client attached: session=%s origin=%s", sessionID, origin)
		}
	})

	mux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte("ok"))
	})

	listener, err := net.Listen("tcp", *flagAddr)
	if err != nil {
		log.Fatalf("listen error: %v", err)
	}
	log.Printf("listening on ws://%s/terminal", *flagAddr)

	server := &http.Server{Handler: mux}

	sigCh := make(chan os.Signal, 1)
	signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	go func() {
		<-sigCh
		log.Println("shutting down...")
		sessionMutex.Lock()
		for _, ts := range sessions {
			ts.Close()
		}
		sessionMutex.Unlock()
		server.Shutdown(context.Background())
	}()

	if err := server.Serve(listener); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
