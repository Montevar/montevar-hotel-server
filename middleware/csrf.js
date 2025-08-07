const csrf = require('csurf');

exports.csrfProtection = csrf({ cookie: true });