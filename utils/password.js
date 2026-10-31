// utils/password.js
const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const N = 16384, r = 8, p = 1, KEYLEN = 64;

// Stored as "scrypt$N$r$p$salt$hash" so the cost can be raised later
const hashPassword = async (password) => {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, KEYLEN, { N, r, p });
  return ['scrypt', N, r, p, salt.toString('base64'), hash.toString('base64')].join('$');
};

const verifyPassword = async (password, stored) => {
  const parts = String(stored || '').split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [, n, rr, pp, salt, hash] = parts;
  const expected = Buffer.from(hash, 'base64');
  const actual = await scrypt(String(password), Buffer.from(salt, 'base64'), expected.length, {
    N: Number(n), r: Number(rr), p: Number(pp),
  });
  return crypto.timingSafeEqual(actual, expected);
};

// Returns an error message, or null if the password is strong enough
const passwordProblem = (password, email) => {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 12) return 'Password must be at least 12 characters.';
  if (password.length > 128) return 'Password must be at most 128 characters.';
  const classes = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((re) => re.test(password)).length;
  if (classes < 3) return 'Use at least three of: lowercase, uppercase, numbers, symbols.';
  const localPart = String(email || '').split('@')[0].toLowerCase();
  if (localPart.length >= 3 && password.toLowerCase().includes(localPart)) {
    return 'Password must not contain your email name.';
  }
  if (/montevar|password|hotel|123456|qwerty/i.test(password)) {
    return 'Password is too easy to guess.';
  }
  return null;
};

module.exports = { hashPassword, verifyPassword, passwordProblem };
