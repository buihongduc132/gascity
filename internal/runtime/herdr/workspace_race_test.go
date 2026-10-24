package herdr

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A vanished Herdr workspace is not permission to close the live original
// worker's tab or spin up a second writer.
func TestEnsurePlacementRecoversVanishedWorkspaceWithoutDuplicate(t *testing.T) {
	for _, existingOriginalTab := range []bool{false, true} {
		name := "free replacement workspace"
		if existingOriginalTab {
			name = "occupied original workspace"
		}
		t.Run(name, func(t *testing.T) {
			dir := t.TempDir()
			bin := filepath.Join(dir, "herdr")
			log := filepath.Join(dir, "commands")
			counter := filepath.Join(dir, "lookups")
			existing := "false"
			if existingOriginalTab {
				existing = "true"
			}
			script := `#!/bin/sh
shift 2
printf '%s\n' "$*" >> "` + log + `"
case "$1 $2" in
"workspace list")
  n=0; test -f "` + counter + `" && n=$(cat "` + counter + `")
  n=$((n + 1)); echo "$n" > "` + counter + `"
  if test "$n" -eq 1; then
    echo '{"result":{"workspaces":[{"workspace_id":"w8X","label":"gascity"}]}}'
  else
    echo '{"result":{"workspaces":[{"workspace_id":"w80","label":"gascity"}]}}'
  fi
  ;;
"tab list")
  if test "$3" = "--workspace" && test "$4" = "w80" && test "` + existing + `" = true; then
    echo '{"result":{"tabs":[{"tab_id":"w80:t1","label":"original-agent"}]}}'
  else
    echo '{"result":{"tabs":[]}}'
  fi
  ;;
"tab create")
  if test "$4" = "w8X"; then
    echo '{"error":{"code":"workspace_not_found","message":"workspace w8X disappeared"}}'
  else
    echo '{"result":{"tab":{"tab_id":"w80:t2"},"root_pane":{"pane_id":"w80:t2:p1"}}}'
  fi
  ;;
"tab close") echo '{"result":{}}' ;;
*) echo '{"result":{}}' ;;
esac
`
			if err := os.WriteFile(bin, []byte(script), 0755); err != nil {
				t.Fatal(err)
			}
			c := &client{session: "gascity", bin: bin}
			tab, pane, err := c.ensurePlacement(context.Background(), "gascity", "original-agent", dir, nil)
			data, _ := os.ReadFile(log)
			calls := string(data)
			if strings.Contains(calls, "tab close") {
				t.Fatalf("removed occupied original tab: %s", calls)
			}
			if existingOriginalTab {
				if err == nil || !strings.Contains(err.Error(), "matching original tab") {
					t.Fatalf("must refuse ambiguous original-owner tab instead of duplicate: tab=%q pane=%q err=%v calls=%s", tab, pane, err, calls)
				}
				if strings.Contains(calls, "tab create --workspace w80") {
					t.Fatalf("created competing original tab: %s", calls)
				}
			} else if err != nil || tab != "w80:t2" || pane != "w80:t2:p1" {
				t.Fatalf("expected recovery into re-resolved free workspace: tab=%q pane=%q err=%v calls=%s", tab, pane, err, calls)
			}
		})
	}
}

// The stale workspace can fail at tab list rather than tab create. Both
// failures must trigger the same bounded re-resolution without a tab close.
func TestEnsurePlacementRecoversVanishedWorkspaceOnTabList(t *testing.T) {
	dir := t.TempDir()
	bin := filepath.Join(dir, "herdr")
	log := filepath.Join(dir, "commands")
	counter := filepath.Join(dir, "lookups")
	script := `#!/bin/sh
shift 2
printf '%s\n' "$*" >> "` + log + `"
case "$1 $2" in
"workspace list")
  n=0; test -f "` + counter + `" && n=$(cat "` + counter + `")
  n=$((n + 1)); echo "$n" > "` + counter + `"
  if test "$n" -eq 1; then
    echo '{"result":{"workspaces":[{"workspace_id":"w8X","label":"gascity"}]}}'
  else
    echo '{"result":{"workspaces":[{"workspace_id":"w80","label":"gascity"}]}}'
  fi
  ;;
"tab list")
  if test "$4" = "w8X"; then
    echo '{"error":{"code":"workspace_not_found","message":"workspace w8X disappeared"}}'
  else
    echo '{"result":{"tabs":[]}}'
  fi
  ;;
"tab create")
  echo '{"result":{"tab":{"tab_id":"w80:t2"},"root_pane":{"pane_id":"w80:t2:p1"}}}'
  ;;
"tab close") echo '{"result":{}}' ;;
*) echo '{"result":{}}' ;;
esac
`
	if err := os.WriteFile(bin, []byte(script), 0755); err != nil {
		t.Fatal(err)
	}
	c := &client{session: "gascity", bin: bin}
	tab, pane, err := c.ensurePlacement(context.Background(), "gascity", "original-agent", dir, nil)
	data, _ := os.ReadFile(log)
	calls := string(data)
	if err != nil || tab != "w80:t2" || pane != "w80:t2:p1" {
		t.Fatalf("stale tab-list workspace must re-resolve once: tab=%q pane=%q err=%v calls=%s", tab, pane, err, calls)
	}
	if strings.Contains(calls, "tab close") || strings.Contains(calls, "tab create --workspace w8X") {
		t.Fatalf("workspace recovery must not close or create into stale workspace: %s", calls)
	}
}
