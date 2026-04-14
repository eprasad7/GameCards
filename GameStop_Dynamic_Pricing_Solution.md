# GameStop Collectibles Dynamic Pricing Engine
## Technical Solution Architecture & Implementation Plan

**Prepared by:** Ish Prasad | Staff AI/ML Engineer
**Date:** April 2026
**For:** Ravi & Team — GameStop AI/ML Engineering

---

## Executive Summary

GameStop's collectibles business (graded trading cards — Pokemon, sports, TCG) currently prices cards using daily batch scrapes from eBay, with no price history storage, no sentiment analysis, and no ML-based pricing. This document presents a complete technical architecture for a **dynamic pricing engine** that combines multi-source market data, social sentiment, ML price prediction with uncertainty quantification, and anomaly detection — all designed to be built in-house with open-source tools.

**The core insight:** Collectibles pricing is a *sparse, irregular, fat-tailed* prediction problem — not a standard time series. Most cards sell infrequently (1-10x per month), prices can 10x overnight on social virality, and the same card at different grades can differ 50x in value. The system must handle this heterogeneity with volume-aware routing, not a one-size-fits-all model.

**GameStop's unique advantage:** Physical store foot traffic + trade-in pricing data that no online competitor (PriceCharting, Alt, Card Ladder) has access to. This is the moat.

---

## 1. Data Architecture

### 1.1 Data Sources — Priority Ranked

| Priority | Source | Data Type | Access Method | Cost | Update Frequency |
|----------|--------|-----------|---------------|------|-----------------|
| **P0** | eBay Marketplace Insights API | Sold listings (90 days) | Limited Release API — negotiate access | Negotiate | Event-driven (every 15 min) |
| **P0** | SoldComps API | eBay sold listings (365 days) | REST API | $59/mo (5,000 req/mo) | Hourly |
| **P0** | PriceCharting API | Aggregated prices (all time) | REST API (40-char token) | ~$15-30/mo (Legendary tier) | Daily CSV |
| **P1** | PSA Population Reports | Grade population counts | Web scrape (psacard.com/pop) or GemRate | Free (GemRate) | Daily |
| **P1** | CardHedger API | 40M+ transactions, multi-platform | REST API | $49+/mo | Near real-time |
| **P1** | Reddit API | Social sentiment | OAuth REST | $12K/yr (Standard tier) | Every 5 min |
| **P2** | Twitter/X API | Event detection, viral moments | Pay-per-use | ~$500-1K/mo | Real-time filtered stream |
| **P2** | TCGPlayer API | Pokemon/MTG market prices | Apply for access | Free (with approval) | Daily |
| **P2** | PokemonPriceTracker API | Graded Pokemon prices + pop | REST API | $99/mo (Business) | Daily |
| **P3** | GameStop internal | Trade-in data, foot traffic, inventory | Internal DB | Free | Real-time |

### 1.2 eBay Strategy — Legal & Practical

**Do NOT scrape eBay directly.** eBay explicitly bans AI agents and scraping in their Feb 2026 User Agreement. As a publicly traded company with an eBay business relationship, GameStop cannot afford the legal/business risk.

**Instead:**
1. **Negotiate Marketplace Insights API access** — GameStop's retail footprint gives leverage. This API returns sold items for last 90 days and is the gold standard.
2. **Use SoldComps as fallback** ($59/mo) — licensed eBay sold data via REST API, up to 240 results per request, 365 days history.
3. **Use CardHedger for multi-platform** ($49/mo) — aggregates eBay, Fanatics, Heritage Auctions, and more.

### 1.3 Price History Storage (The Gap Ravi Identified)

Currently, GameStop doesn't store price history. This is the foundation everything else depends on.

```
┌─────────────────────────────────────────────────────────────────┐
│                    Price History Database                         │
│                    (Cloudflare D1 — SQLite at the edge)           │
│                                                                  │
│  Tables:                                                         │
│  ├── card_catalog        — master card registry with attributes  │
│  ├── price_observations  — every scraped/API price point         │
│  │   (card_id, source, price, date, grade, sale_type,           │
│  │    seller_id*, bid_count, listing_url)                        │
│  │   *seller_id availability depends on feed; verify per source  │
│  ├── price_aggregates    — daily/weekly rollups per card+grade   │
│  ├── population_reports  — daily PSA/CGC/BGS pop snapshots      │
│  ├── sentiment_raw       — individual sentiment observations     │
│  ├── sentiment_scores    — rolled-up 24h/7d/30d sentiment        │
│  ├── feature_store       — pre-computed ML features per card     │
│  ├── model_predictions   — model outputs with confidence bands   │
│  └── price_alerts        — triggered alerts for price movements  │
│                                                                  │
│  Dedup: unique indexes on (card_id, source, listing_url)         │
│  Aggregation: application-level daily/weekly/monthly rollups     │
│  Archival: old observations moved to R2 (Parquet/CSV)            │
│  D1 limit: 10GB per database — plan for archival at ~6 months    │
└─────────────────────────────────────────────────────────────────┘
```

**Why Cloudflare D1:** SQLite at the edge with zero cold starts, global replication, and ~$5-20/mo at moderate scale. No separate database server to manage. The team writes standard SQL. Trade-off: no native time-series extensions (handled in application code via cron-triggered aggregation).

### 1.4 Data Pipeline Architecture

```
                    ┌─────────────┐
                    │   Sources   │
                    └──────┬──────┘
                           │
        ┌──────────────────┼──────────────────┐
        │                  │                  │
   eBay/SoldComps    Reddit/Twitter     PriceCharting
   (every 15 min)    (every 5 min)     (daily)
        │                  │                  │
        ▼                  ▼                  ▼
   ┌─────────────────────────────────────────────┐
   │     Cloudflare Cron Triggers + Queues        │
   │                                               │
   │  Cron: soldcomps ingestion   (every 15 min)  │
   │  Cron: reddit sentiment      (every 5 min)   │
   │  Cron: pricecharting          (daily 2am)    │
   │  Cron: psa population         (daily 3am)    │
   │  Cron: anomaly detection      (daily 4am)    │
   │  Cron: aggregates + features  (daily 5am)    │
   │  Cron: generate predictions   (daily 6am)    │
   │  Cron: sentiment rollup       (hourly)       │
   │  Queue: price observations    (async batch)  │
   │  Queue: sentiment analysis    (async AI)     │
   └──────────────────┬──────────────────────────┘
                      │
                      ▼
   ┌─────────────────────────────────────────────┐
   │        Cloudflare D1 (Price History)         │
   │  + KV (cache hot prices, rate limiting)      │
   │  + R2 (raw data archive, model artifacts)    │
   │  + Workers AI (sentiment NLP)                │
   └──────────────────┬──────────────────────────┘
                      │
           ┌──────────┼──────────┐
           │          │          │
           ▼          ▼          ▼
      Pricing API  Dashboard  Alerts
      (Hono/Workers) (Vite/React) (in-app)
```

---

## 2. Feature Engineering

### 2.1 Feature Categories & Importance

Based on research across collectibles pricing systems, academic papers, and production implementations (PriceCharting, Alt, Card Ladder, StockX):

| Rank | Feature Group | Predictive Power | Implementation Complexity |
|------|--------------|-----------------|--------------------------|
| 1 | **Grade + Grading Company** | ~25-30% of variance | Low — structured data from PSA/CGC |
| 2 | **Card Identity** (set, number, player/character) | ~20-25% | Medium — learned embeddings |
| 3 | **Recent Sold Prices** (lagged features) | ~15-20% | Low — rolling stats from price history |
| 4 | **Population Report** (supply) | ~8-12% | Medium — daily pop scraping |
| 5 | **Sold Velocity** (demand signal) | ~5-8% | Low — count sales per window |
| 6 | **Macro Market Index** | ~3-5% | Medium — aggregate market health |
| 7 | **Player/Meta Performance** | ~3-5% | High — domain-specific APIs |
| 8 | **Seasonality** | ~2-3% | Low — calendar features |
| 9 | **Social Sentiment** | ~1-3% | High — NLP pipeline required |
| 10 | **Rarity Metrics** | ~2-4% | Medium — print run data |

### 2.2 Critical Feature Details

**Grade & Population Features:**
```python
{
    'grade_numeric': 9.5,                    # 1-10 scale
    'grading_company': 'PSA',                # PSA, BGS, CGC, SGC
    'is_gem_mint': True,                     # grade >= 9.5
    'is_perfect_10': False,
    'pop_at_grade': 47,                      # how many exist at this grade
    'pop_higher': 3,                         # how many graded higher
    'pop_ratio': 0.047,                      # % of total pop at this grade
    'is_pop_1': False,                       # unique at this grade
    'pop_growth_rate_90d': 0.12,             # 12% more graded in last 90 days
    # KEY INSIGHT: PSA 10 with pop 5 is worth dramatically more than pop 500
    # The relationship is highly nonlinear — tree models capture this well
}
```

**Demand Signals:**
```python
{
    'sales_count_7d': 3,
    'sales_count_30d': 12,
    'sales_count_90d': 28,
    'velocity_trend': 1.4,                   # 7d rate / 30d rate — >1 = accelerating
    'price_momentum': 1.08,                  # 7d MA / 30d MA — >1 = rising
}
```

> **Deferred features (require live listing snapshots — not available from sold-listing feeds):**
> - `active_listings_count` — needs eBay Browse API or recurring listing snapshots
> - `days_of_inventory` — needs listing-history storage over time (listing count / daily sales rate); a single Browse API call is insufficient
> - `sell_through_rate` — needs recurring listing snapshots to compute sold/listed ratio over time
> - `avg_bidders_last_5_auctions` — needs bid-event data, not exposed by SoldComps or CardHedger
>
> These features can be added in Phase 2+ if eBay Browse API access is secured **and** a listing-snapshot pipeline is built to store historical listing counts.

**Sentiment Features (from Reddit/Twitter pipeline):**
```python
{
    'social_mention_count_7d': 47,
    'social_mention_trend': 2.1,             # 7d / 30d normalized — >1 = spiking
    'social_sentiment_score': 0.72,          # -1 to 1 (bearish to bullish)
    'reddit_post_count_7d': 12,
    'influencer_mention_7d': True,           # mentioned by top YouTuber/streamer
    'search_interest_trend': 1.5,            # Google Trends normalized
}
```

**Seasonality Features:**
```python
{
    'is_holiday_season': False,              # Nov-Dec = +10-20% prices
    'is_tax_refund_season': True,            # Feb-Apr = buying surge
    'is_summer_lull': False,                 # Jun-Aug = lower activity
    'is_nfl_season': True,                   # for football cards
    'days_since_set_release': 45,            # new sets spike then decay
    'month_sin': 0.866,                      # cyclical encoding
    'month_cos': 0.5,
}
```

**GameStop-Exclusive Features (the moat):**
```python
{
    'gamestop_trade_in_volume_7d': 8,        # cards traded in at GS stores
    'gamestop_store_price': 45.99,           # current GS listed price
    'gamestop_inventory_count': 3,           # cards in GS inventory
    'gamestop_days_in_inventory': 22,        # aging signal
    'gamestop_regional_demand': 'high',      # from store-level data
    # NO COMPETITOR HAS THIS DATA
}
```

---

## 3. ML Model Architecture

### 3.1 The Core Problem: Heterogeneous Liquidity

Not all cards are created equal. A base set Charizard PSA 10 sells multiple times per week. A 1987 Topps Barry Bonds PSA 8 sells once every 2 months. The model architecture must adapt to volume.

### 3.2 Volume-Aware Ensemble

```
┌─────────────────────────────────────────────────────────────┐
│                    ENSEMBLE PRICING ENGINE                    │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  HIGH VOLUME (50+ sales/quarter)           ~15% of cards     │
│  ├── LightGBM quantile regression (primary)                  │
│  ├── Temporal Fusion Transformer (temporal dynamics)          │
│  └── LSTM for momentum capture                               │
│  → Meta-learner weighted average                             │
│  → Tight confidence intervals (±10-15%)                      │
│                                                               │
│  MEDIUM VOLUME (10-50 sales/quarter)       ~25% of cards     │
│  ├── LightGBM with stronger regularization                   │
│  ├── Gaussian Process regression (natural uncertainty)        │
│  └── KNN comparable sales (cold-start backup)                │
│  → GP uncertainty widens intervals (±15-25%)                 │
│                                                               │
│  LOW VOLUME (< 10 sales/quarter)           ~60% of cards     │
│  ├── Hierarchical Bayesian model (borrows from similar)      │
│  ├── GP with informative priors                              │
│  └── Comparable sales (KNN in feature space)                 │
│  → Wide uncertainty bands (±25-40%), flag for human review   │
│                                                               │
│  MARKET INDEX (feeds into all above as a feature)            │
│  └── Prophet decomposition on aggregate market data          │
│                                                               │
│  META-LEARNER                                                 │
│  └── Stacking regressor: learns which base model to trust    │
│      based on volume, price range, volatility                │
└─────────────────────────────────────────────────────────────┘
```

### 3.3 Primary Model: LightGBM Quantile Regression

LightGBM is the right primary model because:
- Handles mixed feature types natively (categorical grades, continuous prices)
- Captures nonlinear grade-price relationships (PSA 9 vs 10 can be 5-10x)
- Fast inference (<1ms per card)
- Handles missing features gracefully (many features will be NaN for low-volume cards)
- Interpretable via SHAP values

```python
import lightgbm as lgb

# Train on log(price) — normalizes fat-tailed distribution
# Base params — 'objective' is overridden per-quantile below.
# Huber is used only if training a single point-prediction model (not shown here).
params = {
    'objective': 'huber',           # Overridden to 'quantile' in the loop below
    'metric': 'mae',
    'learning_rate': 0.03,
    'num_leaves': 63,
    'min_data_in_leaf': 20,         # Prevents overfitting on sparse cards
    'feature_fraction': 0.8,
    'bagging_fraction': 0.8,
    'bagging_freq': 5,
    'lambda_l1': 0.1,
    'lambda_l2': 1.0,
    'verbose': -1,
}

# Quantile models for uncertainty
# NOTE: Train ALL quantiles used in inference, including p20/p80 for buy/sell thresholds
quantiles = [0.10, 0.20, 0.25, 0.50, 0.75, 0.80, 0.90]
models = {}
for q in quantiles:
    params_q = {**params, 'objective': 'quantile', 'alpha': q}
    models[q] = lgb.train(params_q, train_set, num_boost_round=2000,
                          valid_sets=[val_set],
                          callbacks=[lgb.early_stopping(50)])

# Inference: full price distribution
fair_value = np.exp(models[0.50].predict(X))      # Median = fair market value
buy_threshold = np.exp(models[0.20].predict(X))    # Buy if below this
sell_threshold = np.exp(models[0.80].predict(X))   # Sell if above this
confidence_width = (np.exp(models[0.90].predict(X)) - np.exp(models[0.10].predict(X))) / fair_value
```

**Why Huber loss, not MSE:** A single anomalous $3,000 sale of a card that normally trades at $50 will destroy a model trained with MSE. Huber loss is robust to these fat-tailed outliers.

**Why log(price):** Collectibles prices are log-normally distributed. A $50 card varying ±$10 is the same relative uncertainty as a $5,000 card varying ±$1,000. Log-transform makes the model learn relative, not absolute, error.

### 3.4 Conformal Prediction for Calibrated Uncertainty

Quantile regression gives intervals, but they may not be calibrated (the 90% interval might only cover 78% of actuals). Conformal prediction wraps any model to give **distribution-free coverage guarantees**.

```python
class ConformalPricer:
    """
    Wraps any point prediction model to produce
    prediction intervals with guaranteed coverage.
    """
    def __init__(self, base_model, alpha=0.10):
        # alpha=0.10 gives 90% prediction intervals
        self.base_model = base_model
        self.alpha = alpha

    def calibrate(self, X_cal, y_cal):
        preds = self.base_model.predict(X_cal)
        self.scores = np.sort(np.abs(y_cal - preds))

    def predict_interval(self, X_test):
        preds = self.base_model.predict(X_test)
        n = len(self.scores)
        q_idx = min(int(np.ceil((1 - self.alpha) * (n + 1))) - 1, n - 1)
        width = self.scores[q_idx]
        return preds - width, preds, preds + width
```

### 3.5 Buy/Sell Decision Framework

> **Critical:** Thresholds must be based on **net realizable value (NRV)** — what GameStop actually nets after selling — not raw market quantiles. A model that says "buy at $200" when the card sells for $220 on eBay is a money-loser after fees, shipping, and returns.

```python
# Retail economics constants (adjust per channel)
MARKETPLACE_FEE_PCT = 0.13    # eBay ~13%, COMC ~10%, in-store ~0%
SHIPPING_COST = 5.00           # Average shipping + handling
AUTHENTICATION_COST = 0.00     # Already graded
RETURN_RATE = 0.03             # ~3% return/fraud rate
REQUIRED_MARGIN = 0.20         # 20% minimum gross margin

def compute_nrv(fair_value, channel='ebay'):
    """Net Realizable Value — what GameStop actually nets after a sale."""
    gross = fair_value * (1 - MARKETPLACE_FEE_PCT)
    net_after_returns = gross * (1 - RETURN_RATE)
    nrv = net_after_returns - SHIPPING_COST
    return nrv

def make_pricing_decision(card, models, offered_price):
    preds = {q: models[q].predict(card.features) for q in quantiles}

    fair_value = np.exp(preds[0.50])
    p20 = np.exp(preds[0.20])
    p80 = np.exp(preds[0.80])
    uncertainty = (np.exp(preds[0.90]) - np.exp(preds[0.10])) / fair_value

    # NRV-based thresholds — what GameStop nets, not what the market says
    nrv = compute_nrv(fair_value)
    max_buy_price = nrv * (1 - REQUIRED_MARGIN)  # Max price to achieve target margin

    if offered_price < max_buy_price:
        margin = (nrv - offered_price) / nrv
        if uncertainty < 0.30:
            return 'STRONG_BUY', fair_value, nrv, margin, uncertainty
        else:
            return 'REVIEW_BUY', fair_value, nrv, margin, uncertainty  # Human review
    elif offered_price > p80:
        return 'SELL_SIGNAL', fair_value, nrv, 0, uncertainty
    else:
        return 'FAIR_VALUE', fair_value, nrv, 0, uncertainty
```

---

## 4. Sentiment Analysis Pipeline

### 4.1 Architecture

```
Reddit API (r/pokemontcg, r/baseballcards, etc.)
Twitter/X Filtered Stream (#PokemonTCG, #SportsCards)
        │
        ▼
┌─────────────────────────────────────────┐
│  NLP Pipeline                            │
│                                          │
│  1. Card Mention Extraction (NER)        │
│     "That Charizard PSA 10 is fire"      │
│     → card: Charizard, grade: PSA 10     │
│                                          │
│  2. Sentiment Classification             │
│     FinBERT fine-tuned on collectibles    │
│     → bullish (0.85)                     │
│                                          │
│  3. Hype Detection                       │
│     Volume spike + positive sentiment    │
│     → HYPE_ALERT: Charizard PSA 10       │
│                                          │
│  4. Aggregation                          │
│     Rolling 24h / 7d / 30d scores        │
│     Weighted by engagement (upvotes)     │
└──────────────────┬──────────────────────┘
                   │
                   ▼
         TimescaleDB sentiment_scores table
         → Feeds into ML feature pipeline
```

### 4.2 Target Subreddits

| Subreddit | Members | Focus | Est. Daily Volume |
|-----------|---------|-------|-------------------|
| r/PokemonTCG | ~280K | Pokemon cards | ~500 posts/day |
| r/baseballcards | ~150K | Baseball | ~300 posts/day |
| r/basketballcards | ~60K | Basketball | ~150 posts/day |
| r/footballcards | ~50K | Football | ~120 posts/day |
| r/PKMNTCGDeals | ~100K | Pokemon deals/pricing | ~200 posts/day |
| r/sportscards | ~30K | General sports | ~80 posts/day |
| r/TradingCardCommunity | ~15K | General TCG | ~50 posts/day |

**Combined:** ~2,000-5,000 posts/day, 15,000-40,000 comments/day.
**Reddit API cost:** Free tier (100 RPM) is sufficient for polling. Standard tier ($12K/yr) required for commercial use.
**Twitter/X cost:** ~$500-1K/month at pay-per-use rates for ~100K tweet reads/month.

### 4.3 Viral Event Detection

Social media sentiment's biggest value isn't gradual trend detection — it's **catching viral moments** before they hit prices:

- Influencer pulls a rare card on YouTube/TikTok → 24-48hr price spike
- New set announcement → immediate pre-order pricing impact
- Player injury/trade → sports card price crash within hours
- Ban list update → competitive TCG card values crash immediately
- Celebrity endorsement → category-wide hype

**Detection:** If `social_mention_count_24h > 3 * social_mention_avg_7d` AND `sentiment > 0.5`, trigger an alert and re-price affected cards within 1 hour instead of waiting for daily batch.

---

## 5. Anomaly Detection

### 5.1 Seller-Side Anomaly Detection

> **Data limitation:** The proposed data sources (SoldComps, CardHedger, PriceCharting) return sold-listing summaries, not bid-level event data. True shill-bidding detection (bid-timing patterns, bidder-seller relationship analysis, bid-increment analysis) is **not feasible** without a bid-history feed. The detection below is scoped to what sold-listing data actually supports.

> **Assumption:** `seller_id` availability from licensed feeds (SoldComps, CardHedger) should be verified before relying on seller concentration analysis. If `seller_id` is not consistently exposed, fall back to price-only statistical outlier detection.

```
What we CAN detect from sold listings:
├── Seller price inflation — sellers consistently above market average (via seller_id if available)
├── Statistical price outliers — IQR-based detection on price vs. historical average
├── Suspicious pricing patterns — high-value graded cards at <$1 (data quality)
└── Price spike/crash detection — 7d vs 30d moving average divergence > 30%

What we CANNOT detect without bid-event data:
├── Same bidder repeatedly losing to same seller
├── Bid increment manipulation
├── Concentrated bidding in final seconds
└── Buyer-seller relationship graphs

Model: Statistical outlier detection + seller concentration (if seller_id available)
Action: Flag price for exclusion from training data, create alert for human review
```

### 5.2 Data Quality Issues in Scraped Prices

**The "Best Offer Accepted" problem:** eBay shows the listing price for "Best Offer Accepted" sales, not the actual accepted price. Typical accepted offers are 75-85% of listing price. This biases the model **upward by 15-25%** if not handled.

**Fix:** Flag best-offer sales and apply a discount factor (0.80x), or exclude them from training.

**Lot sales:** "Pokemon lot 50 cards" at $25 is NOT a $25 price point for any individual card. Filter via keyword detection: lot, bundle, collection, set of, x2, x3.

**Currency normalization:** International eBay sales in GBP/EUR/AUD must be converted to USD at the sale date exchange rate.

### 5.3 Market Manipulation Detection

```
Pump and Dump Pattern:
1. Sudden social media spike (coordinated posts)
2. Price spike with concentrated sellers (1-2 accounts) — requires seller_id
3. Volume spike (wash trading between related accounts) — limited detectability
4. Price crash after hype fades

Detection (scoped to available data):
├── Temporal clustering of social mentions (Reddit/Twitter pipeline)
├── Price-volume divergence (price spike without proportional sales increase)
├── Seller concentration analysis (IF seller_id available from feeds)
└── Price spike followed by crash pattern (statistical, no account-level data needed)

Action: Flag card for human review, exclude from model updates
```

---

## 6. Backtesting & Evaluation

### 6.1 Walk-Forward Validation (The Only Valid Approach)

**Never use random train/test splits for time series data.** Always train on past, test on future.

> **Data availability caveat:** Full walk-forward validation requires sufficient history for multiple train/test folds. At launch, SoldComps provides 365 days and eBay Insights provides 90 days of raw transaction data — barely enough for one 12m/1m split. PriceCharting provides all-time aggregated daily prices, which supports walk-forward on price-level features but **cannot** validate transaction-level features (velocity, bid count, seller patterns). Plan for two backtesting phases: (1) launch with PriceCharting backfill + reduced feature set, (2) full walk-forward after 6+ months of raw data accumulation.

```
|--- Train (12 months) ---|--- Test (1 month) ---|
                          |--- Train (13 months) ---|--- Test (1 month) ---|
                                                    |--- Train (14 months) ---|...
```

### 6.2 Metrics

| Metric | What It Measures | Target |
|--------|-----------------|--------|
| **MdAPE** (Median Absolute % Error) | Typical error, robust to outliers | <15% high-vol, <25% mid-vol, <40% low-vol |
| **MAE** | Average absolute dollar error | Depends on price range |
| **Directional Accuracy** | Did we predict up/down correctly? | >60% |
| **Coverage** | % of actuals within prediction interval | 87-93% for 90% CI |
| **Interval Width %** | How wide are the intervals? | <30% for high-vol |
| **Simulated Trading P&L** | If we bought/sold on model signals | Positive over backtest |

**Critical:** Report metrics **stratified by volume bucket.** A model that's 95% accurate on high-volume Charizards but 60% accurate on everything else is useless for GameStop's long-tail inventory.

### 6.3 What NOT to Do

- **Don't use RMSE.** Fat-tailed price distributions make it meaningless.
- **Don't use random train/test splits.** Leaks future information.
- **Don't report aggregate accuracy.** Always stratify by volume.
- **Don't ignore the Best Offer bias.** It inflates prices 15-25%.
- **Don't start with deep learning.** LightGBM will outperform until you have very clean data and >100K training samples.

---

## 7. System Architecture & Infrastructure

### 7.1 Technology Stack

| Layer | Technology | Why |
|-------|-----------|-----|
| **Data Storage** | Cloudflare D1 (SQLite) | Edge-deployed, zero cold starts, ~$5-20/mo |
| **Cache** | Cloudflare KV | Hot price lookups, token caching, rate limiting |
| **Object Storage** | Cloudflare R2 | Raw data archive, ONNX model artifacts (S3-compatible) |
| **Orchestration** | Cloudflare Cron Triggers + Queues | Built-in scheduling, async batch processing |
| **ML Training** | LightGBM, scikit-learn (offline) | Run on Modal/Railway/local, export to ONNX |
| **ML Serving** | Batch predictions via R2 + statistical fallback | Pre-scored JSON loaded at edge, sub-5ms lookups |
| **Experiment Tracking** | MLflow (local/self-hosted) | Model versioning, metric logging |
| **Monitoring** | Cloudflare Analytics Engine + ingestion_log table | Pipeline health, built-in Workers analytics |
| **NLP (Sentiment)** | Workers AI (Llama 3.1 8B + DistilBERT) | NER extraction + sentiment classification at edge |
| **Frontend** | Vite + React + Tailwind v4 on Cloudflare Pages | Edge-deployed dashboard, GameStop-style UI |
| **Infrastructure** | Cloudflare Workers (Hono framework) | Global edge deployment, no servers to manage |

### 7.1.1 Security & Authentication

> **Required before production deployment:**
>
> - **API authentication:** Cloudflare Access or API key middleware on all `/v1/*` routes. Dashboard requires GameStop SSO.
> - **CORS restriction:** Lock to GameStop domains only (remove `cors("*")`).
> - **Rate limiting:** Cloudflare rate limiting rules or KV-based per-key throttling.
> - **Secrets management:** All API keys stored via `wrangler secret put`, never in code or `.env`.
> - **Data privacy:** `seller_id` should be hashed before storage. Reddit `post_url` is public data. No PII collected from end users.
> - **D1 access:** Restricted to Workers bindings only — no public database endpoint.

### 7.2 API Design

```
GET  /v1/price/{card_id}?grade=PSA10
     → { price: 245.00, lower: 210.00, upper: 290.00,
         confidence: "HIGH", last_sale: "2026-04-10",
         sales_30d: 12, trend: "rising" }

GET  /v1/history/{card_id}?grade=PSA10&days=90
     → [{ date, price, source, sale_type }, ...]

GET  /v1/sentiment/{card_id}
     → { score: 0.72, mentions_7d: 47, trend: "spiking",
         top_posts: [...] }

POST /v1/evaluate
     → { card_id, offered_price }
     ← { decision: "STRONG_BUY", fair_value: 245, margin: 22%,
         confidence: "HIGH", reasoning: "Below p20 threshold" }

GET  /v1/alerts/active
     → [{ card_id, alert_type: "PRICE_SPIKE", magnitude: "+35%",
          trigger: "viral_tiktok", timestamp }]

GET  /v1/market/index
     → { pokemon_index: 1247, sports_index: 893,
         trend_30d: "+4.2%", volatility: "moderate" }
```

---

## 8. Implementation Roadmap

### Phase 1: Foundation (Weeks 1-4)

| Week | Deliverable |
|------|-------------|
| 1 | TimescaleDB schema, SoldComps API integration, first eBay data flowing |
| 2 | PriceCharting API integration, PSA population scraping via GemRate |
| 3 | Feature engineering pipeline (grade, velocity, price history features) |
| 4 | LightGBM v1 trained on PriceCharting historical backfill + SoldComps 365-day data, initial backtest results |

> **Cold-start caveat:** On day one, eBay Marketplace Insights provides only 90 days and SoldComps provides 365 days of raw transaction data. This is barely enough for one 12m/1m walk-forward split. Full walk-forward backtesting (multiple folds) requires either: (a) backfilling from PriceCharting's historical CSV, which provides all-time aggregated pricing — sufficient for price-level features but **not** for transaction-level features like velocity, bid count, or seller concentration; or (b) waiting 6+ months to accumulate enough raw data. The Week 4 backtest should use PriceCharting backfill with the reduced feature set that aggregated data can support, and clearly report which features were available vs. imputed.

**Exit criteria:** Model trained on available data (PriceCharting backfill + SoldComps), MdAPE <20% on high-volume cards using the reduced feature set, price history for 50K+ cards stored. Walk-forward validation limited to available history depth.

### Phase 2: Intelligence (Weeks 5-8)

| Week | Deliverable |
|------|-------------|
| 5 | Reddit sentiment pipeline (NER + classification) |
| 6 | Anomaly detection (price outliers, seller concentration if seller_id available, data quality filters) |
| 7 | Conformal prediction intervals, volume-aware routing |
| 8 | Buy/sell decision API, Hono/Workers serving layer |

**Exit criteria:** Full pipeline running daily, sentiment features improving model by measurable delta, API serving prices with confidence intervals.

### Phase 3: Production (Weeks 9-12)

| Week | Deliverable |
|------|-------------|
| 9 | React dashboard (price curves, sentiment, alerts) |
| 10 | Cloudflare Analytics monitoring, model drift detection, alerting |
| 11 | A/B testing framework, automated retraining pipeline |
| 12 | GameStop-specific features (trade-in data, inventory), integration with pricing system |

**Exit criteria:** Production system updating prices daily, dashboard live, alerts working, integrated with GameStop's e-commerce platform.

### Phase 4: Agentic Layer (Weeks 13-16)

| Week | Deliverable |
|------|-------------|
| 13 | Price monitoring agent (watches for anomalies, triggers re-pricing) |
| 14 | Market intelligence agent (summarizes daily market movements) |
| 15 | Competitor price tracking agent (monitors TCGPlayer, COMC, eBay) |
| 16 | Automated pricing recommendations with human approval workflow |

---

## 9. Competitive Landscape

| | PriceCharting | Card Ladder (PSA) | Alt | **GameStop (Proposed)** |
|---|---|---|---|---|
| **Data sources** | eBay + own marketplace | 14 platforms | Multiple | eBay + Reddit + PSA pop + **store data** |
| **ML pricing** | Algorithmic smoothing (no ML) | Unknown | Likely gradient boosting | LightGBM quantile regression (batch) + statistical serving |
| **Sentiment** | None | None | Unknown | Reddit + Twitter NLP |
| **Update frequency** | Daily | Near real-time | Near real-time | Hybrid (daily + event-driven) |
| **Uncertainty** | None | None | None | Conformal prediction intervals |
| **Physical retail data** | No | No | No | **Yes — trade-ins, foot traffic, inventory** |
| **Anomaly detection** | Manual review | Unknown | Unknown | Automated (price-level outliers, seller concentration, data quality) |

**GameStop's unfair advantage:** The combination of online market data + physical store trade-in/inventory data + grading submission volume. No online-only competitor can replicate this.

---

## 10. Cost Estimate

### Monthly Operating Costs

| Item | Cost/Month |
|------|-----------|
| SoldComps API (Scale) | $59 |
| CardHedger API | $49 |
| PriceCharting (Legendary) | ~$25 |
| PokemonPriceTracker (Business) | $99 |
| Reddit API (Standard, prorated) | $1,000 |
| Twitter/X (pay-per-use, Phase 2+) | $500 |
| Cloudflare Workers Paid plan | $5 |
| Cloudflare D1 + KV + R2 + Queues | ~$30-50 |
| Cloudflare Workers AI | ~$10-50 |
| ML training compute (Modal/Railway) | ~$20-50 |
| MLflow (local/self-hosted) | $0-20 |
| **Total** | **~$1,800-$1,900/month** |

**vs. Palantir/vendor alternative:** $100K-500K+/year for a fraction of the functionality.

**vs. PriceCharting license:** They don't license their pricing engine. GameStop would be building something PriceCharting doesn't sell.

---

## 11. Key Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| eBay API access denied | SoldComps + CardHedger as fallbacks, negotiate via GameStop's retail partnership |
| Model accuracy insufficient for low-volume cards | Volume-aware routing, wide uncertainty bands, human review for <10 sales/quarter |
| Social sentiment is noisy/manipulable | Weight sentiment low (1-3% of signal), use as regime detector not price predictor |
| Price history cold start (no data before today) | Backfill from PriceCharting historical CSV, SoldComps 365-day lookback |
| Fat-tailed prices break the model | Huber loss, log-transform, quantile regression, outlier detection |
| eBay "Best Offer" bias | Detect and discount by 20%, or exclude from training |
| Reddit API pricing changes | Budget for Standard tier, explore Pushshift archives for historical data |

---

## Appendix A: References & Data Sources

**APIs & Data:**
- [eBay Marketplace Insights API](https://developer.ebay.com/api-docs/buy/marketplace-insights/static/overview.html)
- [SoldComps — eBay Sold Listings API](https://sold-comps.com/)
- [CardHedger Enterprise API](https://api.cardhedger.com/docs)
- [PriceCharting API](https://www.pricecharting.com/api-documentation)
- [PSA Public API](https://www.psacard.com/publicapi/documentation)
- [GemRate — Aggregated Pop Reports](https://www.gemrate.com/)
- [PokemonPriceTracker API](https://www.pokemonpricetracker.com/psa-pokemon-card-api)
- [Reddit API Pricing 2026](https://www.bbntimes.com/technology/complete-guide-to-reddit-api-pricing-and-usage-tiers-in-2026)

**Research & Methodology:**
- [PriceCharting Methodology](https://www.pricecharting.com/page/methodology)
- [CAIA: Trading Cards and the Price of Perfection](https://caia.org/blog/2021/12/02/collectibles-trading-cards-and-price-perfection)
- [eBay Bans AI Agents — Feb 2026](https://www.valueaddedresource.net/ebay-bans-ai-agents-updates-arbitration-user-agreement-feb-2026/)

**Comparable Systems:**
- PriceCharting.com — algorithmic price aggregation
- Card Ladder (acquired by Collectors/PSA) — multi-platform tracking
- Alt (formerly Alt.xyz) — investment platform with ML pricing
- StockX — sneaker/collectibles marketplace (analogous pricing challenge)
- PWCC Marketplace — high-end card auction index

---

*Built with production experience from Exmplr (multi-agent AI platform over 562K+ clinical trials, RAG over 19.8M vectors) and ServeSys.AI (healthcare edge AI, 27K LOC Rust, 384 tests). The same architectural patterns — deterministic recipe routing, evaluation frameworks, quality gates, incremental pipelines — apply directly to collectibles pricing.*
