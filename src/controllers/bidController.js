const Bid = require('../models/Bid');
const Schedule = require('../models/Schedule');

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
        const existingSchedule = await Schedule.findOne({ bid: savedBid._id });

        if (!existingSchedule) {
          await Schedule.create({
            title: `Disputa/Abertura: ${savedBid.title}`,
            type: 'Licitação',
            eventDate: savedBid.openingDate || new Date(),
            company: savedBid.company, // Corrigido para 'company' conforme o schema do Schedule
            bid: savedBid._id,
            notes: `Órgão: ${savedBid.organ} - Valor Estimado: R$ ${savedBid.estimatedValue || 0}`
          });
        }
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
    
    // Busca a licitação atual antes de atualizar
    const existingBid = await Bid.findById(id);
    if (!existingBid) {
      return res.status(404).json({ error: 'Licitação não encontrada.' });
    }

    const updatedBid = await Bid.findByIdAndUpdate(id, req.body, { new: true, runValidators: true }).populate('company');
    
    // Automação: Se o status enviado for 'Aprovada'
    if (req.body.status === 'Aprovada') {
      try {
        const compId = updatedBid.company?._id || updatedBid.company;
        
        // Verifica se já existe um agendamento vinculado a esta licitação para evitar duplicados
        const existingSchedule = await Schedule.findOne({ bid: updatedBid._id });

        if (!existingSchedule) {
          await Schedule.create({
            title: `Disputa/Abertura: ${updatedBid.title}`,
            type: 'Licitação',
            eventDate: updatedBid.openingDate || new Date(),
            company: compId, // Corrigido para 'company' conforme o schema do Schedule
            bid: updatedBid._id,
            notes: `Órgão: ${updatedBid.organ} - Valor Estimado: R$ ${updatedBid.estimatedValue || 0}${updatedBid.editalUrl ? ` - Edital: ${updatedBid.editalUrl}` : ''}`
          });
        }
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
    
    // Opcional: Remove também o agendamento associado se a licitação for eliminada
    await Schedule.deleteMany({ bid: id });

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