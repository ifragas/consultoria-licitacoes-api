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

    if (savedBid.status === 'Aprovada') {
      try {
        const existingSchedule = await Schedule.findOne({ bid: savedBid._id });

        if (!existingSchedule && savedBid.company) {
          await Schedule.create({
            title: `Disputa/Abertura: ${savedBid.title}`,
            type: 'Abertura de Propostas', // Valor válido exato do enum do Schedule
            eventDate: savedBid.openingDate || new Date(),
            company: savedBid.company,
            bid: savedBid._id,
            notes: `Órgão: ${savedBid.organ} - Valor Estimado: R$ ${savedBid.estimatedValue || 0}`
          });
          console.log('Agendamento criado com sucesso na criação da licitação!');
        }
      } catch (schedErr) {
        console.error('Erro ao gerar agendamento automático na criação:', schedErr.message);
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
    
    const updatedBid = await Bid.findByIdAndUpdate(id, req.body, { returnDocument: 'after', runValidators: true }).populate('company');
    
    if (!updatedBid) {
      return res.status(404).json({ error: 'Licitação não encontrada.' });
    }
    
    if (updatedBid.status === 'Aprovada') {
      try {
        const compId = updatedBid.company?._id || updatedBid.company;
        
        if (compId) {
          const existingSchedule = await Schedule.findOne({ bid: updatedBid._id });

          if (!existingSchedule) {
            await Schedule.create({
              title: `Disputa/Abertura: ${updatedBid.title}`,
              type: 'Abertura de Propostas', // Valor válido exato do enum do Schedule
              eventDate: updatedBid.openingDate || new Date(),
              company: compId,
              bid: updatedBid._id,
              notes: `Órgão: ${updatedBid.organ} - Valor Estimado: R$ ${updatedBid.estimatedValue || 0}${updatedBid.editalUrl ? ` - Edital: ${updatedBid.editalUrl}` : ''}`
            });
            console.log('Agendamento automático gerado com sucesso para a licitação aprovada!');
          } else {
            console.log('Agendamento para esta licitação já existia.');
          }
        } else {
          console.log('Aviso: A licitação aprovada não tem uma empresa associada, o agendamento não foi gerado.');
        }
      } catch (schedErr) {
        console.error('Erro detalhado ao gerar agendamento automático na atualização:', schedErr.message);
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