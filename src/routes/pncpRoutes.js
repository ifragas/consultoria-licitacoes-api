// routes/pncpRoutes.js
const express = require('express');
const router = express.Router();
const { searchPncpBids } = require('../controllers/pncpController');

// Rota GET /api/pncp/search
router.get('/search', searchPncpBids);

module.exports = router;