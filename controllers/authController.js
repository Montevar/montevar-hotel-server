const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

// ... (rest of the code remains the same)

exports.login = async (req, res) => {
  try {
    const user = await User.findOne({ email: req.body.email });
    if (!user) {
      return res.status(401).send({ message: 'Invalid email or password' });
    }
    const isValidPassword = await bcrypt.compare(req.body.password, user.password);
    if (!isValidPassword) {
      return res.status(401).send({ message: 'Invalid email or password' });
    }
    const token = jwt.sign({ userId: user._id }, process.env.SECRET_KEY, {
      expiresIn: '1h'
    });
    res.send({ token });
  } catch (err) {
    res.status(400).send(err);
  }
};

// ... (rest of the code remains the same)

exports.authenticate = async (req, res, next) => {
  try {
    const token = req.header('Authorization').replace('Bearer ', '');
    const decoded = jwt.verify(token, process.env.SECRET_KEY);
    const admin = await Admin.findById(decoded.adminId);
    if (!admin) {
      return res.status(401).send({ message: 'Invalid token' });
    }
    req.admin = admin;
    next();
  } catch (err) {
    res.status(400).send(err);
  }
};