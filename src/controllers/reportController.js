const Document = require('../models/Document');
const Schedule = require('../models/Schedule');
const Company = require('../models/Company');

// Relatório de Documentos Vencidos ou a Caducar
const getExpiringDocuments = async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 30; // Padrão: 30 dias
    const today = new Date();
    
    // Calcula a data limite no futuro
    const targetDate = new Date();
    targetDate.setDate(today.getDate() + days);

    // Procura documentos com data de expiração menor ou igual à data limite
    const documents = await Document.find({
      expirationDate: { $lte: targetDate }
    })
      .populate('company', 'companyName cnpj')
      .sort({ expirationDate: 1 });

    const result = documents.map(doc => {
      const isExpired = new Date(doc.expirationDate) < today;
      return {
        ...doc._doc,
        status: isExpired ? 'VENCIDO' : 'A_VENCER'
      };
    });

    res.json({
      timeframeDays: days,
      totalFound: result.length,
      documents: result
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Resumo Geral do Dashboard
const getDashboardSummary = async (req, res) => {
  try {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    // Consultas em paralelo na base de dados para maior velocidade
    const [totalCompanies, totalPendingSchedules, expiringDocsCount] = await Promise.all([
      Company.countDocuments(),
      Schedule.countDocuments({ status: { $in: ['Pendente', 'EmAndamento'] } }),
      Document.countDocuments({ expirationDate: { $lte: thirtyDaysFromNow } })
    ]);

    res.json({
      totalCompanies,
      totalPendingSchedules,
      expiringDocsCount
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getExpiringDocuments,
  getDashboardSummary
};