package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/google/uuid"
	_ "github.com/lib/pq"
	"github.com/redis/go-redis/v9"
)

var ctx = context.Background()
var rdb *redis.Client
var db *sql.DB

// ─── Types ────────────────────────────────────────────────────────────────────

type AssertionDef struct {
	Type     string `json:"type"`
	Selector string `json:"selector,omitempty"`
	Value    string `json:"value,omitempty"`
	Timeout  int    `json:"timeout,omitempty"`
}

type FlowTarget struct {
	TestId   string `json:"testId,omitempty"`
	Selector string `json:"selector,omitempty"`
	Text     string `json:"text,omitempty"`
}

type FlowStep struct {
	Action  string     `json:"action"`
	Target  FlowTarget `json:"target,omitempty"`
	Value   string     `json:"value,omitempty"`
	URL     string     `json:"url,omitempty"`
	Timeout int        `json:"timeout,omitempty"`
}

type Flow struct {
	Name       string        `json:"name"`
	Steps      []FlowStep    `json:"steps"`
	Assertions []AssertionDef `json:"assertions,omitempty"`
}

type AppMetadata struct {
	Framework    string `json:"framework,omitempty"`
	AuthProvider string `json:"authProvider,omitempty"`
}

type VerifyRequest struct {
	Task             string            `json:"task"`
	URL              string            `json:"url"`
	Mode             string            `json:"mode,omitempty"`
	Assertions       []AssertionDef    `json:"assertions,omitempty"`
	Flows            []Flow            `json:"flows,omitempty"`
	Selectors        map[string]string `json:"selectors,omitempty"`
	Metadata         *AppMetadata      `json:"metadata,omitempty"`
	Timeout          int               `json:"timeout,omitempty"`
	Retries          int               `json:"retries,omitempty"`
	ExpectedBehavior []string          `json:"expectedBehavior,omitempty"`
}

// ─── Main ─────────────────────────────────────────────────────────────────────

func main() {
	rdb = redis.NewClient(&redis.Options{Addr: getEnv("REDIS_URL", "localhost:6379")})

	dsn := getEnv("DATABASE_URL", "postgres://user:password@localhost:5432/verifydb?sslmode=disable")
	var err error
	db, err = sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Fatal: DB open failed: %v", err)
	}

	// Retry database ping for up to 15 seconds to allow Postgres to finish starting
	for i := 0; i < 15; i++ {
		err = db.Ping()
		if err == nil {
			break
		}
		log.Printf("Waiting for Postgres to be ready... (%d/15): %v", i+1, err)
		time.Sleep(1 * time.Second)
	}

	if err != nil {
		log.Fatalf("Fatal: DB ping failed: %v", err)
	}

	initDB()
	log.Println("✅ Postgres connected")

	app := fiber.New(fiber.Config{AppName: "Verfix"})
	app.Use(logger.New())
	app.Use(cors.New(cors.Config{AllowOrigins: "*", AllowHeaders: "Origin, Content-Type, Accept"}))

	api := app.Group("/api/v1")

	// Core
	api.Post("/verify", handleVerify)
	api.Get("/executions", handleListExecutions)
	api.Get("/executions/:id", handleGetExecution)

	// Phase 3 — Observability
	api.Get("/metrics", handleMetrics)
	api.Get("/health", handleHealth)
	api.Get("/flaky", handleFlaky)
	api.Delete("/executions/:id", handleDeleteExecution)

	// Artifact serving
	app.Static("/artifacts", "../workers/artifacts")

	apiPort := getEnv("API_PORT", "3611")
	log.Fatal(app.Listen(":" + apiPort))
}

// ─── Core Handlers ────────────────────────────────────────────────────────────

func handleVerify(c *fiber.Ctx) error {
	req := new(VerifyRequest)
	if err := c.BodyParser(req); err != nil {
		return c.Status(400).JSON(fiber.Map{"error": "Invalid request payload: " + err.Error()})
	}
	if req.URL == "" {
		return c.Status(400).JSON(fiber.Map{"error": "url is required"})
	}
	if req.Task == "" {
		req.Task = "Verify " + req.URL
	}
	if req.Mode == "" {
		req.Mode = "strict"
	}
	if len(req.Assertions) == 0 && !hasFlowAssertions(req.Flows) {
		req.Assertions = []AssertionDef{{Type: "page_loaded"}, {Type: "no_console_errors"}}
		for _, b := range req.ExpectedBehavior {
			req.Assertions = append(req.Assertions, AssertionDef{Type: "text_visible", Value: b})
		}
	}

	executionID := "exec_" + uuid.New().String()

	jobData, _ := json.Marshal(map[string]interface{}{
		"id": executionID, "task": req.Task, "url": req.URL, "mode": req.Mode,
		"assertions": req.Assertions, "flows": req.Flows, "selectors": req.Selectors,
		"metadata": req.Metadata, "timeout": ifZero(req.Timeout, 15000), "retries": ifZero(req.Retries, 2),
	})

	if err := rdb.RPush(ctx, "verify_jobs", jobData).Err(); err != nil {
		return c.Status(500).JSON(fiber.Map{"error": "Failed to queue job"})
	}

	if db != nil {
		assertJSON, _ := json.Marshal(req.Assertions)
		_, dbErr := db.Exec(
			`INSERT INTO executions (id, task, url, mode, assertions, status, created_at) VALUES ($1,$2,$3,$4,$5,'queued',$6)`,
			executionID, req.Task, req.URL, req.Mode, string(assertJSON), time.Now(),
		)
		if dbErr != nil {
			log.Printf("DB insert: %v", dbErr)
		}
	}

	return c.JSON(fiber.Map{"executionId": executionID, "status": "queued"})
}

func handleGetExecution(c *fiber.Ctx) error {
	id := c.Params("id")

	// Try Redis first (has latest worker result with assertions, artifacts, logs)
	val, err := rdb.Get(ctx, "exec_result_"+id).Result()
	if err == nil {
		var result map[string]interface{}
		json.Unmarshal([]byte(val), &result)
		// Enrich with DB data if available
		if db != nil {
			syncExecutionFromRedis(id, result)
		}
		return c.JSON(result)
	}

	// Fallback to Postgres
	if db != nil {
		row := db.QueryRow(
			`SELECT id, task, url, mode, status, passed, duration_ms, retry_count, error_message, created_at, completed_at FROM executions WHERE id=$1`, id,
		)
		var e executionRow
		if err := scanExecution(row, &e); err == nil {
			return c.JSON(e.toMap())
		}
	}

	return c.JSON(fiber.Map{"executionId": id, "status": "queued"})
}

func hasFlowAssertions(flows []Flow) bool {
	for _, f := range flows {
		if len(f.Assertions) > 0 {
			return true
		}
	}
	return false
}

func handleListExecutions(c *fiber.Ctx) error {
	// Query params
	statusFilter := c.Query("status", "")
	urlFilter := c.Query("url", "")
	limitStr := c.QueryInt("limit", 50)

	if db == nil {
		return c.JSON(fiber.Map{"executions": []interface{}{}})
	}

	query := `SELECT id, task, url, mode, status, passed, duration_ms, retry_count, created_at, completed_at
              FROM executions WHERE 1=1`
	args := []interface{}{}
	n := 1
	if statusFilter != "" {
		query += " AND status=$" + itoa(n)
		args = append(args, statusFilter)
		n++
	}
	if urlFilter != "" {
		query += " AND url ILIKE $" + itoa(n)
		args = append(args, "%"+urlFilter+"%")
		n++
	}
	query += " ORDER BY created_at DESC LIMIT $" + itoa(n)
	args = append(args, limitStr)

	rows, err := db.Query(query, args...)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

	var executions []map[string]interface{}
	for rows.Next() {
		var e executionRow
		rows.Scan(&e.ID, &e.Task, &e.URL, &e.Mode, &e.Status, &e.Passed, &e.DurationMs, &e.RetryCount, &e.CreatedAt, &e.CompletedAt)
		executions = append(executions, e.toMap())
	}
	if executions == nil {
		executions = []map[string]interface{}{}
	}
	return c.JSON(fiber.Map{"executions": executions, "total": len(executions)})
}

func handleDeleteExecution(c *fiber.Ctx) error {
	id := c.Params("id")
	rdb.Del(ctx, "exec_result_"+id)
	if db != nil {
		db.Exec(`DELETE FROM executions WHERE id=$1`, id)
	}
	return c.JSON(fiber.Map{"deleted": id})
}

// ─── Phase 3: Observability Handlers ─────────────────────────────────────────

func handleMetrics(c *fiber.Ctx) error {
	if db == nil {
		return c.JSON(fiber.Map{"error": "no database"})
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

	var m Metrics

	db.QueryRow(`SELECT COUNT(*) FROM executions`).Scan(&m.TotalExecutions)
	db.QueryRow(`SELECT COUNT(*) FROM executions WHERE passed=true`).Scan(&m.TotalPassed)
	db.QueryRow(`SELECT COUNT(*) FROM executions WHERE passed=false AND status='completed'`).Scan(&m.TotalFailed)
	db.QueryRow(`SELECT COUNT(*) FROM executions WHERE status='running'`).Scan(&m.TotalRunning)
	db.QueryRow(`SELECT COUNT(*) FROM executions WHERE status='queued'`).Scan(&m.TotalQueued)
	db.QueryRow(`SELECT COUNT(*) FROM executions WHERE created_at > NOW() - INTERVAL '24 hours'`).Scan(&m.Last24h)
	db.QueryRow(`SELECT COALESCE(AVG(duration_ms),0) FROM executions WHERE duration_ms IS NOT NULL`).Scan(&m.AvgDurationMs)
	db.QueryRow(`SELECT COALESCE(AVG(retry_count),0) FROM executions`).Scan(&m.AvgRetriesPerRun)
	db.QueryRow(`
		SELECT COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms),0)
		FROM executions WHERE duration_ms IS NOT NULL
	`).Scan(&m.P95DurationMs)

	completed := m.TotalPassed + m.TotalFailed
	if completed > 0 {
		m.PassRate = float64(m.TotalPassed) / float64(completed) * 100
		m.FailRate = float64(m.TotalFailed) / float64(completed) * 100
	}

	// Unstable: flows (task+url) that have both pass and fail results
	db.QueryRow(`
		SELECT COUNT(*) FROM (
			SELECT task, url FROM executions WHERE status IN ('completed','failed')
			GROUP BY task, url
			HAVING COUNT(DISTINCT passed) > 1
		) sub
	`).Scan(&m.UnstableFlowCount)

	// Daily trend (last 7 days)
	trendRows, _ := db.Query(`
		SELECT DATE(created_at) as day,
		       COUNT(*) as total,
		       SUM(CASE WHEN passed=true THEN 1 ELSE 0 END) as passed,
		       COALESCE(AVG(duration_ms),0) as avg_ms
		FROM executions
		WHERE created_at > NOW() - INTERVAL '7 days'
		GROUP BY day ORDER BY day ASC
	`)
	type DayTrend struct {
		Day    string  `json:"day"`
		Total  int     `json:"total"`
		Passed int     `json:"passed"`
		AvgMs  float64 `json:"avg_ms"`
	}
	var trend []DayTrend
	if trendRows != nil {
		defer trendRows.Close()
		for trendRows.Next() {
			var d DayTrend
			trendRows.Scan(&d.Day, &d.Total, &d.Passed, &d.AvgMs)
			trend = append(trend, d)
		}
	}
	if trend == nil {
		trend = []DayTrend{}
	}

	// Top failing URLs
	failRows, _ := db.Query(`
		SELECT url, COUNT(*) as failures
		FROM executions WHERE passed=false AND status IN ('completed','failed')
		GROUP BY url ORDER BY failures DESC LIMIT 10
	`)
	type URLFailure struct {
		URL      string `json:"url"`
		Failures int    `json:"failures"`
	}
	var topFailing []URLFailure
	if failRows != nil {
		defer failRows.Close()
		for failRows.Next() {
			var f URLFailure
			failRows.Scan(&f.URL, &f.Failures)
			topFailing = append(topFailing, f)
		}
	}
	if topFailing == nil {
		topFailing = []URLFailure{}
	}

	return c.JSON(fiber.Map{
		"metrics":     m,
		"daily_trend": trend,
		"top_failing": topFailing,
	})
}

func handleHealth(c *fiber.Ctx) error {
	// Check Redis
	redisOk := rdb.Ping(ctx).Err() == nil

	// Check Postgres
	dbOk := db != nil && db.Ping() == nil

	// Queue depth
	var queueDepth int64
	queueDepth, _ = rdb.LLen(ctx, "verify_jobs").Result()

	// Active workers (check BullMQ active key)
	activeWorkers, _ := rdb.SCard(ctx, "bull:verify-jobs:active").Result()

	status := "healthy"
	statusCode := 200
	if !redisOk || !dbOk {
		status = "degraded"
		statusCode = 503
	}

	return c.Status(statusCode).JSON(fiber.Map{
		"status":          status,
		"redis":           boolStatus(redisOk),
		"database":        boolStatus(dbOk),
		"queue_depth":     queueDepth,
		"active_workers":  activeWorkers,
		"timestamp":       time.Now(),
	})
}

func handleFlaky(c *fiber.Ctx) error {
	if db == nil {
		return c.JSON(fiber.Map{"flaky": []interface{}{}, "failed_execution_ids": []interface{}{}})
	}

	// Flakiness is scoped to a FLOW, not a bare URL.
	//
	// A flow is the (task, url) pair — the same verification instructions run
	// against the same target.  Two different tasks on the same URL are
	// independent flows with independent stability profiles.
	//
	// A flow is truly "unstable" only when:
	//   1. The same (task, url) has both passing AND failing runs, AND
	//   2. Its failures show diverse error signatures (more than one distinct
	//      error_message among the failed runs).
	//
	// If every failure for a flow has the exact same error_message, it is a
	// deterministic failure (e.g. server always returning ERR_CONNECTION_REFUSED)
	// and should NOT be labeled unstable.
	//
	// NULL error_message (assertion-only failures without a crash) is normalized
	// to a sentinel so it compares distinctly against crash error strings.
	rows, err := db.Query(`
		WITH mixed_flows AS (
			SELECT task, url
			FROM executions
			WHERE status IN ('completed', 'failed')
			GROUP BY task, url
			HAVING COUNT(DISTINCT passed) > 1 AND COUNT(*) >= 2
		),
		unstable_flows AS (
			SELECT task, url
			FROM executions
			WHERE status IN ('completed', 'failed')
			  AND passed = false
			  AND (task, url) IN (SELECT task, url FROM mixed_flows)
			GROUP BY task, url
			HAVING COUNT(DISTINCT COALESCE(error_message, '__assertion_failure__')) > 1
		)
		SELECT e.task,
		       e.url,
		       COUNT(*) as total_runs,
		       SUM(CASE WHEN e.passed=true THEN 1 ELSE 0 END) as pass_count,
		       SUM(CASE WHEN e.passed=false THEN 1 ELSE 0 END) as fail_count,
		       COALESCE(AVG(e.duration_ms),0) as avg_duration_ms,
		       MAX(e.created_at) as last_run
		FROM executions e
		WHERE e.status IN ('completed', 'failed')
		  AND (e.task, e.url) IN (SELECT task, url FROM unstable_flows)
		GROUP BY e.task, e.url
		ORDER BY fail_count DESC
		LIMIT 20
	`)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}
	defer rows.Close()

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

	var results []FlakyFlow
	for rows.Next() {
		var f FlakyFlow
		rows.Scan(&f.Task, &f.URL, &f.TotalRuns, &f.PassCount, &f.FailCount, &f.AvgDuration, &f.LastRun)
		f.FlakeRate = float64(f.FailCount) / float64(f.TotalRuns) * 100
		results = append(results, f)
	}
	if results == nil {
		results = []FlakyFlow{}
	}

	// Return the specific execution IDs that failed for truly-unstable flows
	// so the frontend can tag individual executions.
	var failedIDs []string
	idRows, err := db.Query(`
		WITH mixed_flows AS (
			SELECT task, url
			FROM executions
			WHERE status IN ('completed', 'failed')
			GROUP BY task, url
			HAVING COUNT(DISTINCT passed) > 1 AND COUNT(*) >= 2
		),
		unstable_flows AS (
			SELECT task, url
			FROM executions
			WHERE status IN ('completed', 'failed')
			  AND passed = false
			  AND (task, url) IN (SELECT task, url FROM mixed_flows)
			GROUP BY task, url
			HAVING COUNT(DISTINCT COALESCE(error_message, '__assertion_failure__')) > 1
		)
		SELECT DISTINCT id
		FROM executions
		WHERE status IN ('completed', 'failed')
		  AND passed = false
		  AND (task, url) IN (SELECT task, url FROM unstable_flows)
	`)
	if err == nil {
		defer idRows.Close()
		for idRows.Next() {
			var id string
			idRows.Scan(&id)
			failedIDs = append(failedIDs, id)
		}
	}
	if failedIDs == nil {
		failedIDs = []string{}
	}

	return c.JSON(fiber.Map{"flaky": results, "total": len(results), "failed_execution_ids": failedIDs})
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

func initDB() {
	schema := `
	CREATE TABLE IF NOT EXISTS executions (
		id TEXT PRIMARY KEY,
		task TEXT NOT NULL,
		url TEXT NOT NULL,
		mode TEXT DEFAULT 'strict',
		assertions JSONB,
		status TEXT NOT NULL DEFAULT 'queued',
		passed BOOLEAN,
		duration_ms INTEGER,
		retry_count INTEGER DEFAULT 0,
		error_message TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW(),
		completed_at TIMESTAMPTZ
	);
	CREATE INDEX IF NOT EXISTS idx_executions_status ON executions(status);
	CREATE INDEX IF NOT EXISTS idx_executions_url ON executions(url);
	CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at DESC);
	CREATE INDEX IF NOT EXISTS idx_executions_url_status_passed ON executions(url, status, passed);

	CREATE TABLE IF NOT EXISTS assertion_results (
		id SERIAL PRIMARY KEY,
		execution_id TEXT REFERENCES executions(id) ON DELETE CASCADE,
		assertion_type TEXT NOT NULL,
		passed BOOLEAN NOT NULL,
		duration_ms INTEGER,
		details JSONB,
		screenshot_path TEXT,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);

	CREATE TABLE IF NOT EXISTS artifacts (
		id SERIAL PRIMARY KEY,
		execution_id TEXT REFERENCES executions(id) ON DELETE CASCADE,
		type TEXT NOT NULL,
		path TEXT NOT NULL,
		size_bytes INTEGER,
		created_at TIMESTAMPTZ DEFAULT NOW()
	);
	`
	if _, err := db.Exec(schema); err != nil {
		log.Printf("Schema init warning: %v", err)
	}
}

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
}

func scanExecution(row *sql.Row, e *executionRow) error {
	return row.Scan(&e.ID, &e.Task, &e.URL, &e.Mode, &e.Status, &e.Passed, &e.DurationMs, &e.RetryCount, &e.ErrorMsg, &e.CreatedAt, &e.CompletedAt)
}

func (e *executionRow) toMap() map[string]interface{} {
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

// Sync completed execution result from Redis → Postgres
func syncExecutionFromRedis(id string, result map[string]interface{}) {
	if db == nil {
		return
	}
	status, _ := result["status"].(string)
	if status != "completed" && status != "failed" {
		return
	}
	passed, _ := result["passed"].(bool)
	durationMs, _ := result["duration_ms"].(float64)
	errMsg, _ := result["error"].(string)

	db.Exec(`
		UPDATE executions
		SET status=$1, passed=$2, duration_ms=$3, error_message=$4, completed_at=$5
		WHERE id=$6 AND (status='queued' OR status='running')
	`, status, passed, int(durationMs), nullStr(errMsg), time.Now(), id)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func ifZero(v, fallback int) int {
	if v == 0 {
		return fallback
	}
	return v
}

func boolStatus(ok bool) string {
	if ok {
		return "ok"
	}
	return "down"
}

func nullStr(s string) interface{} {
	if s == "" {
		return nil
	}
	return s
}

func itoa(n int) string {
	return string(rune('0' + n))
}
