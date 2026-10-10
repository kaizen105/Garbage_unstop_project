# Vercel Deployment Guide (Windows PowerShell)

This guide walks you through deploying the SafaiKavach Next.js application to Vercel directly from a Windows PowerShell environment.

## 1. Prepare and Push to GitHub

First, create a new, empty repository on GitHub. Do not initialize it with a README or .gitignore.

Open PowerShell in your project directory (`C:\Garbage_unstop_project`) and run:
```powershell
# Add your new GitHub repository as the remote origin
git remote add origin https://github.com/YOUR_USERNAME/YOUR_REPO_NAME.git

# Push the current master branch to GitHub
git push -u origin master
```

## 2. Import into Vercel

1. Log in to [Vercel](https://vercel.com).
2. Click **Add New...** and select **Project**.
3. Import the GitHub repository you just created.
4. **Framework Preset**: Vercel will auto-detect **Next.js**. Leave it as is.
5. **Build and Output Settings**: Leave all default commands overrides unchecked. Vercel knows how to build Next.js apps natively.

## 3. Environment Variables (Optional)

The application is engineered with a **Mock-First** philosophy. If you do not provide any environment variables, the app will run entirely on synthetic offline endpoints and mock LLM responses.

To enable live features, add the following variables in the Vercel Dashboard (under Settings > Environment Variables) before clicking Deploy:

| Key | Value Example | Description |
|-----|---------------|-------------|
| `LLM_PROVIDER` | `openrouter` (or `evon`) | Set to utilize a real LLM for hazard extraction. |
| `LLM_BASE_URL` | `https://openrouter.ai/api/v1` | The LLM endpoints URL. |
| `LLM_API_KEY` | `sk-or-v1-...` | Your private LLM bearer token. |
| `LLM_MODEL_EXTRACT` | `google/gemini-2.5-flash` | The model slug for extraction. |
| `LLM_MODEL_AUDIT` | `google/gemini-2.5-flash` | The model slug for audits. |
| `GNANI_API_KEY` | `your_gnani_key` | Disables mock voice transcription. |
| `GNANI_STT_URL` | `https://api.gnani.ai/...` | The STT endpoint. |

Once environment variables are set, click **Deploy**.

## 4. Live Smoke-Test Checklist

Once Vercel provisions the live URL, perform these checks:
- [ ] **Load Initial Data**: Open the site and ensure the 4-week synthetic demo data loads into the map and Early Warning panel.
- [ ] **Test Routing API**: Click on an active hotspot. Ensure the right-hand panel calculates and renders standard/bypass/hazmat routes (OSRM public server). If OSRM fails, verify the fallback straight-line approx routes appear.
- [ ] **Voice Reporter UI**: Click the microphone icon. A "Hold to Record" prompt should appear and animate on click. (Audio capture may require HTTPS in most modern browsers, which Vercel provides natively).
- [ ] **Weekly Audit**: Click "Run Weekly Audit". A modal should appear synthesizing the clustered hazards (using either Mock data or LLM if enabled).

## 5. Alternative: Deploy using Vercel CLI

If you prefer not to use GitHub integrations, you can deploy straight from PowerShell using the Vercel CLI.

```powershell
# 1. Install the Vercel CLI globally
npm install -g vercel

# 2. Login to Vercel via CLI
npx vercel login

# 3. Deploy to a preview environment to test
npx vercel

# 4. Deploy to production
npx vercel --prod
```
