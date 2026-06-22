package main

import (
	"database/sql"
	"encoding/json"
	"time"
)

// ─── Shared types (driver-agnostic) ───────────────────────────────────────────

type executionRow struct {
	ID          string
	Task        string
	URL         string
	Mode        string
	Status      string
	Passed      sql.NullBool
	DurationMs  sql.NullInt64
	RetryCount  int
	ErrorMsg    sql.NullString
	CreatedAt   time.Time
	CompletedAt sql.NullTime
	Payload     sql.NullString
}

type Metrics struct {
	TotalExecutions   int     `json:"total_executions"`
	PassRate          float64 `json:"pass_rate"`
	FailRate          float64 `json:"fail_rate"`
	AvgDurationMs     float64 `json:"avg_duration_ms"`
	P95DurationMs     float64 `json:"p95_duration_ms"`
	TotalPassed       int     `json:"total_passed"`
	TotalFailed       int     `json:"total_failed"`
	TotalRunning      int     `json:"total_running"`
	TotalQueued       int     `json:"total_queued"`
	Last24h           int     `json:"executions_last_24h"`
	AvgRetriesPerRun  float64 `json:"avg_retries_per_run"`
	UnstableFlowCount int     `json:"unstable_flow_count"`
}

type DayTrend struct {
	Day    string  `json:"day"`
	Total  int     `json:"total"`
	Passed int     `json:"passed"`
	AvgMs  float64 `json:"avg_ms"`
}

type URLFailure struct {
	URL      string `json:"url"`
	Failures int    `json:"failures"`
}

type FlakyFlow struct {
	Task        string    `json:"task"`
	URL         string    `json:"url"`
	TotalRuns   int       `json:"total_runs"`
	PassCount   int       `json:"pass_count"`
	FailCount   int       `json:"fail_count"`
	FlakeRate   float64   `json:"flake_rate"`
	AvgDuration float64   `json:"avg_duration_ms"`
	LastRun     time.Time `json:"last_run"`
}

// ─── Store interface ──────────────────────────────────────────────────────────

type Store interface {
	Ping() error
	Init() error
	CreateExecution(id, task, url, mode, assertionsJSON string, createdAt time.Time) error
	GetExecution(id string) (executionRow, error)
	ListExecutions(statusFilter, urlFilter string, limit int) ([]executionRow, error)
	DeleteExecution(id string) error
	SyncExecution(id, status string, passed bool, durationMs int, errMsg string, payloadJSON []byte) error
	GetStats() (Metrics, []DayTrend, []URLFailure, error)
	GetFlakyFlows() ([]FlakyFlow, []string, error)
}

// ─── Shared scan helpers ──────────────────────────────────────────────────────

func scanExecutionRow(row *sql.Row, e *executionRow) error {
	return row.Scan(&e.ID, &e.Task, &e.URL, &e.Mode, &e.Status, &e.Passed, &e.DurationMs, &e.RetryCount, &e.ErrorMsg, &e.CreatedAt, &e.CompletedAt, &e.Payload)
}

func scanListExecution(rows *sql.Rows, e *executionRow) error {
	return rows.Scan(&e.ID, &e.Task, &e.URL, &e.Mode, &e.Status, &e.Passed, &e.DurationMs, &e.RetryCount, &e.CreatedAt, &e.CompletedAt)
}

func (e *executionRow) toMap() map[string]interface{} {
	if e.Payload.Valid && e.Payload.String != "" {
		var result map[string]interface{}
		if err := json.Unmarshal([]byte(e.Payload.String), &result); err == nil {
			result["executionId"] = e.ID
			return result
		}
	}
	m := map[string]interface{}{
		"executionId": e.ID, "task": e.Task, "url": e.URL, "mode": e.Mode,
		"status": e.Status, "passed": e.Passed.Bool, "duration_ms": e.DurationMs.Int64,
		"retry_count": e.RetryCount, "created_at": e.CreatedAt,
	}
	if e.ErrorMsg.Valid {
		m["error"] = e.ErrorMsg.String
	}
	if e.CompletedAt.Valid {
		m["completed_at"] = e.CompletedAt.Time
	}
	return m
}
