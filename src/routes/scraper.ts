import { Readability } from "@mozilla/readability";
import { Hono } from "hono";
import { JSDOM } from "jsdom";
import { chromium } from "playwright";
import TurndownService from "turndown";
import * as z from "zod";
const app = new Hono();

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

app.get("/", async (c) => {
  // Parse params
  const result = querySchema.safeParse(c.req.query());

  if (!result.success) {
    return c.json(
      {
        error: "Invalid query parameters",
        issues: result.error.issues,
      },
      400,
    );
  }

  const { url, output } = result.data;

  // Parse page
  const page = await browser.newPage();

  try {
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    const html = await page.content();

    // Convert to md
    const dom = new JSDOM(html, {
      url,
    });

    const article = new Readability(dom.window.document).parse();

    if (!article?.content) {
      return c.json({
        error: "Could not extract readable content",
      });
    }

    const markdown = turndown.turndown(article.content);

    // Return result
    if (output === "md") {
      return c.text(markdown, 200, {
        "Content-Type": "text/markdown; charset=UTF-8",
      });
    }

    return c.json({
      url,
      title: article.title,
      byline: article.byline,
      excerpt: article.excerpt,
      markdown,
    });
  } catch (e) {
    return c.json({
      error: "Failed to scrape page",
      details: e instanceof Error ? e.message : String(e),
    });
  } finally {
    await page.close();
  }
});

export default app;
