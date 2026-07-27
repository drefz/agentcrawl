import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { chromium, errors } from "playwright";
import TurndownService from "turndown";

import { assertPublicHttpUrl } from "../security/ssrf.ts";

type ScrapedPage = {
  success: boolean;
  data: {
    html: string;
    markdown: string;
    metadata: {
      title: string;
      description: string | null;
      language: string | null;
      image: Buffer<ArrayBufferLike> | null;
      sourceURL: string;
      statusCode: number | null;
      contentType: string | null;
    };
  };
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

    let statusCode: number | null = null;
    let contentType: string | null = null;

    try {
      const response = await page.goto(target.href, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      statusCode = response?.status() ?? null;
      contentType = (await response?.headerValue("content-type")) ?? null;
    } catch (error) {
      if (mainNavigationPolicyError) {
        throw mainNavigationPolicyError;
      }
      throw error;
    }

    const sourceURL = page.url();
    const html = await page.content();
    const dom = new JSDOM(html, { url: sourceURL });
    const article = new Readability(dom.window.document).parse();
    const image = await page.screenshot();
    const title = await page.title();
    const language = await page.locator("html").getAttribute("lang");

    if (!article?.content) {
      return null;
    }

    return {
      success: true,
      data: {
        markdown: turndown.turndown(article.content),
        html: html,
        metadata: {
          title: title,
          description: article.excerpt ?? null,
          language: language,
          image: image,
          sourceURL: sourceURL,
          statusCode: statusCode,
          contentType: contentType,
        },
      },
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
