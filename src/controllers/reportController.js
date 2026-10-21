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
// Resumo Geral do Dashboard (incluindo soma financeira)
const getDashboardSummary = async (req, res) => {
  try {
    const today = new Date();
    const thirtyDaysFromNow = new Date();
    thirtyDaysFromNow.setDate(today.getDate() + 30);

    // Consultas e agregações em paralelo
    const [
      totalCompanies,
      totalPendingSchedules,
      expiringDocsCount,
      financialAggregation
    ] = await Promise.all([
      Company.countDocuments(),
      Schedule.countDocuments({ status: { $in: ['Pendente', 'EmAndamento'] } }),
      Document.countDocuments({ expirationDate: { $lte: thirtyDaysFromNow } }),
      // Agregação no MongoDB para somar o valor das licitações ativas
      Schedule.aggregate([
        { 
          $match: { 
            status: { $in: ['Pendente', 'EmAndamento'] } 
          } 
        },
        { 
          $group: { 
            _id: null, 
            totalAmount: { $sum: { $ifNull: ['$value', 0] } } // Altera '$value' para o nome do campo de valor na tua Model se for diferente (ex: '$estimatedValue')
          } 
        }
      ])
    ]);

    const totalFinancialValue = financialAggregation.length > 0 ? financialAggregation[0].totalAmount : 0;

    res.json({
      totalCompanies,
      totalPendingSchedules,
      expiringDocsCount,
      totalFinancialValue // <-- Novo indicador financeiro retornado
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getExpiringDocuments,
  getDashboardSummary
};