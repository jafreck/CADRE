# Implementation Plan: Issue #42

## Strategy
Restore the login timeout handling that was accidentally removed in PR #35. Add configurable per-route timeouts with a sensible global default. Add tests to prevent future regressions.

## Task Summary
- **Total Tasks**: 4
- **Parallelizable Groups**: 2

## Tasks

### Task: task-001 - Add timeout configuration types

**Description:** Add TypeScript types and configuration schema for the timeout settings, including per-route timeout overrides.
**Files:** src/config/types.ts, src/config/schema.ts
**Dependencies:** none
**Complexity:** simple
**Acceptance Criteria:**
- TimeoutConfig interface defined with globalTimeout and routeTimeouts
- Config schema validates timeout values are positive integers
- Default globalTimeout is 30000ms

### Task: task-002 - Implement timeout middleware

**Description:** Create a middleware function that enforces request timeouts based on the route configuration. Falls back to global timeout if no per-route timeout is set.
**Files:** src/middleware/timeout.ts
**Dependencies:** task-001
**Complexity:** moderate
**Acceptance Criteria:**
- Middleware reads timeout from route config, falls back to global
- Returns 408 status code on timeout
- Logs timeout events with route, duration, and request ID
- Cleans up properly (no memory leaks from dangling timers)

### Task: task-003 - Integrate timeout into login handler

**Description:** Wire the timeout middleware into the login route handler. Set a specific timeout for the login route.
**Files:** src/auth/login.ts, src/routes/index.ts
**Dependencies:** task-001, task-002
**Complexity:** simple
**Acceptance Criteria:**
- Login route has a configurable timeout (default 5000ms)
- Timeout middleware is applied before the login handler
- Existing login tests still pass

### Task: task-004 - Add timeout tests

**Description:** Write unit tests for the timeout middleware and integration tests for the login timeout behavior.
**Files:** src/middleware/timeout.test.ts, src/auth/login.test.ts
**Dependencies:** task-002, task-003
**Complexity:** moderate
**Acceptance Criteria:**
- Unit test: middleware times out after configured duration
- Unit test: middleware passes through when handler completes in time
- Unit test: middleware uses global fallback when no route timeout set
- Integration test: login endpoint returns 408 on slow auth
- All tests pass with `npm test`
