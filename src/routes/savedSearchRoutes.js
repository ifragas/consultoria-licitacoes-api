// routes/savedSearchRoutes.js
const express = require('express');
const router = express.Router();
const SavedSearch = require('../models/SavedSearch');
const authMiddleware = require('../middlewares/authMiddleware');

// Listar buscas salvas do usuário
router.get('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    const buscas = await SavedSearch.find({ user: userId }).sort({ createdAt: -1 });
    res.json(buscas);
  } catch (err) {
    console.error('Erro detalhado GET saved-searches:', err);
    res.status(500).json({ message: 'Erro ao carregar pesquisas salvas', error: err.message });
  }
});

// Salvar nova busca
router.post('/', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    const { title, termo, uf, modalidade } = req.body;

    if (!title || !termo) {
      return res.status(400).json({ message: 'Título e termo são obrigatórios.' });
    }

    const novaBusca = new SavedSearch({
      user: userId,
      title,
      termo,
      uf,
      modalidade
    });

    await novaBusca.save();
    res.status(201).json(novaBusca);
  } catch (err) {
    console.error('Erro detalhado POST saved-searches:', err);
    res.status(500).json({ message: 'Erro ao salvar pesquisa', error: err.message });
  }
});

// Excluir busca salva
router.delete('/:id', authMiddleware, async (req, res) => {
  try {
    const userId = req.user?.id || req.user?.userId || req.user?._id;
    await SavedSearch.findOneAndDelete({ _id: req.params.id, user: userId });
    res.json({ message: 'Busca removida' });
  } catch (err) {
    console.error('Erro detalhado DELETE saved-searches:', err);
    res.status(500).json({ message: 'Erro ao excluir busca', error: err.message });
  }
});

module.exports = router;