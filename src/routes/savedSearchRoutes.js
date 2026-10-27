// routes/savedSearchRoutes.js
const express = require('express');
const router = express.Router();
const SavedSearch = require('../models/SavedSearch');
const authMiddleware = require('../middlewares/authMiddleware'); // Seu middleware de autenticação JWT

// Listar buscas salvas do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const buscas = await SavedSearch.find({ user: req.user.id }).sort({ createdAt: -1 });
    res.json(buscas);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao carregar buscas salvas' });
  }
});

// Salvar nova busca
router.post('/', authMiddleware, async (req, res) => {
  try {
    const { title, termo, uf, modalidade } = req.body;
    const novaBusca = new SavedSearch({
      user: req.user.id,
      title,
      termo,
      uf,
      modalidade
    });
    await novaBusca.save();
    res.status(201).json(novaBusca);
  } catch (err) {
    res.status(500).json({ message: 'Erro ao salvar busca' });
  }
});

// Excluir busca salva
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    await SavedSearch.findOneAndDelete({ _id: req.params.id, user: req.user.id });
    res.json({ message: 'Busca removida' });
  } catch (err) {
    res.status(500).json({ message: 'Erro ao excluir busca' });
  }
});

module.exports = router;