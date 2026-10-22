const cron = require('node-cron');
const { Resend } = require('resend');
const Schedule = require('../models/Schedule');

const resend = new Resend(process.env.RESEND_API_KEY);

// Executa diariamente às 08:05 da manhã
cron.schedule('5 8 * * *', async () => {
  try {
    console.log('A verificar agendamentos para disparo de lembretes (Gestorae) às 08:05...');

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
      const companyName = schedule.company?.companyName || schedule.company?.name || 'Cliente não informado';
      const eventDateFormatted = new Date(schedule.eventDate).toLocaleString('pt-BR', {
        dateStyle: 'short',
        timeStyle: 'short'
      });

      await resend.emails.send({
        from: 'Gestorae <onboarding@resend.dev>', // No plano gratuito do Resend, usa-se este remetente padrão
        to: schedule.notificationEmail,
        subject: `[Gestorae] Lembrete: O evento "${schedule.title}" ocorre amanhã!`,
        html: `
          <div style="font-family: Arial, sans-serif; color: #333333; max-width: 600px; margin: 0 auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 16px; background-color: #ffffff;">
            <div style="margin-bottom: 20px; text-align: center;">
              <h1 style="color: #2563eb; margin: 0; font-size: 24px; font-weight: bold;">Gestorae</h1>
              <p style="color: #64748b; font-size: 14px; margin-top: 4px;">Gestão Inteligente de Licitações e Processos</p>
            </div>

            <div style="background-color: #f8fafc; border-left: 4px solid #2563eb; padding: 16px; border-radius: 8px; margin-bottom: 20px;">
              <h2 style="color: #1e293b; font-size: 18px; margin: 0 0 8px 0;">Lembrete de Compromisso Agendado</h2>
              <p style="margin: 0; color: #475569; font-size: 14px;">Olá! Este é um aviso automático informando que falta exatamente <strong>1 dia</strong> para o ato agendado no sistema.</p>
            </div>

            <table style="width: 100%; border-collapse: collapse; margin-bottom: 20px; font-size: 14px;">
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-weight: bold; width: 35%;">Título / Objeto:</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${schedule.title}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Empresa Cliente:</td>
                <td style="padding: 8px 0; color: #2563eb; font-weight: 600;">${companyName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Tipo de Evento:</td>
                <td style="padding: 8px 0; color: #0f172a;">${schedule.type}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Data e Hora:</td>
                <td style="padding: 8px 0; color: #0f172a; font-weight: 600;">${eventDateFormatted}</td>
              </tr>
              ${schedule.locationOrUrl ? `
              <tr>
                <td style="padding: 8px 0; color: #64748b; font-weight: bold;">Edital / Link:</td>
                <td style="padding: 8px 0;"><a href="${schedule.locationOrUrl.startsWith('http') ? schedule.locationOrUrl : `https://${schedule.locationOrUrl}`}" target="_blank" style="color: #2563eb; text-decoration: underline;">Acessar Edital</a></td>
              </tr>
              ` : ''}
            </table>

            ${schedule.notes ? `
            <div style="background-color: #fffbebf8; border: 1px solid #fef3c7; padding: 12px 16px; border-radius: 8px; margin-bottom: 20px;">
              <span style="font-size: 12px; font-weight: bold; color: #b45309; text-transform: uppercase;">Observações:</span>
              <p style="margin: 4px 0 0 0; color: #78350f; font-size: 13px;">${schedule.notes}</p>
            </div>
            ` : ''}

            <hr style="border: none; border-top: 1px solid #e2e8f0; margin: 24px 0 16px 0;" />

            <div style="text-align: center; font-size: 12px; color: #94a3b8;">
              <p style="margin: 0;">Este e-mail foi gerado automaticamente pelo sistema <strong>Gestorae</strong>.</p>
            </div>
          </div>
        `
      });

      schedule.emailSent = true;
      await schedule.save();

      console.log(`Lembrete Gestorae enviado via Resend para: ${schedule.notificationEmail}`);
    }
  } catch (error) {
    console.error('Erro ao processar o envio de e-mails agendados com Resend:', error);
  }
});