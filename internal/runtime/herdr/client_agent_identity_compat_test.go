package herdr

import (
	"encoding/json"
	"testing"
)

func TestAgentInfoIdentityAcrossHerdrVersions(t *testing.T) {
	cases := []struct {
		name      string
		input     string
		want      string
		wantState string
	}{
		{"modern_0_9_3", `{"agent":"agy","name":"agy-orchestrator-bg-wisp-z7c0i6","agent_status":"working","pane_id":"w37:p1"}`, "agy-orchestrator-bg-wisp-z7c0i6", "working"},
		{"legacy_0_7_3", `{"agent":"gastown__worker","agent_status":"idle","pane_id":"w1:p1"}`, "gastown__worker", "idle"},
		{"modern_no_kind", `{"name":"new-session","agent_status":"done"}`, "new-session", "done"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			var got agentInfo
			if err := json.Unmarshal([]byte(tc.input), &got); err != nil {
				t.Fatal(err)
			}
			if got.Name != tc.want || got.AgentStatus != tc.wantState {
				t.Fatalf("got name=%q status=%q, want %q %q", got.Name, got.AgentStatus, tc.want, tc.wantState)
			}
		})
	}
}
