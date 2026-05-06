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
	globalSession *PersistentSession
	sessionMutex  sync.Mutex
)

func main() {
	flag.Parse()

	shellCmd, err := resolveShell()
	if err != nil {
		log.Fatalf("config error: %v", err)
	}
	log.Printf("claudechrome-host starting: shell=%q addr=%s", *flagShell, *flagAddr)

	// Create the persistent session
	globalSession, err = NewPersistentSession(shellCmd)
	if err != nil {
		log.Fatalf("failed to create session: %v", err)
	}
	defer globalSession.Close()

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

		conn, err := websocket.Accept(w, r, &websocket.AcceptOptions{
			InsecureSkipVerify: true,
		})
		if err != nil {
			log.Printf("ws accept error: %v", err)
			return
		}

		// Attach the WebSocket to the persistent session
		sessionMutex.Lock()
		globalSession.AttachClient(conn)
		sessionMutex.Unlock()

		if *flagDebug {
			log.Printf("client connected: origin=%s shell=%s", origin, *flagShell)
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
		server.Shutdown(context.Background())
	}()

	if err := server.Serve(listener); err != http.ErrServerClosed {
		log.Fatalf("server error: %v", err)
	}
}
