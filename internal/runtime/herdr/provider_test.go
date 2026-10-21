package herdr

import (
	"context"
	"os"
	"path/filepath"
	goruntime "runtime"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/runtime"
)

func TestStart_AdoptsExistingLiveProcessOnAgentPaneBusy(t *testing.T) {
	if goruntime.GOOS == "windows" {
		t.Skip("fake herdr CLI is a POSIX shell script")
	}
	dir := t.TempDir()
	metaDir := t.TempDir()
	bin := filepath.Join(dir, "herdr")
	startCountFile := filepath.Join(dir, "start.count")

	script := `#!/bin/sh
shift 2 # drop --session <name>
case "$1 $2" in
"agent get")
  printf '{"error":{"code":"agent_not_found","message":"agent target not found"}}' ;;
"agent list")
  printf '{"result":{"agents":[]}}' ;;
"workspace list")
  printf '{"result":{"workspaces":[]}}' ;;
"workspace create")
  printf '{"result":{"workspace":{"workspace_id":"w2P"},"tab":{"tab_id":"t1"},"root_pane":{"pane_id":"w2P:p1"}}}' ;;
"pane process-info")
  if [ -e '` + startCountFile + `' ]; then
    printf '{"result":{"process_info":{"shell_pid":4242,"foreground_processes":[{"pid":4243,"name":"claude"}]}}}'
  else
    printf '{"result":{"process_info":{"shell_pid":4242,"foreground_processes":[{"pid":4242,"name":"zsh"}]}}}'
  fi ;;
"agent start")
  : > '` + startCountFile + `'
  printf '{"error":{"code":"agent_pane_busy","message":"agent target pane w2P:p1 is not an available shell"}}' ;;
*)
  printf '{"result":{}}' ;;
esac
`
	if err := os.WriteFile(bin, []byte(script), 0o755); err != nil {
		t.Fatalf("write fake herdr: %v", err)
	}

	p := New("test-pane-busy-adopt", metaDir, dir, time.Second, time.Second)
	p.c.bin = bin
	listenHerdrSocket(t, p)

	cfg := runtime.Config{
		WorkDir: dir,
		Command: "claude",
	}
	if err := p.Start(context.Background(), "gastown__witness", cfg); err != nil {
		t.Fatalf("Start() error = %v; want nil when adopting live process on agent_pane_busy", err)
	}
	if got, _ := p.GetMeta("gastown__witness", metaBoundPane); got != "w2P:p1" {
		t.Fatalf("GC_HERDR_PANE_ID = %q; want %q", got, "w2P:p1")
	}
}
