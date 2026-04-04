package internal

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"
)

// ── itoa ─────────────────────────────────────────────────────────────────────

func TestItoa(t *testing.T) {
	cases := []struct {
		in   int
		want string
	}{
		{0, "0"},
		{1, "1"},
		{1994, "1994"},
		{-1, "-1"},
	}
	for _, c := range cases {
		got := itoa(c.in)
		if got != c.want {
			t.Errorf("itoa(%d) = %q, want %q", c.in, got, c.want)
		}
		// Cross-check with stdlib.
		if got != strconv.Itoa(c.in) {
			t.Errorf("itoa(%d) diverges from strconv.Itoa", c.in)
		}
	}
}

// ── tick: RoleLeader ──────────────────────────────────────────────────────────

func TestElectionTick_LeaderDoesNothing(t *testing.T) {
	port := freePort(t)
	n := NewNode(port)

	if err := n.BecomeLeader(); err != nil {
		t.Fatalf("BecomeLeader: %v", err)
	}
	t.Cleanup(n.Stop)

	e := NewElection(port, n)
	if err := e.tick(context.Background()); err != nil {
		t.Errorf("tick for LEADER: %v", err)
	}
	// Role should remain LEADER.
	if n.Role() != RoleLeader {
		t.Errorf("role = %v after tick, want LEADER", n.Role())
	}
}

// ── tick: RoleFollower — healthy leader ───────────────────────────────────────

func TestElectionTick_FollowerHealthyLeader(t *testing.T) {
	// Fake leader server that responds to /ping.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	t.Cleanup(srv.Close)

	// Extract port from the test server listener.
	tcpAddr, ok := srv.Listener.Addr().(*net.TCPAddr)
	if !ok {
		t.Fatalf("unexpected addr type: %T", srv.Listener.Addr())
	}
	testPort := tcpAddr.Port

	n := NewNode(testPort)
	n.BecomeFollower()

	e := NewElection(testPort, n)
	if err := e.tick(context.Background()); err != nil {
		t.Errorf("tick: %v", err)
	}
	// Leader is healthy → node stays FOLLOWER.
	if n.Role() != RoleFollower {
		t.Errorf("role = %v, want FOLLOWER", n.Role())
	}
}

// ── tick: RoleFollower — dead leader → takeover ───────────────────────────────

func TestElectionTick_FollowerDeadLeader_TakesOver(t *testing.T) {
	port := freePort(t)

	n := NewNode(port)
	n.BecomeFollower()
	t.Cleanup(n.Stop)

	e := NewElection(port, n)
	if err := e.tick(context.Background()); err != nil {
		t.Errorf("tick: %v", err)
	}
	// No leader on port → node should try BecomeLeader.
	// Give it a moment for the goroutine to finish (tick is synchronous, so immediate).
	if n.Role() != RoleLeader {
		t.Errorf("role = %v, want LEADER after dead-leader takeover", n.Role())
	}
}

// ── tick: RoleUnknown → determineRole ────────────────────────────────────────

func TestElectionTick_UnknownBecomesLeader(t *testing.T) {
	port := freePort(t)
	n := NewNode(port)
	// Role stays UNKNOWN — no BecomeLeader/BecomeFollower called.
	t.Cleanup(n.Stop)

	e := NewElection(port, n)
	if err := e.tick(context.Background()); err != nil {
		t.Errorf("tick: %v", err)
	}
	// Port is free → determineRole should elect us as LEADER.
	if n.Role() != RoleLeader {
		t.Errorf("role = %v, want LEADER", n.Role())
	}
}

// ── Start / Stop ──────────────────────────────────────────────────────────────

func TestElectionStart_Stop(t *testing.T) {
	port := freePort(t)
	n := NewNode(port)
	t.Cleanup(n.Stop)

	e := NewElection(port, n)
	ctx := context.Background()

	if err := e.Start(ctx); err != nil {
		t.Fatalf("Start: %v", err)
	}

	// After Start the node should have a role (leader or follower).
	time.Sleep(50 * time.Millisecond)
	if n.Role() == RoleUnknown {
		t.Error("expected node to have a role after election Start")
	}

	e.Stop() // must not panic
}
