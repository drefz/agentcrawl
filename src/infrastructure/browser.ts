import { chromium, type Browser } from "playwright";

let browserPromise: Promise<Browser> | undefined;

export function getBrowser(): Promise<Browser> {
  if (browserPromise) {
    return browserPromise;
  }

  const launch = chromium.launch({
    headless: true,
    handleSIGINT: false,
    handleSIGTERM: false,
    handleSIGHUP: false,
  });

  browserPromise = launch;

  void launch.then(
    (browser) => {
      browser.once("disconnected", () => {
        if (browserPromise === launch) {
          browserPromise = undefined;
        }
      });
    },
    () => {
      if (browserPromise === launch) {
        browserPromise = undefined;
      }
    },
  );

  return launch;
}

export async function startBrowser(): Promise<void> {
  await getBrowser();
}

export async function closeBrowser(): Promise<void> {
  const currentBrowser = browserPromise;
  browserPromise = undefined;

  if (!currentBrowser) {
    return;
  }

  const browser = await currentBrowser;

  if (browser.isConnected()) {
    await browser.close();
  }
}
