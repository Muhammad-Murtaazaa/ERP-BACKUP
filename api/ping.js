export default function handler(req, res) {
  res.status(200).json({
    status: 'ok',
    message: 'pong',
    env: {
      has_db_url: Boolean(process.env.DATABASE_URL),
      has_secret: Boolean(process.env.OMNYSYNC_SESSION_SECRET),
      node_version: process.version,
    },
  });
}
