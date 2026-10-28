
require('dotenv').config();

const emailService = require('./services/emailService');

const express = require('express');
const path = require('path');
const connectDB = require('./config/Database');
const cors = require('cors');
const cron = require('node-cron');

const {
  sincronizarPncp,
} = require('./services/pncpSyncService');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const companyRoutes = require('./routes/companyRoutes');
const documentRoutes = require('./routes/documentRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const reportRoutes = require('./routes/reportRoutes');
const bidRoutes = require('./routes/bidRoutes');
const pncpRoutes = require('./routes/pncpRoutes');
const savedSearchRoutes = require('./routes/savedSearchRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Servir a pasta de uploads de forma estática.
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rotas principais.
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/companies', companyRoutes);
app.use('/documents', documentRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/pncp', pncpRoutes);
app.use('/api/saved-searches', savedSearchRoutes);

async function executarSincronizacaoPncp(origem) {
  console.log(`[PNCP SYNC] Solicitação de sincronização: ${origem}`);

  try {
    const resultado = await sincronizarPncp();
    console.log(`[PNCP SYNC] Resultado (${origem}):`, resultado);
  } catch (error) {
    console.error(
      `[PNCP SYNC] Falha na sincronização (${origem}):`,
      error.response?.status || '',
      error.message
    );
  }
}

async function startServer() {
  try {
    // O banco precisa estar conectado antes da sincronização.
    await connectDB();

    console.log('[MongoDB] Conexão estabelecida.');

    // Inicia a API sem aguardar toda a importação do PNCP.
    app.listen(PORT, () => {
      console.log(`🚀 Servidor a correr na porta ${PORT}`);
    });

    // Sincronização inicial após a conexão com o banco.
    void executarSincronizacaoPncp('inicialização');

    // Executa a sincronização a cada seis horas.
    cron.schedule(
      '15 */6 * * *',
      () => {
        void executarSincronizacaoPncp('agendamento');
      },
      {
        timezone: 'America/Sao_Paulo',
      }
    );

    console.log(
      '[PNCP SYNC] Agendamento configurado para executar a cada seis horas.'
    );
  } catch (error) {
    console.error(
      '❌ Erro ao iniciar a API ou conectar ao MongoDB:',
      error
    );

    process.exit(1);
  }
}

startServer();
