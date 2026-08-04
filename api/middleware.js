function makeRequireApiKey(apiKey) {
  return function requireApiKey(req, res, next) {
    if (!apiKey) {
      return res.status(500).json({ error: 'API_KEY not configured on bot server' });
    }
    if (req.headers['x-api-key'] !== apiKey) {
      return res.status(401).json({ error: 'Unauthorized' });
    }
    next();
  };
}

module.exports = { makeRequireApiKey };
