const jwt = require('jsonwebtoken');

// Like authenticate, but never blocks the request. If a valid Bearer token is present,
// req.user is populated the same way authenticate.js does. Otherwise req.user stays
// undefined and the route is responsible for handling anonymous requests.
const authenticateOptional = (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next();
  }

  const token = authHeader.split(' ')[1];
  if (!token || !process.env.JWT_SECRET) {
    return next();
  }

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
  } catch (err) {
    // Ignore invalid/expired tokens for optional auth; treat the request as anonymous.
  }

  next();
};

module.exports = authenticateOptional;
