const Bid = require('../models/Bid');
const Schedule = require('../models/Schedule'); // Alterado de Appointment para Schedule conforme o seu controller

// Listar todas as licitações
const getBids = async (req, res) => {
  try {
    const bids = await Bid.find().populate('company', 'companyName name cnpj');
    res.json(bids);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Criar nova licitação
const createBid = async (req, res) => {
  try {
    const { title, organ, estimatedValue, company, status, editalUrl, openingDate, notes } = req.body;
    
    const newBid = new Bid({
      title,
      organ,
      estimatedValue,
      company,
      status: status || 'Em Análise',
      editalUrl,
      openingDate,
      notes
    });

    const savedBid = await newBid.save();

    // Se já for criada diretamente como 'Aprovada', gera o agendamento automaticamente
    if (savedBid.status === 'Aprovada') {
      try {
        await Schedule.create({
          title: `Disputa/Abertura: ${savedBid.title}`,
          type: 'Licitação', // Tipo compatível com o seu ScheduleSchema
          eventDate: savedBid.openingDate || new Date(),
          companyId: savedBid.company, // O seu ScheduleController lê companyId
          notes: `Órgão: ${savedBid.organ} - Valor Estimado: R$ ${savedBid.estimatedValue || 0}`
        });
      } catch (schedErr) {
        console.error('Erro ao gerar agendamento automático na criação:', schedErr);
      }
    }

    res.status(201).json(savedBid);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Atualizar licitação (incluindo alteração de status/aprovação)
const updateBid = async (req, res) => {
  try {
    const { id } = req.params;
    
    // Busca a licitação atual antes de atualizar para comparar o status anterior
    const existingBid = await Bid.findById(id);
    if (!existingBid) {
      return res.status(404).json({ error: 'Licitação não encontrada.' });
    }

    const updatedBid = await Bid.findByIdAndUpdate(id, req.body, { new: true, runValidators: true }).populate('company');
    
    // Automação: Se mudou para 'Aprovada' (e antes não estava aprovada)
    if (req.body.status === 'Aprovada' && existingBid.status !== 'Aprovada') {
      try {
        // Como o Schedule não tem campo bid direto no controller original, podemos buscar pelo título ou notas se quiser evitar duplicados, ou criar diretamente
        const compId = updatedBid.company?._id || updatedBid.company;
        
        await Schedule.create({
          title: `Disputa/Abertura: ${updatedBid.title}`,
          type: 'Licitação',
          eventDate: updatedBid.openingDate || new Date(),
          companyId: compId,
          notes: `Órgão: ${updatedBid.organ} - Valor Estimado: R$ ${updatedBid.estimatedValue || 0}${updatedBid.editalUrl ? ` - Edital: ${updatedBid.editalUrl}` : ''}`
        });
      } catch (schedErr) {
        console.error('Erro ao gerar agendamento automático na atualização:', schedErr);
      }
    }
    
    res.json(updatedBid);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Eliminar licitação
const deleteBid = async (req, res) => {
  try {
    const { id } = req.params;
    const deletedBid = await Bid.findByIdAndDelete(id);
    
    if (!deletedBid) {
      return res.status(404).json({ error: 'Licitação não encontrada.' });
    }
    
    res.json({ message: 'Licitação eliminada com sucesso.' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getBids,
  createBid,
  updateBid,
  deleteBid
};