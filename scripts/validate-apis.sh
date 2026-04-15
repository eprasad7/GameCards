#!/usr/bin/env bash
set -euo pipefail

# Load keys from .env (quote-safe)
set -a
while IFS='=' read -r key value; do
  [[ -z "$key" || "$key" == \#* ]] && continue
  export "$key=$value"
done < .env
set +a

echo "============================================"
echo "  GMEstart API Validation Script"
echo "  Testing real API responses against parsers"
echo "============================================"
echo ""

# ─── 1. PriceCharting ───
echo "=== PriceCharting API ==="
echo "Key: ${PRICECHARTING_API_KEY:0:8}..."
PC_RESP=$(curl -s "https://www.pricecharting.com/api/product?t=${PRICECHARTING_API_KEY}&q=charizard+base+set" 2>&1)
echo "Response (first 500 chars):"
echo "$PC_RESP" | head -c 500
echo ""
echo "Status: $(echo "$PC_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK -", len(d.get("products",d.get("results",[]))) if isinstance(d,dict) else "unexpected format")' 2>/dev/null || echo "PARSE ERROR")"
echo ""

# ─── 2. SoldComps ───
echo "=== SoldComps API ==="
echo "Key: ${SOLDCOMPS_API_KEY:0:8}..."
SC_RESP=$(curl -s "https://sold-comps.com/api/v1/search?q=charizard+psa+10&limit=3" \
  -H "Authorization: Bearer ${SOLDCOMPS_API_KEY}" \
  -H "Content-Type: application/json" 2>&1)
echo "Response (first 500 chars):"
echo "$SC_RESP" | head -c 500
echo ""
echo "Status: $(echo "$SC_RESP" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK -", type(d).__name__, "keys:", list(d.keys()) if isinstance(d,dict) else "array len=" + str(len(d)))' 2>/dev/null || echo "PARSE ERROR or non-JSON")"
echo ""

# ─── 3. Reddit OAuth ───
echo "=== Reddit OAuth ==="
echo "Client ID: ${REDDIT_CLIENT_ID:0:8}..."
REDDIT_TOKEN=$(curl -s -X POST "https://www.reddit.com/api/v1/access_token" \
  -u "${REDDIT_CLIENT_ID}:${REDDIT_CLIENT_SECRET}" \
  -H "User-Agent: ${REDDIT_USER_AGENT:-game-cards-app/1.0.0}" \
  -d "grant_type=client_credentials" 2>&1)
echo "Token response:"
echo "$REDDIT_TOKEN" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("OK - token type:", d.get("token_type"), "expires:", d.get("expires_in"), "scope:", d.get("scope","n/a"))' 2>/dev/null || echo "PARSE ERROR"

TOKEN=$(echo "$REDDIT_TOKEN" | python3 -c 'import sys,json; print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)
if [ -n "$TOKEN" ]; then
  echo "Fetching r/PokemonTCG/new..."
  REDDIT_POSTS=$(curl -s "https://oauth.reddit.com/r/PokemonTCG/new?limit=3" \
    -H "Authorization: Bearer ${TOKEN}" \
    -H "User-Agent: ${REDDIT_USER_AGENT:-game-cards-app/1.0.0}" 2>&1)
  echo "Posts response: $(echo "$REDDIT_POSTS" | python3 -c 'import sys,json; d=json.load(sys.stdin); kids=d.get("data",{}).get("children",[]); print("OK -", len(kids), "posts, first:", kids[0]["data"]["title"][:60] if kids else "none")' 2>/dev/null || echo "PARSE ERROR")"
fi
echo ""

# ─── 4. PokemonPriceTracker ───
echo "=== PokemonPriceTracker API ==="
echo "Key: ${POKEMON_PRICE_TRACKER_KEY:0:12}..."
PPT_RESP=$(curl -s "https://www.pokemonpricetracker.com/api/v1/prices?name=charizard" \
  -H "Authorization: Bearer ${POKEMON_PRICE_TRACKER_KEY}" 2>&1)
echo "Response (first 500 chars):"
echo "$PPT_RESP" | head -c 500
echo ""
echo ""

echo "============================================"
echo "  Validation complete"
echo "============================================"
