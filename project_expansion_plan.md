# Roadmap: Premium ML Serving API Upgrade

This roadmap details the steps to combine a real AI inference model, a premium frontend dashboard, and containerization into a single unified application.

---

## ── Architectural Overview ──────────────────────────────────────────

```
Client (Browser) ──[ Auth / API Keys ]──► Express API Gateway
                                              │
                    ┌─────────────────────────┴─────────────────────────┐
             (Admin Dashboard)                                   (ML Inference)
                    │                                                   │
                    ▼                                                   ▼
            [ Adjust Weights ]                                 [ A/B Traffic Split ]
                    │                                        ┌──────────┴──────────┐
                    ▼                                        ▼                     ▼
              [ MongoDB ]                               [ Model v1 ]          [ Model v2 ]
                                                          (Hugging             (Hugging
                                                          Face model)          Face model)
```

---

## ── Implementation Phases ─────────────────────────────────────────────

### Phase 1: Real AI Inference Integration
We will replace the simulated inference inside `src/services/modelService.js` with a live call to the **Hugging Face Inference API** (using free, serverless pipelines).
* **Model v1 (Stable):** `distilbert-base-uncased-finetuned-sst-2-english` (a highly reliable, fast sentiment classifier).
* **Model v2 (Canary):** `cardiffnlp/twitter-roberta-base-sentiment-latest` (a model fine-tuned on social media, with improved Neutral sentiment detection).
* **Fallback Mode:** If no Hugging Face API key is configured in the `.env` file, the service will gracefully fall back to the existing simulated inference, keeping the project 100% runnable out of the box.

---

### Phase 2: Premium Frontend Dashboard (Embedded)
To avoid running multiple dev servers, we will build a responsive, single-page application (SPA) served directly from the Express server (`src/public`).
* **Design System (CSS):** Modern glassmorphic dark mode, Outfit/Inter typography, animated gradients, and interactive hover effects.
* **Authentication Screen:** A premium auth gate with a registration and login switcher.
* **Developer Console:**
  * **Interactive Inference Playground:** Type text, choose `v1` / `v2` / `auto` routing, toggle detailed scores, and trigger real-time predictions.
  * **API Key Management:** Generate, copy, and view active API keys.
  * **Inference History Logs:** A paginated table retrieving logs via `GET /api/v1/predict/history`.
* **Admin Dashboard (Role Restricted):**
  * **Traffic Split Controller:** Interactive sliders to dynamically adjust weights between `v1` and `v2` in real-time.
  * **Live Analytics Graphs:** Render error rates and latency trends using Chart.js.

---

### Phase 3: Docker & Local Orchestration
We will create container definitions to spin up the entire application stack locally with a single command:
* **`Dockerfile`:** Packages the Node.js API server and the embedded frontend.
* **`docker-compose.yml`:** Links the Node API server with a MongoDB container and configures health checks.

---

## ── Next Steps ────────────────────────────────────────────────────────

1. Proceed with **Phase 1** to integrate the Hugging Face API.
2. Proceed with **Phase 2** to build the public directory structure and assets.
3. Proceed with **Phase 3** to dockerize the project.
