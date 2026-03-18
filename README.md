# Periskope WhatsApp Group Summariser

AI-powered dashboard to summarise WhatsApp group conversations using [Periskope](https://periskope.app) + Claude AI.

![screenshot](https://via.placeholder.com/800x500/0d0f0e/25d366?text=Periskope+Summariser)

## Features

- 📋 View all your WhatsApp chats from Periskope
- 🔍 Search and filter by groups or direct messages
- 🤖 One-click AI summaries powered by Claude Sonnet
- 💬 Browse recent messages inline
- 🌙 Dark-first, minimal design

## Prerequisites

- Node.js 18+
- [Periskope account](https://periskope.app) with a connected WhatsApp phone
- [Anthropic API key](https://console.anthropic.com)

## Setup

### 1. Clone the repo

```bash
git clone https://github.com/manishkumar98/whatsapp-group-summarisation.git
cd whatsapp-group-summarisation
```

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env`:

```env
PERISKOPE_API_KEY=your_periskope_api_key
ANTHROPIC_API_KEY=your_anthropic_api_key
PHONE_NUMBER=917204417387   # Your WhatsApp number (country code + number, no + or spaces)
PORT=3001
```

### 3. Install dependencies

```bash
npm run install:all
```

### 4. Run locally

```bash
npm run dev
```

- Frontend: http://localhost:3000
- Backend: http://localhost:3001

## Deploy to Railway (recommended)

1. Push this repo to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Select this repo
4. Add environment variables in Railway dashboard (same as `.env`)
5. Railway auto-detects Node.js and deploys — you get a public URL in ~2 minutes

## Deploy to Render

1. Go to [render.com](https://render.com) → New Web Service
2. Connect your GitHub repo
3. Build command: `npm run build`
4. Start command: `npm start`
5. Add environment variables

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/chats` | List all chats |
| GET | `/api/chats/:chatId/messages` | Get messages for a chat |
| POST | `/api/summarise` | Summarise messages with Claude AI |

## Tech Stack

- **Frontend**: React 18, vanilla CSS
- **Backend**: Node.js, Express
- **APIs**: Periskope (WhatsApp), Anthropic Claude Sonnet
- **Font**: DM Sans + DM Mono

## Security

- API keys are stored in `.env` (never committed)
- Backend proxies all external API calls — keys are never exposed to the browser
