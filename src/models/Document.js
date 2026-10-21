const mongoose = require('mongoose');

const DocumentSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'O título do documento é obrigatório.'],
    trim: true
  },
  category: {
    type: String,
    enum: ['Habilitação Jurídica', 'Regularidade Fiscal', 'Qualificação Técnica', 'Qualificação Econômico-Financeira', 'Outros'],
    default: 'Regularidade Fiscal'
  },
  expirationDate: {
    type: Date,
    required: false // Alterado para false para permitir documentos sem validade
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'A empresa vinculada é obrigatória.']
  },
  fileUrl: {
    type: String,
    trim: true
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

// Virtual para verificar se o documento está vencido
DocumentSchema.virtual('isExpired').get(function() {
  if (!this.expirationDate) return false;
  return this.expirationDate < new Date();
});

DocumentSchema.set('toJSON', { virtuals: true });

module.exports = mongoose.model('Document', DocumentSchema);