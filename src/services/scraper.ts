import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { chromium, errors } from "playwright";
import TurndownService from "turndown";

import { assertPublicHttpUrl } from "../security/ssrf.ts";

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
  const target = await assertPublicHttpUrl(url);
  const context = await browser.newContext({
    acceptDownloads: false,
    serviceWorkers: "block",
  });
  let mainNavigationPolicyError: unknown;

  try {
    await context.routeWebSocket(/.*/, (webSocket) =>
      webSocket.close({
        code: 1008,
        reason: "WebSockets are disabled",
      }),
    );

    const page = await context.newPage();

    await context.route("**/*", async (route) => {
      const request = route.request();

      try {
        await assertPublicHttpUrl(request.url());
      } catch (error) {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
          mainNavigationPolicyError = error;
        }

        await route.abort("blockedbyclient");
        return;
      }

      await route.continue();
    });

    try {
      await page.goto(target.href, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
    } catch (error) {
      if (mainNavigationPolicyError) {
        throw mainNavigationPolicyError;
      }
      throw error;
    }

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
      await context.close();
    } catch (error) {
      console.error("Failed to close Playwright context", error);
    }
  }
}
