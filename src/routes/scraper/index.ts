import { Hono } from "hono";

import { errorResponse } from "../../http/errors.ts";
import { UnsafeTargetError } from "../../security/ssrf.ts";
import { scrapePage, ScrapeTimeoutError } from "../../services/scraper.ts";
import { validateQuery } from "./validation.ts";

const scraperRoute = new Hono().get("/", validateQuery, async (c) => {
  const { url, output } = c.req.valid("query");

  try {
    const result = await scrapePage(url);

    if (!result.success) {
      return errorResponse(c, "CONTENT_NOT_READABLE");
    }

    if (output === "md" && result.data) {
      return c.text(result.data.markdown, 200, {
        "Content-Type": "text/markdown; charset=UTF-8",
      });
    }
    return c.json(result);
  } catch (error) {
    if (error instanceof UnsafeTargetError) {
      console.warn("Blocked unsafe scrape target");
      return errorResponse(c, "UNSAFE_TARGET");
    }

    if (error instanceof ScrapeTimeoutError) {
      console.warn("Timed out scraping page", { url });
      return errorResponse(c, "UPSTREAM_TIMEOUT");
    }

    console.error("Failed to scrape page", { url, error });
    return errorResponse(c, "UPSTREAM_FAILURE");
  }
});

export default scraperRoute;
