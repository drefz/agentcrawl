import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { logger } from "hono/logger";

import { errorResponse } from "./http/errors.ts";
import scraperRoutes from "./routes/scraper/index.ts";

const app = new Hono();

app.use(logger());

app.route("/scraper", scraperRoutes);

app.notFound((c) => errorResponse(c, "NOT_FOUND"));
app.onError((error, c) => {
  console.error("Unhandled application error", { error });
  return errorResponse(c, "INTERNAL_ERROR");
});

serve(
  {
    fetch: app.fetch,
    port: 3000,
  },
  (info) => {
    console.log(`Server is running on http://localhost:${info.port}`);
  },
);
