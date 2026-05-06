package main

import (
	"flag"
	"fmt"
	"os"
)

type ShellDef struct {
	Exe  string
	Args []string
}

var knownShells = map[string]ShellDef{
	"powershell": {Exe: "powershell.exe", Args: []string{"-NoLogo"}},
	"pwsh":       {Exe: "pwsh.exe", Args: []string{"-NoLogo"}},
	"cmd":        {Exe: "cmd.exe", Args: []string{}},
	"bash":       {Exe: "bash.exe", Args: []string{"--login", "-i"}},
}

var (
	flagShell = flag.String("shell", "powershell", "Shell to use: powershell | pwsh | cmd | bash")
	flagAddr  = flag.String("addr", "127.0.0.1:7681", "WebSocket listen address")
	flagDebug = flag.Bool("debug", false, "Enable debug logging")
)

func resolveShell() (string, error) {
	def, ok := knownShells[*flagShell]
	if !ok {
		return "", fmt.Errorf("unknown shell %q; valid choices: powershell, pwsh, cmd, bash", *flagShell)
	}
	cmd := def.Exe
	for _, a := range def.Args {
		cmd += " " + a
	}
	return cmd, nil
}

func workDir() string {
	if h, err := os.UserHomeDir(); err == nil {
		return h
	}
	return "C:\\"
}
