const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const verifyJWT = require('../middlewares/authMiddleware');

router.post('/register', authController.register);
router.post('/login', authController.login);
router.post('/refresh', authController.refresh);
router.post('/logout', verifyJWT, authController.logout);

module.exports = router;