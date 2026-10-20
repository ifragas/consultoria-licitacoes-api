const mongoose = require('mongoose');

const CompanySchema = new mongoose.Schema({
  cnpj: {
    type: String,
    required: [true, 'O CNPJ é obrigatório.'],
    unique: true,
    trim: true
  },
  companyName: {
    type: String,
    required: [true, 'A Razão Social é obrigatória.'],
    trim: true
  },
  tradeName: {
    type: String,
    trim: true
  },
  taxRegime: {
    type: String,
    enum: ['ME', 'EPP', 'Demais'],
    default: 'ME'
  },
  contactEmail: {
    type: String,
    trim: true,
    lowercase: true
  },
  contactPhone: {
    type: String,
    trim: true
  },
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Company', CompanySchema);