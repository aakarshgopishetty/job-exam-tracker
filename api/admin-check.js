const { isAdmin } = require('../lib/auth');

module.exports = async (req, res) => {
  return res.status(200).json({ isAdmin: isAdmin(req) });
};
