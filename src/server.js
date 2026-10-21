require('dotenv').config();
const express = require('express');
const path = require('path'); // Importar módulo path
const connectDB = require('./config/Database');
const cors = require('cors'); // 1. Importar o pacote cors

const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const companyRoutes = require('./routes/companyRoutes');
const documentRoutes = require('./routes/documentRoutes');
const scheduleRoutes = require('./routes/scheduleRoutes');
const reportRoutes = require('./routes/reportRoutes');
const bidRoutes = require('./routes/bidRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(cors());

// Servir a pasta de uploads de forma estática
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Conectar ao Banco de Dados
connectDB();

// Rotas Principais
app.use('/auth', authRoutes);
app.use('/users', userRoutes);
app.use('/companies', companyRoutes);
app.use('/documents', documentRoutes);
app.use('/api/schedules', scheduleRoutes);
app.use('/api/reports', reportRoutes);
app.use('/api/bids', bidRoutes);

app.listen(PORT, () => {
  console.log(`🚀 Servidor a correr na porta ${PORT}`);
});