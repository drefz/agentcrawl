import { Readability } from "@mozilla/readability";
import { Hono } from "hono";
import { validator } from "hono/validator";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import TurndownService from "turndown";
import * as z from "zod";

import { apiError } from "../errors.ts";

const browser = await chromium.launch({
  headless: true,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

const querySchema = z.object({
  url: z.url({
    protocol: /^https?$/,
    error: "'url' must be a valid HTTP or HTTPS URL",
  }),
  output: z.enum(["json", "md"]).default("json"),
});

const validateQuery = validator("query", (value, c) => {
  const result = querySchema.safeParse(value);

  if (!result.success) {
    return c.json(
      {
        error: {
          code: "INVALID_QUERY",
          message: "Invalid query parameters",
          issues: result.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        },
      },
      400,
    );
  }
  return result.data;
});

const scraperRoute = new Hono().get("/", validateQuery, async (c) => {
  // Get params
  const { url, output } = c.req.valid("query");

  try {
    const result = await scrapedPage(url);

    if (!result) {
      return c.json(apiError("CONTENT_NOT_READABLE", "Could not extract readable content"), 422);
    }

    if (output === "md") {
      return c.text(result.markdown, 200, {
        "Content-Type": "text/markdown; charset=UTF-8",
      });
    }
    return c.json(result);
  } catch (error) {
    console.error("Failed to scrape page", { url, error });
    return c.json(apiError("UPSTREAM_FAILURE", "Failed to load page"), 502);
  }
});

type ScrapedPage = {
  url: string;
  title: string;
  byline: string | null;
  excerpt: string | null;
  markdown: string;
};

async function scrapedPage(url: string): Promise<ScrapedPage | null> {
  // Parse page
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const finalUrl = page.url();
    const html = await page.content();
    const dom = new JSDOM(html, { url: finalUrl });
    const article = new Readability(dom.window.document).parse();

    if (!article?.content) {
      return null;
    }

    return {
      url: finalUrl,
      title: article.title ?? "",
      byline: article.byline ?? "",
      excerpt: article.excerpt ?? "",
      markdown: turndown.turndown(article.content),
    };
  } finally {
    try {
      await page.close();
    } catch (error) {
      console.error("Failed to close Playwright page", error);
    }
  }
}

export default scraperRoute;
