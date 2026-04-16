const jwt = require('jsonwebtoken');

// Middleware to authenticate JWT tokens
const authenticate = (req, res, next) => {
  // Extract token from Authorization header
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized: No token provided' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized: Malformed token' });
  }

  // Check for JWT_SECRET
  if (!process.env.JWT_SECRET) {
    console.error('JWT_SECRET is not defined in environment variables');
    return res.status(500).json({ error: 'Internal server error' });
  }

  // Verify token
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // Attach decoded payload (e.g., { id, username, ... })
    next();
  } catch (err) {
    console.error('Token verification failed:', err.message);
    if (err.name === 'TokenExpiredError') {
      return res.status(403).json({ error: 'Forbidden: Token expired' });
    }
    if (err.name === 'JsonWebTokenError') {
      return res.status(403).json({ error: 'Forbidden: Invalid token' });
    }
    return res.status(403).json({ error: 'Forbidden: Token verification failed' });
  }
};

module.exports = authenticate;