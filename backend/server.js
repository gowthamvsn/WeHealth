require("dotenv").config();

const menotypeRoutes = require("./routes/menotype");
const express = require("express");
const cors = require("cors");
const path = require("path");

const symptomRoutes = require("./routes/symptoms");
const authRoutes = require("./routes/auth");
const checkinsRoutes = require("./routes/checkins");
const communityRoutes = require("./routes/community");
const { authenticateToken } = require("./middleware/auth");

const app = express();

app.use(cors());
app.use(express.json());

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Serve index.html for root path
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public/index.html'));
});

app.use("/symptoms", authenticateToken, symptomRoutes);
app.use("/menotype", authenticateToken, menotypeRoutes);
app.use("/checkins", authenticateToken, checkinsRoutes);
app.use("/community", authenticateToken, communityRoutes);
app.use("/auth", authRoutes);
const PORT = parseInt(process.env.PORT || "3000", 10);

app.listen(PORT, () => {
  console.log(`WE Health API running on port ${PORT}`);
});

const pool = require("./db");

pool.query("SELECT current_database()", (err, result) => {
  if (err) {
    console.error("Database connection check failed:", err.message);
    return;
  }
  console.log("Connected to DB:", result.rows[0].current_database);
});
