const express = require('express');
const router = express.Router();
const documentController = require('../controllers/documentController');
const verifyJWT = require('../middlewares/authMiddleware');
const upload = require('../middlewares/uploadMiddleware');

router.use(verifyJWT);

router.post('/', upload.single('file'), documentController.createDocument);
router.get('/', documentController.getDocuments);
router.get('/:id', documentController.getDocumentById);
router.put('/:id', upload.single('file'), documentController.updateDocument);
router.delete('/:id', documentController.deleteDocument);

module.exports = router;