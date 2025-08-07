const jwt = require('jsonwebtoken');

exports.authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    const user = await User.findById(decoded.userId);
    if (!user) {
      return res.status(401).send({ message: 'Invalid token' });
    }
    req.user = user;
    next();
  } catch (err) {
    res.status(400).send(err);
  }
};