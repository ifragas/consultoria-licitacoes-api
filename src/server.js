
require('dotenv').config();

const emailService = require('./services/emailService');

const express = require('express');
const path = require('path');
const connectDB = require('./config/Database');
const cors = require('cors');

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const companyRoutes = require('./routes/companyRoutes');
const documentRoutes = require('./routes/documentRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const reportRoutes = require('./routes/reportRoutes');
const bidRoutes = require('./routes/bidRoutes');
const pncpRoutes = require('./routes/pncpRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Servir a pasta de uploads de forma estática
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rotas principais
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/companies', companyRoutes);
app.use('/documents', documentRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/bids', bidRoutes);
app.use('/api/pncp', pncpRoutes);

// Inicialização da aplicação
async function startServer() {
  try {
    // Aguarda a conexão com o MongoDB
    await connectDB();

    app.listen(PORT, () => {
      console.log(`🚀 Servidor a correr na porta ${PORT}`);
    });

  } catch (error) {
    console.error(
      '❌ Erro ao iniciar a API ou conectar ao MongoDB:',
      error
    );

    process.exit(1);
  }
}

startServer();
