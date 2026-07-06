package main

import (
	"context"
	"encoding/json"
	"log"
	"os"
	"time"

	"github.com/gofiber/fiber/v2"
	"github.com/gofiber/fiber/v2/middleware/cors"
	"github.com/gofiber/fiber/v2/middleware/logger"
	"github.com/google/uuid"
	"github.com/redis/go-redis/v9"
)

var ctx = context.Background()
var rdb *redis.Client
var store Store

// ─── Types ────────────────────────────────────────────────────────────────────

type AssertionDef struct {
	Type           string   `json:"type"`
	Selector       string   `json:"selector,omitempty"`
	Value          string   `json:"value,omitempty"`
	Timeout        int      `json:"timeout,omitempty"`
	AcceptStatuses []int    `json:"acceptStatuses,omitempty"`
	Exclude        []string `json:"exclude,omitempty"`
}

type FlowTarget struct {
	TestId   string `json:"testId,omitempty"`
	Selector string `json:"selector,omitempty"`
	Text     string `json:"text,omitempty"`
}

type FlowStep struct {
	Action   string     `json:"action"`
	Target   FlowTarget `json:"target,omitempty"`
	Value    string     `json:"value,omitempty"`
	URL      string     `json:"url,omitempty"`
	Timeout  int        `json:"timeout,omitempty"`
	Optional bool       `json:"optional,omitempty"`
}

type Flow struct {
	Name       string         `json:"name"`
	Mode       string         `json:"mode,omitempty"`
	Steps      []FlowStep     `json:"steps"`
	Assertions []AssertionDef `json:"assertions,omitempty"`
	ClearState bool           `json:"clearState,omitempty"`
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

	store = NewStore()

	// Retry database ping for up to 15 seconds to allow the database to finish starting.
	// For SQLite this loop typically succeeds on the first try (embedded, no server).
	for i := 0; i < 15; i++ {
		err := store.Ping()
		if err == nil {
			break
		}
		log.Printf("Waiting for database to be ready... (%d/15): %v", i+1, err)
		time.Sleep(1 * time.Second)
	}

	// NOTE: Go's database/sql package maintains an internal connection pool and
	// automatically handles transient reconnects under the hood if the database goes down
	// and comes back up during runtime.
	// TODO: For a higher-availability production setup, consider adding an explicit
	// application-level health monitoring/alerting loop or direct crash-restart triggers.
	store.Init()
	log.Println("✅ Database connected")

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

	assertJSON, _ := json.Marshal(req.Assertions)
	if err := store.CreateExecution(executionID, req.Task, req.URL, req.Mode, string(assertJSON), time.Now()); err != nil {
		log.Printf("DB insert: %v", err)
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
		syncExecutionFromRedis(id, result)
		return c.JSON(result)
	}

	// Fallback to database
	if e, err := store.GetExecution(id); err == nil {
		return c.JSON(e.toMap())
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

	executions, err := store.ListExecutions(statusFilter, urlFilter, limitStr)
	if err != nil {
		return c.Status(500).JSON(fiber.Map{"error": err.Error()})
	}

	var result []map[string]interface{}
	for _, e := range executions {
		result = append(result, e.toMap())
	}
	if result == nil {
		result = []map[string]interface{}{}
	}
	return c.JSON(fiber.Map{"executions": result, "total": len(result)})
}

func handleDeleteExecution(c *fiber.Ctx) error {
	id := c.Params("id")
	rdb.Del(ctx, "exec_result_"+id)
	store.DeleteExecution(id)
	return c.JSON(fiber.Map{"deleted": id})
}

// ─── Phase 3: Observability Handlers ─────────────────────────────────────────

func handleMetrics(c *fiber.Ctx) error {
	m, trend, topFailing, err := store.GetStats()
	if err != nil {
		return c.JSON(fiber.Map{"error": "no database"})
	}

	if trend == nil {
		trend = []DayTrend{}
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

	// Check database
	dbOk := store.Ping() == nil

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
		"status":         status,
		"redis":          boolStatus(redisOk),
		"database":       boolStatus(dbOk),
		"queue_depth":    queueDepth,
		"active_workers": activeWorkers,
		"timestamp":      time.Now(),
	})
}

func handleFlaky(c *fiber.Ctx) error {
	results, failedIDs, err := store.GetFlakyFlows()
	if err != nil {
		return c.JSON(fiber.Map{"flaky": []interface{}{}, "failed_execution_ids": []interface{}{}})
	}

	// Compute flake rate per flow (kept here — driver-agnostic).
	for i := range results {
		if results[i].TotalRuns > 0 {
			results[i].FlakeRate = float64(results[i].FailCount) / float64(results[i].TotalRuns) * 100
		}
	}

	if results == nil {
		results = []FlakyFlow{}
	}
	if failedIDs == nil {
		failedIDs = []string{}
	}

	return c.JSON(fiber.Map{"flaky": results, "total": len(results), "failed_execution_ids": failedIDs})
}

// Sync completed execution result from Redis → database.
// Driver-agnostic: extracts the result fields and delegates to the store.
func syncExecutionFromRedis(id string, result map[string]interface{}) {
	status, _ := result["status"].(string)
	if status != "completed" && status != "failed" {
		return
	}
	passed, _ := result["passed"].(bool)
	durationMs, _ := result["duration_ms"].(float64)
	errMsg, _ := result["error"].(string)

	payloadJSON, err := json.Marshal(result)
	if err != nil {
		payloadJSON = nil
	}

	store.SyncExecution(id, status, passed, int(durationMs), errMsg, payloadJSON)
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
