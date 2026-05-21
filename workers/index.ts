import { Queue, Worker, Job } from 'bullmq';
import Redis from 'ioredis';
import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

// Redis connection setup
const connection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  maxRetriesPerRequest: null,
});

// Dedicated connection for blocking commands like blpop
const adapterConnection = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
});

// Create artifacts directory
const artifactsDir = path.join(__dirname, 'artifacts');
if (!fs.existsSync(artifactsDir)) {
  fs.mkdirSync(artifactsDir, { recursive: true });
}

// BullMQ Queue
const verifyQueue = new Queue('verify-jobs', { connection });

// Adapter: Pull from simple Redis list and push to BullMQ
async function adapterLoop() {
  console.log('Starting adapter loop to bridge Go and BullMQ...');
  while (true) {
    try {
      const result = await adapterConnection.blpop('verify_jobs', 0); // Block on dedicated connection
      if (result) {
        const [queueName, jobDataStr] = result;
        const jobData = JSON.parse(jobDataStr);
        console.log(`Received job from API: ${jobData.id}`);
        await verifyQueue.add('verify', jobData);
      }
    } catch (error) {
      console.error('Adapter error:', error);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

// BullMQ Worker
const worker = new Worker('verify-jobs', async (job: Job) => {
  console.log(`Processing job ${job.data.id} - ${job.data.task}`);
  
  // Set status in Redis
  await connection.set(`exec_result_${job.data.id}`, JSON.stringify({
    executionId: job.data.id,
    status: 'running',
    task: job.data.task
  }));

  const browser = await chromium.launch({ headless: false }); // Set to false so you can see it!
  const context = await browser.newContext();
  const page = await context.newPage();

  const logs: string[] = [];
  page.on('console', msg => logs.push(`[${msg.type()}] ${msg.text()}`));

  let passed = true;
  let reason = '';

  try {
    await page.goto(job.data.url, { waitUntil: 'networkidle', timeout: 15000 });
    
    // Evaluate basic assertions based on ExpectedBehavior
    // This is a naive implementation for MVP.
    const title = await page.title();
    console.log(`Page title: ${title}`);
    
    const screenshotPath = path.join(artifactsDir, `${job.data.id}.png`);
    await page.screenshot({ path: screenshotPath });

    // Mark as success
    await connection.set(`exec_result_${job.data.id}`, JSON.stringify({
      executionId: job.data.id,
      status: 'completed',
      passed: true,
      logs,
      screenshot: screenshotPath,
    }));

  } catch (error: any) {
    console.error(`Job ${job.data.id} failed:`, error.message);
    
    // Capture a screenshot of the exact moment it failed
    const screenshotPath = path.join(artifactsDir, `${job.data.id}_failed.png`);
    try {
      await page.screenshot({ path: screenshotPath });
    } catch (e) {
      // Ignore if page is already closed
    }

    await connection.set(`exec_result_${job.data.id}`, JSON.stringify({
      executionId: job.data.id,
      status: 'failed',
      passed: false,
      reason: error.message,
      logs,
      screenshot: screenshotPath
    }));
  } finally {
    await browser.close();
  }
}, { connection });

worker.on('completed', job => {
  console.log(`Job ${job.id} has completed!`);
});

worker.on('failed', (job, err) => {
  console.log(`Job ${job?.id} has failed with ${err.message}`);
});

// Start both
adapterLoop();
console.log('Worker is running and waiting for jobs...');
