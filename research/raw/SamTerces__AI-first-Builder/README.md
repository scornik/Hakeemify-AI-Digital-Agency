<div align="center">

# AI-First-Builder

### AI-Powered Website Generator

Transform natural language into production-ready React applications.
Use it to build websites — or as a foundation to create your own AI builder.

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://opensource.org/licenses/MIT)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](http://makeapullrequest.com)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org/)

---

[Getting Started](#getting-started) · [How It Works](#how-it-works) · [Build Your Own](#build-your-own-ai-builder) · [Contributing](#contributing)

---

</div>

## Overview

AI-First-Builder is an open-source tool that generates complete React websites from simple text prompts. Describe what you want, and the AI creates multi-file projects with modern Tailwind styling, proper component structure, and live preview.

**For Users:** Generate websites instantly without writing code.

**For Developers:** Fork this repo and customize it to build your own AI-powered tools.

> **Note:** AI generation is currently disabled in this codebase — the AI API routes return `503` and no external API key is used or required. To re-enable, restore the route handlers and `configs/AiModel.jsx` from git history and wire up a provider key.

---

## Features

```
┌─────────────────────────────────────────────────────────────────┐
│                                                                 │
│   Natural Language → React Code → Live Preview → Export        │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

| Feature | Description |
|---------|-------------|
| **AI Code Generation** | GPT-4o converts prompts into complete React applications |
| **Live Preview** | See your app instantly with Sandpack's embedded IDE |
| **Multi-File Output** | Generates organized components, not just single files |
| **Modern Styling** | Tailwind CSS with gradients, animations, and responsive design |
| **Export Ready** | Download complete projects ready for deployment |
| **Customizable** | Swap AI providers, modify prompts, extend functionality |

---

## Getting Started

### Prerequisites

- Node.js 18+
- [Convex Account](https://convex.dev) (free)

### Installation

```bash
# Clone
git clone https://github.com/SamTerces/AI-First-Builder.git
cd AI-First-Builder

# Install
npm install

# Configure environment
cp .env.example .env.local
```

Add your keys to `.env.local`:

```env
NEXT_PUBLIC_CONVEX_URL=YOUR_CONVEX_URL
```

### Run

```bash
# Terminal 1
npm run dev

# Terminal 2
npx convex dev
```

Open **http://localhost:3000**

---

## How It Works

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│              │      │              │      │              │
│  Your Prompt │ ───▶ │   GPT-4o     │ ───▶ │  React App   │
│              │      │              │      │              │
└──────────────┘      └──────────────┘      └──────────────┘
                             │
                             ▼
                      ┌──────────────┐
                      │              │
                      │ Live Preview │
                      │  + Export    │
                      │              │
                      └──────────────┘
```

**Step 1:** Enter a prompt like *"Create a SaaS landing page with pricing"*

**Step 2:** AI enhances your prompt with design specifications

**Step 3:** GPT-4o generates complete React code with Tailwind styling

**Step 4:** Preview live in Sandpack, edit if needed, export when ready

---

## Example Prompts

| Prompt | Output |
|--------|--------|
| *"Portfolio website with dark theme"* | Hero, projects grid, about, contact form |
| *"SaaS landing page with pricing cards"* | Hero, features, pricing tiers, CTA |
| *"Restaurant site with menu"* | Hero, menu sections, gallery, reservations |
| *"Fitness dashboard"* | Stats cards, workout tracker, progress charts |

---

## Build Your Own AI Builder

This project is designed as a **starting point** for building custom AI tools. Here's how to customize it:

### Add an AI Provider

AI generation is currently disabled (no provider, no key). To wire one up, restore `configs/AiModel.jsx` and the `app/api/*` route handlers from git history, then swap in any provider: Anthropic, OpenAI, Gemini, Groq, Ollama, etc.

### Customize Output

Edit `data/Prompt.jsx`:

```javascript
// Change CODE_GEN_PROMPT to generate:
// - Different frameworks (Vue, Svelte, Angular)
// - Different styling (CSS Modules, Styled Components)
// - Different patterns (your company's standards)
```

### Extend Features

Add whatever you need:
- Authentication
- Template library
- Deployment integration
- Version history
- Team collaboration

---

## Project Structure

```
AI-First-Builder/
├── app/                    # Next.js App Router
│   ├── (main)/workspace/   # Workspace pages
│   ├── api/                # API routes
│   └── layout.js
│
├── components/
│   ├── custom/             # ChatView, CodeView, Header, Hero
│   └── ui/                 # Reusable components
│
├── data/
│   ├── Prompt.jsx          # Generation prompts (customize here)
│   └── Lookup.jsx
│
├── convex/                 # Backend functions
├── context/                # React contexts
└── lib/                    # Utilities
```

---

## Tech Stack

| | |
|---|---|
| **Framework** | Next.js 15, React 18 |
| **Styling** | Tailwind CSS |
| **AI** | OpenAI GPT-4o |
| **Backend** | Convex |
| **Preview** | Sandpack |
| **Icons** | Lucide React |

---

## Deployment

### Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/SamTerces/AI-First-Builder)

Set these environment variables:
- `NEXT_PUBLIC_CONVEX_URL`

---

## Contributing

1. Fork the repo
2. Create a branch (`git checkout -b feature/name`)
3. Commit changes (`git commit -m 'Add feature'`)
4. Push (`git push origin feature/name`)
5. Open a PR

**Ideas:**
- Support more AI providers
- Add starter templates
- Improve prompts
- Add export to CodeSandbox/StackBlitz

---

## License

MIT — use it however you want, including commercially.

---

<div align="center">

**Build websites with AI. Or build your own AI builder.**

[Back to top](#ai-website-builder)

</div>
