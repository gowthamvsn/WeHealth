require("dotenv").config();

const menotypeRoutes = require("./routes/menotype");
const express = require("express");
const cors = require("cors");
const path = require("path");

const symptomRoutes = require("./routes/symptoms");
const authRoutes = require("./routes/auth");
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
app.use("/auth", authRoutes);
const PORT = 3000;

app.listen(PORT, () => {
  console.log(`WE Health API running on port ${PORT}`);
});

const pool = require("./db");

pool.query("SELECT current_database()", (err, res) => {
  console.log("Connected to DB:", res.rows[0].current_database);
});
