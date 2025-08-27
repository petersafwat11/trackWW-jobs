# Railway Deployment Guide - Cron Job Service

This guide explains how to deploy your container tracking cron job to Railway as a **background worker service** that runs at specific times and sleeps otherwise (not as a web server).

## 🚀 Step-by-Step Railway Deployment

### 1. Push to GitHub

```bash
# Add all files to git
git add .

# Commit changes
git commit -m "Setup cron job service for Railway deployment"

# Push to GitHub
git push origin main
```

### 2. Create Railway Project

1. **Visit Railway**: Go to [railway.app](https://railway.app)
2. **Login** with your GitHub account
3. **Click "New Project"**
4. **Select "Deploy from GitHub repo"**
5. **Choose your repository**
6. **Select the `corn` folder** if it's in a subdirectory

### 3. Configure as Worker Service (Important!)

⚠️ **This is crucial for cron jobs - Railway must NOT treat this as a web service:**

1. **In Railway Dashboard** → Your Project → Settings
2. **Go to "Networking" tab**
3. **DISABLE "Public Networking"** (this prevents Railway from trying to assign a web port)
4. **Or set service type to "Worker"** if the option is available

### 4. Set Environment Variables

In Railway Dashboard → Variables tab, add these exactly:

```
CRON_TIMER=0 0,12 * * *
BASE_URL=https://trackww-backend-production.up.railway.app
BATCH_SIZE=500
CONCURRENCY=10
BRAVO_USERNAME=admin@aqza.com
BRAVO_PASSWORD=J5Hk2Ht3!bg9Y52
BACKEND_SERVER=https://trackww-backend-production.up.railway.app
```

### 5. Deploy Configuration

Railway will automatically:

- ✅ Detect `package.json` and run `npm install`
- ✅ Use `npm start` as the start command
- ✅ Keep the process running continuously
- ✅ Auto-restart if the process crashes

### 6. Monitor Deployment

1. **Check Build Logs**: Railway Dashboard → Deployments → View Build Logs
2. **Check Runtime Logs**: Look for these messages:
   ```
   🔧 Initializing container tracking cron job...
   ⏰ Cron schedule: 0 0,12 * * *
   🌐 Base URL: https://trackww-backend-production.up.railway.app
   🎯 Container tracking cron job is running...
   🚀 Waiting for scheduled execution...
   ```

## 🔧 How Railway Handles Cron Jobs

### Background Process Behavior:

- ✅ **Runs continuously** as a background worker
- ✅ **Sleeps between scheduled times** (minimal CPU usage)
- ✅ **Automatically restarts** if it crashes
- ✅ **No web port required** (saves resources)
- ✅ **Executes at exact scheduled times** (12 AM and 12 PM)

### Resource Usage:

- **During sleep**: ~1-5 MB RAM, 0% CPU
- **During execution**: Increases based on workload
- **Railway free tier**: More than sufficient for cron jobs

## 📊 Monitoring Your Cron Job

### 1. Check Logs at Scheduled Times

Visit Railway Dashboard → Logs at:

- **12:00 AM UTC**
- **12:00 PM UTC**

Look for execution logs:

```
⏱️ Cron job triggered
🚀 Starting schedule notification job...
📦 Fetching batch starting at offset 0...
✅ Processed container ABCD1234 for user@example.com
✅ Schedule notification job completed
📊 Summary: 50 total, 48 success, 2 errors
```

### 2. Set Up Log Alerts (Optional)

- Railway Pro plan offers log-based alerts
- Monitor for error patterns or failed executions

## 🛠️ Troubleshooting

### If the service keeps restarting:

1. Check that you **disabled public networking**
2. Verify all environment variables are set correctly
3. Check for syntax errors in logs

### If cron jobs don't trigger:

1. Verify cron expression at [crontab.guru](https://crontab.guru)
2. Check timezone settings (Railway uses UTC)
3. Ensure the process stays alive (check for crashes)

### If memory/CPU usage is high:

1. Reduce `BATCH_SIZE` and `CONCURRENCY`
2. Add delays between API calls
3. Monitor puppeteer resource usage

## 🔄 Updating the Service

To update your cron job:

1. **Make changes locally**
2. **Commit and push to GitHub**
3. **Railway auto-deploys** from your main branch
4. **Monitor logs** to ensure successful update

## 💡 Pro Tips

1. **Test locally first**: Run `npm start` locally to verify functionality
2. **Start with frequent schedule**: Use `*/5 * * * *` (every 5 min) for testing, then change to `0 0,12 * * *`
3. **Monitor error rates**: Check logs regularly for failed API calls
4. **Use Railway CLI**: Install `railway login` for easier log monitoring

## 🎯 Expected Behavior

✅ **What you should see:**

- Service deploys successfully
- Stays running continuously
- Executes exactly at 12 AM and 12 PM
- Sleeps/idles between executions
- Processes containers and sends emails
- Logs detailed execution information

❌ **What indicates problems:**

- Service keeps restarting
- No logs at scheduled times
- "Port binding" or "web service" errors
- High resource usage during idle time
