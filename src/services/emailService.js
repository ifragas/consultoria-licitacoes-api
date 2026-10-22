const cron = require('node-cron');
const nodemailer = require('nodemailer');
const Schedule = require('../models/Schedule');

const transporter = nodemailer.createTransport({
  host: process.env.EMAIL_HOST || 'smtp.gmail.com',
  port: process.env.EMAIL_PORT || 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS
  }
});

// Executa todos os dias às 08:05 da manhã (horário em que a API no Render já estará acordada e em uso)
cron.schedule('5 8 * * *', async () => {
  try {
    console.log('A verificar agendamentos para disparo de lembretes às 08:05...');

    const now = new Date();
    const tomorrowStart = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 2);

    const schedulesToNotify = await Schedule.find({
      eventDate: { $gte: tomorrowStart,$lt: tomorrowEnd },
      notificationEmail: { $exists: true,$ne: '' },
      emailSent: false,
      status: { $ne: 'Cancelado' }
    }).populate('company');

    for (const schedule of schedulesToNotify) {
      const companyName = schedule.company?.companyName || schedule.company?.name || 'Cliente';
      
      const mailOptions = {
        from: `"LicitaHub Notificações" <${process.env.EMAIL_USER}>`,
        to: schedule.notificationEmail,
        subject: `Lembrete: O evento "${schedule.title}" ocorre amanhã!`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #333; padding: 20px; border: 1px solid #e2e8f0; border-radius: 10px;">
            <h2 style="color: #2563eb;">Lembrete de Licitação / Prazo - LicitaHub</h2>
            <p>Olá! Este é um aviso automático de que falta exatamente <strong>um dia</strong> para o compromisso agendado:</p>
            <ul>
              <li><strong>Evento:</strong> ${schedule.title}</li>
              <li><strong>Cliente / Empresa:</strong> ${companyName}</li>
              <li><strong>Tipo:</strong> ${schedule.type}</li>
              <li><strong>Data e Hora:</strong> ${new Date(schedule.eventDate).toLocaleString('pt-PT')}</li>
              ${schedule.locationOrUrl ? `<li><strong>Local / Link:</strong> <a href="${schedule.locationOrUrl}" target="_blank">Aceder</a></li>` : ''}
            </ul>
            <p>Notas: ${schedule.notes || 'Nenhuma observação informada.'}</p>
            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 20px 0;" />
            <p style="font-size: 12px; color: #64748b;">LicitaHub - Sistema de Gestão e Garimpo de Licitações</p>
          </div>
        `
      };

      await transporter.sendMail(mailOptions);
      
      schedule.emailSent = true;
      await schedule.save();

      console.log(`E-mail de lembrete enviado com sucesso para: ${schedule.notificationEmail}`);
    }
  } catch (error) {
    console.error('Erro ao processar o envio de e-mails agendados:', error);
  }
});