import { Hono } from "hono";
import type { Env } from "../types";

/**
 * POST /v1/ingest/sentiment
 *
 * Receives post data from the Devvit sentiment collector app.
 * Extracts card mentions via Workers AI and queues for sentiment analysis.
 *
 * Body: { posts: [{ id, title, text, subreddit, score, numComments, permalink, createdAt }] }
 */
export const ingestRoutes = new Hono<{ Bindings: Env }>();

interface IncomingPost {
  id: string;
  title: string;
  text: string;
  subreddit: string;
  score: number;
  numComments: number;
  permalink: string;
  createdAt: string;
}

ingestRoutes.post("/sentiment", async (c) => {
  let body: { posts: IncomingPost[] };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: "Invalid JSON" }, 400);
  }

  if (!Array.isArray(body.posts) || body.posts.length === 0) {
    return c.json({ error: "posts must be a non-empty array" }, 400);
  }

  let processed = 0;

  for (const post of body.posts.slice(0, 50)) {
    const fullText = `${post.title} ${post.text}`.trim();
    if (fullText.length < 10) continue;

    // Extract card mentions via Workers AI
    const cardIds = await extractCardMentions(c.env, fullText);

    for (const cardId of cardIds) {
      await c.env.SENTIMENT_QUEUE.send({
        type: "sentiment_analysis",
        data: {
          card_id: cardId,
          text: fullText.slice(0, 500),
          source: "reddit",
          post_url: post.permalink.startsWith("http")
            ? post.permalink
            : `https://reddit.com${post.permalink}`,
          engagement: post.score + post.numComments,
        },
      });
      processed++;
    }
  }

  return c.json({
    status: "ok",
    received: body.posts.length,
    processed,
  });
});

async function extractCardMentions(env: Env, text: string): Promise<string[]> {
  try {
    const result = await env.AI.run("@cf/google/gemma-4-26b-a4b-it", {
      messages: [
        {
          role: "system",
          content:
            'You are a card mention extractor. Given text from a trading card forum, extract specific card names. Return ONLY a JSON array of card names. Example: ["Charizard Base Set", "Jordan Rookie Fleer"]. If no specific cards, return [].',
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
