const express = require('express');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// POST /request-otp
router.post('/request-otp', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Set expiry to 5 minutes from now
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000);

    // Store OTP in database (upsert if exists)
    await pool.query(
      `INSERT INTO otp_codes (email, otp, expires_at) VALUES ($1, $2, $3)
       ON CONFLICT (email) DO UPDATE SET otp = $2, expires_at = $3`,
      [email, otp, expiresAt]
    );

    // Send email
    await sendEmail(
      email,
      'Your OTP for WE Health',
      `Your OTP is: ${otp}. It expires in 5 minutes.`
    );

    res.json({ message: 'OTP sent to your email' });
  } catch (error) {
    console.error('Error requesting OTP:', error);
    res.status(500).json({ error: 'Failed to send OTP' });
  }
});

// POST /verify-otp
router.post('/verify-otp', async (req, res) => {
  const { email, otp } = req.body;

  if (!email || !otp) {
    return res.status(400).json({ error: 'Email and OTP are required' });
  }

  try {
    // Check OTP
    const result = await pool.query(
      'SELECT * FROM otp_codes WHERE email = $1 AND otp = $2 AND expires_at > NOW()',
      [email, otp]
    );

    if (result.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Find or create user
    let userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);

    let user;
    if (userResult.rows.length === 0) {
      // Create new user
      const userId = uuidv4();
      await pool.query(
        'INSERT INTO users (user_id, email, created_at) VALUES ($1, $2, NOW())',
        [userId, email]
      );
      user = { user_id: userId, email };
    } else {
      user = userResult.rows[0];
    }

    // Delete used OTP
    await pool.query('DELETE FROM otp_codes WHERE email = $1', [email]);

    // Generate JWT
    const token = jwt.sign(
      { userId: user.user_id, email: user.email },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { user_id: user.user_id, email: user.email } });
  } catch (error) {
    console.error('Error verifying OTP:', error);
    res.status(500).json({ error: 'Failed to verify OTP' });
  }
});

module.exports = router;