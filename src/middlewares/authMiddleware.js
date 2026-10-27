const jwt = require('jsonwebtoken');

const verifyJWT = (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ error: 'Token não fornecido!' });
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2) {
    return res.status(401).json({ error: 'Erro no formato do token!' });
  }

  const [scheme, token] = parts;
  if (!/^Bearer$/i.test(scheme)) {
    return res.status(401).json({ error: 'Token mal formatado!' });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(403).json({ error: 'Access token inválido ou expirado!' });
    }

    // Extrai o ID independentemente da chave gravada no token (id, userId, _id ou id interno)
    const idExtraido = decoded.id || decoded.userId || decoded._id || (decoded.user && (decoded.user.id || decoded.user._id));

    if (!idExtraido) {
      return res.status(403).json({ error: 'Payload do token não contém um ID de usuário válido!' });
    }

    // Garante retrocompatibilidade com requisições antigas (req.userId) e novas (req.user.id)
    req.userId = idExtraido;
    req.user = { id: idExtraido };

    return next();
  });
};

module.exports = verifyJWT;