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

type ScrapedData = {
  html: string;
  markdown: string;
  metadata: Metadata;
};

type ScrapedPage = { success: true; data: ScrapedData } | { success: false; data: null };

type LoadedPage = {
  html: string;
  finalUrl: string;
  statusCode: number | null;
  contentType: string | null;
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

const NAVIGATION_TIMEOUT_MS = 30_000;

export async function scrapePage(url: string): Promise<ScrapedPage> {
  const target = await assertPublicHttpUrl(url);

  try {
    const loadedPage = await loadPage(target);
    return extractPage(loadedPage);
  } catch (error) {
    if (error instanceof errors.TimeoutError) {
      throw new ScrapeTimeoutError(error);
    }
    throw error;
  }
}

const loadPage = async (target: URL): Promise<LoadedPage> => {
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
      const response = await page.goto(target.href, {
        waitUntil: "domcontentloaded",
        timeout: NAVIGATION_TIMEOUT_MS,
      });

      return {
        html: await page.content(),
        finalUrl: page.url(),
        statusCode: response?.status() ?? null,
        contentType: (await response?.headerValue("content-type")) ?? null,
      };
    } catch (error) {
      if (mainNavigationPolicyError !== undefined) {
        throw mainNavigationPolicyError;
      }
      throw error;
    }
  } finally {
    try {
      await context.close();
    } catch (error) {
      console.error("Failed to close Playwright context", error);
    }
  }
};

const extractPage = (loadedPage: LoadedPage): ScrapedPage => {
  const dom = new JSDOM(loadedPage.html, { url: loadedPage.finalUrl });
  try {
    const document = dom.window.document;
    const metadata = getMetadata(
      document,
      loadedPage.finalUrl,
      loadedPage.statusCode,
      loadedPage.contentType,
    );

    const article = new Readability(document).parse();
    if (!article?.content) {
      return { success: false, data: null };
    }

    return {
      success: true,
      data: {
        markdown: turndown.turndown(article.content),
        html: loadedPage.html,
        metadata,
      },
    };
  } finally {
    dom.window.close();
  }
};

const getMetadata = (
  document: Document,
  url: string,
  statusCode: number | null,
  contentType: string | null,
): Metadata => {
  return {
    title: document.title.trim() || null,
    description: getMetadataContent(document, 'meta[name="description" i]'),
    language: document.documentElement.lang.trim() || null,
    keywords: getMetadataContent(document, 'meta[name="keywords" i]'),
    robots: getMetadataContent(document, 'meta[name="robots" i]'),
    ogTitle: getMetadataContent(document, 'meta[property="og:title" i]'),
    ogDescription: getMetadataContent(document, 'meta[property="og:description" i]'),
    ogUrl: getMetadataContent(document, 'meta[property="og:url" i]'),
    ogImage: getMetadataContent(document, 'meta[property="og:image" i]'),
    ogLocaleAlternate: Array.from(
      document.querySelectorAll<HTMLMetaElement>('meta[property="og:locale:alternate" i]'),
      (element) => element.content.trim(),
    ).filter(Boolean),
    ogSiteName: getMetadataContent(document, 'meta[property="og:site_name" i]'),
    sourceURL: url,
    statusCode,
    contentType,
  };
};

const getMetadataContent = (document: Document, selector: string): string | null => {
  return document.querySelector<HTMLMetaElement>(selector)?.content.trim() || null;
};
