const express = require('express');
const router = express.Router();
const { getBids, createBid, updateBid, deleteBid } = require('../controllers/bidController');
const authMiddleware = require('../middlewares/authMiddleware'); // Ajusta conforme o middleware de autenticação que já usas

// Todas as rotas protegidas por autenticação
router.use(authMiddleware);

router.get('/', getBids);
router.post('/', createBid);
router.put('/:id', updateBid);
router.delete('/:id', deleteBid);

module.exports = router;