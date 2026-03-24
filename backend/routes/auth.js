const express = require('express');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db');
const sendEmail = require('../utils/sendEmail');

const router = express.Router();

// POST /register
router.post('/register', async (req, res) => {
  const { email, username, password } = req.body;

  if (!email || !username || !password) {
    return res.status(400).json({ error: 'Email, username, and password are required' });
  }

  try {
    // Check if user already exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $2',
      [email, username]
    );
    if (existingUser.rows.length > 0) {
      return res.status(400).json({ error: 'User with this email or username already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const userId = uuidv4();
    await pool.query(
      'INSERT INTO users (user_id, email, username, password, created_at, updated_at) VALUES ($1, $2, $3, $4, NOW(), NOW())',
      [userId, email, username, hashedPassword]
    );

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error('Error registering user:', error);
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /login
router.post('/login', async (req, res) => {
  const { identifier, password } = req.body; // identifier can be email or username

  if (!identifier || !password) {
    return res.status(400).json({ error: 'Identifier (email/username) and password are required' });
  }

  try {
    // Find user by email or username
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 OR username = $1',
      [identifier]
    );
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    const user = userResult.rows[0];

    // Check password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      return res.status(400).json({ error: 'Invalid credentials' });
    }

    // Generate JWT
    const token = jwt.sign(
      { userId: user.user_id, email: user.email, username: user.username },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({ token, user: { user_id: user.user_id, email: user.email, username: user.username } });
  } catch (error) {
    console.error('Error logging in:', error);
    res.status(500).json({ error: 'Failed to login' });
  }
});

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

// POST /forgot-password
router.post('/forgot-password', async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ error: 'Email is required' });
  }

  try {
    // Check if user exists
    const userResult = await pool.query('SELECT * FROM users WHERE email = $1', [email]);
    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'User with this email does not exist' });
    }

    // Generate OTP for password reset
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes

    // Store OTP in users table
    await pool.query(
      'UPDATE users SET reset_token = $1, reset_token_expires_at = $2 WHERE email = $3',
      [otp, expiresAt, email]
    );

    // Try to send email (optional - for testing, just return OTP)
    if (process.env.EMAIL_USER && process.env.EMAIL_PASS) {
      try {
        await sendEmail(
          email,
          'Password Reset OTP for WE Health',
          `Your password reset OTP is: ${otp}. It expires in 15 minutes.`
        );
      } catch (emailError) {
        console.warn('Email sending failed, but OTP stored:', emailError.message);
      }
    } else {
      console.log(`[TEST MODE] Password reset OTP for ${email}: ${otp}`);
    }

    res.json({ message: 'Password reset OTP sent to your email', otp: process.env.NODE_ENV !== 'production' ? otp : undefined });
  } catch (error) {
    console.error('Error requesting password reset:', error);
    res.status(500).json({ error: 'Failed to send password reset OTP' });
  }
});

// POST /reset-password
router.post('/reset-password', async (req, res) => {
  const { email, otp, newPassword } = req.body;

  if (!email || !otp || !newPassword) {
    return res.status(400).json({ error: 'Email, OTP, and new password are required' });
  }

  try {
    // Check if user exists and verify OTP
    const userResult = await pool.query(
      'SELECT * FROM users WHERE email = $1 AND reset_token = $2 AND reset_token_expires_at > NOW()',
      [email, otp]
    );

    if (userResult.rows.length === 0) {
      return res.status(400).json({ error: 'Invalid or expired OTP' });
    }

    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // Update password and clear reset tokens
    await pool.query(
      'UPDATE users SET password = $1, reset_token = NULL, reset_token_expires_at = NULL, updated_at = NOW() WHERE email = $2',
      [hashedPassword, email]
    );

    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

module.exports = router;