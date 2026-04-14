import type { Env } from "../../types";

const TARGET_SUBREDDITS = [
  "PokemonTCG",
  "baseballcards",
  "basketballcards",
  "footballcards",
  "PKMNTCGDeals",
  "sportscards",
  "TradingCardCommunity",
];

interface RedditPost {
  data: {
    id: string;
    title: string;
    selftext: string;
    subreddit: string;
    score: number;
    num_comments: number;
    permalink: string;
    created_utc: number;
  };
}

interface RedditListing {
  data: {
    children: RedditPost[];
    after: string | null;
  };
}

/**
 * Ingest Reddit posts for sentiment analysis.
 * Runs every 5 minutes via Cron Trigger.
 *
 * Flow:
 * 1. Fetch recent posts from target subreddits
 * 2. Extract card mentions via NER (Workers AI)
 * 3. Queue each mention for sentiment analysis
 */
export async function ingestRedditSentiment(env: Env): Promise<number> {
  // Get OAuth token
  const token = await getRedditToken(env);
  if (!token) {
    console.error("Failed to get Reddit OAuth token");
    return 0;
  }

  let totalProcessed = 0;

  for (const subreddit of TARGET_SUBREDDITS) {
    try {
      const response = await fetch(
        `https://oauth.reddit.com/r/${subreddit}/new?limit=25`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            "User-Agent": "GameCards:1.0.0 (by /u/gamecards-bot)",
          },
        }
      );

      if (!response.ok) {
        console.error(`Reddit API error for r/${subreddit}: ${response.status}`);
        continue;
      }

      const listing = await response.json() as RedditListing;

      for (const post of listing.data.children) {
        const text = `${post.data.title} ${post.data.selftext}`.trim();
        if (!text) continue;

        // Extract card mentions using Workers AI
        const cardMentions = await extractCardMentions(env, text);

        for (const cardId of cardMentions) {
          await env.SENTIMENT_QUEUE.send({
            type: "sentiment_analysis",
            data: {
              card_id: cardId,
              text: text.slice(0, 500), // Truncate for sentiment model
              source: "reddit",
              post_url: `https://reddit.com${post.data.permalink}`,
              engagement: post.data.score + post.data.num_comments,
            },
          });
          totalProcessed++;
        }
      }
    } catch (err) {
      console.error(`Reddit ingestion failed for r/${subreddit}:`, err);
    }
  }

  return totalProcessed;
}

/**
 * Get Reddit OAuth token using client credentials flow.
 */
async function getRedditToken(env: Env): Promise<string | null> {
  // Check KV cache for existing token
  const cached = await env.PRICE_CACHE.get("reddit:token");
  if (cached) return cached;

  try {
    const credentials = btoa(`${env.REDDIT_CLIENT_ID}:${env.REDDIT_CLIENT_SECRET}`);
    const response = await fetch("https://www.reddit.com/api/v1/access_token", {
      method: "POST",
      headers: {
        Authorization: `Basic ${credentials}`,
        "Content-Type": "application/x-www-form-urlencoded",
        "User-Agent": "GameCards:1.0.0 (by /u/gamecards-bot)",
      },
      body: "grant_type=client_credentials",
    });

    if (!response.ok) return null;

    const data = await response.json() as { access_token: string; expires_in: number };

    // Cache token (expires in ~1 hour, cache for 50 minutes)
    await env.PRICE_CACHE.put("reddit:token", data.access_token, {
      expirationTtl: 3000,
    });

    return data.access_token;
  } catch {
    return null;
  }
}

/**
 * Use Workers AI to extract card mentions from text.
 * Returns array of matching card IDs from the catalog.
 */
async function extractCardMentions(env: Env, text: string): Promise<string[]> {
  try {
    // Use Workers AI text generation to extract card names
    const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
      messages: [
        {
          role: "system",
          content: `You are a card mention extractor. Given text from a trading card forum, extract specific card names mentioned. Return ONLY a JSON array of card names, nothing else. Example: ["Charizard Base Set", "Jordan Rookie Fleer"]. If no specific cards are mentioned, return [].`,
        },
        { role: "user", content: text.slice(0, 800) },
      ],
      max_tokens: 200,
    });

    const responseText = (result as { response: string }).response || "";
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (!jsonMatch) return [];

    const cardNames = JSON.parse(jsonMatch[0]) as string[];
    if (!Array.isArray(cardNames) || cardNames.length === 0) return [];

    // Look up card IDs from catalog
    const cardIds: string[] = [];
    for (const name of cardNames.slice(0, 5)) {
      const card = await env.DB.prepare(
        `SELECT id FROM card_catalog WHERE name LIKE ? LIMIT 1`
      )
        .bind(`%${name}%`)
        .first();

      if (card) cardIds.push(card.id as string);
    }

    return cardIds;
  } catch {
    return [];
  }
}
