"""
Fake News Detection — ML Service
Endpoints:
  POST /extract-keywords  → returns a search query string from article text
  POST /compare-similarity → returns cosine similarity scores + verdict
"""

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from typing import List
import yake
import numpy as np
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Fake News ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Lazy-load sentence transformer (avoids cold-start at import time)
_model = None

def get_model():
    global _model
    if _model is None:
        from sentence_transformers import SentenceTransformer
        logger.info("Loading sentence-transformer model…")
        _model = SentenceTransformer("all-MiniLM-L6-v2")
        logger.info("Model loaded.")
    return _model


# ─────────────────────────────────────────────
# Request / Response schemas
# ─────────────────────────────────────────────

class KeywordRequest(BaseModel):
    text: str

class KeywordResponse(BaseModel):
    query: str
    keywords: List[str]

class SimilarityRequest(BaseModel):
    input_text: str
    scraped_texts: List[str]          # list of raw article texts
    urls: List[str] = []               # optional — echoed back in response
    titles: List[str] = []             # optional — echoed back in response

class SourceResult(BaseModel):
    url: str
    title: str
    similarity: float

class SimilarityResponse(BaseModel):
    label: str                         # "REAL" | "FAKE"
    confidence: float                  # 0-100
    mean_similarity: float             # 0-1
    sources: List[SourceResult]
    explanation: str


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

MAX_CHARS = 3000   # truncation limit per text

def truncate(text: str, limit: int = MAX_CHARS) -> str:
    return text[:limit] if len(text) > limit else text


def extract_keywords_yake(text: str, max_keywords: int = 8) -> List[str]:
    """Return top keywords using YAKE."""
    kw_extractor = yake.KeywordExtractor(
        lan="en",
        n=2,          # up to bigrams
        dedupLim=0.7,
        top=max_keywords,
        features=None,
    )
    keywords = kw_extractor.extract_keywords(text[:2000])
    # YAKE returns (keyword, score) — lower score = more important
    sorted_kws = sorted(keywords, key=lambda x: x[1])
    return [kw for kw, _ in sorted_kws]


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    """Compute cosine similarity between two 1-D vectors."""
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


def build_explanation(label: str, mean_sim: float, num_sources: int) -> str:
    if label == "REAL":
        return (
            f"The article content closely matches {num_sources} web sources "
            f"(average similarity: {mean_sim:.2f}). "
            "Multiple credible sources corroborate the key claims."
        )
    elif mean_sim < 0.15:
        return (
            "No web sources could be found that match the article's claims. "
            "The content appears to be fabricated or highly niche with no verifiable coverage."
        )
    else:
        return (
            f"Web sources found only weak overlap with the article "
            f"(average similarity: {mean_sim:.2f}). "
            "The key claims could not be corroborated by reliable sources."
        )


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@app.get("/health")
def health():
    return {"status": "ok"}


@app.post("/extract-keywords", response_model=KeywordResponse)
def extract_keywords(req: KeywordRequest):
    if not req.text or not req.text.strip():
        raise HTTPException(status_code=400, detail="text is required")

    keywords = extract_keywords_yake(req.text)
    # Build a concise query from the top 4 keywords
    query = " ".join(keywords[:4]) if keywords else req.text[:100]

    return KeywordResponse(query=query, keywords=keywords)


@app.post("/compare-similarity", response_model=SimilarityResponse)
def compare_similarity(req: SimilarityRequest):
    if not req.input_text or not req.input_text.strip():
        raise HTTPException(status_code=400, detail="input_text is required")

    if not req.scraped_texts:
        return SimilarityResponse(
            label="FAKE",
            confidence=90.0,
            mean_similarity=0.0,
            sources=[],
            explanation="No web sources could be fetched to verify the article.",
        )

    model = get_model()

    input_embedding = model.encode(truncate(req.input_text), convert_to_numpy=True)

    valid_sources: List[SourceResult] = []

    for i, text in enumerate(req.scraped_texts):
        if not text or not text.strip():
            continue
        try:
            emb = model.encode(truncate(text), convert_to_numpy=True)
            sim = cosine_similarity(input_embedding, emb)
            valid_sources.append(SourceResult(
                url=req.urls[i] if i < len(req.urls) else "",
                title=req.titles[i] if i < len(req.titles) else f"Source {i+1}",
                similarity=round(sim, 4),
            ))
        except Exception as e:
            logger.warning(f"Embedding failed for source {i}: {e}")

    if not valid_sources:
        return SimilarityResponse(
            label="FAKE",
            confidence=85.0,
            mean_similarity=0.0,
            sources=[],
            explanation="All scraped sources were empty or failed to process.",
        )

    # Sort best matches first
    valid_sources.sort(key=lambda s: s.similarity, reverse=True)

    mean_sim = float(np.mean([s.similarity for s in valid_sources]))

    # Decision thresholds
    REAL_THRESHOLD = 0.40
    UNCERTAIN_THRESHOLD = 0.28

    if mean_sim >= REAL_THRESHOLD:
        label = "REAL"
        # Scale confidence: 0.40 → 55%, 0.70 → 95%
        confidence = min(95.0, 55.0 + (mean_sim - REAL_THRESHOLD) / 0.30 * 40.0)
    elif mean_sim >= UNCERTAIN_THRESHOLD:
        label = "FAKE"
        confidence = 60.0 + (REAL_THRESHOLD - mean_sim) / (REAL_THRESHOLD - UNCERTAIN_THRESHOLD) * 15.0
    else:
        label = "FAKE"
        confidence = min(95.0, 75.0 + (UNCERTAIN_THRESHOLD - mean_sim) / UNCERTAIN_THRESHOLD * 20.0)

    explanation = build_explanation(label, mean_sim, len(valid_sources))

    return SimilarityResponse(
        label=label,
        confidence=round(confidence, 1),
        mean_similarity=round(mean_sim, 4),
        sources=valid_sources[:6],   # top 6
        explanation=explanation,
    )
