const jwt = require('jsonwebtoken');

const generateToken = (user) => {
  const secretKey = process.env.SECRET_JWT_KEY;

  if (!secretKey) {
    throw new Error('SECRET_JWT_KEY is not defined in the environment variables.');
  }

  return jwt.sign(
    {
      id: user._id,
      username: user.username,
      email: user.email,
    },
    secretKey,
    { expiresIn: '7d' }
  );
};

module.exports = generateToken;
