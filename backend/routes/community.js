const express = require("express");
const router = express.Router();
const pool = require("../db");

router.get("/posts", async (req, res) => {
  const limit = Number.parseInt(req.query.limit || "20", 10);
  const safeLimit = Number.isNaN(limit) ? 20 : Math.min(Math.max(limit, 1), 100);

  try {
    const result = await pool.query(
      `SELECT p.post_id, p.content, p.image_url, p.created_at,
              u.user_id, u.username,
              COALESCE(l.likes_count, 0)::int AS likes_count,
              COALESCE(c.comments_count, 0)::int AS comments_count,
              EXISTS (
                SELECT 1 FROM post_likes pl
                WHERE pl.post_id = p.post_id AND pl.user_id = $1
              ) AS current_user_liked
       FROM community_posts p
       JOIN users u ON u.user_id = p.user_id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS likes_count
         FROM post_likes
         GROUP BY post_id
       ) l ON l.post_id = p.post_id
       LEFT JOIN (
         SELECT post_id, COUNT(*) AS comments_count
         FROM post_comments
         GROUP BY post_id
       ) c ON c.post_id = p.post_id
       ORDER BY p.created_at DESC
       LIMIT $2`,
      [req.user.userId, safeLimit]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch posts" });
  }
});

router.post("/posts", async (req, res) => {
  const { content, image_url } = req.body;

  if (!content || !String(content).trim()) {
    return res.status(400).json({ error: "Post content is required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO community_posts (user_id, content, image_url, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW())
       RETURNING post_id, content, image_url, created_at`,
      [req.user.userId, String(content).trim(), image_url || null]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to create post" });
  }
});

router.post("/posts/:postId/like", async (req, res) => {
  const postId = Number.parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) {
    return res.status(400).json({ error: "Invalid post id" });
  }

  try {
    const existing = await pool.query(
      "SELECT 1 FROM post_likes WHERE post_id = $1 AND user_id = $2",
      [postId, req.user.userId]
    );

    if (existing.rows.length > 0) {
      await pool.query(
        "DELETE FROM post_likes WHERE post_id = $1 AND user_id = $2",
        [postId, req.user.userId]
      );
    } else {
      await pool.query(
        "INSERT INTO post_likes (post_id, user_id, created_at) VALUES ($1, $2, NOW())",
        [postId, req.user.userId]
      );
    }

    const countResult = await pool.query(
      "SELECT COUNT(*)::int AS likes_count FROM post_likes WHERE post_id = $1",
      [postId]
    );

    res.json({
      liked: existing.rows.length === 0,
      likes_count: countResult.rows[0].likes_count
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to toggle like" });
  }
});

router.get("/posts/:postId/comments", async (req, res) => {
  const postId = Number.parseInt(req.params.postId, 10);
  if (Number.isNaN(postId)) {
    return res.status(400).json({ error: "Invalid post id" });
  }

  try {
    const result = await pool.query(
      `SELECT c.comment_id, c.content, c.created_at, u.user_id, u.username
       FROM post_comments c
       JOIN users u ON u.user_id = c.user_id
       WHERE c.post_id = $1
       ORDER BY c.created_at ASC`,
      [postId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Failed to fetch comments" });
  }
});

router.post("/posts/:postId/comments", async (req, res) => {
  const postId = Number.parseInt(req.params.postId, 10);
  const content = String(req.body.content || "").trim();

  if (Number.isNaN(postId)) {
    return res.status(400).json({ error: "Invalid post id" });
  }

  if (!content) {
    return res.status(400).json({ error: "Comment content is required" });
  }

  try {
    const postResult = await pool.query(
      "SELECT 1 FROM community_posts WHERE post_id = $1",
      [postId]
    );
    if (postResult.rows.length === 0) {
      return res.status(404).json({ error: "Post not found" });
    }

    const result = await pool.query(
      `INSERT INTO post_comments (post_id, user_id, content, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING comment_id, content, created_at`,
      [postId, req.user.userId, content]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Comment create error:", err);
    res.status(500).json({
      error: "Failed to create comment",
      detail: process.env.NODE_ENV !== "production" ? err.message : undefined
    });
  }
});

module.exports = router;
