import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { errorResponse } from "./http/errors.ts";
import { closeBrowser, startBrowser } from "./infrastructure/browser.ts";
import scraperRoutes from "./routes/scraper/index.ts";

const PORT = 3000;
const SHUTDOWN_SIGNALS = ["SIGINT", "SIGTERM"] as const;

const app = new Hono();

app.use(logger());
app.route("/scraper", scraperRoutes);

app.notFound((c) => errorResponse(c, "NOT_FOUND"));

app.onError((error, c) => {
  console.error("Unhandled application error", { error });
  return errorResponse(c, "INTERNAL_ERROR");
});

await startBrowser();

const server = serve(
  {
    fetch: app.fetch,
    port: PORT,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);

function closeHttpServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

let shuttingDown = false;

async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) {
    return;
  }

  shuttingDown = true;
  console.log(`\nReceived ${signal}; shutting down`);

  try {
    try {
      await closeHttpServer();
    } finally {
      await closeBrowser();
    }

    console.log("Shutdown complete");
  } catch (error) {
    console.error("Failed to shut down cleanly", { error });
    process.exitCode = 1;
  }
}

for (const signal of SHUTDOWN_SIGNALS) {
  process.once(signal, () => void shutdown(signal));
}
