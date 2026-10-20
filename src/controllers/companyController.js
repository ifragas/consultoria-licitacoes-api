const Company = require('../models/Company');

// Criar nova empresa cliente
exports.createCompany = async (req, res) => {
  try {
    const { cnpj, companyName, tradeName, taxRegime, contactEmail, contactPhone } = req.body;

    const companyExists = await Company.findOne({ cnpj });
    if (companyExists) {
      return res.status(400).json({ error: 'Já existe uma empresa registada com este CNPJ.' });
    }

    const company = new Company({
      cnpj,
      companyName,
      tradeName,
      taxRegime,
      contactEmail,
      contactPhone,
      createdBy: req.userId
    });

    await company.save();
    res.status(201).json({ message: 'Empresa cadastrada com sucesso!', company });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Listar todas as empresas
exports.getCompanies = async (req, res) => {
  try {
    const companies = await Company.find().populate('createdBy', 'name email');
    res.json(companies);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Obter detalhes de uma empresa por ID
exports.getCompanyById = async (req, res) => {
  try {
    const company = await Company.findById(req.params.id).populate('createdBy', 'name email');
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    res.json(company);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};

// Atualizar dados da empresa
exports.updateCompany = async (req, res) => {
  try {
    const company = await Company.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true, runValidators: true }
    );

    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }

    res.json({ message: 'Empresa atualizada com sucesso!', company });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

// Eliminar empresa
exports.deleteCompany = async (req, res) => {
  try {
    const company = await Company.findByIdAndDelete(req.params.id);
    if (!company) {
      return res.status(404).json({ error: 'Empresa não encontrada.' });
    }
    res.json({ message: 'Empresa eliminada com sucesso!' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
};