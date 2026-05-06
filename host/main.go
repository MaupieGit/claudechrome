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
	"syscall"

	"github.com/UserExistsError/conpty"
	"github.com/coder/websocket"
)

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
		if !strings.HasPrefix(origin, "chrome-extension://") {
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

		pty, err := conpty.Start(shellCmd,
			conpty.ConPtyDimensions(80, 24),
			conpty.ConPtyWorkDir(workDir()),
		)
		if err != nil {
			log.Printf("conpty start error: %v", err)
			conn.Close(websocket.StatusInternalError, "failed to start shell")
			return
		}

		session := &Session{ws: conn, pty: pty}
		go session.Run(context.Background())
		if *flagDebug {
			log.Printf("session started: origin=%s shell=%s", origin, *flagShell)
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
