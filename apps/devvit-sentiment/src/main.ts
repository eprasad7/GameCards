import { Devvit } from "@devvit/public-api";

/**
 * GameCards Sentiment Collector
 *
 * A Devvit app that runs inside Reddit and pushes trading card
 * post data to the GameCards pricing engine API.
 *
 * Two data collection paths:
 * 1. Real-time: triggers on new posts in installed subreddits
 * 2. Scheduled: batch-reads recent posts every 5 minutes
 *
 * Install on: r/PokemonTCG, r/baseballcards, r/basketballcards,
 *             r/footballcards, r/PKMNTCGDeals, r/sportscards
 */

// API endpoint for the GameCards pricing engine
const API_URL = "https://api.gmestart.com/v1/ingest/sentiment";
const API_KEY = "gamecards-demo-key-2026"; // TODO: move to app settings

// ─── Real-time Trigger: New Posts ───

Devvit.addTrigger({
  event: "PostCreate",
  onEvent: async (event, context) => {
    const post = event.post;
    if (!post) return;

    const text = `${post.title} ${post.body || ""}`.trim();
    if (text.length < 10) return;

    const subreddit = post.subredditName || "";

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({
          posts: [
            {
              id: post.id,
              title: post.title,
              text: post.body || "",
              subreddit,
              score: post.score || 0,
              numComments: post.numberOfComments || 0,
              permalink: post.permalink || `/r/${subreddit}/comments/${post.id}`,
              createdAt: post.createdAt?.toISOString() || new Date().toISOString(),
            },
          ],
        }),
      });

      if (!response.ok) {
        console.error(`API error: ${response.status}`);
      }
    } catch (err) {
      console.error("Failed to send post to GameCards API:", err);
    }
  },
});

// ─── Scheduled Job: Batch Recent Posts ───

Devvit.addSchedulerJob({
  name: "batch-collect-posts",
  onRun: async (_, context) => {
    const subredditName = (await context.reddit.getCurrentSubreddit()).name;

    // Get the 25 most recent posts
    const posts = await context.reddit
      .getNewPosts({
        subredditName,
        limit: 25,
      })
      .all();

    if (posts.length === 0) return;

    const payload = posts.map((post) => ({
      id: post.id,
      title: post.title,
      text: post.body || "",
      subreddit: subredditName,
      score: post.score,
      numComments: post.numberOfComments,
      permalink: post.permalink,
      createdAt: post.createdAt.toISOString(),
    }));

    try {
      const response = await fetch(API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-Key": API_KEY,
        },
        body: JSON.stringify({ posts: payload }),
      });

      if (response.ok) {
        console.log(`Sent ${posts.length} posts from r/${subredditName}`);
      } else {
        console.error(`API error: ${response.status}`);
      }
    } catch (err) {
      console.error("Batch collect failed:", err);
    }
  },
});

// ─── App Install: Start Scheduler ───

Devvit.addTrigger({
  event: "AppInstall",
  onEvent: async (_, context) => {
    // Schedule batch collection every 5 minutes
    await context.scheduler.runJob({
      name: "batch-collect-posts",
      cron: "*/5 * * * *",
    });
    console.log("GameCards sentiment collector installed and scheduled.");
  },
});

export default Devvit;
