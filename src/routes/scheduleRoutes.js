const express = require('express');
const router = express.Router();
const scheduleController = require('../controllers/scheduleController');
const authMiddleware = require('../middlewares/authMiddleware');

router.post('/test-email', scheduleController.testEmailSend);
// Garante que o middleware é uma função, independentemente de como foi exportado
const auth = typeof authMiddleware === 'function' ? authMiddleware : (authMiddleware.authMiddleware || authMiddleware.default);

// Validação de segurança para garantir que as funções existem antes de registar
if (!auth) {
  throw new Error('O authMiddleware não foi importado corretamente como uma função.');
}
if (!scheduleController.createSchedule) {
  throw new Error('A função createSchedule não foi encontrada no scheduleController.');
}

// Aplica a autenticação em todas as rotas de agendamento
router.use(auth);

// Definição das rotas
router.post('/', scheduleController.createSchedule);
router.get('/', scheduleController.getSchedules);
router.get('/:id', scheduleController.getScheduleById);
router.put('/:id', scheduleController.updateSchedule);
router.delete('/:id', scheduleController.deleteSchedule);


module.exports = router;