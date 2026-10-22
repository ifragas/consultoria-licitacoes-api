
const cron = require('node-cron');
const { Resend } = require('resend');
const Schedule = require('../models/Schedule');

const resend = new Resend(process.env.RESEND_API_KEY);

const TIMEZONE = 'America/Sao_Paulo';

// Evita inserir conteúdo dos agendamentos diretamente no HTML sem tratamento.
function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (character) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;'
    };

    return entities[character];
  });
}

// Obtém a data atual no fuso de São Paulo.
function getDatePartsInSaoPaulo(date) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);

  const result = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      result[part.type] = Number(part.value);
    }
  }

  return {
    year: result.year,
    month: result.month,
    day: result.day
  };
}

// Converte a meia-noite de São Paulo em um instante UTC.
function saoPauloMidnightUtc(year, month, day) {
  const targetUtc = Date.UTC(year, month - 1, day);

  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(targetUtc));

  const values = {};

  for (const part of parts) {
    if (part.type !== 'literal') {
      values[part.type] = Number(part.value);
    }
  }

  const representedAsUtc = Date.UTC(
    values.year,
    values.month - 1,
    values.day,
    values.hour,
    values.minute,
    values.second
  );

  const offset = representedAsUtc - targetUtc;

  return new Date(targetUtc - offset);
}

// Retorna o início e o fim do dia seguinte em São Paulo.
// O fim é exclusivo: eventDate >= início e eventDate < fim.
function getTomorrowRange() {
  const today = getDatePartsInSaoPaulo(new Date());

  const tomorrow = new Date(
    Date.UTC(today.year, today.month - 1, today.day + 1)
  );

  const dayAfterTomorrow = new Date(
    Date.UTC(today.year, today.month - 1, today.day + 2)
  );

  const tomorrowParts = {
    year: tomorrow.getUTCFullYear(),
    month: tomorrow.getUTCMonth() + 1,
    day: tomorrow.getUTCDate()
  };

  const dayAfterParts = {
    year: dayAfterTomorrow.getUTCFullYear(),
    month: dayAfterTomorrow.getUTCMonth() + 1,
    day: dayAfterTomorrow.getUTCDate()
  };

  return {
    start: saoPauloMidnightUtc(
      tomorrowParts.year,
      tomorrowParts.month,
      tomorrowParts.day
    ),
    end: saoPauloMidnightUtc(
      dayAfterParts.year,
      dayAfterParts.month,
      dayAfterParts.day
    )
  };
}

function formatEventDate(date) {
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: TIMEZONE,
    dateStyle: 'short',
    timeStyle: 'short'
  }).format(new Date(date));
}

function buildEmailHtml({
  companyName,
  title,
  eventDateFormatted
}) {
  const safeCompanyName = escapeHtml(companyName);
  const safeTitle = escapeHtml(title);
  const safeEventDate = escapeHtml(eventDateFormatted);

  return `
    <!DOCTYPE html>
    <html lang="pt-BR">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Lembrete Gestorae</title>
      </head>
      <body style="
        margin: 0;
        padding: 0;
        background-color: #f3f4f6;
        font-family: Arial, Helvetica, sans-serif;
        color: #1f2937;
      ">
        <div style="
          max-width: 600px;
          margin: 30px auto;
          padding: 0 15px;
        ">
          <div style="
            background-color: #ffffff;
            border-radius: 12px;
            overflow: hidden;
            border: 1px solid #e5e7eb;
          ">
            <div style="
              background-color: #111827;
              color: #ffffff;
              padding: 28px 24px;
              text-align: center;
            ">
              <h1 style="
                margin: 0;
                font-size: 26px;
                letter-spacing: 0.5px;
              ">Gestorae</h1>

              <p style="
                margin: 8px 0 0;
                color: #d1d5db;
                font-size: 14px;
              ">Gestão e acompanhamento de licitações</p>
            </div>

            <div style="padding: 30px 24px;">
              <h2 style="
                margin-top: 0;
                color: #111827;
                font-size: 22px;
              ">Lembrete de agendamento</h2>

              <p style="font-size: 15px; line-height: 1.7;">
                Este é um lembrete de que você possui um evento agendado
                para amanhã no sistema Gestorae.
              </p>

              <div style="
                margin: 24px 0;
                padding: 20px;
                background-color: #f9fafb;
                border: 1px solid #e5e7eb;
                border-left: 4px solid #2563eb;
                border-radius: 6px;
              ">
                <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280;">
                  EVENTO
                </p>

                <p style="
                  margin: 0 0 20px;
                  font-size: 18px;
                  font-weight: bold;
                  color: #111827;
                ">${safeTitle}</p>

                <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280;">
                  DATA E HORÁRIO
                </p>

                <p style="
                  margin: 0 0 20px;
                  font-size: 16px;
                  font-weight: bold;
                ">${safeEventDate}</p>

                <p style="margin: 0 0 8px; font-size: 13px; color: #6b7280;">
                  EMPRESA
                </p>

                <p style="margin: 0; font-size: 15px;">
                  ${safeCompanyName}
                </p>
              </div>

              <p style="font-size: 14px; line-height: 1.7;">
                Recomendamos conferir os detalhes do evento e preparar
                antecipadamente a documentação necessária.
              </p>

              <p style="font-size: 14px; line-height: 1.7;">
                Este e-mail foi enviado automaticamente pelo sistema
                Gestorae. Não é necessário responder a esta mensagem.
              </p>
            </div>

            <div style="
              padding: 18px 24px;
              background-color: #f9fafb;
              border-top: 1px solid #e5e7eb;
              text-align: center;
              color: #6b7280;
              font-size: 12px;
            ">
              © ${new Date().getFullYear()} Gestorae — Todos os direitos reservados.
            </div>
          </div>
        </div>
      </body>
    </html>
  `;
}

async function processScheduledReminders() {
  console.log('[GESTORAE CRON] Iniciando verificação de lembretes.');

  try {
    if (!process.env.RESEND_API_KEY) {
      console.error(
        '[GESTORAE CRON] RESEND_API_KEY não está configurada.'
      );
      return;
    }

    const { start, end } = getTomorrowRange();

    console.log(
      `[GESTORAE CRON] Período pesquisado: ${start.toISOString()} até ${end.toISOString()}`
    );

    const schedulesToNotify = await Schedule.find({
      eventDate: {
        $gte: start,
        $lt: end
      },
      notificationEmail: {
        $exists: true,
        $ne: ''
      },
      // Inclui registros antigos que não tenham o campo emailSent.
      $or: [
        { emailSent: false },
        { emailSent: { $exists: false } }
      ],
      status: { $ne: 'Cancelado' }
    }).populate('company');

    console.log(
      `[GESTORAE CRON] Agendamentos encontrados: ${schedulesToNotify.length}`
    );

    for (const schedule of schedulesToNotify) {
      try {
        const companyName =
          schedule.company?.companyName ||
          schedule.company?.name ||
          'Cliente não informado';

        const eventDateFormatted = formatEventDate(schedule.eventDate);

        const emailHtml = buildEmailHtml({
          companyName,
          title: schedule.title || 'Evento agendado',
          eventDateFormatted
        });

        console.log(
          `[GESTORAE CRON] Enviando lembrete para ${schedule.notificationEmail}`
        );

        const { data, error } = await resend.emails.send({
          from: 'Gestorae <onboarding@resend.dev>',
          to: schedule.notificationEmail,
          subject: `[Gestorae] Lembrete: "${schedule.title || 'Evento agendado'}" ocorre amanhã!`,
          html: emailHtml
        });

        // O SDK pode retornar um erro sem lançar uma exceção.
        if (error) {
          console.error(
            `[GESTORAE CRON] Resend rejeitou o e-mail para ${schedule.notificationEmail}:`,
            error
          );
          continue;
        }

        if (!data?.id) {
          console.error(
            `[GESTORAE CRON] O Resend não retornou um ID para ${schedule.notificationEmail}. O agendamento não será marcado como enviado.`
          );
          continue;
        }

        // Só marca como enviado depois de confirmar a aceitação pela API.
        schedule.emailSent = true;
        await schedule.save();

        console.log(
          `[GESTORAE CRON] E-mail aceito pelo Resend. ID: ${data.id}. Destinatário: ${schedule.notificationEmail}`
        );
      } catch (emailError) {
        console.error(
          `[GESTORAE CRON] Falha ao processar o agendamento ${schedule._id}:`,
          emailError
        );
      }
    }

    console.log('[GESTORAE CRON] Verificação finalizada.');
  } catch (error) {
    console.error(
      '[GESTORAE CRON] Erro ao consultar os agendamentos:',
      error
    );
  }
}

// Executa diariamente às 08h05 no horário de Brasília.
cron.schedule(
  '5 8 * * *',
  () => {
    processScheduledReminders();
  },
  {
    timezone: TIMEZONE
  }
);

console.log(
  '[GESTORAE CRON] Serviço registrado para executar diariamente às 08:05 (America/Sao_Paulo).'
);

// Exportação opcional para permitir testes manuais.
module.exports = {
  processScheduledReminders
};
