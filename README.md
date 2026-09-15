# JobSphere — Setup Guide

## Step-by-Step API Integration

---

### Step 1 — Install Node.js

Go to https://nodejs.org and download **Node.js LTS** (v20+).
Verify it worked:
```bash
node --version   # should show v20.x.x
```

---

### Step 2 — Download the project

Download the `JobSphere` folder from Claude.
It contains:
```
JobSphere/
├── server.js          ← Backend (fetches APIs, serves files)
├── package.json       ← Project config
├── README.md          ← This file
└── public/
    └── index.html     ← Frontend website
```

---

### Step 3 — Run locally

Open a terminal inside the `JobSphere` folder and run:
```bash
node server.js
```

You'll see:
```
✅ JobSphere running at http://localhost:3000
📡 API: http://localhost:3000/api/jobs
❤️  Health: http://localhost:3000/api/health
```

Open **http://localhost:3000** in your browser — live jobs will appear!

---

### Step 4 — Deploy FREE on Render (public URL, always live)

**Render** hosts Node.js apps free. Your site will have a real URL like `jobsphere.onrender.com`.

1. Create a free account at https://render.com
2. Upload your `JobSphere` folder to a GitHub repo (https://github.com → New repo → upload files)
3. In Render: **New → Web Service** → connect your GitHub repo
4. Settings:
   - **Build command:** (leave empty)
   - **Start command:** `node server.js`
   - **Instance type:** Free
5. Click **Deploy** — done! Render gives you a live URL.

---

### Step 5 — Alternative: Deploy on Railway (also free)

1. Go to https://railway.app
2. **New Project → Deploy from GitHub**
3. Select your repo → it auto-detects Node.js
4. Add environment variable: `PORT = 3000`
5. Done — live URL in 2 minutes

---

### How the APIs work

| Source | URL | Data |
|---|---|---|
| Himalayas | `https://himalayas.app/jobs/api?limit=20&offset=0` | 100k+ remote jobs, salary, company logo |
| RemoteOK | `https://remoteok.com/api` | Global remote, tags, salary ranges |
| Remotive | `https://remotive.com/api/remote-jobs?limit=100` | Curated remote, categories |

The server fetches all 3 APIs, combines them, deduplicates, and caches for 15 minutes.
Your browser just talks to `/api/jobs` on your own server — no CORS issues!

---

### Adding Adzuna API (25+ countries including India 🇮🇳)

1. Get a free API key at https://developer.adzuna.com (takes 2 minutes)
2. In `server.js`, add your keys at the top:
```js
const ADZUNA_ID = 'your_app_id_here';
const ADZUNA_KEY = 'your_app_key_here';
```
3. Add this function to `server.js`:
```js
async function getAdzuna(country = 'in') {
  try {
    const data = await fetchJSON(
      `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${ADZUNA_ID}&app_key=${ADZUNA_KEY}&results_per_page=50&content-type=application/json`
    );
    return (data.results || []).map(j => ({
      id: 'az-' + j.id,
      title: j.title || '',
      company: j.company?.display_name || '',
      logo: '',
      location: j.location?.display_name || country.toUpperCase(),
      remote: j.contract_time === 'full_time',
      url: j.redirect_url || '#',
      tags: [j.category?.label || ''].filter(Boolean),
      description: (j.description || '').trim().substring(0, 300),
      posted: j.created || new Date().toISOString(),
      salary: j.salary_min && j.salary_max
        ? `$${Math.round(j.salary_min/1000)}k – $${Math.round(j.salary_max/1000)}k`
        : null,
      source: 'Adzuna',
      category: j.category?.label || ''
    }));
  } catch(e) { console.error('Adzuna error:', e.message); return []; }
}
```
4. Add `getAdzuna('in')` to the `Promise.allSettled` array in `getJobs()`.

---

### Troubleshooting

| Problem | Fix |
|---|---|
| `node: command not found` | Install Node.js from nodejs.org |
| `Cannot find module` | Run from inside the JobSphere folder |
| No jobs showing | Check terminal for API errors; try `curl http://localhost:3000/api/health` |
| Port already in use | Run `PORT=3001 node server.js` |
