const express = require('express');
const router = express.Router();
const companyController = require('../controllers/companyController');
const verifyJWT = require('../middlewares/authMiddleware');

// Todas as rotas de empresas requerem autenticação
router.use(verifyJWT);

router.post('/', companyController.createCompany);
router.get('/', companyController.getCompanies);
router.get('/:id', companyController.getCompanyById);
router.put('/:id', companyController.updateCompany);
router.delete('/:id', companyController.deleteCompany);

module.exports = router;