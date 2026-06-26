# ML Model Serving API

A production-grade REST API for serving machine learning models with full observability, security, and A/B traffic routing. Built with **Node.js + Express + MongoDB**.

## Features

| Category | What's included |
|---|---|
| **Security** | Helmet (CSP, HSTS), CORS allowlist, JWT auth, API key auth (bcrypt-hashed), rate limiting (global + per-route), input validation with Zod |
| **ML Serving** | Single inference, batch inference (50 items), model versioning (v1/v2), weighted A/B routing, configurable timeout |
| **Observability** | Prometheus metrics endpoint (`/health/metrics`), Winston structured JSON logging (file rotation), request IDs on every response |
| **MongoDB** | Connection pooling, retry on connect, TTL index on prediction logs (90-day auto-delete), compound indexes for analytics queries |
| **Production** | Graceful SIGTERM/SIGINT shutdown, unhandledRejection + uncaughtException handlers, env-based config validation, standardized error shapes |
| **Testing** | Jest + Supertest integration tests, 25+ test cases covering auth, prediction, validation, and health endpoints |

---

## Quick Start

```bash
# 1. Clone and install
git clone https://github.com/LEVELING2108/ml-serving-api
cd ml-serving-api
npm install

# 2. Configure environment
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret

# 3. Run in development mode
npm run dev

# 4. Run tests
npm test
```

---

## API Reference

### Authentication

All prediction endpoints require authentication via:
- `Authorization: Bearer <jwt_token>` — for users
- `X-API-Key: <key>` — for programmatic access

#### Register
```
POST /api/v1/auth/register
{
  "name": "Sourav Kumar",
  "email": "sourav@example.com",
  "password": "SecurePass1"
}
```

#### Login
```
POST /api/v1/auth/login
{ "email": "...", "password": "..." }
→ returns { token, user }
```

#### Generate API Key
```
POST /api/v1/auth/api-key
Authorization: Bearer <token>
→ returns { apiKey: "sk-...", prefix: "sk-ab12" }
⚠️  Store this key securely — it will not be shown again.
```

---

### Predictions

#### Single Prediction
```
POST /api/v1/predict
Authorization: Bearer <token>
{
  "text": "This product is absolutely amazing!",
  "modelVersion": "auto",         // "v1" | "v2" | "auto" (A/B routing)
  "options": {
    "returnScores": true,          // Include per-class probability scores
    "topK": 1
  }
}

Response:
{
  "success": true,
  "data": {
    "requestId": "uuid",
    "prediction": {
      "label": "POSITIVE",
      "confidence": 0.8924,
      "scores": { "POSITIVE": 0.8924, "NEGATIVE": 0.0612, "NEUTRAL": 0.0464 }
    },
    "model": { "version": "v2", "type": "sentiment" },
    "performance": { "latencyMs": 67 }
  }
}
```

#### Batch Prediction (up to 50 inputs)
```
POST /api/v1/predict/batch
{
  "inputs": [
    { "id": "item-1", "text": "Great service!" },
    { "id": "item-2", "text": "Terrible experience" }
  ],
  "modelVersion": "v1"
}
```

#### Prediction History
```
GET /api/v1/predict/history?page=1&limit=20&modelVersion=v2&status=success
```

---

### Admin (role: admin)

#### Get Model Metadata
```
GET /api/v1/admin/models
```

#### Update A/B Traffic Split
```
PATCH /api/v1/admin/models/weights
{ "version": "v2", "weight": 0.5 }
// Automatically sets v1 to 0.5 as well
```

#### Analytics Dashboard
```
GET /api/v1/admin/analytics?hours=24
→ returns totalPredictions, successRate, per-model breakdown, latency stats
```

---

### Health & Monitoring

| Endpoint | Purpose |
|---|---|
| `GET /health` | Full health check with DB + memory info |
| `GET /health/live` | Kubernetes liveness probe |
| `GET /health/ready` | Kubernetes readiness probe (checks DB) |
| `GET /health/metrics` | Prometheus metrics scrape endpoint |

#### Prometheus Metrics Exposed
- `ml_api_http_request_duration_seconds` — request latency histogram (by method, route, status)
- `ml_api_predictions_total` — prediction count (by model version, status)
- `ml_api_prediction_duration_seconds` — inference latency histogram
- `ml_api_auth_failures_total` — auth failure counter (by reason)
- `ml_api_model_traffic_ratio` — live A/B split gauge
- Standard Node.js metrics: CPU, memory, event loop lag, GC stats

---

## Architecture

```
Client
  └── Rate Limiter + Helmet + CORS
        └── Auth Middleware (JWT or API Key)
              └── Zod Validation
                    └── Prediction Router (A/B routing)
                          ├── Model v1 (stable, 80% traffic)
                          └── Model v2 (canary, 20% traffic)
                                └── Response Builder
                                      ├── MongoDB (prediction log + audit)
                                      └── Prometheus Metrics
```

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | 3000 | Server port |
| `MONGODB_URI` | localhost:27017/ml_serving_db | MongoDB connection string |
| `JWT_SECRET` | — | **Required in production** |
| `JWT_EXPIRES_IN` | 7d | Token lifetime |
| `RATE_LIMIT_MAX_REQUESTS` | 100 | Requests per window |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Rate limit window (15 min) |
| `MODEL_V1_WEIGHT` | 0.8 | v1 A/B traffic fraction |
| `MODEL_V2_WEIGHT` | 0.2 | v2 A/B traffic fraction |
| `LOG_LEVEL` | info | Winston log level |

---

## Running Tests
```bash
npm test                  # All tests
npm run test:coverage     # With coverage report
```

Tests use a separate `ml_serving_test` database and clean up after each run.

---

## Tech Stack

- **Runtime**: Node.js 18+
- **Framework**: Express 4
- **Database**: MongoDB via Mongoose
- **Auth**: JWT (jsonwebtoken) + bcryptjs
- **Validation**: Zod
- **Security**: Helmet, CORS, express-rate-limit
- **Monitoring**: prom-client (Prometheus), Winston
- **Testing**: Jest + Supertest
