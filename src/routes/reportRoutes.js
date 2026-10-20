const express = require('express');
const router = express.Router();
const reportController = require('../controllers/reportController');
const authMiddleware = require('../middlewares/authMiddleware');

const auth = typeof authMiddleware === 'function' ? authMiddleware : (authMiddleware.authMiddleware || authMiddleware.default);

router.use(auth);

router.get('/expiring-documents', reportController.getExpiringDocuments);
router.get('/dashboard-summary', reportController.getDashboardSummary);

module.exports = router;