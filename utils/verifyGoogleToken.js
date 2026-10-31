// utils/verifyGoogleToken.js
const { OAuth2Client } = require('google-auth-library');

const client = new OAuth2Client();

// Checks a Google Sign-In ID token (signature, expiry, audience, issuer) and
// returns { email, name } for a verified Google account, or null.
module.exports = async (credential) => {
  if (!process.env.GOOGLE_CLIENT_ID || typeof credential !== 'string') return null;

  const ticket = await client.verifyIdToken({
    idToken: credential,
    audience: process.env.GOOGLE_CLIENT_ID,
  });
  const payload = ticket.getPayload();
  if (!payload || !payload.email || payload.email_verified !== true) return null;

  return { email: payload.email.toLowerCase(), name: payload.name || '' };
};
