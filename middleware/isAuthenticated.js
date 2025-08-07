// server/middleware/isAuthenticated.js
const cookie = require('cookie');

module.exports = (req, res, next) => {
  const cookies = cookie.parse(req.headers.cookie || '');
  if (cookies.admin_token === 'authenticated') {
    return next();
  } else {
    return res.status(401).json({ message: 'Unauthorized' });
  }
};
