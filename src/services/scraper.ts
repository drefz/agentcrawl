import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { chromium, errors } from "playwright";
import TurndownService from "turndown";

type ScrapedPage = {
  url: string;
  title: string;
  byline: string | null;
  excerpt: string | null;
  markdown: string;
};

export class ScrapeTimeoutError extends Error {
  constructor(cause?: unknown) {
    super("Timed out while loading page", { cause });
    this.name = "ScrapeTimeoutError";
  }
}

const browser = await chromium.launch({
  headless: true,
});

const turndown = new TurndownService({
  headingStyle: "atx",
  codeBlockStyle: "fenced",
});

export async function scrapePage(url: string): Promise<ScrapedPage | null> {
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
      byline: article.byline ?? null,
      excerpt: article.excerpt ?? null,
      markdown: turndown.turndown(article.content),
    };
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      throw new ScrapeTimeoutError(error);
    }
    throw error;
  } finally {
    try {
      await page.close();
    } catch (error) {
      console.error("Failed to close Playwright page", error);
    }
  }
}
