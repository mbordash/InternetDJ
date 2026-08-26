const mariadb = require('mariadb');
require('dotenv').config(); // Use default .env path

const pool = mariadb.createPool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  port: process.env.DB_PORT,
  database: process.env.DB_NAME,
  // Raised from 5 after a Googlebot sitemap sweep was able to occupy the whole
  // pool at once: each child sitemap needs its own connection, and at five
  // there was no headroom left for ordinary page traffic. Keep this below the
  // MariaDB server's max_connections, remembering that every app machine holds
  // its own pool of this size.
  connectionLimit: 15
});

module.exports = pool;
