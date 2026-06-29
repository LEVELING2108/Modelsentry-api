# ModelSentry

ModelSentry is a production-grade, secure Machine Learning serving gateway and analytics wrapper built on **Node.js, Express, MongoDB, and Redis**. It intercepts and serves model inference requests with A/B traffic split controls, observability metrics, multi-provider upstream failovers, usage billing, and API key management inside an embedded dark-theme developer portal.

---

## 🛠️ Tech Stack

![NodeJS](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)
![Redis](https://img.shields.io/badge/Redis-DC382D?style=flat-square&logo=redis&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=flat-square&logo=prometheus&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat-square&logo=jest&logoColor=white)

---

## ✨ Key Features

- **Multi-Task ML Gateway**: Dynamically routes and performs predictions across multiple ML tasks:
  - **Sentiment Analysis** (DistilBERT & RoBERTa models)
  - **Text Summarization** (BART & Pegasus models)
  - **Named Entity Recognition (NER)** (BERT-cased models)
- **A/B Traffic Split & Diagnostic Audit**: Drag-and-drop weight controllers to dynamically balance requests between Stable (`v1`) and Canary (`v2`) models, with side-by-side performance indicators (latency, errors, confidence, sentiment segments) in the admin console.
- **Canary Auto-Rollback Drift Detector**: A periodic background daemon scans canary (`v2`) inference error/timeout rates. If $\ge 15\%$ failures occur over a 5-minute window, it automatically rolls back traffic allocation to $100\%$ Stable (`v1`).
- **Upstream Multi-Provider Failover**: Built-in resilient client that queries primary Hugging Face API pipelines. If Hugging Face is down or unconfigured, it dynamically fails over to alternative providers (**Google Gemini**, **OpenAI**, or custom **Self-Hosted** endpoints) before falling back to simulation.
- **Character Usage Billing (Quotas)**: Restricts API keys to custom monthly character quotas (input + output characters processed). Automatically resets quotas on the 1st of every month and synchronizes consumption in Redis.
- **Sub-1ms API Key Verification**: Bypasses slow bcrypt hashes by using fast SHA-256 key matches cached in Redis (with a 5-minute TTL) to maintain ultra-low gateway overhead.
- **Redis Caching Layer**: Gracefully intercepts repeat payloads using MD5 digests to avoid redundant upstream API requests.
- **Production Observability**: Winston JSON rotating logs and raw Prometheus metrics (`/health/metrics`) tracking HTTP traffic, authentication failures, and latency histograms.

---

## 🚀 Quick Start

### Local Setup

1. **Clone & Install Dependencies**
   ```bash
   git clone https://github.com/LEVELING2108/Modelsentry-api.git
   cd Modelsentry-api
   npm install
   ```

2. **Configure Environment**
   Create a `.env` file from the template:
   ```bash
   cp .env.example .env
   ```
   Configure your live credentials (`HF_API_KEY`, `GEMINI_API_KEY`, etc.) and the desired `FALLBACK_PROVIDER`.

3. **Start Development Server**
   ```bash
   npm run dev
   ```
   *Your server will boot at `http://localhost:3005`.*

### Docker Deployment

To build and run the complete application stack (Node.js API + MongoDB + Redis):
```bash
docker-compose up --build
```

---

## 🧪 Running Tests

Verify health checks, predictions, fallback failovers, and billing pipelines by running the Jest test suite:
```bash
npm test
```
*Currently contains 39 fully passing integration and unit tests.*
