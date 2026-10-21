package main

import (
	"errors"
	"testing"
	"time"

	"github.com/gastownhall/gascity/internal/runtime"
)

type statusActivityFailureProvider struct {
	runtime.Provider
	metadataCalls int
	activityCalls int
}

func (p *statusActivityFailureProvider) ObserveLivenessWithError(_ string, _ []string) (runtime.Liveness, error) {
	return runtime.Liveness{Running: true, Alive: true}, nil
}
func (p *statusActivityFailureProvider) GetMeta(_, _ string) (string, error) {
	p.metadataCalls++
	return "", errors.New("metadata backend unavailable")
}
func (p *statusActivityFailureProvider) GetLastActivity(_ string) (time.Time, error) {
	p.activityCalls++
	return time.Time{}, errors.New("activity backend unavailable")
}

func TestStatusLivenessDoesNotRequireHerdrActivityMetadata(t *testing.T) {
	provider := &statusActivityFailureProvider{Provider: runtime.NewFake()}
	got, err := statusObserveRuntimeLivenessOnly("", nil, provider, nil, "agy-orchestrator-bg-wisp-z7c0i6")
	if err != nil || !got.Running || !got.Alive {
		t.Fatalf("status liveness=%+v err=%v, want running", got, err)
	}
	if provider.metadataCalls != 0 || provider.activityCalls != 0 {
		t.Fatalf("unnecessary metadata=%d activity=%d calls", provider.metadataCalls, provider.activityCalls)
	}
}
