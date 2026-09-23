# Open Lovable — Powered by CRAWL4AI

Build, clone, and re-imagine any website with AI — in seconds.  
A fork of [open-lovable](https://github.com/mendableai/open-lovable) rebuilt with CRAWL4AI scraping, a visual element inspector, extended model support, and more.

---

## Features

- **AI Website Builder** — Describe what you want; get a full React + Vite app running in a sandbox
- **Clone Any Website** — Paste a URL to scrape and recreate its design (powered by CRAWL4AI)
- **Import HTML** — Upload an `.html` file to recreate it with AI
- **Visual Inspector** — Click any element in the preview to edit styles, text, images, links, and videos live (like Lovable)
- **Drag-to-Reorder** — Drag elements in the preview to reorder them
- **Multi-Model Support** — Anthropic Claude, Google Gemini (including free tier), OpenAI GPT, Groq Llama, and 6+ OpenRouter free models
- **ZIP Download** — Download your generated project as a ZIP file
- **Fast Apply** — Optional Morph integration for faster code edits

---

## Models Supported

| Provider | Models |
|----------|--------|
| Anthropic | Claude Sonnet 4.6, Claude Opus 4.7, Claude Haiku 4.5 |
| Google | Gemini 3 Pro, Gemini 2.5 Pro, Gemini 2.0 Flash, Gemini 2.0 Flash Lite, Gemini 1.5 Flash |
| OpenAI | GPT-4.1 |
| Groq | Llama 3.3 70B (fast) |
| OpenRouter (free) | Qwen3 Coder, GPT-OSS 120B, Hermes 3 405B, Nemotron 120B, Kimi K2.5, Gemma 4 31B, Nemotron Super |

---

## Quick Start

### 1. Clone & Install

```bash
git clone https://github.com/Kaoz625/open-lovable.git
cd open-lovable
npm install
```

### 2. Configure Environment

Copy the example and fill in your keys:

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
# =============================================================================
# SCRAPING BACKEND (Crawl4AI — replaces Firecrawl)
# =============================================================================
# Docker Compose sets this automatically. For local dev without Docker:
CRAWL4AI_SERVICE_URL=http://localhost:8000

# Optional: Residential proxy for bypassing Cloudflare (Bright Data, Oxylabs, etc.)
RESIDENTIAL_PROXY_URL=

# Optional: CapSolver API key for CAPTCHA solving
CAPSOLVER_API_KEY=

# =============================================================================
# SANDBOX PROVIDER — Choose ONE
# =============================================================================
SANDBOX_PROVIDER=vercel   # or 'e2b'

# --- Option A: Vercel Sandbox (default) ---
# Run `vercel link` then `vercel env pull` to auto-populate:
VERCEL_OIDC_TOKEN=auto_generated_by_vercel_env_pull
# Or use a Personal Access Token:
# VERCEL_TEAM_ID=team_xxxxxxxxx
# VERCEL_PROJECT_ID=prj_xxxxxxxxx
# VERCEL_TOKEN=vercel_xxxxxxxxxxxx

# --- Option B: E2B Sandbox ---
# SANDBOX_PROVIDER=e2b
# E2B_API_KEY=your_e2b_api_key   # https://e2b.dev

# =============================================================================
# AI PROVIDERS — Need at least one
# =============================================================================

# Vercel AI Gateway (gives access to all providers via one key)
AI_GATEWAY_API_KEY=your_ai_gateway_api_key   # https://vercel.com/dashboard/ai-gateway

# Individual keys (used when AI_GATEWAY_API_KEY is not set)
ANTHROPIC_API_KEY=your_key   # https://console.anthropic.com
OPENAI_API_KEY=your_key      # https://platform.openai.com
GEMINI_API_KEY=your_key      # https://aistudio.google.com/app/apikey  (free tier available)
GROQ_API_KEY=your_key        # https://console.groq.com  (free tier available)

# OpenRouter — access to 200+ models, including free ones
# Up to 5 keys for rotation (OPENROUTER_API_KEY_2 through _5 are optional)
OPENROUTER_API_KEY=your_key  # https://openrouter.ai/keys

# Optional: Morph fast-apply for quicker edits
MORPH_API_KEY=your_key       # https://morphllm.com/dashboard
```

### 3. Start CRAWL4AI Service

**With Docker (recommended):**

```bash
docker-compose up
```

This starts both the Next.js app and the CRAWL4AI microservice together.

**Without Docker (manual):**

```bash
# Terminal 1 — CRAWL4AI service
pip install crawl4ai
crawl4ai-server --port 8000

# Terminal 2 — Next.js app
npm run dev
```

### 4. Open

Visit [http://localhost:3000](http://localhost:3000)

---

## Docker Compose (Full Stack)

```yaml
# docker-compose.yml is included in the repo
docker-compose up --build
```

Services:
- `app` — Next.js on port 3000
- `crawl4ai-service` — Crawl4AI scraping API on port 8000

---

## Project Structure

```
open-lovable/
├── app/
│   ├── page.tsx                    # Landing page
│   ├── generation/page.tsx         # Main builder UI
│   └── api/
│       ├── generate-ai-code-stream/ # Core AI code generation
│       ├── apply-ai-code-stream/    # Fast-apply edits
│       ├── scrape-url-enhanced/     # CRAWL4AI scraping
│       ├── inject-inspector/        # Visual inspector injection
│       └── create-zip/             # Project download
├── components/
│   ├── PropertiesPanel.tsx         # Visual editor panel
│   └── shared/                     # UI components
├── config/
│   └── app.config.ts               # Model list, display names, defaults
├── crawl4ai-service/               # Python CRAWL4AI microservice
└── docker-compose.yml
```

---

## Sandbox Options

| Provider | Best For | Cost |
|----------|----------|------|
| Vercel Sandbox | Production deployments | Pay-per-use |
| E2B | Development & testing | Free tier available |

---

## Adding More Models

Edit `config/app.config.ts`:

```typescript
availableModels: [
  'anthropic/claude-sonnet-4-6',
  'google/gemini-2.0-flash',        // free via Google AI Studio
  'openrouter/qwen/qwen3-coder:free', // free via OpenRouter
  // add more here...
],
modelDisplayNames: {
  'google/gemini-2.0-flash': 'Gemini 2.0 Flash',
  // add display name here...
}
```

---

## Credits

- Built on [Open Lovable](https://github.com/mendableai/open-lovable) by the Firecrawl team
- Scraping powered by [Crawl4AI](https://github.com/unclecode/crawl4ai)
- Sandboxes by [Vercel](https://vercel.com) / [E2B](https://e2b.dev)
- AI by Anthropic, Google, OpenAI, Groq, OpenRouter

---

## License

MIT
