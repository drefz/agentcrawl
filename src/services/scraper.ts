import { Readability } from "@mozilla/readability";
import { JSDOM } from "jsdom";
import { chromium, errors } from "playwright";
import TurndownService from "turndown";

import { assertPublicHttpUrl } from "../security/ssrf.ts";

type Metadata = {
  title: string | null;
  description: string | null;
  language: string | null;
  keywords: string | null;
  robots: string | null;
  ogTitle: string | null;
  ogDescription: string | null;
  ogUrl: string | null;
  ogImage: string | null;
  ogLocaleAlternate: string[];
  ogSiteName: string | null;
  sourceURL: string;
  statusCode: number | null;
  contentType: string | null;
};

type ScrapedPage = {
  success: boolean;
  data: {
    html: string;
    markdown: string;
    metadata: Metadata;
  } | null;
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

export async function scrapePage(url: string): Promise<ScrapedPage> {
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

    const html = await page.content();
    const dom = new JSDOM(html, { url: page.url() });
    const article = new Readability(dom.window.document).parse();
    if (!article?.content) {
      return { success: false, data: null };
    }

    const document = dom.window.document;

    return {
      success: true,
      data: {
        markdown: turndown.turndown(article.content),
        html: html,
        metadata: getMetadata(document, page.url(), statusCode, contentType),
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

const getMetadata = (
  document: Document,
  url: string,
  statusCode: number | null,
  contentType: string | null,
): Metadata => {
  return {
    title: document.title.trim(),
    description:
      document.querySelector('meta[name="description" i]')?.getAttribute("content") || null,
    language: document.documentElement.getAttribute("lang")?.trim() || null,
    keywords:
      document.querySelector<HTMLMetaElement>('meta[name="keywords" i]')?.content.trim() || null,
    robots:
      document.querySelector<HTMLMetaElement>('meta[name="robots" i]')?.content.trim() || null,
    ogTitle: document.querySelector('meta[property="og:title" i]')?.getAttribute("content") || null,
    ogDescription:
      document.querySelector('meta[property="og:description" i]')?.getAttribute("content") || null,
    ogUrl: document.querySelector('meta[property="og:url" i]')?.getAttribute("content") || null,
    ogImage: document.querySelector('meta[property="og:image" i]')?.getAttribute("content") || null,
    ogLocaleAlternate: Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[property="og:locale:alternate" i]'),
      (element) => element.content.trim(),
    ).filter(Boolean),
    ogSiteName:
      document.querySelector('meta[property="og:site_name" i]')?.getAttribute("content") || null,
    sourceURL: url,
    statusCode: statusCode,
    contentType: contentType,
  };
};
