const path = require("path");
require("dotenv").config({ path: path.join(__dirname, ".env") });

const { Pool } = require("pg");

const isAzurePostgres = String(process.env.DB_HOST || "").includes("postgres.database.azure.com");
const useSsl = String(process.env.DB_SSL || (isAzurePostgres ? "true" : "false")).toLowerCase() === "true";

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  port: Number(process.env.DB_PORT || 5432),
  ssl: useSsl ? { rejectUnauthorized: false } : false
});


module.exports = pool;