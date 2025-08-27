# Container Tracking Cron Job

This is a Node.js cron job service that automatically processes container tracking notifications at scheduled intervals.

## Features

- Automated container tracking notifications
- Configurable cron scheduling
- Batch processing with concurrency control
- Environment-based configuration
- Railway deployment ready

## Setup

1. Install dependencies:

```bash
npm install
```

2. Configure environment variables:

```bash
cp env.example .env
# Edit .env with your actual values
```

3. Run locally:

```bash
npm start
```

## Environment Variables

- `CRON_TIMER`: Cron schedule expression (default: "0 0,12 \* \* \*" - runs at 12 AM and 12 PM)
- `BASE_URL`: Your backend server URL
- `BATCH_SIZE`: Number of schedules to process per batch (default: 500)
- `CONCURRENCY`: Maximum concurrent requests (default: 10)
- `BRAVO_USERNAME`: Bravo email service username
- `BRAVO_PASSWORD`: Bravo email service password
- `BACKEND_SERVER`: Backend server URL for API calls

## Railway Deployment

1. Connect your repository to Railway
2. Set environment variables in Railway dashboard
3. Deploy with the start command: `npm start`

## Schedule

By default, the job runs twice daily at:

- 12:00 AM (midnight)
- 12:00 PM (noon)

You can modify the `CRON_TIMER` environment variable to change this schedule.

## Architecture

The service:

1. Fetches active schedules from your backend API
2. Processes them in batches with concurrency control
3. Calls the tracking and notification endpoint for each container
4. Logs results and handles errors gracefully
