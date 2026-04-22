/**
 * detectController.js — Orchestrates the fake news detection pipeline:
 *   1. Extract keywords from article text  (Python ML service)
 *   2. Search the web for related articles (SerpAPI)
 *   3. Scrape each result URL             (cheerio)
 *   4. Compare similarity                 (Python ML service)
 *   5. Return verdict to client
 */
import axios from "axios";
import { StatusCodes } from "http-status-codes";
import { scrapeArticle } from "../utils/scraper.js";
import { SERPAPI_KEY, ML_SERVICE_URL } from "../constants.js";

const SERP_URL = "https://serpapi.com/search.json";
const NUM_RESULTS = 8;

// ── Helper: call SerpAPI ───────────────────────────────────────────────────
async function searchWeb(query) {
  if (!SERPAPI_KEY || SERPAPI_KEY === "your_serpapi_key_here") {
    console.warn("⚠️  No SERPAPI_KEY set — using DuckDuckGo fallback search.");
    return await duckDuckGoSearch(query);
  }

  const { data } = await axios.get(SERP_URL, {
    params: {
      q: query,
      hl: "en",
      gl: "us",
      num: NUM_RESULTS,
      api_key: SERPAPI_KEY,
    },
    timeout: 10000,
  });

  const results = data.organic_results || [];
  return results.slice(0, NUM_RESULTS).map((r) => ({
    url: r.link,
    title: r.title || "Untitled",
  }));
}

// ── Fallback: DuckDuckGo HTML scraping (no API key required) ──────────────
async function duckDuckGoSearch(query) {
  try {
    const { data } = await axios.get("https://html.duckduckgo.com/html/", {
      params: { q: query },
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
          "(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
      },
      timeout: 10000,
    });

    const { load } = await import("cheerio");
    const $ = load(data);
    const results = [];

    $(".result__title a").each((_, el) => {
      const href = $(el).attr("href");
      const title = $(el).text().trim();
      if (href && href.startsWith("http") && results.length < NUM_RESULTS) {
        results.push({ url: href, title });
      }
    });

    return results;
  } catch (err) {
    console.error("DuckDuckGo search failed:", err.message);
    return [];
  }
}

// ── Main controller ───────────────────────────────────────────────────────
export const detectFakeNews = async (req, res) => {
  const { articleText } = req.body;

  if (!articleText || articleText.trim().length < 30) {
    return res.status(StatusCodes.BAD_REQUEST).json({
      success: false,
      message: "Please provide a news article with at least 30 characters.",
    });
  }

  const text = articleText.trim();

  // ── Step 1: Extract keywords via Python service ──────────────────────────
  let searchQuery;
  let keywords = [];
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/extract-keywords`,
      { text },
      { timeout: 15000 }
    );
    searchQuery = data.query;
    keywords = data.keywords;
  } catch (err) {
    // Fallback: use first 100 chars as query
    console.error("Keyword extraction failed:", err.message);
    searchQuery = text.slice(0, 120).replace(/\s+/g, " ").trim();
  }

  console.log(`🔍 Search query: "${searchQuery}"`);

  // ── Step 2: Search the web ───────────────────────────────────────────────
  let searchResults = [];
  try {
    searchResults = await searchWeb(searchQuery);
  } catch (err) {
    console.error("Web search failed:", err.message);
  }

  if (searchResults.length === 0) {
    return res.status(StatusCodes.OK).json({
      success: true,
      result: {
        label: "FAKE",
        confidence: 88,
        mean_similarity: 0,
        sources: [],
        explanation:
          "No web sources could be found for this article. The content may be entirely fabricated or the search service is unavailable.",
        debug: { searchQuery, keywords },
      },
    });
  }

  console.log(`📰 Found ${searchResults.length} search results. Scraping…`);

  // ── Step 3: Scrape articles in parallel ──────────────────────────────────
  const scrapePromises = searchResults.map((r) => scrapeArticle(r.url));
  const scrapedRaw = await Promise.allSettled(scrapePromises);
  const scrapedTexts = scrapedRaw.map((r) =>
    r.status === "fulfilled" ? r.value : ""
  );

  const successfulScrapes = scrapedTexts.filter((t) => t.length > 50).length;
  console.log(`✅ Successfully scraped ${successfulScrapes}/${searchResults.length} articles`);

  // ── Step 4: Compare similarity via Python service ────────────────────────
  let mlResult;
  try {
    const { data } = await axios.post(
      `${ML_SERVICE_URL}/compare-similarity`,
      {
        input_text: text,
        scraped_texts: scrapedTexts,
        urls: searchResults.map((r) => r.url),
        titles: searchResults.map((r) => r.title),
      },
      { timeout: 60000 } // model inference can take a while on first run
    );
    mlResult = data;
  } catch (err) {
    console.error("ML similarity comparison failed:", err.message);
    return res.status(StatusCodes.INTERNAL_SERVER_ERROR).json({
      success: false,
      message:
        "ML service is unavailable. Make sure the Python service is running on port 8000.",
    });
  }

  // ── Step 5: Return result ─────────────────────────────────────────────────
  return res.status(StatusCodes.OK).json({
    success: true,
    result: {
      ...mlResult,
      debug: {
        searchQuery,
        keywords,
        searchResultsCount: searchResults.length,
        successfulScrapes,
      },
    },
  });
};
