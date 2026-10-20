const Schedule = require('../models/Schedule');
const Company = require('../models/Company');

// Criar um novo agendamento/prazo
const createSchedule = async (req, res) => {
  try {
    const { title, type, eventDate, companyId, assignedTo, locationOrUrl, notes } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    // Identifica o ID do utilizador com segurança (verifica req.user.id, req.user._id ou req.user)
    const userId = req.user?.id || req.user?._id || req.user;

    const schedule = new Schedule({
      title,
      type,
      eventDate,
      company: companyId,
      assignedTo: assignedTo || userId, 
      locationOrUrl,
      notes
    });

    await schedule.save();
    res.status(201).json({ message: 'Agendamento criado com sucesso!', schedule });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Listar agendamentos com filtros (por semana, mês ou empresa)
const getSchedules = async (req, res) => {
  try {
    const { companyId, startDate, endDate, status } = req.query;
    const filter = {};

    if (companyId) filter.company = companyId;
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.eventDate = {};
      if (startDate) filter.eventDate.$gte = new Date(startDate);
      if (endDate) filter.eventDate.$lte = new Date(endDate);
    }

    const schedules = await Schedule.find(filter)
      .populate('company', 'companyName cnpj')
      .populate('assignedTo', 'name email')
      .sort({ eventDate: 1 });

    res.json(schedules);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obter um agendamento específico por ID
const getScheduleById = async (req, res) => {
  try {
    const schedule = await Schedule.findById(req.params.id)
      .populate('company', 'companyName cnpj')
      .populate('assignedTo', 'name email');

    if (!schedule) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }
    res.json(schedule);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Atualizar status ou detalhes do agendamento
const updateSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!schedule) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }

    res.json({ message: 'Agendamento atualizado com sucesso!', schedule });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Eliminar agendamento
const deleteSchedule = async (req, res) => {
  try {
    const schedule = await Schedule.findByIdAndDelete(req.params.id);
    if (!schedule) {
      return res.status(404).json({ error: 'Agendamento não encontrado.' });
    }
    res.json({ message: 'Agendamento eliminado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Garante que todas as funções usadas nas rotas são exportadas aqui!
module.exports = {
  createSchedule,
  getSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule
};