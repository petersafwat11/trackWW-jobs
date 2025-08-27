import "dotenv/config";
import cron from "node-cron";
import axios from "axios";

// Environment variables
const cronTimer = process.env.CRON_TIMER || "0 0,12 * * *"; // Default: 12 AM and 12 PM daily
const baseURL = process.env.BASE_URL || "http://localhost:5000";
const batchSize = parseInt(process.env.BATCH_SIZE) || 500;
const concurrency = parseInt(process.env.CONCURRENCY) || 10;

// Helper function to get active schedules from API
async function getActiveSchedules(offset = 0, limit = batchSize) {
  try {
    const response = await axios.get(`${baseURL}/api/schedules/active`, {
      params: { offset, limit },
      timeout: 30000,
    });

    return response.data?.data || [];
  } catch (error) {
    console.error("Error fetching active schedules:", error.message);
    return [];
  }
}

// Helper function to process a single container notification
async function processContainerNotification(schedule) {
  try {
    const response = await axios.post(
      `${baseURL}/api/schedules/track-and-notify`,
      {
        email_to: schedule.email_to,
        container_no: schedule.container_no,
      },
      {
        timeout: 60000, // 1 minute timeout per request
      }
    );

    console.log(
      `✅ Processed container ${schedule.container_no} for ${schedule.email_to}`
    );
    return { success: true, container: schedule.container_no };
  } catch (error) {
    console.error(
      `❌ Error processing container ${schedule.container_no}:`,
      error.message
    );
    return {
      success: false,
      container: schedule.container_no,
      error: error.message,
    };
  }
}

// Main function to process all notifications
async function processNotifications() {
  console.log("🚀 Starting schedule notification job...");
  console.log(`📅 Timestamp: ${new Date().toISOString()}`);

  let totalProcessed = 0;
  let totalSuccess = 0;
  let totalErrors = 0;

  try {
    let offset = 0;
    let batch;

    do {
      console.log(`📦 Fetching batch starting at offset ${offset}...`);
      batch = await getActiveSchedules(offset, batchSize);

      if (batch.length === 0) {
        console.log("📋 No more schedules to process");
        break;
      }

      console.log(`🔄 Processing ${batch.length} schedules...`);

      // Process batch with concurrency limit
      const promises = batch.map((schedule) =>
        processContainerNotification(schedule)
      );
      const results = await Promise.allSettled(promises);

      // Count results
      results.forEach((result) => {
        totalProcessed++;
        if (result.status === "fulfilled" && result.value.success) {
          totalSuccess++;
        } else {
          totalErrors++;
        }
      });

      offset += batchSize;

      // Add small delay between batches to avoid overwhelming the server
      if (batch.length === batchSize) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } while (batch.length === batchSize);

    console.log("✅ Schedule notification job completed");
    console.log(
      `📊 Summary: ${totalProcessed} total, ${totalSuccess} success, ${totalErrors} errors`
    );
  } catch (error) {
    console.error("💥 Critical error in schedule notification job:", error);
  }
}

// Initialize cron job
console.log("🔧 Initializing container tracking cron job...");
console.log(`⏰ Cron schedule: ${cronTimer}`);
console.log(`🌐 Base URL: ${baseURL}`);
console.log(`📦 Batch size: ${batchSize}`);
console.log(`🔄 Concurrency: ${concurrency}`);

cron.schedule(cronTimer, async () => {
  console.log("⏱️ Cron job triggered");
  await processNotifications();
});

console.log("🎯 Container tracking cron job is running...");
console.log("🚀 Waiting for scheduled execution...");

// Keep the process alive
process.on("SIGTERM", () => {
  console.log("👋 Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("👋 Received SIGINT, shutting down gracefully...");
  process.exit(0);
});
