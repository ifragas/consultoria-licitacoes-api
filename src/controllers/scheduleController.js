const Schedule = require('../models/Schedule');
const Company = require('../models/Company');

const createSchedule = async (req, res) => {
  try {
    const { title, type, eventDate, companyId, assignedTo, locationOrUrl, notes, notificationEmail, bidId } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    const userId = req.user?.id || req.user?._id || req.user;

    const schedule = new Schedule({
      title,
      type,
      eventDate,
      company: companyId,
      assignedTo: assignedTo || userId, 
      locationOrUrl,
      notes,
      notificationEmail,
      bid: bidId || null
    });

    await schedule.save();
    res.status(201).json({ message: 'Agendamento criado com sucesso!', schedule });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

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

const { Resend } = require('resend');
const resend = new Resend(process.env.RESEND_API_KEY);

const testEmailSend = async (req, res) => {
  try {
    const { email } = res.req ? req.body : req;
    const targetEmail = email || 'ianfraga92@gmail.com';

    const data = await resend.emails.send({
      from: 'Gestorae <onboarding@resend.dev>',
      to: [targetEmail],
      subject: '[Gestorae] Teste de Envio de E-mail via Resend 🚀',
      html: `
        <div style="font-family: Arial, sans-serif; color: #333333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
          <div style="margin-bottom: 20px; text-align: center;">
            <h1 style="color: #2563eb; margin: 0; font-size: 24px; font-weight: bold;">Gestorae</h1>
            <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Gestão Inteligente de Licitações e Processos</p>
          </div>

          <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
            <h2 style="color: #15803d; font-size: 18px; margin: 0 0 8px 0;">Teste via Resend bem-sucedido! 🎉</h2>
            <p style="margin: 0; color: #166534; font-size: 14px;">A integração HTTP com o Resend no Render está a funcionar perfeitamente.</p>
          </div>

          <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />

          <div style="text-align: center; font-size: 12px; color: #94a3b8;">
            <p style="margin: 0;">E-mail de teste gerado pelo sistema <strong>Gestorae</strong>.</p>
          </div>
        </div>
      `
    });

    res.json({ message: 'E-mail de teste da Gestorae disparado com sucesso via Resend!', data });
  } catch (error) {
    console.error('Erro ao enviar e-mail de teste via Resend:', error);
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createSchedule,
  getSchedules,
  getScheduleById,
  updateSchedule,
  deleteSchedule,
  testEmailSend
};