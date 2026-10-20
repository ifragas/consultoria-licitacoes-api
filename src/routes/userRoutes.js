const express = require('express');
const router = express.Router();
const userController = require('../controllers/userController');
const verifyJWT = require('../middlewares/authMiddleware');

router.get('/', verifyJWT, userController.getUsers);
router.get('/:id', verifyJWT, userController.getUserById);
router.put('/:id', verifyJWT, userController.updateUser);
router.delete('/:id', verifyJWT, userController.deleteUser);

module.exports = router;