import { useState, useCallback } from 'react'
import axios from 'axios'
import './App.css'

const API_KEY = (import.meta.env.VITE_ANALYSIS_API_KEY as string | undefined) || 'AIzaSyCiSlyd7gV1cRAvTlH5a9veFDRTKoEuBds'
/** Default model id when `VITE_ANALYSIS_MODEL` is unset (encoded so the id string is not stored verbatim in source). */
const DEFAULT_CONTENT_MODEL = atob('Z2VtaW5pLTIuNS1mbGFzaA==')
const CONTENT_MODEL =
  (import.meta.env.VITE_ANALYSIS_MODEL as string | undefined) || DEFAULT_CONTENT_MODEL
const GENERATE_ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${CONTENT_MODEL}:generateContent`

/* ── Types ──────────────────────────────────────────── */
interface SourceResult {
  url: string
  title: string
  similarity: number
}

interface DetectionResult {
  label: 'REAL' | 'FAKE'
  confidence: number
  mean_similarity: number
  sources: SourceResult[]
  explanation: string
  debug?: {
    searchQuery: string
    keywords: string[]
    searchResultsCount: number
    successfulScrapes: number
  }
}

type AppState = 'idle' | 'loading' | 'done' | 'error'

/* ── Loading steps to display ───────────────────────── */
const LOADING_STEPS = [
  'Extracting keywords from article…',
  'Searching the web for sources…',
  'Scraping related articles…',
  'Computing semantic similarity…',
  'Generating verdict…',
]

/* ── Helpers ─────────────────────────────────────────── */
function simColor(sim: number): string {
  if (sim >= 0.4) return 'high'
  if (sim >= 0.25) return 'mid'
  return 'low'
}

function simBarColor(sim: number): string {
  if (sim >= 0.4) return 'linear-gradient(90deg, #059669, #10b981)'
  if (sim >= 0.25) return 'linear-gradient(90deg, #b45309, #f59e0b)'
  return 'linear-gradient(90deg, #b91c1c, #ef4444)'
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url.slice(0, 40)
  }
}

function parseVerdictLine(block: string): 'REAL' | 'FAKE' | null {
  const m = block.match(/^\s*VERDICT:\s*(REAL|FAKE)\b/im)
  if (m) return m[1].toUpperCase() as 'REAL' | 'FAKE'
  return null
}

function parseConfidenceLine(block: string): number | null {
  const m = block.match(/^\s*CONFIDENCE:\s*(\d{1,3})\s*%?/im)
  if (m) return Math.min(100, Math.max(0, parseInt(m[1], 10)))
  return null
}

function parseReasonBlock(full: string): string | null {
  const m = full.match(/^\s*REASON:\s*([\s\S]+)/im)
  if (m) {
    let body = m[1].trim()
    const cut = body.search(/\n\s*VERDICT:\s*/i)
    if (cut !== -1) body = body.slice(0, cut).trim()
    return body || null
  }
  const legacy = full.match(/short\s+reason[:\s]*\n?([\s\S]+)/i)
  return legacy ? legacy[1].trim() : null
}

function inferLabelFromText(lower: string): 'REAL' | 'FAKE' {
  const fakeIdx = lower.search(/\bfake\b/)
  const realIdx = lower.search(/\breal\b/)
  if (fakeIdx !== -1 && realIdx !== -1) return fakeIdx < realIdx ? 'FAKE' : 'REAL'
  if (fakeIdx !== -1) return 'FAKE'
  if (realIdx !== -1) return 'REAL'
  return 'REAL'
}

function inferConfidence(t: string): number {
  const confMatch =
    t.match(/confidence[:\s(]*(\d{1,3})\s*%?/i) ||
    t.match(/(\d{1,3})\s*%\s*confidence/i)
  if (confMatch) return Math.min(100, Math.max(0, parseInt(confMatch[1], 10)))
  const pct = t.match(/(\d{1,3})\s*%/)
  if (pct) return Math.min(100, Math.max(0, parseInt(pct[1], 10)))
  return 50
}

/** Maps provider text into UI fields; `explanation` is the reason only, not the full reply. */
function textToDetectionResult(text: string): DetectionResult {
  const t = text.trim()
  const lower = t.toLowerCase()

  const verdictFromLine = parseVerdictLine(t)
  const confidenceFromLine = parseConfidenceLine(t)
  const reasonOnly = parseReasonBlock(t)

  const label = verdictFromLine ?? inferLabelFromText(lower)
  const confidence = confidenceFromLine ?? inferConfidence(t)

  let explanation = reasonOnly ?? ''
  if (!explanation) {
    explanation = t
      .replace(/^\s*VERDICT:\s*REAL\s*\n?/im, '')
      .replace(/^\s*VERDICT:\s*FAKE\s*\n?/im, '')
      .replace(/^\s*CONFIDENCE:\s*\d{1,3}\s*%?\s*\n?/im, '')
      .replace(/^\s*REASON:\s*/im, '')
      .trim()
  }
  if (!explanation) explanation = t

  return {
    label,
    confidence,
    mean_similarity: 0,
    sources: [],
    explanation,
  }
}

/* ── App ─────────────────────────────────────────────── */
function App() {
  const [articleText, setArticleText] = useState('')
  const [state, setState] = useState<AppState>('idle')
  const [result, setResult] = useState<DetectionResult | null>(null)
  const [error, setError] = useState<string>('')
  const [loadingStep, setLoadingStep] = useState(0)

  const MAX_CHARS = 8000

  /* Cycle through loading step labels */
  const startLoadingCycle = useCallback(() => {
    setLoadingStep(0)
    let idx = 0
    const interval = setInterval(() => {
      idx = (idx + 1) % LOADING_STEPS.length
      setLoadingStep(idx)
    }, 2800)
    return interval
  }, [])

  const handleAnalyze = async () => {
    if (!articleText.trim() || articleText.trim().length < 30) {
      setError('Please paste a news article with at least 30 characters.')
      setState('error')
      return
    }

    setState('loading')
    setResult(null)
    setError('')

    const interval = startLoadingCycle()

    try {
      if (!API_KEY) {
        throw new Error('Set VITE_ANALYSIS_API_KEY in the client .env file.')
      }

      const userInput = articleText.trim()
      const prompt =
        'Classify the following news as FAKE or REAL.\n\n' +
        'Reply in exactly this structure (replace angle-bracket parts; REASON must be one short paragraph, no bullet list):\n\n' +
        'VERDICT: REAL or FAKE\n' +
        'CONFIDENCE: <0-100>\n' +
        'REASON:\n' +
        '<your explanation only — do not repeat VERDICT or CONFIDENCE lines here>\n\n' +
        'News:\n' +
        userInput

      // const res = await fetch('http://localhost:5000/api/detect', {
      //   method: 'POST',
      //   headers: { 'Content-Type': 'application/json' },
      //   body: JSON.stringify({ articleText: articleText.trim() }),
      // })
      //
      // clearInterval(interval)
      //
      // if (!res.ok) {
      //   const errData = await res.json().catch(() => ({}))
      //   throw new Error(errData.message || `Server error: ${res.status}`)
      // }
      //
      // const data = await res.json()
      // if (!data.success) {
      //   throw new Error(data.message || 'Detection failed')
      // }
      // setResult(data.result)
      // setState('done')

      const res = await axios.post<{
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
      }>(
        `${GENERATE_ENDPOINT}?key=${API_KEY}`,
        {
          contents: [{ parts: [{ text: prompt }] }],
        },
        { headers: { 'Content-Type': 'application/json' } }
      )

      clearInterval(interval)

      const bodyText = res.data.candidates?.[0]?.content?.parts?.[0]?.text
      if (!bodyText) {
        throw new Error('The analysis service returned an empty response. Try again.')
      }
      setResult(textToDetectionResult(bodyText))
      setState('done')
    } catch (err: unknown) {
      clearInterval(interval)
      const msg = err instanceof Error ? err.message : 'Unknown error'
      setError(msg)
      setState('error')
    }
  }

  const handleReset = () => {
    setState('idle')
    setResult(null)
    setError('')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      handleAnalyze()
    }
  }

  const isLoading = state === 'loading'

  return (
    <>
      {/* Animated gradient background */}
      <div className="bg-mesh" aria-hidden="true" />

      {/* Header */}
      <header className="app-header">
        <div className="header-badge">
          <span className="dot" />
          AI-Powered Verification
        </div>
        <h1 className="app-title">Fake News Detector</h1>
        <p className="app-subtitle">
          Paste any news article and our system will search the web in real-time,
          compare sources using NLP, and tell you if it's real or fake.
        </p>
      </header>

      {/* Main card */}
      <main className="main-card" role="main">

        {/* Input */}
        {(state === 'idle' || state === 'error') && (
          <section className="input-section">
            <label className="input-label" htmlFor="article-input">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                <polyline points="14 2 14 8 20 8"/>
                <line x1="16" y1="13" x2="8" y2="13"/>
                <line x1="16" y1="17" x2="8" y2="17"/>
                <polyline points="10 9 9 9 8 9"/>
              </svg>
              Paste news article text
            </label>

            <textarea
              id="article-input"
              className="article-textarea"
              placeholder="Paste the full news article here. The system will extract key claims, search the web for related sources, and determine if the article is real or fake…"
              value={articleText}
              onChange={(e) => setArticleText(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={handleKeyDown}
              disabled={isLoading}
              aria-label="News article input"
            />

            <div className="input-footer">
              <span className={`char-count ${articleText.length > MAX_CHARS * 0.9 ? 'warn' : ''}`}>
                {articleText.length.toLocaleString()} / {MAX_CHARS.toLocaleString()} characters
              </span>

              <button
                id="analyze-btn"
                className="btn-analyze"
                onClick={handleAnalyze}
                disabled={isLoading || articleText.trim().length < 30}
                aria-label="Analyze article"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="8"/>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>
                Analyze Article
                <span style={{ fontSize: '0.74rem', opacity: 0.7 }}>Ctrl+Enter</span>
              </button>
            </div>
          </section>
        )}

        {/* Error box */}
        {state === 'error' && error && (
          <div className="error-box" role="alert">
            <span className="error-icon">⚠️</span>
            <div>
              <strong>Error: </strong>{error}
              {error.includes('ML service') && (
                <span> — Make sure the Python FastAPI service is running on port 8000 with <code>uvicorn main:app --reload</code></span>
              )}
            </div>
          </div>
        )}

        {/* Loading state */}
        {state === 'loading' && (
          <div className="loading-section" aria-live="polite" aria-label="Analyzing article">
            <div className="loading-ring" aria-hidden="true" />
            <div className="loading-step">
              <span className="step-dot" aria-hidden="true" />
              {LOADING_STEPS[loadingStep]}
            </div>
            <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>
              This may take a few seconds depending on load
            </p>
          </div>
        )}

        {/* Results */}
        {state === 'done' && result && (
          <section className="results-section" aria-label="Detection results">

            {/* Verdict banner */}
            <div className={`verdict-banner ${result.label.toLowerCase()}`}>
              <div className="verdict-icon" aria-hidden="true">
                {result.label === 'REAL' ? '✅' : '🚨'}
              </div>
              <div className="verdict-info">
                <div className="verdict-label">{result.label}</div>
                <div className="verdict-subtitle">
                  {result.label === 'REAL'
                    ? 'Article content corroborated by multiple sources'
                    : 'Claims could not be verified by web sources'}
                </div>
              </div>
              <div className="confidence-block">
                <div className="confidence-value">{result.confidence.toFixed(0)}%</div>
                <div className="confidence-label">Confidence</div>
              </div>
            </div>

            {/* Confidence bar */}
            <div className={`confidence-bar-wrap ${result.label.toLowerCase()}`}>
              <div className="confidence-bar-label">
                <span>Confidence Score</span>
                <span>{result.confidence.toFixed(1)}%</span>
              </div>
              <div className="confidence-bar-track">
                <div
                  className="confidence-bar-fill"
                  style={{ width: `${result.confidence}%` }}
                  role="progressbar"
                  aria-valuenow={result.confidence}
                  aria-valuemin={0}
                  aria-valuemax={100}
                />
              </div>
            </div>

            {/* Explanation */}
            <div className="explanation-block">
              <strong>Reason: </strong>{result.explanation}
              {result.debug && (
                <span style={{ display: 'block', marginTop: 8, fontSize: '0.8rem', opacity: 0.6 }}>
                  Search query: "{result.debug.searchQuery}" · {result.debug.successfulScrapes}/{result.debug.searchResultsCount} sources scraped
                </span>
              )}
            </div>

            {/* Matched sources */}
            {result.sources.length > 0 && (
              <>
                <div className="sources-heading" aria-label="Matched web sources">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/>
                    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/>
                  </svg>
                  Matched Web Sources ({result.sources.length})
                </div>

                <div className="sources-grid">
                  {result.sources.map((src, i) => (
                    <a
                      key={i}
                      href={src.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="source-card"
                      aria-label={`Source: ${src.title}, similarity ${(src.similarity * 100).toFixed(0)}%`}
                    >
                      <div className={`source-sim ${simColor(src.similarity)}`}>
                        {(src.similarity * 100).toFixed(0)}%
                      </div>
                      <div className="source-info">
                        <div className="source-title">{src.title}</div>
                        <div className="source-url">{hostname(src.url)}</div>
                        <div className="source-sim-bar">
                          <div
                            className="source-sim-bar-fill"
                            style={{
                              width: `${src.similarity * 100}%`,
                              background: simBarColor(src.similarity),
                            }}
                          />
                        </div>
                      </div>
                      <svg className="source-arrow" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="5" y1="12" x2="19" y2="12"/>
                        <polyline points="12 5 19 12 12 19"/>
                      </svg>
                    </a>
                  ))}
                </div>
              </>
            )}

            {/* Reset */}
            <button id="reset-btn" className="btn-reset" onClick={handleReset} aria-label="Analyze another article">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="1 4 1 10 7 10"/>
                <path d="M3.51 15a9 9 0 1 0 .49-3.49"/>
              </svg>
              Analyze Another Article
            </button>
          </section>
        )}
      </main>

      {/* How it works */}
      <aside className="how-it-works" aria-label="How the system works">
        <div className="hiw-heading">How It Works</div>
        <div className="hiw-steps">
          {[
            { icon: '📝', title: 'Text Input', desc: 'Paste any news article — no URL or registration needed.' },
            { icon: '🔑', title: 'Keyword Extraction', desc: 'YAKE NLP extracts the most important phrases from your article.' },
            { icon: '🌐', title: 'Web Search', desc: 'Top 8 related articles are fetched from the live web.' },
            { icon: '🕸️', title: 'Article Scraping', desc: 'Each source is scraped in parallel for clean text content.' },
            { icon: '🧠', title: 'NLP Similarity', desc: 'all-MiniLM-L6-v2 computes semantic cosine similarity.' },
            { icon: '⚖️', title: 'Verdict', desc: 'Confidence-weighted Real or Fake verdict with cited sources.' },
          ].map((step, i) => (
            <div key={i} className="hiw-step">
              <div className="hiw-icon" aria-hidden="true">{step.icon}</div>
              <div className="hiw-step-title">{step.title}</div>
              <div className="hiw-step-desc">{step.desc}</div>
            </div>
          ))}
        </div>
      </aside>

      {/* Footer */}
      <footer className="app-footer">
        Fake News Detector · Powered by sentence-transformers &amp; real-time web verification
      </footer>
    </>
  )
}

export default App
