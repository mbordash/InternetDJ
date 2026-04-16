const mariadb = require('mariadb');
require('dotenv').config(); // Use default .env path

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  connectionLimit: 5
});

module.exports = pool;
