
const express = require('express');
const router = express.Router();

const {
  searchPncpBids,
  startPncpSearch,
  getPncpSearchJob,
} = require('../controllers/pncpController');

// Pesquisa tradicional, sem termos.
router.get('/search', searchPncpBids);

// Inicia uma pesquisa por palavras-chave em segundo plano.
router.post('/search/jobs', startPncpSearch);

// Consulta progresso e resultados parciais/finais.
router.get('/search/jobs/:id', getPncpSearchJob);

module.exports = router;
