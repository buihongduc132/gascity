package main

import (
	"github.com/gastownhall/gascity/internal/api"
	"testing"
)

func TestStatusForceLocalBypassesCachedSupervisorWithoutRestart(t *testing.T) {
	prior := cityStatusAPIClient
	t.Cleanup(func() { cityStatusAPIClient = prior })
	cached := &api.Client{}
	cityStatusAPIClient = func(_ string) (*api.Client, string) { return cached, "" }
	t.Setenv("GC_STATUS_FORCE_LOCAL", "1")
	result, reason := selectedStatusAPIClient("/city")
	if result != nil || reason != "local-liveness-override" {
		t.Fatalf("override still returned stale supervisor: client=%p reason=%s", result, reason)
	}
	t.Setenv("GC_STATUS_FORCE_LOCAL", "0")
	result, reason = selectedStatusAPIClient("/city")
	if result != cached || reason != "" {
		t.Fatalf("ordinary API path changed: client=%p reason=%s", result, reason)
	}
}
