# ModelSentry

ModelSentry is a production-grade, secure Machine Learning serving gateway and analytics wrapper built on **Node.js, Express, and MongoDB**. It intercepts and serves model inference requests with A/B traffic split controls, observability metrics, and API key management inside an embedded dark-theme developer portal.

---

## 🛠️ Tech Stack

![NodeJS](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=nodedotjs&logoColor=white)
![Express](https://img.shields.io/badge/Express-000000?style=flat-square&logo=express&logoColor=white)
![MongoDB](https://img.shields.io/badge/MongoDB-47A248?style=flat-square&logo=mongodb&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat-square&logo=docker&logoColor=white)
![Prometheus](https://img.shields.io/badge/Prometheus-E6522C?style=flat-square&logo=prometheus&logoColor=white)
![Jest](https://img.shields.io/badge/Jest-C21325?style=flat-square&logo=jest&logoColor=white)

---

## ✨ Key Features

- **Real Sentiment Predictions**: Deep learning sentiment classification powered by Hugging Face pipeline endpoints (BERT & RoBERTa models).
- **A/B Traffic Split Controls**: Drag-and-drop weight controllers to dynamically balance requests between Stable (`v1`) and Canary (`v2`) models.
- **Embedded Developer Console**: Single-page dark dashboard to test inferences in the Playground, manage developer API keys, and audit prediction history logs.
- **Production Observability**: Winston JSON logs (with automated rotation) and raw Prometheus metrics (`/health/metrics`) for CPU, latency histograms, and HTTP request tracking.
- **Robust Security Gates**: Programmatic API key validation, JWT tokens, global and endpoint rate limiters, Helmet header controls (strict CSP), and input constraints (via Zod).

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

3. **Start Development Server**
   ```bash
   npm run dev
   ```
   *Your server will boot at `http://localhost:3000`.*

### Docker Deployment

To build and run the complete application stack (Node.js API + MongoDB):
```bash
docker-compose up --build
```

---

## 🧪 Running Tests

Verify health checks, predictions, and auth pipelines by running the Jest test suite:
```bash
npm test
```
