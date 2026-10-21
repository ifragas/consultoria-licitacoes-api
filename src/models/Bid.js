const mongoose = require('mongoose');

const bidSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'O título ou objeto da licitação é obrigatório.'],
    trim: true
  },
  organ: {
    type: String,
    required: [true, 'O órgão licitante é obrigatório.'],
    trim: true
  },
  estimatedValue: {
    type: Number,
    default: 0
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'A empresa associada é obrigatória.']
  },
  status: {
    type: String,
    enum: ['Em Análise', 'Aprovada', 'Rejeitada', 'Vencida', 'Concluída'],
    default: 'Em Análise'
  },
  editalUrl: {
    type: String,
    trim: true
  },
  openingDate: {
    type: Date
  },
  notes: {
    type: String,
    trim: true
  }
}, {
  timestamps: true
});

module.exports = mongoose.model('Bid', bidSchema);