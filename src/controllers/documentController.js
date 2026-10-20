const Document = require('../models/Document');
const Company = require('../models/Company');
const { uploadToSupabase } = require('../services/supabaseStorageService');

const createDocument = async (req, res) => {
  try {
    const { title, category, expirationDate, companyId, notes } = req.body;

    const company = await Company.findById(companyId);
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    let fileUrl = null;
    if (req.file) {
      // Envia o ficheiro para o Supabase e obtém a URL pública
      fileUrl = await uploadToSupabase(req.file);
    }

    const document = new Document({
      title,
      category,
      expirationDate,
      company: companyId,
      fileUrl,
      notes
    });

    await document.save();
    res.status(201).json({ message: 'Documento registado com sucesso no Supabase!', document });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateDocument = async (req, res) => {
  try {
    const updateData = { ...req.body };

    if (req.file) {
      updateData.fileUrl = await uploadToSupabase(req.file);
    }

    const document = await Document.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    );

    if (!document) {
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }

    res.json({ message: 'Documento atualizado com sucesso!', document });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getDocuments = async (req, res) => {
  try {
    const { companyId } = req.query;
    const filter = companyId ? { company: companyId } : {};
    const documents = await Document.find(filter).populate('company', 'companyName cnpj');
    res.json(documents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const getDocumentById = async (req, res) => {
  try {
    const document = await Document.findById(req.params.id).populate('company', 'companyName cnpj');
    if (!document) {
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }
    res.json(document);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

const deleteDocument = async (req, res) => {
  try {
    const document = await Document.findByIdAndDelete(req.params.id);
    if (!document) {
      return res.status(404).json({ error: 'Documento não encontrado.' });
    }
    res.json({ message: 'Documento eliminado com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  createDocument,
  getDocuments,
  getDocumentById,
  updateDocument,
  deleteDocument
};