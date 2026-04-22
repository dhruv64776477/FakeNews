/**
 * scraper.js — Fetches and extracts clean paragraph text from a URL.
 * Uses axios for HTTP requests and cheerio for HTML parsing.
 */
import axios from "axios";
import * as cheerio from "cheerio";

const TIMEOUT_MS = 6000;
const MAX_CHARS = 3000;

// Common boilerplate selectors to remove before extracting text
const REMOVE_SELECTORS = [
  "script",
  "style",
  "noscript",
  "iframe",
  "nav",
  "header",
  "footer",
  "aside",
  ".ad",
  ".ads",
  ".advertisement",
  ".cookie-banner",
  ".popup",
  '[role="navigation"]',
  '[role="banner"]',
  '[role="complementary"]',
];

/**
 * Scrape an article URL and return clean paragraph text.
 * @param {string} url
 * @returns {Promise<string>}  Clean text, truncated to MAX_CHARS
 */
export async function scrapeArticle(url) {
  try {
    const response = await axios.get(url, {
      timeout: TIMEOUT_MS,
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
        "Accept-Language": "en-US,en;q=0.9",
      },
      maxRedirects: 5,
    });

    const $ = cheerio.load(response.data);

    // Remove noise
    REMOVE_SELECTORS.forEach((sel) => $(sel).remove());

    // Prefer article / main content areas
    const contentSelectors = [
      "article",
      '[role="main"]',
      "main",
      ".article-body",
      ".post-content",
      ".entry-content",
      ".story-body",
      ".content-body",
      "#content",
      "#main-content",
    ];

    let paragraphs = [];

    for (const sel of contentSelectors) {
      const el = $(sel);
      if (el.length > 0) {
        el.find("p").each((_, p) => {
          const text = $(p).text().trim();
          if (text.length > 30) paragraphs.push(text);
        });
        if (paragraphs.length > 2) break;
      }
    }

    // Fallback: all paragraphs on the page
    if (paragraphs.length === 0) {
      $("p").each((_, p) => {
        const text = $(p).text().trim();
        if (text.length > 30) paragraphs.push(text);
      });
    }

    const fullText = paragraphs.join(" ").replace(/\s+/g, " ").trim();
    return fullText.slice(0, MAX_CHARS);
  } catch (err) {
    // Silently swallow network/access errors — handled upstream
    return "";
  }
}
