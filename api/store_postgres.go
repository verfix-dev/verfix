//go:build !sqlite

package main

import (
	"database/sql"
	"log"
	"time"

	_ "github.com/lib/pq"
)

type pgStore struct {
	db *sql.DB
}

// NewStore returns the PostgreSQL-backed Store (default build, no sqlite tag).
func NewStore() Store {
	dsn := getEnv("DATABASE_URL", "postgres://user:password@localhost:5432/verifydb?sslmode=disable")
	db, err := sql.Open("postgres", dsn)
	if err != nil {
		log.Fatalf("Fatal: DB open failed: %v", err)
	}
	return &pgStore{db: db}
}

func (s *pgStore) Ping() error {
	return s.db.Ping()
}

func (s *pgStore) Init() error {
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
		completed_at TIMESTAMPTZ,
		payload JSONB
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
	if _, err := s.db.Exec(schema); err != nil {
		log.Printf("Schema init warning: %v", err)
	}

	if _, err := s.db.Exec(`ALTER TABLE executions ADD COLUMN IF NOT EXISTS payload JSONB;`); err != nil {
		log.Printf("DB migration warning: failed to add payload column: %v", err)
	}
	return nil
}

func (s *pgStore) CreateExecution(id, task, url, mode, assertionsJSON string, createdAt time.Time) error {
	_, err := s.db.Exec(
		`INSERT INTO executions (id, task, url, mode, assertions, status, created_at) VALUES ($1,$2,$3,$4,$5,'queued',$6)`,
		id, task, url, mode, assertionsJSON, createdAt,
	)
	return err
}

func (s *pgStore) GetExecution(id string) (executionRow, error) {
	row := s.db.QueryRow(
		`SELECT id, task, url, mode, status, passed, duration_ms, retry_count, error_message, created_at, completed_at, payload FROM executions WHERE id=$1`, id,
	)
	var e executionRow
	if err := scanExecutionRow(row, &e); err != nil {
		return e, err
	}
	return e, nil
}

func (s *pgStore) ListExecutions(statusFilter, urlFilter string, limit int) ([]executionRow, error) {
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
	args = append(args, limit)

	rows, err := s.db.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var executions []executionRow
	for rows.Next() {
		var e executionRow
		if err := scanListExecution(rows, &e); err != nil {
			continue
		}
		executions = append(executions, e)
	}
	return executions, nil
}

func (s *pgStore) DeleteExecution(id string) error {
	_, err := s.db.Exec(`DELETE FROM executions WHERE id=$1`, id)
	return err
}

func (s *pgStore) SyncExecution(id, status string, passed bool, durationMs int, errMsg string, payloadJSON []byte) error {
	var payload interface{} = nil
	if payloadJSON != nil {
		payload = string(payloadJSON)
	}
	_, err := s.db.Exec(`
		UPDATE executions
		SET status=$1, passed=$2, duration_ms=$3, error_message=$4, completed_at=$5, payload=$6
		WHERE id=$7 AND (status='queued' OR status='running')
	`, status, passed, durationMs, nullStr(errMsg), time.Now(), payload, id)
	return err
}

func (s *pgStore) GetStats() (Metrics, []DayTrend, []URLFailure, error) {
	var m Metrics

	s.db.QueryRow(`SELECT COUNT(*) FROM executions`).Scan(&m.TotalExecutions)
	s.db.QueryRow(`SELECT COUNT(*) FROM executions WHERE passed=true`).Scan(&m.TotalPassed)
	s.db.QueryRow(`SELECT COUNT(*) FROM executions WHERE passed=false AND status='completed'`).Scan(&m.TotalFailed)
	s.db.QueryRow(`SELECT COUNT(*) FROM executions WHERE status='running'`).Scan(&m.TotalRunning)
	s.db.QueryRow(`SELECT COUNT(*) FROM executions WHERE status='queued'`).Scan(&m.TotalQueued)
	s.db.QueryRow(`SELECT COUNT(*) FROM executions WHERE created_at > NOW() - INTERVAL '24 hours'`).Scan(&m.Last24h)
	s.db.QueryRow(`SELECT COALESCE(AVG(duration_ms),0) FROM executions WHERE duration_ms IS NOT NULL`).Scan(&m.AvgDurationMs)
	s.db.QueryRow(`SELECT COALESCE(AVG(retry_count),0) FROM executions`).Scan(&m.AvgRetriesPerRun)
	s.db.QueryRow(`
		SELECT COALESCE(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY duration_ms),0)
		FROM executions WHERE duration_ms IS NOT NULL
	`).Scan(&m.P95DurationMs)

	completed := m.TotalPassed + m.TotalFailed
	if completed > 0 {
		m.PassRate = float64(m.TotalPassed) / float64(completed) * 100
		m.FailRate = float64(m.TotalFailed) / float64(completed) * 100
	}

	s.db.QueryRow(`
		SELECT COUNT(*) FROM (
			SELECT task, url FROM executions WHERE status IN ('completed','failed')
			GROUP BY task, url
			HAVING COUNT(DISTINCT passed) > 1
		) sub
	`).Scan(&m.UnstableFlowCount)

	trendRows, _ := s.db.Query(`
		SELECT DATE(created_at) as day,
		       COUNT(*) as total,
		       SUM(CASE WHEN passed=true THEN 1 ELSE 0 END) as passed,
		       COALESCE(AVG(duration_ms),0) as avg_ms
		FROM executions
		WHERE created_at > NOW() - INTERVAL '7 days'
		GROUP BY day ORDER BY day ASC
	`)
	var trend []DayTrend
	if trendRows != nil {
		defer trendRows.Close()
		for trendRows.Next() {
			var d DayTrend
			trendRows.Scan(&d.Day, &d.Total, &d.Passed, &d.AvgMs)
			trend = append(trend, d)
		}
	}

	failRows, _ := s.db.Query(`
		SELECT url, COUNT(*) as failures
		FROM executions WHERE passed=false AND status IN ('completed','failed')
		GROUP BY url ORDER BY failures DESC LIMIT 10
	`)
	var topFailing []URLFailure
	if failRows != nil {
		defer failRows.Close()
		for failRows.Next() {
			var f URLFailure
			failRows.Scan(&f.URL, &f.Failures)
			topFailing = append(topFailing, f)
		}
	}

	return m, trend, topFailing, nil
}

func (s *pgStore) GetFlakyFlows() ([]FlakyFlow, []string, error) {
	rows, err := s.db.Query(`
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
		return nil, nil, err
	}
	defer rows.Close()

	var results []FlakyFlow
	for rows.Next() {
		var f FlakyFlow
		rows.Scan(&f.Task, &f.URL, &f.TotalRuns, &f.PassCount, &f.FailCount, &f.AvgDuration, &f.LastRun)
		f.FlakeRate = float64(f.FailCount) / float64(f.TotalRuns) * 100
		results = append(results, f)
	}

	var failedIDs []string
	idRows, err := s.db.Query(`
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

	return results, failedIDs, nil
}
