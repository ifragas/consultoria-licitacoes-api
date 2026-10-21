const Bid = require('../models/Bid');

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
    res.status(201).json(savedBid);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Atualizar licitação (incluindo alteração de status/aprovação)
const updateBid = async (req, res) => {
  try {
    const { id } = req.params;
    const updatedBid = await Bid.findByIdAndUpdate(id, req.body, { new: true, runValidators: true });
    
    if (!updatedBid) {
      return res.status(404).json({ error: 'Licitação não encontrada.' });
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