const mongoose = require('mongoose');

const scheduleSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'O título do evento/prazo é obrigatório.'],
    trim: true
  },
  type: {
    type: String,
    enum: [
      'Abertura de Propostas',
      'Disputa / Lances',
      'Habilitação',
      'Impugnação / Esclarecimento',
      'Resultado / Homologação',
      'Outro'
    ],
    default: 'Abertura de Propostas'
  },
  eventDate: {
    type: Date,
    required: [true, 'A data e hora do evento são obrigatórias.']
  },
  company: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Company',
    required: [true, 'A empresa cliente deve ser associada.']
  },
  assignedTo: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User'
  },
  status: {
    type: String,
    enum: ['Pendente', 'EmAndamento', 'Concluido', 'Cancelado'],
    default: 'Pendente'
  },
  locationOrUrl: {
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

module.exports = mongoose.model('Schedule', scheduleSchema);