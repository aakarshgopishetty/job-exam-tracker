module.exports = async (req, res) => {
  res.status(200).json({ key: process.env.VAPID_PUBLIC_KEY || '' });
};
